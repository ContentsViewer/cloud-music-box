import { useEffect, useMemo, useRef } from "react"
import { useFrame } from "@react-three/fiber"
import * as THREE from "three"
import { useAudioDynamicsStore } from "@/src/stores/audio-dynamics-store"
import { useThemeStore } from "@/src/stores/theme-store"
import {
  MaterialDynamicColors,
  Blend,
  Hct,
} from "@material/material-color-utilities"

// --- Band Configuration ---
// 4 frequency bands: [0-200Hz], [200-1kHz], [1k-4kHz], [4kHz+]
const BAND_CUTOFFS = [200, 1000, 4000] // Hz
const NUM_BANDS = BAND_CUTOFFS.length + 1
// Points per band (ring buffer)
const POINTS_PER_BAND = 4096
// Sample offset for Lissajous (same as original)
const SAMPLE_OFFSET_Y = 6
const SAMPLE_OFFSET_Z = 12
// Hue offset per band (spread across 270° of hue wheel)
const BAND_HUE_OFFSETS = [0, 70, 160, 250]

const noteFromPitch = (frequency: number) => {
  const noteNum = 12 * (Math.log(frequency / 440) / Math.log(2))
  return Math.round(noteNum) + 69
}

// --- Biquad lowpass filter ---
interface BiquadCoeffs {
  b0: number; b1: number; b2: number
  a1: number; a2: number
}

function computeLowpassCoeffs(fc: number, sampleRate: number): BiquadCoeffs {
  const w0 = (2 * Math.PI * fc) / sampleRate
  const Q = 0.707 // Butterworth
  const alpha = Math.sin(w0) / (2 * Q)
  const cosw0 = Math.cos(w0)
  const a0 = 1 + alpha
  return {
    b0: (1 - cosw0) / 2 / a0,
    b1: (1 - cosw0) / a0,
    b2: (1 - cosw0) / 2 / a0,
    a1: (-2 * cosw0) / a0,
    a2: (1 - alpha) / a0,
  }
}

function applyBiquad(input: Float32Array, c: BiquadCoeffs): Float32Array {
  const out = new Float32Array(input.length)
  let x1 = 0, x2 = 0, y1 = 0, y2 = 0
  for (let i = 0; i < input.length; i++) {
    const x0 = input[i]
    const y0 = c.b0 * x0 + c.b1 * x1 + c.b2 * x2 - c.a1 * y1 - c.a2 * y2
    out[i] = y0
    x2 = x1; x1 = x0
    y2 = y1; y1 = y0
  }
  return out
}

function splitIntoBands(
  samples: Float32Array,
  coeffsList: BiquadCoeffs[]
): Float32Array[] {
  // Apply lowpass at each cutoff
  const lowpassed = coeffsList.map(c => applyBiquad(samples, c))

  const bands: Float32Array[] = []
  // Band 0: lowpass at cutoff[0]
  bands.push(lowpassed[0])
  // Band 1..N-2: difference of adjacent lowpasses
  for (let i = 1; i < lowpassed.length; i++) {
    const band = new Float32Array(samples.length)
    for (let j = 0; j < samples.length; j++) {
      band[j] = lowpassed[i][j] - lowpassed[i - 1][j]
    }
    bands.push(band)
  }
  // Last band: original minus highest lowpass
  const lastBand = new Float32Array(samples.length)
  const lastLp = lowpassed[lowpassed.length - 1]
  for (let j = 0; j < samples.length; j++) {
    lastBand[j] = samples[j] - lastLp[j]
  }
  bands.push(lastBand)

  return bands
}

// Vertex shader — same as original Lissajous
const vertexShader = `
attribute float startTime;
attribute vec3 bandColor;

uniform float time;
uniform float aspect;

varying float vAlpha;
varying vec3 vColor;

void main() {
  vec3 p = position;
  float r = length(p.xy);

  // Time-based fade (same as original Lissajous line)
  float elapsed = clamp((time - startTime) / (4096.0 / 22050.0), 0.0, 1.0);
  float alpha = 1.0;
  if (elapsed < 0.1) {
    alpha = mix(1.0, 0.6, smoothstep(0.0, 0.1, elapsed));
  } else if (elapsed <= 0.5) {
    alpha = mix(0.6, 0.4, smoothstep(0.1, 0.5, elapsed));
  } else {
    alpha = mix(0.4, 0.0, smoothstep(0.5, 1.0, elapsed));
  }
  vAlpha = alpha * 0.3;

  // Gamma correction
  if (r > 0.001) {
    float scale = pow(r, 1.0 / 2.2) / r;
    p.xy *= scale;
  }

  // 45-degree rotation
  mat3 rotationMatrix = mat3(
    cos(0.785398), sin(0.785398), 0.0,
    -sin(0.785398), cos(0.785398), 0.0,
    0.0, 0.0, 1.0
  );
  p = rotationMatrix * p;

  // Aspect ratio
  if (aspect < 1.0) {
    p.x /= aspect;
  }
  if (aspect > 1.4) {
    p.y *= aspect / 1.4;
  }

  // Z -> Y offset + scaling
  p.y += position.z * 1.0;
  p.y *= 0.6;
  p.x *= 0.8;
  p.z = 0.0;

  gl_Position = vec4(p, 1.0);
  vColor = bandColor;
}
`

const fragmentShader = `
varying float vAlpha;
varying vec3 vColor;

void main() {
  gl_FragColor = vec4(vColor, vAlpha);
}
`

interface RenderingContext {
  time: number
  frame?: {
    timeSeconds: number
    sampleRate: number
    samples0: Float32Array
    samples1: Float32Array
    pitch0: number
    pitch1: number
  }
  tails: number[]
  currentPitch: number
  // Filtered band data (updated when new AudioFrame arrives)
  bandsL: Float32Array[]
  bandsR: Float32Array[]
}

export const BandLissajous = () => {
  const [audioDynamicsState] = useAudioDynamicsStore()
  const [themeStoreState] = useThemeStore()
  const lineRef = useRef<THREE.LineSegments>(null)

  // Precompute filter coefficients
  const filterCoeffs = useMemo(() => {
    const sampleRate = 44100
    return BAND_CUTOFFS.map(fc => computeLowpassCoeffs(fc, sampleRate))
  }, [])

  const context = useMemo<RenderingContext>(() => {
    return {
      time: 0,
      tails: new Array(NUM_BANDS).fill(0),
      currentPitch: 440,
      bandsL: [],
      bandsR: [],
    }
  }, [])

  const totalVertices = NUM_BANDS * POINTS_PER_BAND

  const positions = useMemo(() => new Float32Array(totalVertices * 3), [])
  const startTimes = useMemo(() => new Float32Array(totalVertices), [])
  const bandColors = useMemo(() => new Float32Array(totalVertices * 3), [])

  // Index buffer: line segments within each band (no cross-band connections)
  const indices = useMemo(() => {
    const segsPerBand = POINTS_PER_BAND - 1
    const idx = new Uint32Array(NUM_BANDS * segsPerBand * 2)
    let ptr = 0
    for (let b = 0; b < NUM_BANDS; b++) {
      const base = b * POINTS_PER_BAND
      for (let i = 0; i < segsPerBand; i++) {
        idx[ptr++] = base + i
        idx[ptr++] = base + i + 1
      }
    }
    return idx
  }, [])

  // When new AudioFrame arrives: filter into bands
  useEffect(() => {
    const frame = audioDynamicsState.frame
    context.frame = frame
    context.time = frame.timeSeconds

    const pitch = Math.max(frame.pitch0, frame.pitch1)
    if (pitch !== -1) {
      context.currentPitch = pitch
    }

    if (frame.sampleRate > 0 && frame.samples0.length > 0) {
      context.bandsL = splitIntoBands(frame.samples0, filterCoeffs)
      context.bandsR = splitIntoBands(frame.samples1, filterCoeffs)
    }
  }, [audioDynamicsState.frame])

  const particleBaseColor = useMemo(() => {
    const baseColor = MaterialDynamicColors.primary.getArgb(
      themeStoreState.scheme
    )
    return Hct.fromInt(baseColor)
  }, [themeStoreState])

  useFrame((state, deltaTime) => {
    const time = state.clock.getElapsedTime()

    if (!lineRef.current) return
    if (!context.frame) return
    if (context.frame.sampleRate === 0) return
    if (context.bandsL.length === 0) return

    const canvasSize = state.size
    const sampleRate = context.frame.sampleRate

    const samplesCountToAppend = ~~(deltaTime * sampleRate)
    const startOffset = ~~(
      (context.time - context.frame.timeSeconds) * sampleRate
    )
    context.time += deltaTime

    // Per-band colors
    const note = noteFromPitch(context.currentPitch)
    const baseHue = (note % 12) * 30
    const colorTable: [number, number, number][] = []
    for (let b = 0; b < NUM_BANDS; b++) {
      const nc = Hct.from(
        baseHue + BAND_HUE_OFFSETS[b],
        Math.max(particleBaseColor.chroma, 40),
        75
      )
      const pc = Blend.harmonize(nc.toInt(), particleBaseColor.toInt())
      colorTable.push([
        ((pc >> 16) & 255) / 255.0,
        ((pc >> 8) & 255) / 255.0,
        (pc & 255) / 255.0,
      ])
    }

    const geo = lineRef.current.geometry
    const posArr = geo.attributes.position.array as Float32Array
    const timeArr = geo.attributes.startTime.array as Float32Array
    const colorArr = geo.attributes.bandColor.array as Float32Array

    for (let i = 0; i < samplesCountToAppend; i++) {
      const t = startOffset + i

      for (let b = 0; b < NUM_BANDS; b++) {
        const bL = context.bandsL[b]
        const bR = context.bandsR[b]
        const len = bL.length

        const tY = t + SAMPLE_OFFSET_Y
        const tZ = t + SAMPLE_OFFSET_Z

        // x: R_band[t], y: L_band[t+6], z: L_band[t+12] - R_band[t+12]
        const xVal = t >= 0 && t < len ? bR[t] : 0
        const yVal = tY >= 0 && tY < len ? bL[tY] : 0
        const zL = tZ >= 0 && tZ < len ? bL[tZ] : 0
        const zR = tZ >= 0 && tZ < len ? bR[tZ] : 0

        const tail = context.tails[b]
        const idx = b * POINTS_PER_BAND + tail

        posArr[idx * 3 + 0] = xVal
        posArr[idx * 3 + 1] = yVal
        posArr[idx * 3 + 2] = zL - zR

        timeArr[idx] =
          time - (deltaTime * (samplesCountToAppend - i)) / samplesCountToAppend

        const [cr, cg, cb] = colorTable[b]
        colorArr[idx * 3 + 0] = cr
        colorArr[idx * 3 + 1] = cg
        colorArr[idx * 3 + 2] = cb

        context.tails[b] = (tail + 1) % POINTS_PER_BAND
      }
    }

    geo.attributes.position.needsUpdate = true
    geo.attributes.startTime.needsUpdate = true
    geo.attributes.bandColor.needsUpdate = true

    const mat = lineRef.current.material as THREE.ShaderMaterial
    mat.uniforms.time.value = time
    mat.uniforms.aspect.value = canvasSize.width / canvasSize.height
  })

  return (
    <lineSegments ref={lineRef}>
      <bufferGeometry>
        <bufferAttribute
          attach="attributes-position"
          count={totalVertices}
          itemSize={3}
          array={positions}
        />
        <bufferAttribute
          attach="attributes-startTime"
          count={totalVertices}
          itemSize={1}
          array={startTimes}
        />
        <bufferAttribute
          attach="attributes-bandColor"
          count={totalVertices}
          itemSize={3}
          array={bandColors}
        />
        <bufferAttribute
          attach="index"
          count={indices.length}
          itemSize={1}
          array={indices}
        />
      </bufferGeometry>
      <shaderMaterial
        vertexShader={vertexShader}
        fragmentShader={fragmentShader}
        transparent={true}
        depthWrite={false}
        uniforms={{
          time: { value: 0 },
          aspect: { value: 1 },
        }}
      />
    </lineSegments>
  )
}
