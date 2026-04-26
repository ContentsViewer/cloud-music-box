import { useEffect, useMemo, useRef } from "react"
import { useFrame, useThree } from "@react-three/fiber"
import * as THREE from "three"
import {
  AudioFrame,
  useAudioDynamicsStore,
} from "../stores/audio-dynamics-store"
import { useThemeStore } from "../stores/theme-store"
import { Hct } from "@material/material-color-utilities"

const STATE_COUNT = 96
const VOXEL_N = 96
const VOXEL_COUNT = VOXEL_N * VOXEL_N * VOXEL_N
const SAMPLE_STRIDE = 8
const TAU_DELAY = 8
// Phyllotactic shifts: 3 つの異なる Fibonacci 比のシフトで C₃ 巡回対称も崩す
const SHIFT_IJ = 3
const SHIFT_JK = 5
const SHIFT_KI = 8
const RECURRENCE_EPSILON = 0.5   // cosine 距離用スケール
const FADE_POWER = 0.10
const POINT_SIZE_BASE = 4.0
const INTENSITY_CUTOFF = 0.05     // cosine intensity 範囲 [0, 1] 用
const SCREEN_SCALE = 1.2
const RING_SIZE = STATE_COUNT * SAMPLE_STRIDE + 4 * TAU_DELAY + 4096

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

  varying float vIntensity;

  const float SQRT_2 = 1.41421356;
  const float SQRT_6 = 2.44948975;
  const float N_F = ${VOXEL_N.toFixed(1)};
  const float STATE_F = ${STATE_COUNT.toFixed(1)};

  vec3 readL(float idx) {
    return texture2D(uStatesL, vec2((idx + 0.5) / STATE_F, 0.5)).rgb;
  }
  vec3 readR(float idx) {
    return texture2D(uStatesR, vec2((idx + 0.5) / STATE_F, 0.5)).rgb;
  }

  // Cosine distance: 1 - cos(angle between (lA|rA) and (lB|rB)).
  // Range [0, 2]. Magnitude-invariant — robust against loud passages.
  float dist6(vec3 lA, vec3 rA, vec3 lB, vec3 rB) {
    float dotV = dot(lA, lB) + dot(rA, rB);
    float magA = sqrt(dot(lA, lA) + dot(rA, rA)) + 1e-5;
    float magB = sqrt(dot(lB, lB) + dot(rB, rB)) + 1e-5;
    return 1.0 - dotV / (magA * magB);
  }

  void main() {
    // position attribute holds the (i, j, k) voxel indices.
    float i = position.x;
    float j = position.y;
    float k = position.z;

    // Phyllotactic shifts: 3 つの異なる shift 量を割り当て、C₃ 巡回対称も崩す。
    // d_ij が SHIFT_IJ、d_jk が SHIFT_JK、d_ki が SHIFT_KI に紐付く → 巡回で値が変わる。
    float jShift = clamp(j + uShiftIJ, 0.0, STATE_F - 1.0);   // d_ij 用
    float kShift = clamp(k + uShiftJK, 0.0, STATE_F - 1.0);   // d_jk 用
    float iShift = clamp(i + uShiftKI, 0.0, STATE_F - 1.0);   // d_ki 用

    vec3 lI = readL(i);
    vec3 rI = readR(i);
    vec3 lJ = readL(j);
    vec3 rJ = readR(j);
    vec3 lK = readL(k);
    vec3 rK = readR(k);
    vec3 lJs = readL(jShift);
    vec3 rJs = readR(jShift);
    vec3 lKs = readL(kShift);
    vec3 rKs = readR(kShift);
    vec3 lIs = readL(iShift);
    vec3 rIs = readR(iShift);

    float dij = dist6(lI, rI, lJs, rJs);   // i  vs  j+τs
    float djk = dist6(lJ, rJ, lKs, rKs);   // j  vs  k+τs
    float dki = dist6(lK, rK, lIs, rIs);   // k  vs  i+τs
    float dmean = (dij + djk + dki) / 3.0;
    float intensity = exp(-dmean / max(uEpsilon, 1e-5));

    if (intensity < uCutoff) {
      gl_PointSize = 0.0;
      gl_Position = vec4(2.0, 2.0, 2.0, 1.0);   // outside clip volume
      vIntensity = 0.0;
      return;
    }

    // Age fade: newer corner (high i+j+k) brighter
    float age = (i + j + k) / (3.0 * (N_F - 1.0));
    float fade = pow(age, uFadePower);

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
  uniform vec3 uColor;
  uniform float uOpacity;
  varying float vIntensity;

  void main() {
    if (vIntensity <= 0.0) discard;
    vec2 c = gl_PointCoord - 0.5;
    float r = length(c) * 2.0;
    float disc = smoothstep(1.0, 0.0, r);
    gl_FragColor = vec4(uColor * vIntensity, disc * vIntensity * uOpacity);
  }
`

export const RecurrenceCloud = () => {
  const [audioDynamicsState] = useAudioDynamicsStore()
  const [themeStoreState] = useThemeStore()
  const matRef = useRef<THREE.ShaderMaterial>(null)
  const size = useThree(state => state.size)

  const audioRingL = useMemo(() => new Float32Array(RING_SIZE), [])
  const audioRingR = useMemo(() => new Float32Array(RING_SIZE), [])
  const ringRef = useRef({ tail: 0 })

  const statesArrayL = useMemo(() => new Float32Array(STATE_COUNT * 4), [])
  const statesArrayR = useMemo(() => new Float32Array(STATE_COUNT * 4), [])

  const statesTexL = useMemo(() => {
    const tex = new THREE.DataTexture(
      statesArrayL,
      STATE_COUNT,
      1,
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
      STATE_COUNT,
      1,
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

    let tail = ringRef.current.tail
    for (let i = 0; i < consume; i++) {
      audioRingL[tail] = samples0[startOffset + i]
      audioRingR[tail] = samples1[startOffset + i]
      tail = tail + 1
      if (tail >= RING_SIZE) tail -= RING_SIZE
    }
    ringRef.current.tail = tail

    const newestBase = tail - 1 - 2 * TAU_DELAY
    for (let k = 0; k < STATE_COUNT; k++) {
      const stepsBack = (STATE_COUNT - 1 - k) * SAMPLE_STRIDE
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
      statesArrayL[off + 3] = 0
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
          uColor: { value: colorVec },
          uOpacity: { value: 1.0 },
        }}
      />
    </points>
  )
}
