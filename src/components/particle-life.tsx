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

// --- Band filter (same as geometric-swarm) ---
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
    if (i >= 0) { sum += band[i] * band[i]; count++ }
  }
  return count > 0 ? Math.sqrt(sum / count) : 0
}

// --- Particle Life Configuration ---
const MAX_AGENTS_PER_BAND = 48
const MAX_TOTAL = MAX_AGENTS_PER_BAND * NUM_BANDS
const VERTS_PER_AGENT = 3
const BAND_SIZES = [0.035, 0.022, 0.014, 0.009]
const BAND_HUE_OFFSETS = [0, 70, 160, 250]
const R_MIN = 0.03   // repulsion radius
const R_MAX = 0.25   // interaction radius
const FRICTION = 0.98

const noteFromPitch = (frequency: number) => {
  const noteNum = 12 * (Math.log(frequency / 440) / Math.log(2))
  return Math.round(noteNum) + 69
}

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
  x: number; y: number
  vx: number; vy: number
  active: boolean
}

interface PLContext {
  agents: Agent[][]
  activeCounts: number[]
  bandsL: Float32Array[]
  bandsR: Float32Array[]
  smoothRMS: number[]
  // 4x4 interaction matrix: matrix[i][j] = attraction from type i toward type j
  matrix: number[][]
  frameTime: number
  currentPitch: number
  time: number
}

export const ParticleLife = () => {
  const [audioDynamicsState] = useAudioDynamicsStore()
  const [themeStoreState] = useThemeStore()
  const meshRef = useRef<THREE.Mesh>(null)

  const filterCoeffs = useMemo(() => {
    return BAND_CUTOFFS.map(fc => computeLowpassCoeffs(fc, 44100))
  }, [])

  const ctx = useMemo<PLContext>(() => {
    const agents: Agent[][] = []
    for (let b = 0; b < NUM_BANDS; b++) {
      const band: Agent[] = []
      for (let i = 0; i < MAX_AGENTS_PER_BAND; i++) {
        band.push({
          x: (Math.random() - 0.5) * 0.6,
          y: (Math.random() - 0.5) * 0.6,
          vx: (Math.random() - 0.5) * 0.001,
          vy: (Math.random() - 0.5) * 0.001,
          active: false,
        })
      }
      agents.push(band)
    }
    // Initialize interaction matrix with interesting asymmetric base values
    const matrix = [
      [ 0.3,  0.2, -0.1, -0.2],  // low: attracts low+midlow, repels high
      [-0.1,  0.3,  0.2, -0.1],  // midlow: attracts midlow+midhigh
      [ 0.1, -0.2,  0.3,  0.2],  // midhigh: attracts midhigh+high
      [ 0.2,  0.1, -0.1,  0.3],  // high: attracts high+low (cycle)
    ]
    return {
      agents,
      activeCounts: new Array(NUM_BANDS).fill(0),
      bandsL: [],
      bandsR: [],
      smoothRMS: new Array(NUM_BANDS).fill(0),
      matrix,
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

  useFrame(() => {
    if (!meshRef.current) return
    if (ctx.bandsL.length === 0) return
    const sampleRate = audioDynamicsState.frame.sampleRate
    if (sampleRate === 0) return

    const currentOffset = ~~((ctx.time - ctx.frameTime) * sampleRate)
    ctx.time += 1 / 60 // fixed timestep for stability

    const note = noteFromPitch(ctx.currentPitch)
    const baseHue = (note % 12) * 30

    // --- Update RMS and agent counts ---
    for (let b = 0; b < NUM_BANDS; b++) {
      const rms = calcBandRMS(ctx.bandsL[b], currentOffset, 2048)
      ctx.smoothRMS[b] += (rms - ctx.smoothRMS[b]) * 0.12
      const s = ctx.smoothRMS[b]

      const targetCount = s > 0.005
        ? Math.max(2, Math.min(MAX_AGENTS_PER_BAND, ~~(s * MAX_AGENTS_PER_BAND * 4)))
        : 0

      const agents = ctx.agents[b]
      let active = 0
      for (let i = 0; i < MAX_AGENTS_PER_BAND; i++) {
        if (i < targetCount) {
          if (!agents[i].active) {
            agents[i].active = true
            agents[i].x = (Math.random() - 0.5) * 0.5
            agents[i].y = (Math.random() - 0.5) * 0.5
            agents[i].vx = (Math.random() - 0.5) * 0.001
            agents[i].vy = (Math.random() - 0.5) * 0.001
          }
          active++
        } else {
          agents[i].active = false
        }
      }
      ctx.activeCounts[b] = active
    }

    // --- Update interaction matrix based on band RMS ---
    const baseMatrix = [
      [ 0.3,  0.2, -0.1, -0.2],
      [-0.1,  0.3,  0.2, -0.1],
      [ 0.1, -0.2,  0.3,  0.2],
      [ 0.2,  0.1, -0.1,  0.3],
    ]
    for (let i = 0; i < NUM_BANDS; i++) {
      for (let j = 0; j < NUM_BANDS; j++) {
        // When band i is loud, it attracts/pushes band j more strongly
        ctx.matrix[i][j] = baseMatrix[i][j] + ctx.smoothRMS[i] * 1.5 - ctx.smoothRMS[j] * 0.5
      }
    }

    // --- Particle Life force calculation ---
    for (let b = 0; b < NUM_BANDS; b++) {
      const agents = ctx.agents[b]
      const ac = ctx.activeCounts[b]
      if (ac === 0) continue

      // Stereo offset
      const stereoOffset = currentOffset >= 0 && currentOffset < ctx.bandsL[b].length
        ? (ctx.bandsL[b][currentOffset] - ctx.bandsR[b][currentOffset]) * 0.2
        : 0

      for (let i = 0; i < ac; i++) {
        const a = agents[i]
        let fx = 0, fy = 0

        // Interact with ALL bands
        for (let ob = 0; ob < NUM_BANDS; ob++) {
          const attraction = ctx.matrix[b][ob]
          const otherAgents = ctx.agents[ob]
          const oac = ctx.activeCounts[ob]

          for (let j = 0; j < oac; j++) {
            if (b === ob && i === j) continue
            const o = otherAgents[j]
            const dx = o.x - a.x
            const dy = o.y - a.y
            const distSq = dx * dx + dy * dy

            if (distSq > R_MAX * R_MAX || distSq < 0.000001) continue
            const dist = Math.sqrt(distSq)

            if (dist < R_MIN) {
              // Universal short-range repulsion
              const repel = (R_MIN / dist - 1) * 0.0008
              fx -= (dx / dist) * repel
              fy -= (dy / dist) * repel
            } else {
              // Attraction/repulsion based on matrix
              const t = (dist - R_MIN) / (R_MAX - R_MIN)
              // Triangle function: peaks at midpoint of [rMin, rMax]
              const strength = attraction * (1 - Math.abs(2 * t - 1)) * 0.0004
              fx += (dx / dist) * strength
              fy += (dy / dist) * strength
            }
          }
        }

        // Pitch-based drift
        const pitchAngle = (baseHue / 360) * Math.PI * 2 + b * Math.PI * 0.5
        fx += Math.cos(pitchAngle) * 0.00015
        fy += Math.sin(pitchAngle) * 0.00015

        // Stereo bias
        fx += stereoOffset * 0.0003

        // Boundary: soft push
        const br = Math.sqrt(a.x * a.x + a.y * a.y)
        if (br > 0.7) {
          const push = (br - 0.7) * 0.002
          fx -= (a.x / br) * push
          fy -= (a.y / br) * push
        }

        a.vx = (a.vx + fx) * FRICTION
        a.vy = (a.vy + fy) * FRICTION
        a.x += a.vx
        a.y += a.vy
      }
    }

    // --- Write geometry ---
    const posArr = positions
    const colArr = colors
    const alphaArr = alphas

    for (let b = 0; b < NUM_BANDS; b++) {
      const agents = ctx.agents[b]
      const size = BAND_SIZES[b]
      const nc = Hct.from(baseHue + BAND_HUE_OFFSETS[b], Math.max(particleBaseColor.chroma, 40), 75)
      const pc = Blend.harmonize(nc.toInt(), particleBaseColor.toInt())
      const cr = ((pc >> 16) & 255) / 255
      const cg = ((pc >> 8) & 255) / 255
      const cb = (pc & 255) / 255

      for (let i = 0; i < MAX_AGENTS_PER_BAND; i++) {
        const gIdx = b * MAX_AGENTS_PER_BAND + i
        const vBase = gIdx * VERTS_PER_AGENT

        if (!agents[i].active) {
          for (let v = 0; v < 3; v++) {
            posArr[(vBase + v) * 3] = 0
            posArr[(vBase + v) * 3 + 1] = 0
            posArr[(vBase + v) * 3 + 2] = 0
            alphaArr[vBase + v] = 0
          }
          continue
        }

        const a = agents[i]
        const speed = Math.sqrt(a.vx * a.vx + a.vy * a.vy)
        const angle = speed > 0.00005 ? Math.atan2(a.vy, a.vx) : 0

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
          colArr[(vBase + v) * 3] = cr
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
