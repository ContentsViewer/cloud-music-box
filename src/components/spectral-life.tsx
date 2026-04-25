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
import FFT from "fft.js"

// --- Configuration ---
const MAX_SPECIES = 8
const MAX_AGENTS_PER_SPECIES = 16
const MAX_TOTAL_AGENTS = MAX_SPECIES * MAX_AGENTS_PER_SPECIES // 128
const VERTS_PER_AGENT = 3

// FFT & Peak Detection
const FFT_SIZE = 4096
const PEAK_THRESHOLD_DB = -50
const PEAK_MIN_DISTANCE = 4        // bins (~43Hz minimum separation)
const FREQ_MATCH_TOLERANCE = 0.05  // 5% for tracking across frames
const FREQ_SMOOTH_RATE = 0.2
const AMPLITUDE_SMOOTH_RATE = 0.15
const SPAWN_THRESHOLD = 0.003
const DESPAWN_THRESHOLD = 0.001
const DESPAWN_FRAMES = 12

// Rendering
const FADE_IN_RATE = 0.05   // per render frame (60fps), ~0.3s
const FADE_OUT_RATE = 0.03  // per render frame, ~0.5s
const AGENT_ALPHA_SCALE = 15.0
const AGENT_ALPHA_MAX = 0.7
const BASS_SIZE = 0.035
const TREBLE_SIZE = 0.009
const FREQ_LOW = 50
const FREQ_HIGH = 8000

// Physics (Particle Life)
const R_MIN = 0.03
const R_MAX = 0.25
const FRICTION = 0.98
const REPULSION_STRENGTH = 0.0008
const INTERACTION_STRENGTH = 0.0004
const SELF_ATTRACTION = 0.35
const BASS_BIAS = 0.7
const TREBLE_BIAS = 1.3
const BOUNDARY_RADIUS = 0.7
const BOUNDARY_STRENGTH = 0.002
const ENERGY_INJECTION = 0.0003

// Consonance table: 12 semitones (music theory encoded as numbers)
// Positive = attraction (consonant), Negative = repulsion (dissonant)
const CONSONANCE_TABLE = [
//  uni   m2    M2   m3   M3   P4   tri   P5   m6   M6   m7   M7
  0.35, -0.5, -0.2, 0.3, 0.4, 0.5, -0.7, 0.7, 0.3, 0.4, -0.3, -0.2,
]

const noteFromPitch = (frequency: number) => {
  const noteNum = 12 * (Math.log(frequency / 440) / Math.log(2))
  return Math.round(noteNum) + 69
}

// Precompute Hann window
const hannWindow = new Float32Array(FFT_SIZE)
for (let i = 0; i < FFT_SIZE; i++) {
  hannWindow[i] = 0.5 * (1 - Math.cos((2 * Math.PI * i) / (FFT_SIZE - 1)))
}

// Agent size interpolated by frequency (bass=large, treble=small)
function agentSizeFromFreq(freq: number): number {
  const t = Math.max(0, Math.min(1, Math.log2(freq / FREQ_LOW) / Math.log2(FREQ_HIGH / FREQ_LOW)))
  return BASS_SIZE * (1 - t) + TREBLE_SIZE * t
}

// Vertex shader (clip-space, no projection)
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

interface DetectedPeak {
  bin: number
  freq: number
  amplitude: number
}

interface TrackedPeak {
  freq: number
  amplitude: number
  age: number
  despawnCounter: number
  alive: boolean
}

interface Agent {
  x: number; y: number
  vx: number; vy: number
  fadeAlpha: number
  active: boolean
}

interface SpectralLifeContext {
  // FFT
  fft: InstanceType<typeof FFT>
  spectrum: number[]
  windowed: Float32Array
  magnitudes: Float32Array

  // Peak tracking
  peaks: TrackedPeak[]

  // Agents: flat array indexed by [speciesIdx * MAX_AGENTS_PER_SPECIES + agentIdx]
  agents: Agent[][]
  activeCounts: number[]

  // Interaction matrix (recomputed when species change)
  interactionMatrix: Float32Array

  // Timing
  frameTime: number
  currentPitch: number
  time: number
  sampleRate: number

  // Color cache per species
  speciesColors: Float32Array // MAX_SPECIES * 3 (rgb)
  speciesSizes: Float32Array  // MAX_SPECIES
  lastColorHue: number
}

export const SpectralLife = () => {
  const [audioDynamicsState] = useAudioDynamicsStore()
  const [themeStoreState] = useThemeStore()
  const meshRef = useRef<THREE.Mesh>(null)

  const ctx = useMemo<SpectralLifeContext>(() => {
    const agents: Agent[][] = []
    for (let s = 0; s < MAX_SPECIES; s++) {
      const species: Agent[] = []
      for (let i = 0; i < MAX_AGENTS_PER_SPECIES; i++) {
        species.push({
          x: (Math.random() - 0.5) * 0.5,
          y: (Math.random() - 0.5) * 0.5,
          vx: (Math.random() - 0.5) * 0.001,
          vy: (Math.random() - 0.5) * 0.001,
          fadeAlpha: 0,
          active: false,
        })
      }
      agents.push(species)
    }
    return {
      fft: new FFT(FFT_SIZE),
      spectrum: new FFT(FFT_SIZE).createComplexArray(),
      windowed: new Float32Array(FFT_SIZE),
      magnitudes: new Float32Array(FFT_SIZE / 2),
      peaks: [],
      agents,
      activeCounts: new Array(MAX_SPECIES).fill(0),
      interactionMatrix: new Float32Array(MAX_SPECIES * MAX_SPECIES),
      frameTime: 0,
      currentPitch: 440,
      time: 0,
      sampleRate: 44100,
      speciesColors: new Float32Array(MAX_SPECIES * 3),
      speciesSizes: new Float32Array(MAX_SPECIES),
      lastColorHue: -1,
    }
  }, [])

  const totalVerts = MAX_TOTAL_AGENTS * VERTS_PER_AGENT
  const positions = useMemo(() => new Float32Array(totalVerts * 3), [])
  const colors = useMemo(() => new Float32Array(totalVerts * 3), [])
  const alphas = useMemo(() => new Float32Array(totalVerts), [])

  const indices = useMemo(() => {
    const idx = new Uint32Array(MAX_TOTAL_AGENTS * 3)
    for (let i = 0; i < MAX_TOTAL_AGENTS; i++) {
      idx[i * 3 + 0] = i * 3 + 0
      idx[i * 3 + 1] = i * 3 + 1
      idx[i * 3 + 2] = i * 3 + 2
    }
    return idx
  }, [])

  // --- Audio frame processing: FFT + peak detection + species management ---
  useEffect(() => {
    const frame = audioDynamicsState.frame
    if (frame.sampleRate === 0) return
    ctx.frameTime = frame.timeSeconds
    ctx.time = frame.timeSeconds
    ctx.sampleRate = frame.sampleRate
    const pitch = Math.max(frame.pitch0, frame.pitch1)
    if (pitch !== -1) ctx.currentPitch = pitch

    const samples0 = frame.samples0
    const samples1 = frame.samples1
    if (samples0.length === 0) return

    // Skip FFT if silence
    const maxRMS = Math.max(frame.rms0, frame.rms1)
    if (maxRMS < 0.003) {
      // Let existing peaks decay naturally
      for (const peak of ctx.peaks) {
        peak.amplitude *= 0.8
        peak.despawnCounter++
        if (peak.despawnCounter >= DESPAWN_FRAMES) peak.alive = false
      }
      ctx.peaks = ctx.peaks.filter(p => p.alive)
      updateSpeciesFromPeaks(ctx)
      return
    }

    // 1. Apply Hann window & average L+R for mono FFT
    const len = Math.min(FFT_SIZE, samples0.length)
    for (let i = 0; i < len; i++) {
      ctx.windowed[i] = ((samples0[i] + samples1[i]) * 0.5) * hannWindow[i]
    }
    for (let i = len; i < FFT_SIZE; i++) {
      ctx.windowed[i] = 0
    }

    // 2. FFT
    ctx.fft.realTransform(ctx.spectrum, ctx.windowed)
    ctx.fft.completeSpectrum(ctx.spectrum)

    // 3. Compute magnitude spectrum
    const halfSize = FFT_SIZE / 2
    for (let k = 0; k < halfSize; k++) {
      const re = ctx.spectrum[2 * k]
      const im = ctx.spectrum[2 * k + 1]
      ctx.magnitudes[k] = Math.sqrt(re * re + im * im)
    }

    // 4. Peak detection: find local maxima above threshold
    const freqPerBin = frame.sampleRate / FFT_SIZE
    const thresholdLinear = Math.pow(10, PEAK_THRESHOLD_DB / 20) * FFT_SIZE
    const detectedPeaks: DetectedPeak[] = []

    for (let k = PEAK_MIN_DISTANCE; k < halfSize - PEAK_MIN_DISTANCE; k++) {
      const mag = ctx.magnitudes[k]
      if (mag < thresholdLinear) continue

      // Check local maximum within PEAK_MIN_DISTANCE
      let isMax = true
      for (let d = 1; d <= PEAK_MIN_DISTANCE; d++) {
        if (ctx.magnitudes[k - d] >= mag || ctx.magnitudes[k + d] >= mag) {
          isMax = false
          break
        }
      }
      if (!isMax) continue

      detectedPeaks.push({
        bin: k,
        freq: k * freqPerBin,
        amplitude: mag / FFT_SIZE, // normalize
      })
    }

    // 5. Harmonic grouping: boost fundamentals, suppress harmonics
    detectedPeaks.sort((a, b) => a.freq - b.freq)
    for (let i = detectedPeaks.length - 1; i >= 0; i--) {
      for (let j = 0; j < i; j++) {
        const ratio = detectedPeaks[i].freq / detectedPeaks[j].freq
        const nearestHarmonic = Math.round(ratio)
        if (nearestHarmonic >= 2 && nearestHarmonic <= 6
          && Math.abs(ratio - nearestHarmonic) < 0.04) {
          detectedPeaks[j].amplitude += detectedPeaks[i].amplitude * 0.3
          detectedPeaks[i].amplitude *= 0.3
        }
      }
    }

    // 6. Select top MAX_SPECIES peaks by amplitude
    detectedPeaks.sort((a, b) => b.amplitude - a.amplitude)
    const topPeaks = detectedPeaks.slice(0, MAX_SPECIES)

    // 7. Match to existing tracked peaks by frequency proximity
    const matched = new Set<number>() // indices into ctx.peaks that were matched
    const usedNewPeaks = new Set<number>()

    for (let ti = 0; ti < ctx.peaks.length; ti++) {
      const tracked = ctx.peaks[ti]
      if (!tracked.alive) continue

      let bestMatch = -1
      let bestDist = Infinity
      for (let ni = 0; ni < topPeaks.length; ni++) {
        if (usedNewPeaks.has(ni)) continue
        const freqDist = Math.abs(topPeaks[ni].freq - tracked.freq) / tracked.freq
        if (freqDist < FREQ_MATCH_TOLERANCE && freqDist < bestDist) {
          bestDist = freqDist
          bestMatch = ni
        }
      }

      if (bestMatch >= 0) {
        // Update tracked peak with smoothing
        const np = topPeaks[bestMatch]
        tracked.freq += (np.freq - tracked.freq) * FREQ_SMOOTH_RATE
        tracked.amplitude += (np.amplitude - tracked.amplitude) * AMPLITUDE_SMOOTH_RATE
        tracked.age++
        tracked.despawnCounter = 0
        matched.add(ti)
        usedNewPeaks.add(bestMatch)
      } else {
        // No match: start despawn countdown
        tracked.amplitude *= 0.85
        tracked.despawnCounter++
        if (tracked.despawnCounter >= DESPAWN_FRAMES) {
          tracked.alive = false
        }
      }
    }

    // 8. Spawn new peaks for unmatched detected peaks
    for (let ni = 0; ni < topPeaks.length; ni++) {
      if (usedNewPeaks.has(ni)) continue
      if (topPeaks[ni].amplitude < SPAWN_THRESHOLD) continue
      if (ctx.peaks.filter(p => p.alive).length >= MAX_SPECIES) break

      ctx.peaks.push({
        freq: topPeaks[ni].freq,
        amplitude: topPeaks[ni].amplitude,
        age: 0,
        despawnCounter: 0,
        alive: true,
      })
    }

    // Remove dead peaks
    ctx.peaks = ctx.peaks.filter(p => p.alive)

    // 9. Update species from peaks
    updateSpeciesFromPeaks(ctx)
  }, [audioDynamicsState.frame])

  const particleBaseColor = useMemo(() => {
    const baseColor = MaterialDynamicColors.primary.getArgb(themeStoreState.scheme)
    return Hct.fromInt(baseColor)
  }, [themeStoreState])

  // --- Main render loop ---
  useFrame(() => {
    if (!meshRef.current) return
    if (ctx.sampleRate === 0) return

    const agents = ctx.agents
    const peaks = ctx.peaks
    const aliveCount = peaks.length

    // Update colors when pitch changes
    const note = noteFromPitch(ctx.currentPitch)
    const baseHue = (note % 12) * 30

    if (baseHue !== ctx.lastColorHue || true) {
      // Recompute per-species colors and sizes
      ctx.lastColorHue = baseHue
      for (let s = 0; s < aliveCount; s++) {
        const peakNote = noteFromPitch(peaks[s].freq)
        const hue = (peakNote % 12) * 30
        const nc = Hct.from(hue, Math.max(particleBaseColor.chroma, 40), 75)
        const pc = Blend.harmonize(nc.toInt(), particleBaseColor.toInt())
        ctx.speciesColors[s * 3 + 0] = ((pc >> 16) & 255) / 255
        ctx.speciesColors[s * 3 + 1] = ((pc >> 8) & 255) / 255
        ctx.speciesColors[s * 3 + 2] = (pc & 255) / 255
        ctx.speciesSizes[s] = agentSizeFromFreq(peaks[s].freq)
      }
    }

    // Recompute interaction matrix
    for (let a = 0; a < aliveCount; a++) {
      for (let b = 0; b < aliveCount; b++) {
        if (a === b) {
          ctx.interactionMatrix[a * MAX_SPECIES + b] = SELF_ATTRACTION
          continue
        }
        const ratio = peaks[b].freq / peaks[a].freq
        const semitones = Math.round(12 * Math.log2(ratio))
        const normalized = ((semitones % 12) + 12) % 12
        let c = CONSONANCE_TABLE[normalized]
        // Asymmetry: bass is anchor, treble orbits
        if (peaks[a].freq < peaks[b].freq) c *= BASS_BIAS
        else c *= TREBLE_BIAS
        ctx.interactionMatrix[a * MAX_SPECIES + b] = c
      }
    }

    // --- Physics simulation ---
    for (let s = 0; s < aliveCount; s++) {
      const specAgents = agents[s]
      const ac = ctx.activeCounts[s]
      if (ac === 0) continue

      const peakAmp = peaks[s].amplitude

      for (let i = 0; i < ac; i++) {
        const a = specAgents[i]
        if (!a.active) continue

        let fx = 0, fy = 0

        // Energy injection: amplitude-proportional random force
        fx += (Math.random() - 0.5) * peakAmp * ENERGY_INJECTION * 2
        fy += (Math.random() - 0.5) * peakAmp * ENERGY_INJECTION * 2

        // Particle Life interactions with all species
        for (let os = 0; os < aliveCount; os++) {
          const attraction = ctx.interactionMatrix[s * MAX_SPECIES + os]
          const otherAgents = agents[os]
          const oac = ctx.activeCounts[os]

          for (let j = 0; j < oac; j++) {
            if (s === os && i === j) continue
            const o = otherAgents[j]
            if (!o.active) continue

            const dx = o.x - a.x
            const dy = o.y - a.y
            const distSq = dx * dx + dy * dy

            if (distSq > R_MAX * R_MAX || distSq < 0.000001) continue
            const dist = Math.sqrt(distSq)

            if (dist < R_MIN) {
              // Hard repulsion
              const repel = (R_MIN / dist - 1) * REPULSION_STRENGTH
              fx -= (dx / dist) * repel
              fy -= (dy / dist) * repel
            } else {
              // Consonance-modulated interaction with dome profile
              const t = (dist - R_MIN) / (R_MAX - R_MIN)
              const profile = 1 - Math.abs(2 * t - 1)
              const strength = attraction * profile * INTERACTION_STRENGTH
              fx += (dx / dist) * strength
              fy += (dy / dist) * strength
            }
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

        // Fade alpha update
        if (a.fadeAlpha < 1) {
          a.fadeAlpha = Math.min(1, a.fadeAlpha + FADE_IN_RATE)
        }
      }

      // Handle despawning agents (beyond active count)
      for (let i = ac; i < MAX_AGENTS_PER_SPECIES; i++) {
        const a = specAgents[i]
        if (a.fadeAlpha > 0) {
          a.fadeAlpha = Math.max(0, a.fadeAlpha - FADE_OUT_RATE)
          // Still apply physics during fade-out
          a.vx *= FRICTION
          a.vy *= FRICTION
          a.x += a.vx
          a.y += a.vy
        }
      }
    }

    // Handle species that have fully despawned
    for (let s = aliveCount; s < MAX_SPECIES; s++) {
      const specAgents = agents[s]
      for (let i = 0; i < MAX_AGENTS_PER_SPECIES; i++) {
        const a = specAgents[i]
        if (a.fadeAlpha > 0) {
          a.fadeAlpha = Math.max(0, a.fadeAlpha - FADE_OUT_RATE)
          a.vx *= FRICTION
          a.vy *= FRICTION
          a.x += a.vx
          a.y += a.vy
        }
      }
    }

    // --- Write geometry ---
    const posArr = positions
    const colArr = colors
    const alphaArr = alphas

    for (let s = 0; s < MAX_SPECIES; s++) {
      const specAgents = agents[s]
      const hasPeak = s < aliveCount
      const peakAmp = hasPeak ? peaks[s].amplitude : 0

      const cr = hasPeak ? ctx.speciesColors[s * 3 + 0] : 0
      const cg = hasPeak ? ctx.speciesColors[s * 3 + 1] : 0
      const cb = hasPeak ? ctx.speciesColors[s * 3 + 2] : 0
      const size = hasPeak ? ctx.speciesSizes[s] : TREBLE_SIZE

      for (let i = 0; i < MAX_AGENTS_PER_SPECIES; i++) {
        const gIdx = s * MAX_AGENTS_PER_SPECIES + i
        const vBase = gIdx * VERTS_PER_AGENT
        const a = specAgents[i]

        const displayAlpha = a.fadeAlpha * Math.min(Math.sqrt(peakAmp) * AGENT_ALPHA_SCALE, AGENT_ALPHA_MAX)

        if (displayAlpha < 0.01) {
          for (let v = 0; v < 3; v++) {
            posArr[(vBase + v) * 3] = 0
            posArr[(vBase + v) * 3 + 1] = 0
            posArr[(vBase + v) * 3 + 2] = 0
            alphaArr[vBase + v] = 0
          }
          continue
        }

        // Triangle pointing in velocity direction
        const speed = Math.sqrt(a.vx * a.vx + a.vy * a.vy)
        const angle = speed > 0.00005 ? Math.atan2(a.vy, a.vx) : 0

        posArr[(vBase + 0) * 3 + 0] = a.x + Math.cos(angle) * size
        posArr[(vBase + 0) * 3 + 1] = a.y + Math.sin(angle) * size
        posArr[(vBase + 1) * 3 + 0] = a.x + Math.cos(angle + 2.4) * size * 0.6
        posArr[(vBase + 1) * 3 + 1] = a.y + Math.sin(angle + 2.4) * size * 0.6
        posArr[(vBase + 2) * 3 + 0] = a.x + Math.cos(angle - 2.4) * size * 0.6
        posArr[(vBase + 2) * 3 + 1] = a.y + Math.sin(angle - 2.4) * size * 0.6

        for (let v = 0; v < 3; v++) {
          posArr[(vBase + v) * 3 + 2] = 0
          colArr[(vBase + v) * 3 + 0] = cr
          colArr[(vBase + v) * 3 + 1] = cg
          colArr[(vBase + v) * 3 + 2] = cb
          alphaArr[vBase + v] = displayAlpha
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

// --- Helper: Update species agent counts from tracked peaks ---
function updateSpeciesFromPeaks(ctx: SpectralLifeContext) {
  const peaks = ctx.peaks
  const aliveCount = peaks.length

  for (let s = 0; s < MAX_SPECIES; s++) {
    const specAgents = ctx.agents[s]

    if (s < aliveCount && peaks[s].alive) {
      // Active species: determine agent count from amplitude
      const amp = peaks[s].amplitude
      const targetCount = amp > DESPAWN_THRESHOLD
        ? Math.max(2, Math.min(MAX_AGENTS_PER_SPECIES, ~~(Math.sqrt(amp) * MAX_AGENTS_PER_SPECIES * 3)))
        : 0

      let active = 0
      for (let i = 0; i < MAX_AGENTS_PER_SPECIES; i++) {
        if (i < targetCount) {
          if (!specAgents[i].active) {
            // Spawn at random position
            specAgents[i].active = true
            specAgents[i].x = (Math.random() - 0.5) * 0.5
            specAgents[i].y = (Math.random() - 0.5) * 0.5
            specAgents[i].vx = (Math.random() - 0.5) * 0.001
            specAgents[i].vy = (Math.random() - 0.5) * 0.001
            specAgents[i].fadeAlpha = 0 // will fade in
          }
          active++
        } else {
          specAgents[i].active = false
          // fadeAlpha will decay in the render loop
        }
      }
      ctx.activeCounts[s] = active
    } else {
      // Inactive species: deactivate all
      ctx.activeCounts[s] = 0
      for (let i = 0; i < MAX_AGENTS_PER_SPECIES; i++) {
        specAgents[i].active = false
      }
    }
  }
}
