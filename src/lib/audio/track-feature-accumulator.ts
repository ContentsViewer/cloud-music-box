import FFT from "fft.js"
import type { AudioFrame } from "./audio-frame"

// Accumulates a fixed-dimension acoustic descriptor for one track by riding on
// the AudioFrames that audio-player already emits (~4 Hz, 0.5 s windows).
//
// - No extra decode and no extra memory: the frames carry zero-copy views into
//   the PCM the analyser already holds. Nothing here copies the whole track.
// - Frames overlap by ~50 % and repeat on seek, so a covered-range set tracks
//   which absolute sample ranges were already analyzed. Every hop is processed
//   exactly once, which is what makes coverageSeconds trustworthy.
// - The hot path allocates nothing: every scratch buffer is created once per
//   accumulator (the onset envelope grows by doubling, ~43 pushes per second).
//
// Feature vector layout is described by TRACK_FEATURE_LABELS. All values are raw
// (unnormalized); standardisation happens later against the whole corpus.

const FFT_SIZE = 2048
const HOP_SIZE = 1024
const SPECTRUM_BINS = FFT_SIZE / 2

const MEL_BANDS = 26
const MFCC_COUNT = 12
const MEL_MIN_HZ = 20
const MEL_MAX_HZ = 16000

/** Below this per-hop RMS the spectrum is meaningless, so it is not accumulated */
const SILENCE_RMS = 1e-4
const EPS = 1e-10

const LOUD_HIST_BINS = 48
const LOUD_MIN_DB = -80

const PITCH_HIST_MIN_SEMITONE = 12
const PITCH_HIST_BINS = 96

/** Tempo search range, in BPM */
const BPM_MIN = 50
const BPM_MAX = 200

/**
 * Bump when the meaning of any dimension changes. Records at an older version
 * are ignored (and re-derived the next time the track is played); playlists keep
 * working against the old model until they are recomputed.
 */
export const TRACK_FEATURE_VERSION = 1

/** A track needs at least this much analyzed audio before it is stored at all */
export const MIN_COVERAGE_SECONDS = 30
export const MIN_COVERAGE_RATIO = 0.2

/** Above this the descriptor is considered final and the track is not re-analyzed */
export const GOOD_COVERAGE_SECONDS = 60
export const GOOD_COVERAGE_RATIO = 0.5

export const TRACK_FEATURE_LABELS: readonly string[] = [
  ...Array.from({ length: MFCC_COUNT }, (_, i) => `mfcc${i + 1}Mean`),
  ...Array.from({ length: MFCC_COUNT }, (_, i) => `mfcc${i + 1}Std`),
  "centroidLogMean",
  "centroidLogStd",
  "rolloffLogMean",
  "flatnessLogMean",
  "fluxMean",
  "fluxStd",
  "loudnessMeanDb",
  "loudnessStdDb",
  "loudnessRangeDb",
  "voicedFraction",
  "pitchMedianSemitone",
  "pitchSpreadSemitone",
  "stereoWidth",
  "tempoLogBpm",
  "beatStrength",
]

export const TRACK_FEATURE_DIM = TRACK_FEATURE_LABELS.length

export interface TrackFeatureAccumulator {
  /** Feed a frame from the audio bus. Already-analyzed ranges are skipped. */
  push(frame: AudioFrame): void
  /** Seconds of distinct audio analyzed so far */
  coverageSeconds(): number
  /** Finalise into a fixed-dimension vector. null when coverage is too small. */
  finish(): Float32Array | null
  reset(): void
}

interface Range {
  start: number
  end: number
}

/** Inserts [start, end) into a sorted, disjoint, merged range list */
function insertRange(ranges: Range[], start: number, end: number) {
  let i = 0
  while (i < ranges.length && ranges[i].end < start) i++
  let s = start
  let e = end
  let j = i
  while (j < ranges.length && ranges[j].start <= e) {
    s = Math.min(s, ranges[j].start)
    e = Math.max(e, ranges[j].end)
    j++
  }
  ranges.splice(i, j - i, { start: s, end: e })
}

/** Calls onGap for each sub-range of [start, end) not already in ranges */
function forEachUncovered(
  ranges: Range[],
  start: number,
  end: number,
  onGap: (from: number, to: number) => void
) {
  let cursor = start
  for (let i = 0; i < ranges.length && cursor < end; i++) {
    const r = ranges[i]
    if (r.end <= cursor) continue
    if (r.start >= end) break
    if (r.start > cursor) onGap(cursor, r.start)
    cursor = Math.max(cursor, r.end)
  }
  if (cursor < end) onGap(cursor, end)
}

const hzToMel = (hz: number) => 2595 * Math.log10(1 + hz / 700)
const melToHz = (mel: number) => 700 * (10 ** (mel / 2595) - 1)

interface MelFilterBank {
  /** Flattened triangular weights, band b occupies [offsets[b], offsets[b + 1]) */
  weights: Float32Array
  offsets: Int32Array
  /** First spectrum bin of each band */
  startBins: Int32Array
}

function createMelFilterBank(sampleRate: number): MelFilterBank {
  const nyquist = sampleRate / 2
  const maxHz = Math.min(MEL_MAX_HZ, nyquist)
  const melLo = hzToMel(MEL_MIN_HZ)
  const melHi = hzToMel(maxHz)
  const binHz = sampleRate / FFT_SIZE

  const points = new Float64Array(MEL_BANDS + 2)
  for (let i = 0; i < points.length; i++) {
    const hz = melToHz(melLo + ((melHi - melLo) * i) / (MEL_BANDS + 1))
    points[i] = hz / binHz
  }

  const weights: number[] = []
  const offsets = new Int32Array(MEL_BANDS + 1)
  const startBins = new Int32Array(MEL_BANDS)

  for (let b = 0; b < MEL_BANDS; b++) {
    const lo = points[b]
    const mid = points[b + 1]
    const hi = points[b + 2]
    const from = Math.max(0, Math.ceil(lo))
    const to = Math.min(SPECTRUM_BINS - 1, Math.floor(hi))
    offsets[b] = weights.length
    startBins[b] = from
    for (let k = from; k <= to; k++) {
      const w = k < mid ? (k - lo) / (mid - lo) : (hi - k) / (hi - mid)
      weights.push(w > 0 ? w : 0)
    }
  }
  offsets[MEL_BANDS] = weights.length

  return {
    weights: Float32Array.from(weights),
    offsets,
    startBins,
  }
}

function createDctTable(): Float32Array {
  // DCT-II, coefficients 1..MFCC_COUNT (c0 is overall loudness, already covered)
  const table = new Float32Array(MFCC_COUNT * MEL_BANDS)
  for (let k = 0; k < MFCC_COUNT; k++) {
    for (let b = 0; b < MEL_BANDS; b++) {
      table[k * MEL_BANDS + b] = Math.cos(
        (Math.PI * (k + 1) * (b + 0.5)) / MEL_BANDS
      )
    }
  }
  return table
}

function percentileFromHistogram(
  hist: Float32Array,
  total: number,
  fraction: number,
  binToValue: (bin: number) => number
): number {
  if (total <= 0) return 0
  const target = total * fraction
  let seen = 0
  for (let i = 0; i < hist.length; i++) {
    seen += hist[i]
    if (seen >= target) return binToValue(i)
  }
  return binToValue(hist.length - 1)
}

export function createTrackFeatureAccumulator(): TrackFeatureAccumulator {
  const fft = new FFT(FFT_SIZE)
  const spectrum = fft.createComplexArray()
  const windowBuf = new Float32Array(FFT_SIZE)
  const power = new Float32Array(SPECTRUM_BINS)
  const logMel = new Float32Array(MEL_BANDS)
  const prevLogMel = new Float32Array(MEL_BANDS)
  const dctTable = createDctTable()

  const hann = new Float32Array(FFT_SIZE)
  for (let i = 0; i < FFT_SIZE; i++) {
    hann[i] = 0.5 * (1 - Math.cos((2 * Math.PI * i) / (FFT_SIZE - 1)))
  }

  let sampleRate = 0
  let melBank: MelFilterBank | undefined

  const covered: Range[] = []
  let coveredSamples = 0

  // Per-hop accumulators
  let spectralHops = 0
  let hasPrevLogMel = false
  const mfccSum = new Float64Array(MFCC_COUNT)
  const mfccSumSq = new Float64Array(MFCC_COUNT)
  let centroidLogSum = 0
  let centroidLogSumSq = 0
  let rolloffLogSum = 0
  let flatnessLogSum = 0
  let fluxSum = 0
  let fluxSumSq = 0
  let fluxCount = 0
  let stereoCorrSum = 0
  let loudSum = 0
  let loudSumSq = 0
  const loudHist = new Float32Array(LOUD_HIST_BINS)

  // Per-frame accumulators (pitch is already computed by the analyser)
  let frameCount = 0
  let voicedCount = 0
  const pitchHist = new Float32Array(PITCH_HIST_BINS)

  // Onset envelope, kept with its absolute hop index so that seeks do not
  // silently splice unrelated moments together when estimating tempo.
  let env = new Float32Array(4096)
  let envHop = new Int32Array(4096)
  let envCount = 0

  const pushEnvelope = (hopIndex: number, value: number) => {
    if (envCount === env.length) {
      const nextEnv = new Float32Array(env.length * 2)
      nextEnv.set(env)
      env = nextEnv
      const nextHop = new Int32Array(envHop.length * 2)
      nextHop.set(envHop)
      envHop = nextHop
    }
    env[envCount] = value
    envHop[envCount] = hopIndex
    envCount++
  }

  const processHop = (
    samples0: Float32Array,
    samples1: Float32Array,
    offset: number,
    hopIndex: number
  ) => {
    const bank = melBank
    if (!bank) return

    let energy = 0
    let dot = 0
    let e0 = 0
    let e1 = 0
    for (let i = 0; i < FFT_SIZE; i++) {
      const a = samples0[offset + i]
      const b = samples1[offset + i]
      const mono = 0.5 * (a + b)
      windowBuf[i] = mono * hann[i]
      energy += mono * mono
      dot += a * b
      e0 += a * a
      e1 += b * b
    }

    const rms = Math.sqrt(energy / FFT_SIZE)
    if (rms < SILENCE_RMS) {
      // Spectral stats are meaningless here, but the flux history must NOT be
      // dropped: silence → attack is the strongest onset in the signal, and
      // discarding it left percussive material with a flat onset envelope.
      pushEnvelope(hopIndex, 0)
      prevLogMel.fill(Math.log(EPS))
      hasPrevLogMel = true
      return
    }

    const db = 20 * Math.log10(rms)
    loudSum += db
    loudSumSq += db * db
    const loudBin = Math.min(
      LOUD_HIST_BINS - 1,
      Math.max(0, Math.floor(((db - LOUD_MIN_DB) / -LOUD_MIN_DB) * LOUD_HIST_BINS))
    )
    loudHist[loudBin]++

    stereoCorrSum += e0 > 0 && e1 > 0 ? dot / Math.sqrt(e0 * e1) : 1

    fft.realTransform(spectrum, windowBuf)
    fft.completeSpectrum(spectrum)

    let totalPower = 0
    let weightedBin = 0
    let logPowerSum = 0
    for (let k = 0; k < SPECTRUM_BINS; k++) {
      const re = spectrum[2 * k]
      const im = spectrum[2 * k + 1]
      const p = re * re + im * im
      power[k] = p
      totalPower += p
      weightedBin += k * p
      logPowerSum += Math.log(p + EPS)
    }

    const binHz = sampleRate / FFT_SIZE
    const centroidHz = totalPower > 0 ? (weightedBin / totalPower) * binHz : 0
    const centroidLog = Math.log(centroidHz + 1)
    centroidLogSum += centroidLog
    centroidLogSumSq += centroidLog * centroidLog

    let cumulative = 0
    const rolloffTarget = totalPower * 0.85
    let rolloffBin = SPECTRUM_BINS - 1
    for (let k = 0; k < SPECTRUM_BINS; k++) {
      cumulative += power[k]
      if (cumulative >= rolloffTarget) {
        rolloffBin = k
        break
      }
    }
    rolloffLogSum += Math.log(rolloffBin * binHz + 1)

    const geometricMean = Math.exp(logPowerSum / SPECTRUM_BINS)
    const arithmeticMean = totalPower / SPECTRUM_BINS
    const flatness =
      arithmeticMean > 0 ? geometricMean / arithmeticMean : 0
    flatnessLogSum += Math.log(flatness + EPS)

    for (let b = 0; b < MEL_BANDS; b++) {
      let acc = 0
      const from = bank.offsets[b]
      const to = bank.offsets[b + 1]
      const startBin = bank.startBins[b]
      for (let w = from; w < to; w++) {
        acc += bank.weights[w] * power[startBin + (w - from)]
      }
      logMel[b] = Math.log(acc + EPS)
    }

    for (let k = 0; k < MFCC_COUNT; k++) {
      let acc = 0
      const row = k * MEL_BANDS
      for (let b = 0; b < MEL_BANDS; b++) {
        acc += logMel[b] * dctTable[row + b]
      }
      const c = acc / MEL_BANDS
      mfccSum[k] += c
      mfccSumSq[k] += c * c
    }

    let flux = 0
    if (hasPrevLogMel) {
      for (let b = 0; b < MEL_BANDS; b++) {
        const d = logMel[b] - prevLogMel[b]
        if (d > 0) flux += d
      }
      fluxSum += flux
      fluxSumSq += flux * flux
      fluxCount++
    }
    prevLogMel.set(logMel)
    hasPrevLogMel = true

    pushEnvelope(hopIndex, flux)
    spectralHops++
  }

  const estimateTempo = (): { logBpm: number; strength: number } => {
    if (envCount < 64) return { logBpm: 0, strength: 0 }

    // Longest run of consecutive hops: tempo across a seek boundary is noise
    const sorted: number[] = new Array(envCount)
    for (let i = 0; i < envCount; i++) sorted[i] = i
    sorted.sort((a, b) => envHop[a] - envHop[b])

    let bestStart = 0
    let bestLength = 1
    let runStart = 0
    for (let i = 1; i < sorted.length; i++) {
      if (envHop[sorted[i]] === envHop[sorted[i - 1]] + 1) continue
      if (i - runStart > bestLength) {
        bestLength = i - runStart
        bestStart = runStart
      }
      runStart = i
    }
    if (sorted.length - runStart > bestLength) {
      bestLength = sorted.length - runStart
      bestStart = runStart
    }

    const hopRate = sampleRate / HOP_SIZE
    const lagMin = Math.max(2, Math.floor((hopRate * 60) / BPM_MAX))
    const lagMax = Math.ceil((hopRate * 60) / BPM_MIN)
    if (bestLength < lagMax * 5) return { logBpm: 0, strength: 0 }

    let size = 1
    while (size < bestLength * 2) size *= 2
    const tempoFft = new FFT(size)
    const padded = new Float32Array(size)
    let mean = 0
    for (let i = 0; i < bestLength; i++) mean += env[sorted[bestStart + i]]
    mean /= bestLength
    for (let i = 0; i < bestLength; i++) {
      padded[i] = env[sorted[bestStart + i]] - mean
    }

    // Onsets rarely land on a hop boundary, so a sharp attack lands in hop k for
    // one beat and hop k+1 for the next. Unsmoothed, that alternation correlates
    // at twice the true period and the estimate comes out an octave low.
    const smoothed = new Float32Array(size)
    for (let i = 0; i < bestLength; i++) {
      const prev = i > 0 ? padded[i - 1] : padded[i]
      const next = i < bestLength - 1 ? padded[i + 1] : padded[i]
      smoothed[i] = 0.25 * prev + 0.5 * padded[i] + 0.25 * next
    }
    padded.set(smoothed)

    const spec = tempoFft.createComplexArray()
    tempoFft.realTransform(spec, padded)
    tempoFft.completeSpectrum(spec)
    const powerSpec = tempoFft.createComplexArray()
    for (let k = 0; k < size; k++) {
      const re = spec[2 * k]
      const im = spec[2 * k + 1]
      powerSpec[2 * k] = re * re + im * im
      powerSpec[2 * k + 1] = 0
    }
    const auto = tempoFft.createComplexArray()
    tempoFft.inverseTransform(auto, powerSpec)

    const zero = auto[0]
    if (!(zero > 0)) return { logBpm: 0, strength: 0 }

    // A musical period is almost never a whole number of hops (120 BPM is 21.53
    // hops at 43 Hz), so the strongest INTEGER lag is routinely a multiple of the
    // real one — it happens to land closer to an integer. Score fractional
    // candidate periods by how well the whole comb 1p/2p/3p/4p is supported...
    const interp = (lag: number) => {
      const i = Math.floor(lag)
      const f = lag - i
      return auto[2 * i] + (auto[2 * (i + 1)] - auto[2 * i]) * f
    }

    const HARMONICS = 4
    const candidates: { period: number; score: number }[] = []
    let bestScore = -Infinity
    for (let p = lagMin; p <= lagMax; p += 0.05) {
      if (2 * (Math.floor(p * HARMONICS) + 1) >= auto.length) break
      let score = 0
      for (let m = 1; m <= HARMONICS; m++) score += Math.max(0, interp(p * m))
      score /= HARMONICS
      candidates.push({ period: p, score })
      if (score > bestScore) bestScore = score
    }
    if (!(bestScore > 0)) return { logBpm: 0, strength: 0 }

    // ...then take the FUNDAMENTAL: a doubled period fits the comb just as well,
    // so prefer the shortest period that explains the signal nearly as well.
    const chosen = candidates.find(c => c.score >= bestScore * 0.85)
    if (!chosen) return { logBpm: 0, strength: 0 }

    const bpm = (hopRate * 60) / chosen.period
    const strength = Math.max(0, Math.min(1, bestScore / zero))
    return { logBpm: Math.log2(bpm / 100), strength }
  }

  const reset = () => {
    covered.length = 0
    coveredSamples = 0
    spectralHops = 0
    hasPrevLogMel = false
    mfccSum.fill(0)
    mfccSumSq.fill(0)
    centroidLogSum = 0
    centroidLogSumSq = 0
    rolloffLogSum = 0
    flatnessLogSum = 0
    fluxSum = 0
    fluxSumSq = 0
    fluxCount = 0
    stereoCorrSum = 0
    loudSum = 0
    loudSumSq = 0
    loudHist.fill(0)
    frameCount = 0
    voicedCount = 0
    pitchHist.fill(0)
    envCount = 0
  }

  return {
    push(frame: AudioFrame) {
      if (frame.sampleRate !== sampleRate) {
        sampleRate = frame.sampleRate
        melBank = createMelFilterBank(sampleRate)
      }

      const frameStart = Math.round(frame.timeSeconds * sampleRate)
      const frameEnd = frameStart + frame.samples0.length
      // A hop is claimed by the position it STARTS at; its window may reach into
      // audio a neighboring frame already covered. Ranges therefore track hop
      // starts, not raw samples, which is what keeps the hop grid contiguous
      // across the ~50 % frame overlap (a gap there would break tempo detection).
      const usableEnd = frameEnd - FFT_SIZE + 1
      if (usableEnd <= frameStart) return

      let processedAny = false
      forEachUncovered(covered, frameStart, usableEnd, (from, to) => {
        // Hops live on a global grid so that partially covered frames still line up
        let hop = Math.ceil(from / HOP_SIZE) * HOP_SIZE
        while (hop < to) {
          processHop(frame.samples0, frame.samples1, hop - frameStart, hop / HOP_SIZE)
          processedAny = true
          hop += HOP_SIZE
        }
      })

      insertRange(covered, frameStart, usableEnd)
      coveredSamples = 0
      for (let i = 0; i < covered.length; i++) {
        coveredSamples += covered[i].end - covered[i].start
      }

      if (!processedAny) return

      frameCount++
      if (frame.pitch0 > 0) {
        voicedCount++
        const semitone = 12 * Math.log2(frame.pitch0 / 440) + 69
        const bin = Math.floor(semitone - PITCH_HIST_MIN_SEMITONE)
        if (bin >= 0 && bin < PITCH_HIST_BINS) pitchHist[bin]++
      }
    },

    coverageSeconds() {
      return sampleRate > 0 ? coveredSamples / sampleRate : 0
    },

    finish() {
      const coverage = sampleRate > 0 ? coveredSamples / sampleRate : 0
      if (coverage < MIN_COVERAGE_SECONDS) return null
      if (spectralHops < 32) return null

      const out = new Float32Array(TRACK_FEATURE_DIM)
      let at = 0

      for (let k = 0; k < MFCC_COUNT; k++) {
        out[at + k] = mfccSum[k] / spectralHops
      }
      at += MFCC_COUNT
      for (let k = 0; k < MFCC_COUNT; k++) {
        const mean = mfccSum[k] / spectralHops
        out[at + k] = Math.sqrt(
          Math.max(0, mfccSumSq[k] / spectralHops - mean * mean)
        )
      }
      at += MFCC_COUNT

      const centroidMean = centroidLogSum / spectralHops
      out[at++] = centroidMean
      out[at++] = Math.sqrt(
        Math.max(0, centroidLogSumSq / spectralHops - centroidMean * centroidMean)
      )
      out[at++] = rolloffLogSum / spectralHops
      out[at++] = flatnessLogSum / spectralHops

      const fluxMean = fluxCount > 0 ? fluxSum / fluxCount : 0
      out[at++] = fluxMean
      out[at++] =
        fluxCount > 0
          ? Math.sqrt(Math.max(0, fluxSumSq / fluxCount - fluxMean * fluxMean))
          : 0

      const loudMean = loudSum / spectralHops
      out[at++] = loudMean
      out[at++] = Math.sqrt(
        Math.max(0, loudSumSq / spectralHops - loudMean * loudMean)
      )
      const binToDb = (bin: number) =>
        LOUD_MIN_DB + ((bin + 0.5) / LOUD_HIST_BINS) * -LOUD_MIN_DB
      const p10 = percentileFromHistogram(loudHist, spectralHops, 0.1, binToDb)
      const p90 = percentileFromHistogram(loudHist, spectralHops, 0.9, binToDb)
      out[at++] = p90 - p10

      out[at++] = frameCount > 0 ? voicedCount / frameCount : 0
      const binToSemitone = (bin: number) => PITCH_HIST_MIN_SEMITONE + bin + 0.5
      out[at++] = percentileFromHistogram(
        pitchHist,
        voicedCount,
        0.5,
        binToSemitone
      )
      out[at++] =
        percentileFromHistogram(pitchHist, voicedCount, 0.75, binToSemitone) -
        percentileFromHistogram(pitchHist, voicedCount, 0.25, binToSemitone)

      out[at++] = 1 - stereoCorrSum / spectralHops

      const tempo = estimateTempo()
      out[at++] = tempo.logBpm
      out[at++] = tempo.strength

      for (let i = 0; i < out.length; i++) {
        if (!Number.isFinite(out[i])) out[i] = 0
      }
      return out
    },

    reset,
  }
}
