import { useEffect, useMemo, useRef } from "react"
import { useFrame, useThree } from "@react-three/fiber"
import * as THREE from "three"
import {
  AudioFrame,
  useAudioDynamicsStore,
} from "../stores/audio-dynamics-store"
import { useThemeStore } from "../stores/theme-store"
import { Hct } from "@material/material-color-utilities"

const VOXEL_N = 96
const VOXEL_COUNT = VOXEL_N * VOXEL_N * VOXEL_N
// 異方性 stride: voxel coord → state index は線形変換.
// 主対角線方向 (1,1,1) は STRIDE_PARA、直交方向は uStridePerp (uniform)。
// state buffer は 1 sample 刻みで保持し、最大 state-index = (VOXEL_N-1)*STRIDE_PARA = 760
// に余裕を持って 768 (= 256×3) を確保。
const SAMPLE_STRIDE_PARA = 232       // GLSL 内 const として埋込 (state buffer サイズに直結)
const SAMPLE_STRIDE_PERP_INITIAL = 8.0   // uStridePerp の初期値、ランタイム可変
const STATE_COUNT = Math.ceil(((VOXEL_N - 1) * SAMPLE_STRIDE_PARA + 1) / 256) * 256
// 2D texture layout: 1D だと MAX_TEXTURE_SIZE (典型 16384) を超える場合があるため
// (TEX_W × TEX_H) の長方形に並べ替えて回避する.
// TEX_W は GPU cache 親和性で 256 アラインの 1024 を採用、TEX_H は容量に合わせて切上.
const TEX_W = 1024
const TEX_H = Math.ceil(STATE_COUNT / TEX_W)
const TEX_PIXELS = TEX_W * TEX_H
const TAU_DELAY = 8
// stateJ (Side) で readL に加える時間オフセット (sample 単位).
// モノラル時 stateJ = signal(idx+offset) - signal(idx) の時間差分ベクトルになり、
// 0 ベクトルにならず紋が出るようになる. iso-directional recurrence 風.
const SIDE_OFFSET = 8
// Phyllotactic shifts: 3 つの異なる Fibonacci 比のシフトで C₃ 巡回対称も崩す.
// state-index (= sample) 単位. 旧 voxel 単位 (3, 5, 8) × SAMPLE_STRIDE_PARA(8) = (24, 40, 64).
const SHIFT_IJ = 24
const SHIFT_JK = 40
const SHIFT_KI = 64
const FADE_POWER = 1.0
const RECURRENCE_EPSILON = 0.5   // cosine 距離用スケール
// Pitch coloring: pitch を半音 hue にして HSV→RGB 変換する.
// Sat/Val は uniform でランタイム可変.
const PITCH_SAT = 0.7
const PITCH_VAL = 1.0
const POINT_SIZE_BASE = 6.0
const INTENSITY_CUTOFF = 0.04     // intensity 範囲 [0, 1] 用 (sharper 化に伴い緩和)
const SCREEN_SCALE = 1.2
// Outer Lp combine: 黄金比系の不等重みで巡回対称も崩す
const W_A = 1.0
const W_B = 0.618    // φ⁻¹
const W_C = 0.382    // φ⁻²
const COMBINE_P = 3.0
const RING_SIZE = STATE_COUNT + 4 * TAU_DELAY + 4096

const VERTEX_SHADER = `
  uniform sampler2D uStatesL;
  uniform sampler2D uStatesR;
  uniform float uEpsilon;
  uniform float uFadePower;
  uniform float uPointSize;
  uniform float uCutoff;
  uniform float uScale;
  uniform float uAspect;
  uniform float uShiftIJ;
  uniform float uShiftJK;
  uniform float uShiftKI;
  uniform float uWA;
  uniform float uWB;
  uniform float uWC;
  uniform float uCombineP;
  uniform float uStridePerp;   // 直交方向 stride (sample/voxel). 主対角線方向は STRIDE_PARA 固定.
  uniform vec3 uColor;          // pitch 未検出時のフォールバック色 (テーマ色)
  uniform float uPitchSat;
  uniform float uPitchVal;

  varying float vIntensity;
  varying vec3 vColor;

  const float SQRT_2 = 1.41421356;
  const float SQRT_6 = 2.44948975;
  const float N_F = ${VOXEL_N.toFixed(1)};
  const float STATE_F = ${STATE_COUNT.toFixed(1)};
  const float STRIDE_PARA = ${SAMPLE_STRIDE_PARA.toFixed(1)};
  const float SIDE_OFFSET = ${SIDE_OFFSET.toFixed(1)};
  // 2D texture layout: 1D index → (x, y) で展開して MAX_TEXTURE_SIZE 制約を回避.
  const float TEX_W = ${TEX_W.toFixed(1)};
  const float TEX_H = ${TEX_H.toFixed(1)};

  vec2 idxToUV(float idx) {
    float x = mod(idx, TEX_W);
    float y = floor(idx / TEX_W);
    return vec2((x + 0.5) / TEX_W, (y + 0.5) / TEX_H);
  }
  vec3 readL(float idx) {
    return texture2D(uStatesL, idxToUV(idx)).rgb;
  }
  vec3 readR(float idx) {
    return texture2D(uStatesR, idxToUV(idx)).rgb;
  }
  // state texture L の alpha チャンネルに pitch (Hz) を仕込んである.
  float readPitch(float idx) {
    return texture2D(uStatesL, idxToUV(idx)).a;
  }

  // 標準的な HSV → RGB 変換.
  vec3 hsv2rgb(vec3 c) {
    vec4 K = vec4(1.0, 2.0/3.0, 1.0/3.0, 3.0);
    vec3 p = abs(fract(c.xxx + K.xyz) * 6.0 - K.www);
    return c.z * mix(K.xxx, clamp(p - K.xxx, 0.0, 1.0), c.y);
  }

  // pitch (Hz) → 半音 hue → HSV → RGB.
  // pitch <= 0 (未検出) は uColor フォールバック.
  vec3 pitchToColor(float pitch) {
    if (pitch <= 0.0) return uColor;
    float note = 12.0 * log2(pitch / 440.0);
    float hue = mod(note, 12.0) / 12.0;
    return hsv2rgb(vec3(hue, uPitchSat, uPitchVal));
  }

  // Cosine distance for 3D state vectors. [0, 2], magnitude-invariant.
  float dist3(vec3 A, vec3 B) {
    float magA = length(A) + 1e-5;
    float magB = length(B) + 1e-5;
    return 1.0 - dot(A, B) / (magA * magB);
  }

  // 座標ごとに L/R の役割を非対称化することが鍵.
  // - I 座標: Mid = L + R       → LR swap で不変
  // - J 座標: Side = L - R      → LR swap で符号反転 (=ベクトル方向反転)
  // - K 座標: L チャンネル単独   → LR swap で完全に R 信号に化ける
  // 3 座標が L↔R swap に対して異なる効き方をするので、ボクセル空間内で
  // 対称写像が存在せず、cloud 全体としても LR で異なる絵になる.
  vec3 stateI(float idx) { return readL(idx); }   // L
  // 時間オフセット付き Side: モノラル時にも非ゼロ (signal の時間差分ベクトル).
  // LR swap で readL ↔ readR が入れ替わり、新 stateJ は元 stateJ と異なる → LR 非対称性も維持.
  vec3 stateJ(float idx) {
    float idxOff = clamp(idx + SIDE_OFFSET, 0.0, STATE_F - 1.0);
    return readL(idxOff) - readR(idx);
  }
  vec3 stateK(float idx) { return readR(idx); }                // R

  // R(i,j,k): 3 ペア比較を Lp ノルム (黄金比重み) で結合して intensity を返す.
  float recurrenceIntensity3(
    vec3 sI, vec3 sJ, vec3 sK,
    vec3 sIs, vec3 sJs, vec3 sKs,
    float eps
  ) {
    float dij = dist3(sI, sJs);   // i  vs  j+τs
    float djk = dist3(sJ, sKs);   // j  vs  k+τs
    float dki = dist3(sK, sIs);   // k  vs  i+τs

    float p = max(uCombineP, 1.0);
    float wsum = uWA + uWB + uWC + 1e-5;
    float D = pow(
      pow(uWA * dij, p) + pow(uWB * djk, p) + pow(uWC * dki, p),
      1.0 / p
    ) / wsum;

    return exp(-D / max(eps, 1e-5));
  }

  void main() {
    // position attribute holds the (i, j, k) voxel indices.
    float i = position.x;
    float j = position.y;
    float k = position.z;

    // 異方性線形変換: voxel coord (i,j,k) → state-index (Si, Sj, Sk).
    // 主対角線方向 (1,1,1) は STRIDE_PARA で粗く、直交方向は uStridePerp で細かく.
    float center = (i + j + k) / 3.0;
    float Si = STRIDE_PARA * center + uStridePerp * (i - center);
    float Sj = STRIDE_PARA * center + uStridePerp * (j - center);
    float Sk = STRIDE_PARA * center + uStridePerp * (k - center);

    // Phyllotactic shifts: state-index (sample) 単位. 3 ペア間で異なるずれを与え C₃ 対称を崩す.
    float SiSh = clamp(Si + uShiftKI, 0.0, STATE_F - 1.0);   // d_ki 用
    float SjSh = clamp(Sj + uShiftIJ, 0.0, STATE_F - 1.0);   // d_ij 用
    float SkSh = clamp(Sk + uShiftJK, 0.0, STATE_F - 1.0);   // d_jk 用
    Si = clamp(Si, 0.0, STATE_F - 1.0);
    Sj = clamp(Sj, 0.0, STATE_F - 1.0);
    Sk = clamp(Sk, 0.0, STATE_F - 1.0);

    // voxel center (主対角線中央) 時刻の state-index. 視線軸=(1,1,1) と一致するため
    // 画面奥行きに沿って色がグラデーションする.
    float centerIdx = clamp(STRIDE_PARA * center, 0.0, STATE_F - 1.0);
    vColor = pitchToColor(readPitch(centerIdx));

    // 各座標で異なる L/R 役割を割り当てる. これが LR 非対称性の主源.
    vec3 sI  = stateI(Si);
    vec3 sJ  = stateJ(Sj);
    vec3 sK  = stateK(Sk);
    vec3 sIs = stateI(SiSh);
    vec3 sJs = stateJ(SjSh);
    vec3 sKs = stateK(SkSh);

    float intensity = recurrenceIntensity3(
      sI,  sJ,  sK,
      sIs, sJs, sKs,
      uEpsilon
    );

    if (intensity < uCutoff) {
      gl_PointSize = 0.0;
      gl_Position = vec4(2.0, 2.0, 2.0, 1.0);   // outside clip volume
      vIntensity = 0.0;
      return;
    }

    // Age fade: pow(age, FADE_POWER) — newer corner (high i+j+k) brighter.
    float age = (i + j + k) / (3.0 * (N_F - 1.0));
    float fade = pow(age, uFadePower);

    // Age fade (lissajous-curve 風 3 フェーズ、現在無効化):
    // - elapsed [0.0, 0.1):  1.0 → 0.6   急減衰 (誕生直後の点滅)
    // - elapsed [0.1, 0.5]:  0.6 → 0.4   緩やかに保持
    // - elapsed (0.5, 1.0]:  0.4 → 0.0   フェードアウト
    // float elapsed = 1.0 - age;
    // float fade;
    // if (elapsed < 0.1) {
    //   fade = mix(1.0, 0.8, smoothstep(0.0, 0.1, elapsed));
    // } else if (elapsed <= 0.5) {
    //   fade = mix(0.8, 0.4, smoothstep(0.1, 0.5, elapsed));
    // } else {
    //   fade = mix(0.4, 0.0, smoothstep(0.5, 1.0, elapsed));
    // }

    // Voxel position in [-0.5, 0.5]^3
    vec3 p = vec3(i, j, k) / (N_F - 1.0) - 0.5;

    // Orthographic projection along the (1, 1, 1) diagonal.
    float screenX = dot(p, vec3(1.0, -1.0, 0.0)) / SQRT_2;
    float screenY = dot(p, vec3(1.0, 1.0, -2.0)) / SQRT_6;

    // Aspect correction: fit a square image regardless of canvas shape
    float scaleX = uScale;
    float scaleY = uScale;
    if (uAspect > 1.0) {
      scaleX = uScale / uAspect;
    } else {
      scaleY = uScale * uAspect;
    }

    gl_Position = vec4(screenX * scaleX, screenY * scaleY, 0.0, 1.0);
    gl_PointSize = uPointSize * intensity;
    vIntensity = intensity * fade;
  }
`

const FRAGMENT_SHADER = `
  precision highp float;
  uniform float uOpacity;
  varying float vIntensity;
  varying vec3 vColor;   // vertex で pitch から生成、テーマ色フォールバック含む

  void main() {
    if (vIntensity <= 0.0) discard;
    vec2 c = gl_PointCoord - 0.5;
    float r = length(c) * 2.0;
    float disc = smoothstep(1.0, 0.0, r);
    // ガンマ補正 (一時無効化): pow(x, 1/2.2) で暗部を持ち上げる.
    // ※ three.js outputColorSpace=SRGBColorSpace で後段に自動 sRGB 変換あり.
    // float corrected = pow(vIntensity, 1.0 / 2.2);
    // gl_FragColor = vec4(vColor * corrected, disc * corrected * uOpacity);
    gl_FragColor = vec4(vColor * vIntensity, disc * vIntensity * uOpacity);
  }
`

export const RecurrenceCloud = () => {
  const [audioDynamicsState] = useAudioDynamicsStore()
  const [themeStoreState] = useThemeStore()
  const matRef = useRef<THREE.ShaderMaterial>(null)
  const size = useThree(state => state.size)

  const audioRingL = useMemo(() => new Float32Array(RING_SIZE), [])
  const audioRingR = useMemo(() => new Float32Array(RING_SIZE), [])
  // pitch を sample 単位で ring に積む (frame 内は同値). state alpha に転載してシェーダーで色変換.
  const audioRingPitch = useMemo(() => new Float32Array(RING_SIZE), [])
  const ringRef = useRef({ tail: 0 })

  const statesArrayL = useMemo(() => new Float32Array(TEX_PIXELS * 4), [])
  const statesArrayR = useMemo(() => new Float32Array(TEX_PIXELS * 4), [])

  const statesTexL = useMemo(() => {
    const tex = new THREE.DataTexture(
      statesArrayL,
      TEX_W,
      TEX_H,
      THREE.RGBAFormat,
      THREE.FloatType
    )
    tex.magFilter = THREE.NearestFilter
    tex.minFilter = THREE.NearestFilter
    tex.wrapS = THREE.ClampToEdgeWrapping
    tex.wrapT = THREE.ClampToEdgeWrapping
    tex.needsUpdate = true
    return tex
  }, [statesArrayL])

  const statesTexR = useMemo(() => {
    const tex = new THREE.DataTexture(
      statesArrayR,
      TEX_W,
      TEX_H,
      THREE.RGBAFormat,
      THREE.FloatType
    )
    tex.magFilter = THREE.NearestFilter
    tex.minFilter = THREE.NearestFilter
    tex.wrapS = THREE.ClampToEdgeWrapping
    tex.wrapT = THREE.ClampToEdgeWrapping
    tex.needsUpdate = true
    return tex
  }, [statesArrayR])

  // Per-vertex (i, j, k) indices stored in the position attribute.
  const indexArray = useMemo(() => {
    const arr = new Float32Array(VOXEL_COUNT * 3)
    let p = 0
    for (let k = 0; k < VOXEL_N; k++) {
      for (let j = 0; j < VOXEL_N; j++) {
        for (let i = 0; i < VOXEL_N; i++) {
          arr[p++] = i
          arr[p++] = j
          arr[p++] = k
        }
      }
    }
    return arr
  }, [])

  useEffect(
    () => () => {
      statesTexL.dispose()
      statesTexR.dispose()
    },
    [statesTexL, statesTexR]
  )

  const clock = useMemo(
    () => ({ frame: null as AudioFrame | null, time: 0 }),
    []
  )
  useEffect(() => {
    const frame = audioDynamicsState.frame
    clock.frame = frame
    clock.time = frame.timeSeconds
  }, [audioDynamicsState.frame, clock])

  const colorVec = useMemo(() => {
    const sourceColor = Hct.fromInt(themeStoreState.sourceColor)
    sourceColor.tone = 75
    sourceColor.chroma = Math.max(48, sourceColor.chroma)
    const argb = sourceColor.toInt()
    const r = ((argb >> 16) & 0xff) / 255
    const g = ((argb >> 8) & 0xff) / 255
    const b = (argb & 0xff) / 255
    return new THREE.Vector3(r, g, b)
  }, [themeStoreState.sourceColor])

  useEffect(() => {
    if (matRef.current) {
      matRef.current.uniforms.uColor.value = colorVec
    }
  }, [colorVec])

  useFrame((_state, deltaTime) => {
    if (matRef.current) {
      matRef.current.uniforms.uAspect.value = size.width / Math.max(1, size.height)
    }

    const frame = clock.frame
    if (!frame) return
    const samples0 = frame.samples0
    const samples1 = frame.samples1
    const len = samples0.length
    if (len === 0) return
    const sampleRate = frame.sampleRate

    const startOffset = Math.max(
      0,
      Math.floor((clock.time - frame.timeSeconds) * sampleRate)
    )
    const remaining = len - startOffset
    const consume = Math.max(
      0,
      Math.min(Math.floor(deltaTime * sampleRate), remaining, RING_SIZE)
    )
    clock.time += deltaTime

    // frame 単位の pitch は per-sample ではないので、L/R の有効な方を採用 (lissajous 流儀).
    // 未検出 (-1) は 0 に正規化してシェーダー側でフォールバック分岐に乗せる.
    const framePitch = Math.max(frame.pitch0, frame.pitch1, 0)

    let tail = ringRef.current.tail
    for (let i = 0; i < consume; i++) {
      audioRingL[tail] = samples0[startOffset + i]
      audioRingR[tail] = samples1[startOffset + i]
      audioRingPitch[tail] = framePitch
      tail = tail + 1
      if (tail >= RING_SIZE) tail -= RING_SIZE
    }
    ringRef.current.tail = tail

    const newestBase = tail - 1 - 2 * TAU_DELAY
    for (let k = 0; k < STATE_COUNT; k++) {
      // 1 sample 刻みで連続スナップショットを作る (異方性 stride 化に伴う変更).
      // voxel→state-index 変換側で stride を吸収するため、ここは固定 stride 1.
      const stepsBack = STATE_COUNT - 1 - k
      let baseIdx = newestBase - stepsBack
      baseIdx = ((baseIdx % RING_SIZE) + RING_SIZE) % RING_SIZE
      let i1 = baseIdx + TAU_DELAY
      if (i1 >= RING_SIZE) i1 -= RING_SIZE
      let i2 = baseIdx + 2 * TAU_DELAY
      if (i2 >= RING_SIZE) i2 -= RING_SIZE
      const off = k * 4
      statesArrayL[off + 0] = audioRingL[baseIdx]
      statesArrayL[off + 1] = audioRingL[i1]
      statesArrayL[off + 2] = audioRingL[i2]
      // alpha に baseIdx 時刻の pitch を載せる (シェーダーで色変換のため)
      statesArrayL[off + 3] = audioRingPitch[baseIdx]
      statesArrayR[off + 0] = audioRingR[baseIdx]
      statesArrayR[off + 1] = audioRingR[i1]
      statesArrayR[off + 2] = audioRingR[i2]
      statesArrayR[off + 3] = 0
    }
    statesTexL.needsUpdate = true
    statesTexR.needsUpdate = true
  })

  return (
    <points frustumCulled={false}>
      <bufferGeometry>
        <bufferAttribute
          attach="attributes-position"
          count={VOXEL_COUNT}
          itemSize={3}
          array={indexArray}
        />
      </bufferGeometry>
      <shaderMaterial
        ref={matRef}
        vertexShader={VERTEX_SHADER}
        fragmentShader={FRAGMENT_SHADER}
        transparent={true}
        depthTest={false}
        depthWrite={false}
        blending={THREE.AdditiveBlending}
        uniforms={{
          uStatesL: { value: statesTexL },
          uStatesR: { value: statesTexR },
          uEpsilon: { value: RECURRENCE_EPSILON },
          uFadePower: { value: FADE_POWER },
          uPointSize: { value: POINT_SIZE_BASE },
          uCutoff: { value: INTENSITY_CUTOFF },
          uScale: { value: SCREEN_SCALE },
          uAspect: { value: 1 },
          uShiftIJ: { value: SHIFT_IJ },
          uShiftJK: { value: SHIFT_JK },
          uShiftKI: { value: SHIFT_KI },
          uWA: { value: W_A },
          uWB: { value: W_B },
          uWC: { value: W_C },
          uCombineP: { value: COMBINE_P },
          uStridePerp: { value: SAMPLE_STRIDE_PERP_INITIAL },
          uColor: { value: colorVec },
          uPitchSat: { value: PITCH_SAT },
          uPitchVal: { value: PITCH_VAL },
          uOpacity: { value: 1.0 },
        }}
      />
    </points>
  )
}
