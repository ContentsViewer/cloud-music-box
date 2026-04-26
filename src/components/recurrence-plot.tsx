import { useEffect, useMemo, useRef } from "react"
import { useFrame, useThree } from "@react-three/fiber"
import * as THREE from "three"
import {
  AudioFrame,
  useAudioDynamicsStore,
} from "../stores/audio-dynamics-store"
import { useThemeStore } from "../stores/theme-store"
import { Hct } from "@material/material-color-utilities"

const STATE_COUNT = 512
const SAMPLE_STRIDE = 86
const TAU_DELAY = 8
const RECURRENCE_EPSILON = 0.05
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
  uniform sampler2D uStates;
  uniform float uN;
  uniform float uEpsilon;
  uniform vec3 uColor;
  uniform float uOpacity;

  void main() {
    float u = (floor(vUv.x * uN) + 0.5) / uN;
    float v = (floor(vUv.y * uN) + 0.5) / uN;
    vec3 si = texture2D(uStates, vec2(u, 0.5)).rgb;
    vec3 sj = texture2D(uStates, vec2(v, 0.5)).rgb;
    float d = distance(si, sj);
    float intensity = exp(-d / max(uEpsilon, 1e-5));

    vec2 c = vUv - 0.5;
    float r = length(c) * 2.0;
    float vignette = smoothstep(1.0, 0.7, r);

    float a = clamp(intensity * vignette, 0.0, 1.0);
    gl_FragColor = vec4(uColor * a, a * uOpacity);
  }
`

export const RecurrencePlot = () => {
  const [audioDynamicsState] = useAudioDynamicsStore()
  const [themeStoreState] = useThemeStore()
  const viewport = useThree(state => state.viewport)
  const displayMatRef = useRef<THREE.ShaderMaterial>(null)

  const audioRing = useMemo(() => new Float32Array(RING_SIZE), [])
  const ringRef = useRef({ tail: 0 })

  const statesArray = useMemo(() => new Float32Array(STATE_COUNT * 4), [])
  const statesTex = useMemo(() => {
    const tex = new THREE.DataTexture(
      statesArray,
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
  }, [statesArray])

  useEffect(() => () => statesTex.dispose(), [statesTex])

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
      const s0 = samples0[startOffset + i]
      const s1 = samples1[startOffset + i]
      audioRing[tail] = (s0 + s1) * 0.5
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
      statesArray[off + 0] = audioRing[baseIdx]
      statesArray[off + 1] = audioRing[i1]
      statesArray[off + 2] = audioRing[i2]
      statesArray[off + 3] = 0
    }
    statesTex.needsUpdate = true
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
          uStates: { value: statesTex },
          uN: { value: STATE_COUNT },
          uEpsilon: { value: RECURRENCE_EPSILON },
          uColor: { value: colorVec },
          uOpacity: { value: 0.9 },
        }}
      />
    </mesh>
  )
}
