import { useEffect, useMemo, useRef } from "react"
import { useFrame, useThree } from "@react-three/fiber"
import * as THREE from "three"
import {
  AudioFrame,
  useAudioDynamicsStore,
} from "../stores/audio-dynamics-store"
import { useThemeStore } from "../stores/theme-store"
import { Hct } from "@material/material-color-utilities"

// =============================================================================
// 蝸牛フロントエンド → スパース皮質マップ(現状案の実装)
//
//   3層を明確に区切る(入力層は維持、解釈/出力は差し替えやすく):
//     [INPUT]          蝸牛フロントエンド → 特徴ベクトル x (~144次元, 構造保持)
//                      = cochleagram(M) + per-band best-ITD(M) + ITD強度(M) + サマリ自己相関(P)
//     [INTERPRETATION] トポグラフィック・スパース符号化マップ(過完備 N≫DIM)
//                      = k-WTA で少数発火 + Oja で STRF 学習 + 近傍協調 + IP 恒常性
//     [OUTPUT]         共感覚カラーの銀河: 各セルの W[i]→色(ピッチ=色相/コヒーレンス=彩度)、
//                      発火を発光する star (point sprite) として暗い宇宙に additive 描画。
//
//   r キーで地図リセット。
// =============================================================================

// --- INPUT 層パラメータ(維持) ---
const M = 32
const D_ITD = 16 // ITD 探索遅延 (δ = d - D/2)
const P = 48 // サマリ自己相関ラグ
const CORR_W = 256
const RING = 2048
const F_LO = 60
const F_HI = 16000
const Q = 5.0
const COMPRESS = 0.3
const DIM = 3 * M + P // 32+32+32+48 = 144

// --- INTERPRETATION 層パラメータ ---
const G = 64 // 格子 G×G
const N = G * G // 2304 セル (≫ DIM = 過完備)
const K_ACTIVE = Math.round(N * 0.02) // スパース: 上位 ~2% 発火
// ============================================================
// 挙動プリセット(セット単位で切替: 使うセットの5値を下の定数へ反映)
//
//   [A] 落ち着いた挙動(初期セット)
//       ETA=0.02, ETA_NB=0.008, NB_RAD=2, GAMMA_IP=0.02, HEAT_DECAY=0.85
//       学習がゆっくりで安定。地図がじっくり組織化し、スイープは遅く滑らか。
//       全域被覆に時間がかかる(~1分)が、チラつきが少なく落ち着いた絵。
//
//   [B] リアクティブ寄り(現行)
//       ETA=0.06, ETA_NB=0.03, NB_RAD=3, GAMMA_IP=0.05, HEAT_DECAY=0.65
//       学習が速くスイープ前線が速い + 発火のキレが出て信号追従が良い。
//       立ち上がり・被覆が速い代わり、やや不安定/チラつきが出やすい。
// ============================================================
const ETA = 0.06 // Oja 学習率(STRF)
const ETA_NB = 0.03 // 近傍協調(スイープ前線)
const NB_RAD = 3 // 近傍半径
const GAMMA_IP = 0.05 // IP(恒常性)
const HEAT_DECAY = 0.65 // 発火残光(小=キレ/大=尾を引く)
const USE_ALPHA = 0.02 // 使用率 EMA
const P_TARGET = K_ACTIVE / N // 目標発火率

// --- OUTPUT 層パラメータ(共感覚カラーの銀河) ---
const STAR_POINT_SIZE = 26.0 // 発火時(heat=1)の基準ピクセルサイズ
const STAR_HALO_GAIN = 0.22 // 芯に対する広いハロー(星雲)の明るさ
const HEAT_GAMMA = 0.6 // 淡い星の知覚的持ち上げ
const SAT_FLOOR = 0.35 // ITDコヒーレンス0でも残す最低彩度
// 星雲(膜): ボリュメトリック・レイマーチ(Beer-Lambert)。密度=W由来3D場(z=cochleagram)
const NEB_DZ = 32 // 体積の深さ(=cochleagram帯域数)
const NEB_STEPS = 64 // レイマーチ段数
const NEB_SIGMA = 28.0 // 吸収係数(濃さ)
const NEB_CARVE = 0.0 // 彫り(0=削らない。可視化確認後に上げてフィラメント化)
const NEB_DENS_TARGET = 2.5 // 自動露出: 最濃ボクセルがこの密度になるよう uDensGain を毎フレーム調整
const NEB_EMIS = 1.6 // 発光ゲイン
const NEB_BOX_HALF = [1.0, 1.0, 0.6] // 体積ボックス半径(z=厚み)
const NEB_EYE = [0.0, 0.0, 2.2] // 仮想カメラ位置
const NEB_TILT_X = 0.25 // 静的傾斜(rad, 奥行き/パララックス)
const NEB_TILT_Y = 0.3

// 帯域 m の中心周波数(入力層と同式)
function bandFreq(m: number): number {
  return F_LO * Math.pow(F_HI / F_LO, m / (M - 1))
}
// HSV→RGB(out[off..off+2] に書込)。recurrence-cloud の hsv2rgb を CPU化。
function hsv2rgb(h: number, s: number, v: number, out: Float32Array, off: number) {
  const i = Math.floor(h * 6)
  const f = h * 6 - i
  const p = v * (1 - s)
  const q = v * (1 - f * s)
  const t = v * (1 - (1 - f) * s)
  let r = 0,
    g = 0,
    b = 0
  switch (((i % 6) + 6) % 6) {
    case 0: r = v; g = t; b = p; break
    case 1: r = q; g = v; b = p; break
    case 2: r = p; g = v; b = t; break
    case 3: r = p; g = q; b = v; break
    case 4: r = t; g = p; b = v; break
    case 5: r = v; g = p; b = q; break
  }
  out[off] = r
  out[off + 1] = g
  out[off + 2] = b
}

// 星(point sprite): 格子セル→clip空間、サイズ∝発火、無音は不可視
const STAR_VERT = `
  attribute float aHeat;
  attribute vec3 aColor;
  uniform float uAspect;
  uniform float uPointSize;
  uniform float uGamma;
  const float G_F = ${G.toFixed(1)};
  varying vec3 vColor;
  varying float vIntensity;
  void main() {
    float gx = position.x;
    float gy = position.y;
    float nx = (gx / (G_F - 1.0)) * 1.8 - 0.9;
    float ny = (gy / (G_F - 1.0)) * 1.8 - 0.9;
    float sx = 1.0;
    float sy = 1.0;
    if (uAspect > 1.0) sx = 1.0 / uAspect; else sy = uAspect;
    float intensity = pow(clamp(aHeat / 1.5, 0.0, 1.0), uGamma);
    vIntensity = intensity;
    vColor = aColor;
    if (intensity <= 0.001) {        // 発火していない → 不可視
      gl_PointSize = 0.0;
      gl_Position = vec4(2.0, 2.0, 2.0, 1.0);
      return;
    }
    gl_PointSize = uPointSize * intensity;
    gl_Position = vec4(nx * sx, ny * sy, 0.0, 1.0);
  }
`
// 星 fragment: 明るい芯 + 広いハロー(星雲)、additive
const STAR_FRAG = `
  precision highp float;
  uniform float uHaloGain;
  uniform float uOpacity;
  varying vec3 vColor;
  varying float vIntensity;
  void main() {
    if (vIntensity <= 0.0) discard;
    float r = length(gl_PointCoord - 0.5) * 2.0;
    if (r > 1.0) discard;
    float core = smoothstep(0.35, 0.0, r);
    float halo = smoothstep(1.0, 0.0, r) * uHaloGain;
    float a = (core + halo) * vIntensity * uOpacity;
    vec3 rgb = vColor * (1.0 + core * 1.5);   // 芯は白方向にブロー
    gl_FragColor = vec4(rgb * a, a);
  }
`
// 背景: 暗い宇宙(ほぼ黒 + ごく薄い放射状tint)
const BG_VERT = `
  varying vec2 vUv;
  void main(){ vUv = uv; gl_Position = projectionMatrix*modelViewMatrix*vec4(position,1.0); }
`
const BG_FRAG = `
  precision highp float;
  varying vec2 vUv;
  uniform vec3 uTint;
  uniform float uOpacity;
  void main(){
    vec2 c = vUv - 0.5;
    float d = length(c) * 2.0;
    float vig = smoothstep(1.2, 0.2, d);
    vec3 col = uTint * (0.06 + 0.10 * vig);
    gl_FragColor = vec4(col, uOpacity);
  }
`
// 星雲(膜): ボリュメトリック・レイマーチ + Beer-Lambert。W由来3D密度(z=cochleagram)を
// 仮想カメラからマーチし、半透明シェルを累積=膜の重なり。固定ノイズ・bakedアニメ不使用。GLSL3。
const NEB_VERT = `
  out vec2 vUv;
  void main(){ vUv = uv; gl_Position = projectionMatrix*modelViewMatrix*vec4(position,1.0); }
`
const NEB_FRAG = `
  precision highp float;
  precision highp sampler3D;
  out vec4 fragColor;
  in vec2 vUv;
  uniform sampler3D uVolume;   // R=W由来密度(z=cochleagram)
  uniform sampler2D uColor;    // rgb=共感覚色(2D, セル=(x,y))
  uniform float uAspect;
  uniform float uSigma;
  uniform float uCarve;
  uniform float uDensGain;
  uniform float uEmis;
  uniform float uOpacity;
  uniform mat3 uView;
  uniform vec3 uEye;
  uniform vec3 uBoxHalf;

  // AABB交差(ボックス [-half, +half])
  vec2 boxHit(vec3 ro, vec3 rd, vec3 rad){
    vec3 m = 1.0 / rd;
    vec3 n = m * ro;
    vec3 k = abs(m) * rad;
    vec3 t1 = -n - k;
    vec3 t2 = -n + k;
    return vec2(max(max(t1.x, t1.y), t1.z), min(min(t2.x, t2.y), t2.z));
  }

  void main(){
    // 仮想カメラ: 画面uv→レイ、静的傾斜 uView で奥行きを見せる(R3Fカメラ非依存)
    vec2 sc = (vUv - 0.5) * vec2(uAspect, 1.0);
    vec3 rd = normalize(uView * vec3(sc, -1.4));
    vec3 ro = uView * uEye;
    vec2 tb = boxHit(ro, rd, uBoxHalf);
    float tn = max(tb.x, 0.0);
    if (tb.y <= tn) { fragColor = vec4(0.0); return; }
    float t = tn;
    float dt = (tb.y - tn) / float(${NEB_STEPS});
    vec3 col = vec3(0.0);
    float trans = 1.0;
    for (int i = 0; i < ${NEB_STEPS}; i++){
      vec3 p = ro + rd * t;                    // [-half, +half]
      vec3 uvw = p / uBoxHalf * 0.5 + 0.5;      // [0,1]^3
      float d = texture(uVolume, uvw).r;
      d = max(0.0, d * uDensGain - uCarve);     // 彫り=フィラメント化(参照の -128*n 相当)
      if (d > 0.0){
        vec3 emis = texture(uColor, uvw.xy).rgb; // 共感覚色(深さ不変)
        float a = 1.0 - exp(-d * uSigma * dt);   // Beer-Lambert(吸収=不透明度)
        col += trans * a * emis * uEmis;         // 発光累積(front-to-back)
        trans *= 1.0 - a;
        if (trans < 0.01) break;
      }
      t += dt;
    }
    fragColor = vec4(col, (1.0 - trans) * uOpacity); // additive合成
  }
`

export const FbSparseCortex = () => {
  const [audioDynamicsState] = useAudioDynamicsStore()
  const [themeStoreState] = useThemeStore()
  const viewport = useThree(s => s.viewport)
  const size = useThree(s => s.size)
  const bgMatRef = useRef<THREE.ShaderMaterial>(null)
  const nebMatRef = useRef<THREE.ShaderMaterial>(null)
  const starMatRef = useRef<THREE.ShaderMaterial>(null)
  const starGeoRef = useRef<THREE.BufferGeometry>(null)
  const resetRef = useRef(false)
  const volMaxRef = useRef(1) // 体積密度の自動露出(フレーム最大の平滑追従)

  // ===== INPUT 層: フィルタバンク係数 =====
  const coeffs = useMemo(() => {
    const sr = 44100
    const b0 = new Float32Array(M)
    const b2 = new Float32Array(M)
    const a1 = new Float32Array(M)
    const a2 = new Float32Array(M)
    for (let m = 0; m < M; m++) {
      const f = F_LO * Math.pow(F_HI / F_LO, m / (M - 1))
      const w0 = (2 * Math.PI * f) / sr
      const alpha = Math.sin(w0) / (2 * Q)
      const a0 = 1 + alpha
      b0[m] = alpha / a0
      b2[m] = -alpha / a0
      a1[m] = (-2 * Math.cos(w0)) / a0
      a2[m] = (1 - alpha) / a0
    }
    return { b0, b2, a1, a2 }
  }, [])

  const bandBuf = useMemo(() => new Float32Array(M * 2 * RING), [])
  const x1 = useMemo(() => new Float32Array(M * 2), [])
  const x2 = useMemo(() => new Float32Array(M * 2), [])
  const y1 = useMemo(() => new Float32Array(M * 2), [])
  const y2 = useMemo(() => new Float32Array(M * 2), [])
  const ringRef = useRef({ idx: 0, filled: 0 })
  const featVec = useMemo(() => new Float32Array(DIM), [])

  // ===== INTERPRETATION 層: 重み・状態 =====
  const W = useMemo(() => new Float32Array(N * DIM), [])
  const thr = useMemo(() => new Float32Array(N), [])
  const usage = useMemo(() => new Float32Array(N), [])
  const drive = useMemo(() => new Float32Array(N), [])
  const driveSorted = useMemo(() => new Float32Array(N), [])
  const heat = useMemo(() => new Float32Array(N), [])

  // ===== OUTPUT 層: 星(point sprite)バッファ =====
  const starPos = useMemo(() => {
    const a = new Float32Array(N * 3)
    for (let i = 0; i < N; i++) {
      a[i * 3 + 0] = i % G // gx
      a[i * 3 + 1] = (i / G) | 0 // gy
      a[i * 3 + 2] = 0
    }
    return a
  }, [])
  const cellColor = useMemo(() => new Float32Array(N * 3), []) // 共感覚RGB(毎frame)
  const cellHeat = useMemo(() => new Float32Array(N), []) // 発火(=heat, 毎frame)
  // 星雲(膜): 色場テクスチャ(RGB=共感覚色)
  const nebData = useMemo(() => new Float32Array(N * 4), [])
  const nebTex = useMemo(() => {
    const t = new THREE.DataTexture(nebData, G, G, THREE.RGBAFormat, THREE.FloatType)
    t.magFilter = THREE.LinearFilter
    t.minFilter = THREE.LinearFilter
    t.wrapS = THREE.ClampToEdgeWrapping
    t.wrapT = THREE.ClampToEdgeWrapping
    t.needsUpdate = true
    return t
  }, [nebData])
  useEffect(() => () => nebTex.dispose(), [nebTex])
  // 体積テクスチャ: W由来3D密度(x,y=マップ, z=cochleagram帯域)。Data3DTexture(WebGL2)
  const volData = useMemo(() => new Float32Array(N * NEB_DZ), [])
  const volTex = useMemo(() => {
    const t = new THREE.Data3DTexture(volData, G, G, NEB_DZ)
    t.format = THREE.RedFormat
    t.type = THREE.FloatType
    // Float3Dの線形フィルタは拡張依存(非対応だとサンプル0=黒)。まず Nearest で確実に可視化
    t.minFilter = THREE.NearestFilter
    t.magFilter = THREE.NearestFilter
    t.wrapS = THREE.ClampToEdgeWrapping
    t.wrapT = THREE.ClampToEdgeWrapping
    t.wrapR = THREE.ClampToEdgeWrapping
    t.needsUpdate = true
    return t
  }, [volData])
  useEffect(() => () => volTex.dispose(), [volTex])
  // 仮想カメラの静的傾斜(mat3) と位置・ボックス
  const nebView = useMemo(() => {
    const m4 = new THREE.Matrix4().makeRotationX(NEB_TILT_X)
    m4.multiply(new THREE.Matrix4().makeRotationY(NEB_TILT_Y))
    return new THREE.Matrix3().setFromMatrix4(m4)
  }, [])
  const nebEye = useMemo(() => new THREE.Vector3(...(NEB_EYE as [number, number, number])), [])
  const nebBoxHalf = useMemo(
    () => new THREE.Vector3(...(NEB_BOX_HALF as [number, number, number])),
    []
  )

  const initInterp = useMemo(
    () => () => {
      for (let i = 0; i < N; i++) {
        let norm = 0
        for (let k = 0; k < DIM; k++) {
          const v = Math.random() * 2 - 1
          W[i * DIM + k] = v
          norm += v * v
        }
        const inv = 1 / (Math.sqrt(norm) + 1e-6)
        for (let k = 0; k < DIM; k++) W[i * DIM + k] *= inv
      }
      thr.fill(0)
      usage.fill(P_TARGET)
      heat.fill(0)
    },
    [W, thr, usage, heat]
  )
  const inited = useRef(false)
  if (!inited.current) {
    initInterp()
    inited.current = true
  }

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "r") resetRef.current = true
    }
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  }, [])

  const clock = useMemo(() => ({ frame: null as AudioFrame | null, time: 0 }), [])
  useEffect(() => {
    clock.frame = audioDynamicsState.frame
    clock.time = audioDynamicsState.frame.timeSeconds
  }, [audioDynamicsState.frame, clock])

  const colors = useMemo(() => {
    const base = Hct.fromInt(themeStoreState.sourceColor)
    const low = Hct.from(base.hue, Math.max(22, base.chroma * 0.4), 16)
    const high = Hct.from((base.hue + 35) % 360, Math.max(55, base.chroma * 0.8), 60)
    const accent = Hct.from((base.hue + 70) % 360, Math.max(85, base.chroma), 82)
    const toVec = (argb: number) =>
      new THREE.Vector3(
        ((argb >> 16) & 255) / 255,
        ((argb >> 8) & 255) / 255,
        (argb & 255) / 255
      )
    return { low: toVec(low.toInt()), high: toVec(high.toInt()), accent: toVec(accent.toInt()) }
  }, [themeStoreState.sourceColor])

  useEffect(() => {
    if (bgMatRef.current) bgMatRef.current.uniforms.uTint.value = colors.low
  }, [colors])

  useFrame((_state, deltaTime) => {
    if (resetRef.current) {
      initInterp()
      resetRef.current = false
    }
    const frame = clock.frame
    if (!frame || frame.samples0.length === 0) return
    const s0 = frame.samples0
    const s1 = frame.samples1
    const len = s0.length
    const sampleRate = frame.sampleRate
    const startOffset = Math.max(
      0,
      Math.floor((clock.time - frame.timeSeconds) * sampleRate)
    )
    const remaining = len - startOffset
    const consume = Math.max(0, Math.min(Math.floor(deltaTime * sampleRate), remaining))
    clock.time += deltaTime
    if (consume === 0) return
    // フレームレート非依存化: 60fps基準で学習/減衰を時間スケール(60fps時は1.0=不変)
    const dtScale = Math.min(4, Math.max(0.25, deltaTime * 60))

    // ============================================================
    // [INPUT 層] フィルタバンク → 特徴ベクトル x (構造保持, ~144次元)
    // ============================================================
    const { b0, b2, a1, a2 } = coeffs
    let idx = ringRef.current.idx
    for (let i = 0; i < consume; i++) {
      const sL = s0[startOffset + i]
      const sR = s1[startOffset + i]
      for (let m = 0; m < M; m++) {
        const iL = m * 2, iR = m * 2 + 1
        const yL = b0[m] * sL + b2[m] * x2[iL] - a1[m] * y1[iL] - a2[m] * y2[iL]
        x2[iL] = x1[iL]; x1[iL] = sL; y2[iL] = y1[iL]; y1[iL] = yL
        bandBuf[iL * RING + idx] = yL
        const yR = b0[m] * sR + b2[m] * x2[iR] - a1[m] * y1[iR] - a2[m] * y2[iR]
        x2[iR] = x1[iR]; x1[iR] = sR; y2[iR] = y1[iR]; y1[iR] = yR
        bandBuf[iR * RING + idx] = yR
      }
      idx = idx + 1
      if (idx >= RING) idx -= RING
    }
    ringRef.current.idx = idx
    ringRef.current.filled = Math.min(RING, ringRef.current.filled + consume)
    if (ringRef.current.filled < CORR_W + D_ITD + P + 8) return

    const last = (idx - 1 + RING) % RING
    const halfD = D_ITD >> 1
    const W_ = CORR_W
    // summary autocorr バッファ
    for (let p = 0; p < P; p++) featVec[3 * M + p] = 0

    for (let m = 0; m < M; m++) {
      const baseL = (m * 2) * RING
      const baseR = (m * 2 + 1) * RING
      // 包絡 (cochleagram)
      let eAcc = 0, eL = 1e-9, eR = 1e-9, e0 = 1e-9
      for (let w = 0; w < W_; w++) {
        let t = last - w; if (t < 0) t += RING
        const vL = bandBuf[baseL + t], vR = bandBuf[baseR + t]
        const mono = 0.5 * (vL + vR)
        if (w < 256) eAcc += mono * mono
        eL += vL * vL; eR += vR * vR; e0 += mono * mono
      }
      featVec[m] = Math.pow(Math.sqrt(eAcc / 256), COMPRESS) // env
      // best-ITD + 強度
      const crossNorm = 1 / Math.sqrt(eL * eR)
      let bestCC = -1e9, bestD = 0
      for (let d = 0; d < D_ITD; d++) {
        const delta = d - halfD
        let cc = 0
        for (let w = 0; w < W_; w++) {
          let t = last - w; if (t < 0) t += RING
          let tr = t - delta; if (tr < 0) tr += RING; else if (tr >= RING) tr -= RING
          cc += bandBuf[baseL + t] * bandBuf[baseR + tr]
        }
        cc *= crossNorm
        if (cc > bestCC) { bestCC = cc; bestD = delta }
      }
      featVec[M + m] = bestD / halfD // best-ITD ∈ [-1,1]
      featVec[2 * M + m] = bestCC // 強度
      // サマリ自己相関に加算 (帯域エネルギーで正規化)
      const invE0 = 1 / e0
      for (let p = 0; p < P; p++) {
        let ac = 0
        for (let w = 0; w < W_; w++) {
          let t = last - w; if (t < 0) t += RING
          let t2 = t - p; if (t2 < 0) t2 += RING
          const m1 = 0.5 * (bandBuf[baseL + t] + bandBuf[baseR + t])
          const m2 = 0.5 * (bandBuf[baseL + t2] + bandBuf[baseR + t2])
          ac += m1 * m2
        }
        featVec[3 * M + p] += ac * invE0
      }
    }
    // x を L2 正規化(形に着目)
    let xn = 0
    for (let k = 0; k < DIM; k++) xn += featVec[k] * featVec[k]
    const xInv = 1 / (Math.sqrt(xn) + 1e-6)
    for (let k = 0; k < DIM; k++) featVec[k] *= xInv

    // ============================================================
    // [INTERPRETATION 層] スパース符号化(k-WTA + Oja + 近傍 + IP)
    // ============================================================
    // forward: drive = W·x - thr
    let maxU = -1e9
    for (let i = 0; i < N; i++) {
      const b = i * DIM
      let s = 0
      for (let k = 0; k < DIM; k++) s += W[b + k] * featVec[k]
      const u = s - thr[i]
      drive[i] = u
      if (u > maxU) maxU = u
    }
    // k-WTA しきい値(上位 K_ACTIVE)
    driveSorted.set(drive)
    driveSorted.sort() // 昇順
    const kThr = driveSorted[N - K_ACTIVE]
    const invMaxU = 1 / (maxU - kThr + 1e-6)

    // 学習(発火セルのみ)+ 使用率更新
    for (let i = 0; i < N; i++) {
      const fired = drive[i] >= kThr ? 1 : 0
      usage[i] = (1 - USE_ALPHA * dtScale) * usage[i] + USE_ALPHA * dtScale * fired
      // IP: 使用率を目標へ(過使用→thr上げ)
      thr[i] += GAMMA_IP * dtScale * (usage[i] - P_TARGET)
      if (fired) {
        const y = (drive[i] - kThr) * invMaxU // 0..1
        const b = i * DIM
        // Oja: w += η·y·(x - y·w)
        let nrm = 0
        for (let k = 0; k < DIM; k++) {
          const wv = W[b + k] + ETA * dtScale * y * (featVec[k] - y * W[b + k])
          W[b + k] = wv
          nrm += wv * wv
        }
        // 単位ノルム化
        const inv = 1 / (Math.sqrt(nrm) + 1e-6)
        for (let k = 0; k < DIM; k++) W[b + k] *= inv
        heat[i] = Math.min(1.5, heat[i] + y * dtScale)

        // 近傍協調(トポグラフィック)
        const gx = i % G, gy = (i / G) | 0
        const x0 = Math.max(0, gx - NB_RAD), x1g = Math.min(G - 1, gx + NB_RAD)
        const y0 = Math.max(0, gy - NB_RAD), y1g = Math.min(G - 1, gy + NB_RAD)
        for (let ny = y0; ny <= y1g; ny++) {
          for (let nx = x0; nx <= x1g; nx++) {
            const j = ny * G + nx
            if (j === i) continue
            const gd2 = (nx - gx) * (nx - gx) + (ny - gy) * (ny - gy)
            const h = ETA_NB * dtScale * Math.exp(-gd2 / (2 * NB_RAD * NB_RAD))
            const bj = j * DIM
            for (let k = 0; k < DIM; k++) W[bj + k] += h * (featVec[k] - W[bj + k])
          }
        }
      }
    }

    // ============================================================
    // [OUTPUT 層] 共感覚カラー(W[i]→色)+ 発火 → 星の属性
    // ============================================================
    let frameMaxVol = 0
    for (let i = 0; i < N; i++) {
      const b = i * DIM
      // 色相: cochleagram部のスペクトル重心 → 周波数 → note → hue
      let num = 0,
        den = 1e-9
      for (let m = 0; m < M; m++) {
        const e = W[b + m] > 0 ? W[b + m] : 0
        num += m * e
        den += e
      }
      const f = bandFreq(num / den)
      const note = 12 * Math.log2(f / 440) + 69
      const hue = (((note % 12) + 12) % 12) / 12
      // 彩度: ITD強度部(コヒーレンス)の平均
      let coh = 0
      for (let k = 0; k < M; k++) coh += W[b + 2 * M + k]
      coh = Math.min(1, Math.max(0, coh / M))
      const sat = SAT_FLOOR + (1 - SAT_FLOOR) * coh
      hsv2rgb(hue, sat, 1.0, cellColor, i * 3)
      // 星雲(膜): 色場(rgb=共感覚色, a未使用)
      const o = i * 4
      nebData[o + 0] = cellColor[i * 3 + 0]
      nebData[o + 1] = cellColor[i * 3 + 1]
      nebData[o + 2] = cellColor[i * 3 + 2]
      nebData[o + 3] = 1.0
      // 体積密度: z=cochleagram帯域(0..NEB_DZ-1)を深さに(index = z*N + i)。max(0,W)
      for (let z = 0; z < NEB_DZ; z++) {
        const w = W[b + z]
        const v = w > 0 ? w : 0
        volData[z * N + i] = v
        if (v > frameMaxVol) frameMaxVol = v
      }
      // 発火 → 星属性 + 残光
      cellHeat[i] = heat[i]
      heat[i] *= Math.pow(HEAT_DECAY, dtScale) // 発火残光(時間スケール=フレームレート非依存)
    }
    if (starGeoRef.current) {
      starGeoRef.current.attributes.aColor.needsUpdate = true
      starGeoRef.current.attributes.aHeat.needsUpdate = true
    }
    if (starMatRef.current) {
      starMatRef.current.uniforms.uAspect.value =
        size.width / Math.max(1, size.height)
    }
    nebTex.needsUpdate = true
    volTex.needsUpdate = true
    // 自動露出: 体積密度の最大を平滑追従し、最濃ボクセルが NEB_DENS_TARGET 密度になるよう調整
    volMaxRef.current = Math.max(volMaxRef.current * 0.97, frameMaxVol, 1e-3)
    if (nebMatRef.current) {
      nebMatRef.current.uniforms.uAspect.value =
        size.width / Math.max(1, size.height)
      nebMatRef.current.uniforms.uDensGain.value =
        NEB_DENS_TARGET / Math.max(volMaxRef.current, 0.02)
    }
  })

  const planeSize = Math.max(viewport.width, viewport.height) * 1.05

  return (
    <>
      {/* 背景: 暗い宇宙 */}
      <mesh renderOrder={0}>
        <planeGeometry args={[planeSize, planeSize]} />
        <shaderMaterial
          ref={bgMatRef}
          vertexShader={BG_VERT}
          fragmentShader={BG_FRAG}
          transparent={true}
          depthTest={false}
          depthWrite={false}
          uniforms={{
            uTint: { value: colors.low },
            uOpacity: { value: 0.9 },
          }}
        />
      </mesh>
      {/* 星雲(膜): W由来3D密度のボリュメトリック・レイマーチ(Beer-Lambert, additive) */}
      <mesh renderOrder={1}>
        <planeGeometry args={[planeSize, planeSize]} />
        <shaderMaterial
          ref={nebMatRef}
          vertexShader={NEB_VERT}
          fragmentShader={NEB_FRAG}
          glslVersion={THREE.GLSL3}
          transparent={true}
          depthTest={false}
          depthWrite={false}
          blending={THREE.AdditiveBlending}
          uniforms={{
            uVolume: { value: volTex },
            uColor: { value: nebTex },
            uAspect: { value: 1 },
            uSigma: { value: NEB_SIGMA },
            uCarve: { value: NEB_CARVE },
            uDensGain: { value: NEB_DENS_TARGET },
            uEmis: { value: NEB_EMIS },
            uOpacity: { value: 1.0 },
            uView: { value: nebView },
            uEye: { value: nebEye },
            uBoxHalf: { value: nebBoxHalf },
          }}
        />
      </mesh>
      {/* 星: 共感覚カラーの発光 point sprite(additive) */}
      <points renderOrder={2} frustumCulled={false}>
        <bufferGeometry ref={starGeoRef}>
          <bufferAttribute
            attach="attributes-position"
            count={N}
            itemSize={3}
            array={starPos}
          />
          <bufferAttribute
            attach="attributes-aColor"
            count={N}
            itemSize={3}
            array={cellColor}
          />
          <bufferAttribute
            attach="attributes-aHeat"
            count={N}
            itemSize={1}
            array={cellHeat}
          />
        </bufferGeometry>
        <shaderMaterial
          ref={starMatRef}
          vertexShader={STAR_VERT}
          fragmentShader={STAR_FRAG}
          transparent={true}
          depthTest={false}
          depthWrite={false}
          blending={THREE.AdditiveBlending}
          uniforms={{
            uAspect: { value: 1 },
            uPointSize: { value: STAR_POINT_SIZE },
            uGamma: { value: HEAT_GAMMA },
            uHaloGain: { value: STAR_HALO_GAIN },
            uOpacity: { value: 1.0 },
          }}
        />
      </points>
    </>
  )
}
