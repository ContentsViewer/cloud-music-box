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

// --- Band filter (reused from band-lissajous) ---
const BAND_CUTOFFS = [200, 1000, 4000]
const NUM_BANDS = BAND_CUTOFFS.length + 1

interface BiquadCoeffs {
  b0: number; b1: number; b2: number
  a1: number; a2: number
}

function computeLowpassCoeffs(fc: number, sampleRate: number): BiquadCoeffs {
  const w0 = (2 * Math.PI * fc) / sampleRate
  const alpha = Math.sin(w0) / (2 * 0.707)
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

function splitIntoBands(samples: Float32Array, coeffsList: BiquadCoeffs[]): Float32Array[] {
  const lowpassed = coeffsList.map(c => applyBiquad(samples, c))
  const bands: Float32Array[] = []
  bands.push(lowpassed[0])
  for (let i = 1; i < lowpassed.length; i++) {
    const band = new Float32Array(samples.length)
    for (let j = 0; j < samples.length; j++) {
      band[j] = lowpassed[i][j] - lowpassed[i - 1][j]
    }
    bands.push(band)
  }
  const lastBand = new Float32Array(samples.length)
  const lastLp = lowpassed[lowpassed.length - 1]
  for (let j = 0; j < samples.length; j++) {
    lastBand[j] = samples[j] - lastLp[j]
  }
  bands.push(lastBand)
  return bands
}

function calcBandRMS(band: Float32Array, offset: number, window: number): number {
  let sum = 0
  let count = 0
  for (let i = offset; i < Math.min(offset + window, band.length); i++) {
    if (i >= 0) {
      sum += band[i] * band[i]
      count++
    }
  }
  return count > 0 ? Math.sqrt(sum / count) : 0
}

// --- Boids Configuration ---
const MAX_AGENTS_PER_BAND = 64
const MAX_TOTAL = MAX_AGENTS_PER_BAND * NUM_BANDS
const VERTS_PER_AGENT = 3 // triangle
const BAND_SIZES = [0.04, 0.025, 0.015, 0.01] // triangle size per band
const BAND_MAX_SPEED = [0.003, 0.005, 0.008, 0.012]
const BAND_HUE_OFFSETS = [0, 70, 160, 250]

const noteFromPitch = (frequency: number) => {
  const noteNum = 12 * (Math.log(frequency / 440) / Math.log(2))
  return Math.round(noteNum) + 69
}

// Vertex shader — clip space direct
const vertexShader = `
attribute vec3 agentColor;
attribute float agentAlpha;
varying vec3 vColor;
varying float vAlpha;
void main() {
  gl_Position = vec4(position.xy, 0.0, 1.0);
  vColor = agentColor;
  vAlpha = agentAlpha;
}
`

const fragmentShader = `
varying vec3 vColor;
varying float vAlpha;
void main() {
  gl_FragColor = vec4(vColor, vAlpha);
}
`

interface Agent {
  x: number
  y: number
  vx: number
  vy: number
  active: boolean
}

interface SwarmContext {
  agents: Agent[][]
  bandsL: Float32Array[]
  bandsR: Float32Array[]
  bandRMS: number[]
  smoothRMS: number[]
  frameTime: number
  currentPitch: number
  time: number
}

export const GeometricSwarm = () => {
  const [audioDynamicsState] = useAudioDynamicsStore()
  const [themeStoreState] = useThemeStore()
  const meshRef = useRef<THREE.Mesh>(null)

  const filterCoeffs = useMemo(() => {
    return BAND_CUTOFFS.map(fc => computeLowpassCoeffs(fc, 44100))
  }, [])

  const ctx = useMemo<SwarmContext>(() => {
    const agents: Agent[][] = []
    for (let b = 0; b < NUM_BANDS; b++) {
      const band: Agent[] = []
      for (let i = 0; i < MAX_AGENTS_PER_BAND; i++) {
        band.push({
          x: (Math.random() - 0.5) * 0.4,
          y: (Math.random() - 0.5) * 0.4,
          vx: (Math.random() - 0.5) * 0.002,
          vy: (Math.random() - 0.5) * 0.002,
          active: false,
        })
      }
      agents.push(band)
    }
    return {
      agents,
      bandsL: [],
      bandsR: [],
      bandRMS: new Array(NUM_BANDS).fill(0),
      smoothRMS: new Array(NUM_BANDS).fill(0),
      frameTime: 0,
      currentPitch: 440,
      time: 0,
    }
  }, [])

  const totalVerts = MAX_TOTAL * VERTS_PER_AGENT
  const positions = useMemo(() => new Float32Array(totalVerts * 3), [])
  const colors = useMemo(() => new Float32Array(totalVerts * 3), [])
  const alphas = useMemo(() => new Float32Array(totalVerts), [])

  const indices = useMemo(() => {
    const idx = new Uint32Array(MAX_TOTAL * 3)
    for (let i = 0; i < MAX_TOTAL; i++) {
      idx[i * 3 + 0] = i * 3 + 0
      idx[i * 3 + 1] = i * 3 + 1
      idx[i * 3 + 2] = i * 3 + 2
    }
    return idx
  }, [])

  // Audio frame update → filter into bands
  useEffect(() => {
    const frame = audioDynamicsState.frame
    if (frame.sampleRate === 0) return

    ctx.frameTime = frame.timeSeconds
    ctx.time = frame.timeSeconds

    const pitch = Math.max(frame.pitch0, frame.pitch1)
    if (pitch !== -1) ctx.currentPitch = pitch

    if (frame.samples0.length > 0) {
      ctx.bandsL = splitIntoBands(frame.samples0, filterCoeffs)
      ctx.bandsR = splitIntoBands(frame.samples1, filterCoeffs)
    }
  }, [audioDynamicsState.frame])

  const particleBaseColor = useMemo(() => {
    const baseColor = MaterialDynamicColors.primary.getArgb(themeStoreState.scheme)
    return Hct.fromInt(baseColor)
  }, [themeStoreState])

  useFrame((state, deltaTime) => {
    if (!meshRef.current) return
    if (ctx.bandsL.length === 0) return

    const sampleRate = audioDynamicsState.frame.sampleRate
    if (sampleRate === 0) return

    const currentOffset = ~~((ctx.time - ctx.frameTime) * sampleRate)
    ctx.time += deltaTime

    // Per-band: compute RMS, update agent count, run boids
    const note = noteFromPitch(ctx.currentPitch)
    const baseHue = (note % 12) * 30

    for (let b = 0; b < NUM_BANDS; b++) {
      const rms = calcBandRMS(ctx.bandsL[b], currentOffset, 2048)
      ctx.smoothRMS[b] += (rms - ctx.smoothRMS[b]) * 0.15
      const smoothed = ctx.smoothRMS[b]

      // Target agent count based on RMS (min 2 when any sound, max 64)
      const targetCount = smoothed > 0.005
        ? Math.max(2, Math.min(MAX_AGENTS_PER_BAND, ~~(smoothed * MAX_AGENTS_PER_BAND * 4)))
        : 0

      const agents = ctx.agents[b]

      // Activate/deactivate agents
      let activeCount = 0
      for (let i = 0; i < MAX_AGENTS_PER_BAND; i++) {
        if (i < targetCount) {
          if (!agents[i].active) {
            // Spawn near center with random velocity
            agents[i].active = true
            agents[i].x = (Math.random() - 0.5) * 0.3
            agents[i].y = (Math.random() - 0.5) * 0.3
            agents[i].vx = (Math.random() - 0.5) * BAND_MAX_SPEED[b]
            agents[i].vy = (Math.random() - 0.5) * BAND_MAX_SPEED[b]
          }
          activeCount++
        } else {
          agents[i].active = false
        }
      }

      if (activeCount === 0) continue

      // Boids forces
      const separationDist = 0.08 + smoothed * 0.2
      const cohesionStrength = 0.0003 * (1 - smoothed * 2)
      const alignStrength = 0.02
      const separationStrength = 0.001 + smoothed * 0.003
      const maxSpeed = BAND_MAX_SPEED[b] * (0.5 + smoothed * 3)

      // Compute center of mass
      let cx = 0, cy = 0
      for (let i = 0; i < activeCount; i++) {
        cx += agents[i].x
        cy += agents[i].y
      }
      cx /= activeCount
      cy /= activeCount

      // Pitch-based target direction
      const pitchAngle = (baseHue / 360) * Math.PI * 2 + b * Math.PI * 0.5
      const targetDirX = Math.cos(pitchAngle) * 0.0005
      const targetDirY = Math.sin(pitchAngle) * 0.0005

      // L/R stereo offset for band center
      const stereoOffset = ctx.bandsL[b] && ctx.bandsR[b] && currentOffset >= 0 && currentOffset < ctx.bandsL[b].length
        ? (ctx.bandsL[b][currentOffset] - ctx.bandsR[b][currentOffset]) * 0.3
        : 0

      for (let i = 0; i < activeCount; i++) {
        const a = agents[i]
        let fx = 0, fy = 0

        // Separation
        for (let j = 0; j < activeCount; j++) {
          if (i === j) continue
          const dx = a.x - agents[j].x
          const dy = a.y - agents[j].y
          const dist = Math.sqrt(dx * dx + dy * dy)
          if (dist < separationDist && dist > 0.001) {
            fx += (dx / dist) * separationStrength / dist
            fy += (dy / dist) * separationStrength / dist
          }
        }

        // Alignment (steer toward average velocity)
        let avgVx = 0, avgVy = 0
        for (let j = 0; j < activeCount; j++) {
          avgVx += agents[j].vx
          avgVy += agents[j].vy
        }
        avgVx /= activeCount
        avgVy /= activeCount
        fx += (avgVx - a.vx) * alignStrength
        fy += (avgVy - a.vy) * alignStrength

        // Cohesion (toward center + stereo offset)
        fx += (cx + stereoOffset - a.x) * cohesionStrength
        fy += (cy - a.y) * cohesionStrength

        // Pitch direction
        fx += targetDirX
        fy += targetDirY

        // Boundary: soft push back toward center
        if (Math.abs(a.x) > 0.8) fx -= a.x * 0.001
        if (Math.abs(a.y) > 0.8) fy -= a.y * 0.001

        a.vx += fx
        a.vy += fy

        // Clamp speed
        const speed = Math.sqrt(a.vx * a.vx + a.vy * a.vy)
        if (speed > maxSpeed) {
          a.vx = (a.vx / speed) * maxSpeed
          a.vy = (a.vy / speed) * maxSpeed
        }

        a.x += a.vx
        a.y += a.vy
      }
    }

    // Write to BufferGeometry
    const posArr = positions
    const colArr = colors
    const alphaArr = alphas

    for (let b = 0; b < NUM_BANDS; b++) {
      const agents = ctx.agents[b]
      const size = BAND_SIZES[b]

      // Band color
      const nc = Hct.from(baseHue + BAND_HUE_OFFSETS[b], Math.max(particleBaseColor.chroma, 40), 75)
      const pc = Blend.harmonize(nc.toInt(), particleBaseColor.toInt())
      const cr = ((pc >> 16) & 255) / 255
      const cg = ((pc >> 8) & 255) / 255
      const cb = (pc & 255) / 255

      for (let i = 0; i < MAX_AGENTS_PER_BAND; i++) {
        const globalIdx = b * MAX_AGENTS_PER_BAND + i
        const vBase = globalIdx * VERTS_PER_AGENT

        if (!agents[i].active) {
          // Hide: degenerate triangle at origin
          for (let v = 0; v < 3; v++) {
            posArr[(vBase + v) * 3 + 0] = 0
            posArr[(vBase + v) * 3 + 1] = 0
            posArr[(vBase + v) * 3 + 2] = 0
            alphaArr[vBase + v] = 0
          }
          continue
        }

        const a = agents[i]
        // Triangle pointing in velocity direction
        const speed = Math.sqrt(a.vx * a.vx + a.vy * a.vy)
        const angle = speed > 0.0001 ? Math.atan2(a.vy, a.vx) : 0

        // 3 vertices: tip, left, right
        const tipX = a.x + Math.cos(angle) * size
        const tipY = a.y + Math.sin(angle) * size
        const leftX = a.x + Math.cos(angle + 2.4) * size * 0.6
        const leftY = a.y + Math.sin(angle + 2.4) * size * 0.6
        const rightX = a.x + Math.cos(angle - 2.4) * size * 0.6
        const rightY = a.y + Math.sin(angle - 2.4) * size * 0.6

        const bandAlpha = Math.min(ctx.smoothRMS[b] * 5, 1.0) * 0.7

        posArr[(vBase + 0) * 3] = tipX
        posArr[(vBase + 0) * 3 + 1] = tipY
        posArr[(vBase + 1) * 3] = leftX
        posArr[(vBase + 1) * 3 + 1] = leftY
        posArr[(vBase + 2) * 3] = rightX
        posArr[(vBase + 2) * 3 + 1] = rightY

        for (let v = 0; v < 3; v++) {
          posArr[(vBase + v) * 3 + 2] = 0
          colArr[(vBase + v) * 3 + 0] = cr
          colArr[(vBase + v) * 3 + 1] = cg
          colArr[(vBase + v) * 3 + 2] = cb
          alphaArr[vBase + v] = bandAlpha
        }
      }
    }

    const geo = meshRef.current.geometry
    geo.attributes.position.needsUpdate = true
    geo.attributes.agentColor.needsUpdate = true
    geo.attributes.agentAlpha.needsUpdate = true
  })

  return (
    <mesh ref={meshRef}>
      <bufferGeometry>
        <bufferAttribute attach="attributes-position" count={totalVerts} itemSize={3} array={positions} />
        <bufferAttribute attach="attributes-agentColor" count={totalVerts} itemSize={3} array={colors} />
        <bufferAttribute attach="attributes-agentAlpha" count={totalVerts} itemSize={1} array={alphas} />
        <bufferAttribute attach="index" count={indices.length} itemSize={1} array={indices} />
      </bufferGeometry>
      <shaderMaterial
        vertexShader={vertexShader}
        fragmentShader={fragmentShader}
        transparent={true}
        depthWrite={false}
        side={THREE.DoubleSide}
        uniforms={{}}
      />
    </mesh>
  )
}
