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

// --- Configuration ---
const NUM_AGENTS = 128
const MAX_TAU = 600           // ~14ms at 44100Hz
const LISSAJOUS_DELAY = 6     // samples, same as original Lissajous
const WAVEFORM_SPREAD = 0.5
const TRAIL_LENGTH = 32

// Physics
const SPRING = 0.02
const FRICTION = 0.95
const INTERACTION_STRENGTH = 0.0004
const K_SPECIES = 3            // sin cycles across tau range
const R_MIN = 0.03
const R_MAX = 0.25
const REPULSION_STRENGTH = 0.0008
const BOUNDARY_RADIUS = 0.7
const BOUNDARY_STRENGTH = 0.002

// Visibility
const ALPHA_SMOOTH_RATE = 0.12
const ALPHA_THRESHOLD = 0.008
const ALPHA_SCALE = 5.0
const ALPHA_MAX = 0.7
const RMS_WINDOW = 64          // samples for local RMS

// Rendering
const AGENT_SIZE = 0.012
const TRAIL_ALPHA_MAX = 0.25
const COLOR_TABLE_SIZE = 16

const noteFromPitch = (frequency: number) => {
  const noteNum = 12 * (Math.log(frequency / 440) / Math.log(2))
  return Math.round(noteNum) + 69
}

// Precompute sin interaction table for O(1) lookup
const interactionTable = new Float32Array(NUM_AGENTS * NUM_AGENTS)
for (let i = 0; i < NUM_AGENTS; i++) {
  const tauI = (i / (NUM_AGENTS - 1)) * MAX_TAU
  for (let j = 0; j < NUM_AGENTS; j++) {
    const tauJ = (j / (NUM_AGENTS - 1)) * MAX_TAU
    const dTau = tauJ - tauI
    interactionTable[i * NUM_AGENTS + j] = Math.sin((dTau / MAX_TAU) * K_SPECIES * 2 * Math.PI)
  }
}

// Vertex shader (clip-space, no projection)
const vertexShader = `
attribute vec3 vertColor;
attribute float vertAlpha;
varying vec3 vColor;
varying float vAlpha;
void main() {
  gl_Position = vec4(position.xy, 0.0, 1.0);
  vColor = vertColor;
  vAlpha = vertAlpha;
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
  tau: number
  smoothAlpha: number
  trail: Float32Array
  trailHead: number
}

interface TauLifeContext {
  agents: Agent[]
  frame?: {
    timeSeconds: number
    sampleRate: number
    samples0: Float32Array
    samples1: Float32Array
    pitch0: number
    pitch1: number
    rms0: number
    rms1: number
  }
  frameTime: number
  currentPitch: number
  time: number
  // Color lookup table (precomputed per pitch change)
  colorTable: Float32Array // [r,g,b] * COLOR_TABLE_SIZE
  lastBaseHue: number
}

export const TauLife = () => {
  const [audioDynamicsState] = useAudioDynamicsStore()
  const [themeStoreState] = useThemeStore()
  const meshRef = useRef<THREE.Mesh>(null)
  const trailRef = useRef<THREE.LineSegments>(null)

  const ctx = useMemo<TauLifeContext>(() => {
    const agents: Agent[] = []
    for (let i = 0; i < NUM_AGENTS; i++) {
      agents.push({
        x: (Math.random() - 0.5) * 0.1,
        y: (Math.random() - 0.5) * 0.1,
        vx: 0, vy: 0,
        tau: Math.round((i / (NUM_AGENTS - 1)) * MAX_TAU),
        smoothAlpha: 0,
        trail: new Float32Array(TRAIL_LENGTH * 2),
        trailHead: 0,
      })
    }
    return {
      agents,
      frameTime: 0,
      currentPitch: 440,
      time: 0,
      colorTable: new Float32Array(COLOR_TABLE_SIZE * 3),
      lastBaseHue: -1,
    }
  }, [])

  // --- Agent geometry: triangles ---
  const agentVertCount = NUM_AGENTS * 3
  const agentPositions = useMemo(() => new Float32Array(agentVertCount * 3), [])
  const agentColors = useMemo(() => new Float32Array(agentVertCount * 3), [])
  const agentAlphas = useMemo(() => new Float32Array(agentVertCount), [])
  const agentIndices = useMemo(() => {
    const idx = new Uint32Array(NUM_AGENTS * 3)
    for (let i = 0; i < NUM_AGENTS; i++) {
      idx[i * 3 + 0] = i * 3 + 0
      idx[i * 3 + 1] = i * 3 + 1
      idx[i * 3 + 2] = i * 3 + 2
    }
    return idx
  }, [])

  // --- Trail geometry: line segments ---
  const trailVertCount = NUM_AGENTS * TRAIL_LENGTH
  const trailPositions = useMemo(() => new Float32Array(trailVertCount * 3), [])
  const trailColors = useMemo(() => new Float32Array(trailVertCount * 3), [])
  const trailAlphas = useMemo(() => new Float32Array(trailVertCount), [])
  const trailIndices = useMemo(() => {
    const segsPerAgent = TRAIL_LENGTH - 1
    const idx = new Uint32Array(NUM_AGENTS * segsPerAgent * 2)
    let ptr = 0
    for (let a = 0; a < NUM_AGENTS; a++) {
      const base = a * TRAIL_LENGTH
      for (let s = 0; s < segsPerAgent; s++) {
        idx[ptr++] = base + s
        idx[ptr++] = base + s + 1
      }
    }
    return idx
  }, [])

  useEffect(() => {
    const frame = audioDynamicsState.frame
    if (frame.sampleRate === 0) return
    ctx.frame = frame
    ctx.frameTime = frame.timeSeconds
    ctx.time = frame.timeSeconds
    const pitch = Math.max(frame.pitch0, frame.pitch1)
    if (pitch !== -1) ctx.currentPitch = pitch
  }, [audioDynamicsState.frame])

  const particleBaseColor = useMemo(() => {
    const baseColor = MaterialDynamicColors.primary.getArgb(themeStoreState.scheme)
    return Hct.fromInt(baseColor)
  }, [themeStoreState])

  useFrame(() => {
    if (!meshRef.current || !trailRef.current) return
    if (!ctx.frame) return
    const sampleRate = ctx.frame.sampleRate
    if (sampleRate === 0) return

    const samples0 = ctx.frame.samples0
    const samples1 = ctx.frame.samples1
    const sampleLen = samples0.length

    const currentOffset = ~~((ctx.time - ctx.frameTime) * sampleRate)
    ctx.time += 1 / 60

    const note = noteFromPitch(ctx.currentPitch)
    const baseHue = (note % 12) * 30
    const agents = ctx.agents

    // --- Update color lookup table when hue changes ---
    if (baseHue !== ctx.lastBaseHue) {
      ctx.lastBaseHue = baseHue
      for (let c = 0; c < COLOR_TABLE_SIZE; c++) {
        const phaseT = c / (COLOR_TABLE_SIZE - 1)
        const hueShift = phaseT * 180
        const nc = Hct.from(baseHue + hueShift, Math.max(particleBaseColor.chroma, 40), 75)
        const pc = Blend.harmonize(nc.toInt(), particleBaseColor.toInt())
        ctx.colorTable[c * 3 + 0] = ((pc >> 16) & 255) / 255
        ctx.colorTable[c * 3 + 1] = ((pc >> 8) & 255) / 255
        ctx.colorTable[c * 3 + 2] = (pc & 255) / 255
      }
    }

    // --- Simulation ---
    for (let i = 0; i < NUM_AGENTS; i++) {
      const a = agents[i]

      // Rule 3: Local RMS for alpha gating
      const rmsCenter = currentOffset + a.tau
      let rmsSum = 0
      let rmsCount = 0
      const rmsStart = Math.max(0, rmsCenter - (RMS_WINDOW >> 1))
      const rmsEnd = Math.min(sampleLen, rmsCenter + (RMS_WINDOW >> 1))
      for (let s = rmsStart; s < rmsEnd; s++) {
        rmsSum += samples0[s] * samples0[s] + samples1[s] * samples1[s]
        rmsCount += 2
      }
      const localRMS = rmsCount > 0 ? Math.sqrt(rmsSum / rmsCount) : 0
      a.smoothAlpha += (localRMS - a.smoothAlpha) * ALPHA_SMOOTH_RATE

      // Skip invisible agents (save CPU)
      if (a.smoothAlpha < ALPHA_THRESHOLD) {
        a.smoothAlpha *= (1 - ALPHA_SMOOTH_RATE)
        // Still record trail position (at current pos) so trail fades smoothly
        a.trail[a.trailHead * 2 + 0] = a.x
        a.trail[a.trailHead * 2 + 1] = a.y
        a.trailHead = (a.trailHead + 1) % TRAIL_LENGTH
        continue
      }

      let fx = 0, fy = 0

      // Rule 1: Spring toward Lissajous target
      const sIdx = currentOffset + a.tau
      const sIdxDelay = sIdx + LISSAJOUS_DELAY
      if (sIdx >= 0 && sIdx < sampleLen && sIdxDelay >= 0 && sIdxDelay < sampleLen) {
        const targetX = samples1[sIdx] * WAVEFORM_SPREAD      // R channel
        const targetY = samples0[sIdxDelay] * WAVEFORM_SPREAD  // L channel + delay
        fx += (targetX - a.x) * SPRING
        fy += (targetY - a.y) * SPRING
      }
      // else: no spring force (agent drifts on momentum at buffer boundary)

      // Rule 2: sin(delta-tau) asymmetric interaction
      for (let j = 0; j < NUM_AGENTS; j++) {
        if (i === j) continue
        const b = agents[j]

        // Skip invisible agents
        if (b.smoothAlpha < ALPHA_THRESHOLD) continue

        const dx = b.x - a.x
        const dy = b.y - a.y
        const distSq = dx * dx + dy * dy

        if (distSq > R_MAX * R_MAX || distSq < 0.000001) continue
        const dist = Math.sqrt(distSq)

        if (dist < R_MIN) {
          // Hard repulsion (species-independent)
          const repel = (R_MIN / dist - 1) * REPULSION_STRENGTH
          fx -= (dx / dist) * repel
          fy -= (dy / dist) * repel
        } else {
          // sin(delta-tau) modulated attraction/repulsion with dome profile
          const t = (dist - R_MIN) / (R_MAX - R_MIN)
          const profile = 1 - Math.abs(2 * t - 1) // dome: peaks at midpoint
          const interaction = interactionTable[i * NUM_AGENTS + j]
          const strength = interaction * profile * INTERACTION_STRENGTH
          fx += (dx / dist) * strength
          fy += (dy / dist) * strength
        }
      }

      // Boundary: soft push inward
      const br = Math.sqrt(a.x * a.x + a.y * a.y)
      if (br > BOUNDARY_RADIUS) {
        const push = (br - BOUNDARY_RADIUS) * BOUNDARY_STRENGTH
        fx -= (a.x / br) * push
        fy -= (a.y / br) * push
      }

      // Integrate
      a.vx = (a.vx + fx) * FRICTION
      a.vy = (a.vy + fy) * FRICTION
      a.x += a.vx
      a.y += a.vy

      // Record trail
      a.trail[a.trailHead * 2 + 0] = a.x
      a.trail[a.trailHead * 2 + 1] = a.y
      a.trailHead = (a.trailHead + 1) % TRAIL_LENGTH
    }

    // --- Write agent triangles ---
    const aPos = agentPositions
    const aCol = agentColors
    const aAlp = agentAlphas

    for (let i = 0; i < NUM_AGENTS; i++) {
      const a = agents[i]
      const displayAlpha = Math.min(a.smoothAlpha * ALPHA_SCALE, ALPHA_MAX)

      if (displayAlpha < 0.01) {
        // Zero out invisible agent vertices
        const vBase = i * 3
        for (let v = 0; v < 3; v++) {
          aPos[(vBase + v) * 3] = 0
          aPos[(vBase + v) * 3 + 1] = 0
          aPos[(vBase + v) * 3 + 2] = 0
          aAlp[vBase + v] = 0
        }
        continue
      }

      // Color from lookup table (interpolated by tau position)
      const phaseT = i / (NUM_AGENTS - 1)
      const colorIdx = Math.min(~~(phaseT * (COLOR_TABLE_SIZE - 1)), COLOR_TABLE_SIZE - 2)
      const colorFrac = phaseT * (COLOR_TABLE_SIZE - 1) - colorIdx
      const cr = ctx.colorTable[colorIdx * 3 + 0] * (1 - colorFrac) + ctx.colorTable[(colorIdx + 1) * 3 + 0] * colorFrac
      const cg = ctx.colorTable[colorIdx * 3 + 1] * (1 - colorFrac) + ctx.colorTable[(colorIdx + 1) * 3 + 1] * colorFrac
      const cb = ctx.colorTable[colorIdx * 3 + 2] * (1 - colorFrac) + ctx.colorTable[(colorIdx + 1) * 3 + 2] * colorFrac

      // Triangle pointing in velocity direction
      const speed = Math.sqrt(a.vx * a.vx + a.vy * a.vy)
      const angle = speed > 0.00005 ? Math.atan2(a.vy, a.vx) : 0

      const vBase = i * 3
      aPos[(vBase + 0) * 3 + 0] = a.x + Math.cos(angle) * AGENT_SIZE
      aPos[(vBase + 0) * 3 + 1] = a.y + Math.sin(angle) * AGENT_SIZE
      aPos[(vBase + 1) * 3 + 0] = a.x + Math.cos(angle + 2.4) * AGENT_SIZE * 0.6
      aPos[(vBase + 1) * 3 + 1] = a.y + Math.sin(angle + 2.4) * AGENT_SIZE * 0.6
      aPos[(vBase + 2) * 3 + 0] = a.x + Math.cos(angle - 2.4) * AGENT_SIZE * 0.6
      aPos[(vBase + 2) * 3 + 1] = a.y + Math.sin(angle - 2.4) * AGENT_SIZE * 0.6

      for (let v = 0; v < 3; v++) {
        aPos[(vBase + v) * 3 + 2] = 0
        aCol[(vBase + v) * 3 + 0] = cr
        aCol[(vBase + v) * 3 + 1] = cg
        aCol[(vBase + v) * 3 + 2] = cb
        aAlp[vBase + v] = displayAlpha
      }
    }

    // --- Write trail lines ---
    const tPos = trailPositions
    const tCol = trailColors
    const tAlp = trailAlphas

    for (let i = 0; i < NUM_AGENTS; i++) {
      const a = agents[i]
      const displayAlpha = Math.min(a.smoothAlpha * ALPHA_SCALE, ALPHA_MAX)

      // Color from lookup table
      const phaseT = i / (NUM_AGENTS - 1)
      const colorIdx = Math.min(~~(phaseT * (COLOR_TABLE_SIZE - 1)), COLOR_TABLE_SIZE - 2)
      const colorFrac = phaseT * (COLOR_TABLE_SIZE - 1) - colorIdx
      const cr = ctx.colorTable[colorIdx * 3 + 0] * (1 - colorFrac) + ctx.colorTable[(colorIdx + 1) * 3 + 0] * colorFrac
      const cg = ctx.colorTable[colorIdx * 3 + 1] * (1 - colorFrac) + ctx.colorTable[(colorIdx + 1) * 3 + 1] * colorFrac
      const cb = ctx.colorTable[colorIdx * 3 + 2] * (1 - colorFrac) + ctx.colorTable[(colorIdx + 1) * 3 + 2] * colorFrac

      const base = i * TRAIL_LENGTH
      for (let s = 0; s < TRAIL_LENGTH; s++) {
        const ringIdx = (a.trailHead - 1 - s + TRAIL_LENGTH * 2) % TRAIL_LENGTH
        tPos[(base + s) * 3 + 0] = a.trail[ringIdx * 2 + 0]
        tPos[(base + s) * 3 + 1] = a.trail[ringIdx * 2 + 1]
        tPos[(base + s) * 3 + 2] = 0

        tCol[(base + s) * 3 + 0] = cr
        tCol[(base + s) * 3 + 1] = cg
        tCol[(base + s) * 3 + 2] = cb

        // Fade: newest = full alpha, oldest = 0, scaled by agent visibility
        const age = s / (TRAIL_LENGTH - 1)
        tAlp[base + s] = TRAIL_ALPHA_MAX * (1 - age) * Math.min(displayAlpha / ALPHA_MAX, 1)
      }
    }

    // Update geometries
    meshRef.current.geometry.attributes.position.needsUpdate = true
    meshRef.current.geometry.attributes.vertColor.needsUpdate = true
    meshRef.current.geometry.attributes.vertAlpha.needsUpdate = true
    trailRef.current.geometry.attributes.position.needsUpdate = true
    trailRef.current.geometry.attributes.vertColor.needsUpdate = true
    trailRef.current.geometry.attributes.vertAlpha.needsUpdate = true
  })

  return (
    <>
      {/* Trails */}
      <lineSegments ref={trailRef}>
        <bufferGeometry>
          <bufferAttribute attach="attributes-position" count={trailVertCount} itemSize={3} array={trailPositions} />
          <bufferAttribute attach="attributes-vertColor" count={trailVertCount} itemSize={3} array={trailColors} />
          <bufferAttribute attach="attributes-vertAlpha" count={trailVertCount} itemSize={1} array={trailAlphas} />
          <bufferAttribute attach="index" count={trailIndices.length} itemSize={1} array={trailIndices} />
        </bufferGeometry>
        <shaderMaterial
          vertexShader={vertexShader}
          fragmentShader={fragmentShader}
          transparent={true}
          depthWrite={false}
          uniforms={{}}
        />
      </lineSegments>
      {/* Agent triangles */}
      <mesh ref={meshRef}>
        <bufferGeometry>
          <bufferAttribute attach="attributes-position" count={agentVertCount} itemSize={3} array={agentPositions} />
          <bufferAttribute attach="attributes-vertColor" count={agentVertCount} itemSize={3} array={agentColors} />
          <bufferAttribute attach="attributes-vertAlpha" count={agentVertCount} itemSize={1} array={agentAlphas} />
          <bufferAttribute attach="index" count={agentIndices.length} itemSize={1} array={agentIndices} />
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
    </>
  )
}
