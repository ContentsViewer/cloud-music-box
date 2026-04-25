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
const MAX_TAU = 600         // max phase offset in samples
const TRAIL_LENGTH = 32     // positions remembered per agent
const WAVEFORM_SPREAD = 0.5  // target position scale (waveform value × this = target coordinate)
const SPRING = 0.015          // spring stiffness toward waveform target
const REPULSION_DIST = 0.04
const REPULSION_STRENGTH = 0.0006
const ATTRACT_DIST = 0.2
const ATTRACT_STRENGTH = 0.00003
const FRICTION = 0.92         // stronger damping for stability
const AGENT_SIZE = 0.012
const AGENT_ALPHA = 0.6
const TRAIL_ALPHA_MAX = 0.25

const noteFromPitch = (frequency: number) => {
  const noteNum = 12 * (Math.log(frequency / 440) / Math.log(2))
  return Math.round(noteNum) + 69
}

// Vertex shader for both agents (triangles) and trails (lines)
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
  tau: number // phase offset (fixed per agent)
  // Trail: ring buffer of past positions
  trail: Float32Array // [x0,y0, x1,y1, ...] length = TRAIL_LENGTH*2
  trailHead: number
}

interface SwarmContext {
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
}

export const PhaseSwarm = () => {
  const [audioDynamicsState] = useAudioDynamicsStore()
  const [themeStoreState] = useThemeStore()
  const meshRef = useRef<THREE.Mesh>(null)
  const trailRef = useRef<THREE.LineSegments>(null)

  const ctx = useMemo<SwarmContext>(() => {
    const agents: Agent[] = []
    for (let i = 0; i < NUM_AGENTS; i++) {
      agents.push({
        x: (Math.random() - 0.5) * 0.4,
        y: (Math.random() - 0.5) * 0.4,
        vx: 0, vy: 0,
        tau: Math.round((i / (NUM_AGENTS - 1)) * MAX_TAU),
        trail: new Float32Array(TRAIL_LENGTH * 2),
        trailHead: 0,
      })
    }
    return {
      agents,
      frameTime: 0,
      currentPitch: 440,
      time: 0,
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
  // Each agent has TRAIL_LENGTH-1 segments = (TRAIL_LENGTH-1)*2 indices
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

    // --- Simulation ---
    for (let i = 0; i < NUM_AGENTS; i++) {
      const a = agents[i]
      let fx = 0, fy = 0

      // Force 1: Spring toward waveform-derived target position
      const sIdx = currentOffset + a.tau
      if (sIdx >= 0 && sIdx < sampleLen) {
        const targetX = samples0[sIdx] * WAVEFORM_SPREAD
        const targetY = samples1[sIdx] * WAVEFORM_SPREAD
        fx += (targetX - a.x) * SPRING
        fy += (targetY - a.y) * SPRING
      }

      // Force 2: Inter-agent repulsion + attraction
      for (let j = 0; j < NUM_AGENTS; j++) {
        if (i === j) continue
        const b = agents[j]
        const dx = b.x - a.x
        const dy = b.y - a.y
        const distSq = dx * dx + dy * dy

        if (distSq > ATTRACT_DIST * ATTRACT_DIST || distSq < 0.000001) continue
        const dist = Math.sqrt(distSq)

        if (dist < REPULSION_DIST) {
          // Repel
          const f = (REPULSION_DIST / dist - 1) * REPULSION_STRENGTH
          fx -= (dx / dist) * f
          fy -= (dy / dist) * f
        } else {
          // Attract (gentle, keeps swarm together)
          const f = ATTRACT_STRENGTH
          fx += (dx / dist) * f
          fy += (dy / dist) * f
        }
      }

      // Force 3: Boundary
      const br = Math.sqrt(a.x * a.x + a.y * a.y)
      if (br > 0.7) {
        const push = (br - 0.7) * 0.003
        fx -= (a.x / br) * push
        fy -= (a.y / br) * push
      }

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

    // Fixed alpha — movement itself communicates dynamics
    const globalAlpha = AGENT_ALPHA

    for (let i = 0; i < NUM_AGENTS; i++) {
      const a = agents[i]
      const phaseT = i / (NUM_AGENTS - 1) // 0..1

      // Color: continuous hue gradient by τ position
      const hueShift = phaseT * 180
      const nc = Hct.from(baseHue + hueShift, Math.max(particleBaseColor.chroma, 40), 75)
      const pc = Blend.harmonize(nc.toInt(), particleBaseColor.toInt())
      const cr = ((pc >> 16) & 255) / 255
      const cg = ((pc >> 8) & 255) / 255
      const cb = (pc & 255) / 255

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
        aAlp[vBase + v] = globalAlpha
      }
    }

    // --- Write trail lines ---
    const tPos = trailPositions
    const tCol = trailColors
    const tAlp = trailAlphas

    for (let i = 0; i < NUM_AGENTS; i++) {
      const a = agents[i]
      const phaseT = i / (NUM_AGENTS - 1)
      const hueShift = phaseT * 180
      const nc = Hct.from(baseHue + hueShift, Math.max(particleBaseColor.chroma, 30), 65)
      const pc = Blend.harmonize(nc.toInt(), particleBaseColor.toInt())
      const cr = ((pc >> 16) & 255) / 255
      const cg = ((pc >> 8) & 255) / 255
      const cb = (pc & 255) / 255

      const base = i * TRAIL_LENGTH
      for (let s = 0; s < TRAIL_LENGTH; s++) {
        // Read from ring buffer: newest first
        const ringIdx = (a.trailHead - 1 - s + TRAIL_LENGTH * 2) % TRAIL_LENGTH
        tPos[(base + s) * 3 + 0] = a.trail[ringIdx * 2 + 0]
        tPos[(base + s) * 3 + 1] = a.trail[ringIdx * 2 + 1]
        tPos[(base + s) * 3 + 2] = 0

        tCol[(base + s) * 3 + 0] = cr
        tCol[(base + s) * 3 + 1] = cg
        tCol[(base + s) * 3 + 2] = cb

        // Fade: newest = full alpha, oldest = 0
        const age = s / (TRAIL_LENGTH - 1)
        tAlp[base + s] = TRAIL_ALPHA_MAX * (1 - age)
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
