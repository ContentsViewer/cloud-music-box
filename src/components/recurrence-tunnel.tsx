import { useEffect, useMemo, useRef } from "react"
import { useFrame, useThree } from "@react-three/fiber"
import * as THREE from "three"
import {
  AudioFrame,
  useAudioDynamicsStore,
} from "../stores/audio-dynamics-store"
import { useThemeStore } from "../stores/theme-store"
import { Hct } from "@material/material-color-utilities"

const STATE_COUNT = 256
const SAMPLE_STRIDE = 86
const TAU_DELAY = 8
const RECURRENCE_EPSILON = 0.15
const DEPTH_STEPS = 128
const FADE_POWER = 1.0
const RING_SIZE = STATE_COUNT * SAMPLE_STRIDE + 4 * TAU_DELAY + 4096

const DISPLAY_VERTEX = `
  varying vec2 vUv;
  void main() {
    vUv = uv;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`

const DISPLAY_FRAGMENT = `
  precision highp float;
  varying vec2 vUv;
  uniform sampler2D uStatesL;
  uniform sampler2D uStatesR;
  uniform float uEpsilon;
  uniform float uFadePower;
  uniform vec3 uColor;
  uniform float uOpacity;

  const float PI_HALF = 1.5707963267948966;

  void main() {
    float dt = vUv.x - 0.5;
    float theta = vUv.y * PI_HALF;
    float c = cos(theta);
    float s = sin(theta);

    float peak = 0.0;

    for (int n = 0; n < ${DEPTH_STEPS}; n++) {
      float t = float(n) / float(${DEPTH_STEPS - 1});
      float i = t + dt * 0.5;
      float j = t - dt * 0.5;
      if (i < 0.0 || i > 1.0 || j < 0.0 || j > 1.0) continue;

      vec3 sLi = texture2D(uStatesL, vec2(i, 0.5)).rgb;
      vec3 sRi = texture2D(uStatesR, vec2(i, 0.5)).rgb;
      vec3 sLj = texture2D(uStatesL, vec2(j, 0.5)).rgb;
      vec3 sRj = texture2D(uStatesR, vec2(j, 0.5)).rgb;

      vec3 sA = c * sLi + s * sRi;
      vec3 sB = c * sLj + s * sRj;
      float d = distance(sA, sB);
      float intensity = exp(-d / max(uEpsilon, 1e-5));

      float fade = pow(t, uFadePower);
      peak = max(peak, intensity * fade);
    }

    float diagAttenuate = smoothstep(0.0, 0.04, abs(dt));
    float final = peak * diagAttenuate;

    vec2 cUv = vUv - 0.5;
    float r = length(cUv) * 2.0;
    float vignette = smoothstep(1.0, 0.7, r);

    float a = clamp(final * vignette, 0.0, 1.0);
    gl_FragColor = vec4(uColor * a, a * uOpacity);
  }
`

export const RecurrenceTunnel = () => {
  const [audioDynamicsState] = useAudioDynamicsStore()
  const [themeStoreState] = useThemeStore()
  const viewport = useThree(state => state.viewport)
  const displayMatRef = useRef<THREE.ShaderMaterial>(null)

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
    if (displayMatRef.current) {
      displayMatRef.current.uniforms.uColor.value = colorVec
    }
  }, [colorVec])

  useFrame((_state, deltaTime) => {
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

  const plateSize = Math.min(viewport.width, viewport.height) * 0.95

  return (
    <mesh>
      <planeGeometry args={[plateSize, plateSize]} />
      <shaderMaterial
        ref={displayMatRef}
        vertexShader={DISPLAY_VERTEX}
        fragmentShader={DISPLAY_FRAGMENT}
        transparent={true}
        depthTest={false}
        depthWrite={false}
        uniforms={{
          uStatesL: { value: statesTexL },
          uStatesR: { value: statesTexR },
          uEpsilon: { value: RECURRENCE_EPSILON },
          uFadePower: { value: FADE_POWER },
          uColor: { value: colorVec },
          uOpacity: { value: 0.9 },
        }}
      />
    </mesh>
  )
}
