import FFT from "fft.js"
import type { AudioFrame } from "./audio-frame"

// Analyser: slices 0.5 s windows out of the decoded PCM with ZERO copies and
// estimates pitch/RMS via FFT autocorrelation to build an AudioFrame.
//
// - The OfflineAudioContext is used ONLY as a "44.1 kHz normalizing decoder"
//   (decodeAudioData resamples to the context sample rate, so every track is
//   normalized here). No per-frame graph render (startRendering): the render was
//   an identity map (a range copy of an already-decoded array), so it has been
//   replaced with subarray views.
// - The hot path allocates nothing: samples are read-only views into the decoded
//   buffer. Only the short final window of a track falls back to a zero-padded
//   copy (identical behavior to the old render's silence padding).
// - autoCorrelate mutates its input, so it is isolated to a reused scratch
//   buffer (writing to a view would corrupt the decoded buffer).
const SAMPLE_RATE = 44100
const WINDOW_LENGTH = Math.round(SAMPLE_RATE * 0.5) // 22050
const PITCH_WINDOW = 2048

export interface AudioAnalyser {
  /** Called once per track change. Decodes the whole track into 44.1 kHz PCM */
  setBuffer(blob: Blob): Promise<void>
  /** Analyzes the 0.5 s window at the playback position. Returns null if no buffer is set */
  analyze(timeSeconds: number): AudioFrame | null
}

export function createAudioAnalyser(): AudioAnalyser {
  // Used for decodeAudioData only (startRendering is never called, so the
  // single-render restriction is irrelevant). Created lazily on the first
  // setBuffer because static prerendering (Node) has no OfflineAudioContext
  let decoderContext: OfflineAudioContext | undefined
  let audioBuffer: AudioBuffer | undefined

  const fft = new FFT(PITCH_WINDOW)
  const spectrum = fft.createComplexArray()
  const powerSpectrum = new Float32Array(PITCH_WINDOW)
  const corr = fft.createComplexArray()
  const pitchScratch = new Float32Array(PITCH_WINDOW)

  const autoCorrelate = (buf: Float32Array, sampleRate: number) => {
    let rms = 0
    let nBuf = buf.length
    for (let i = 0; i < nBuf; i++) {
      const val = buf[i]
      rms += val * val
    }
    rms = Math.sqrt(rms / nBuf)
    if (rms < 0.01) return [-1, rms]

    let r1 = 0
    let r2 = nBuf - 1
    const threshold = 0.2
    for (let i = 0; i < nBuf / 2; i++) {
      if (Math.abs(buf[i]) < threshold) {
        r1 = i
        break
      }
    }
    for (let i = 1; i < nBuf / 2; i++) {
      if (Math.abs(buf[nBuf - i]) < threshold) {
        r2 = nBuf - i
        break
      }
    }

    for (let i = 0; i < r1; i++) buf[i] = 0
    for (let i = r2 + 1; i < buf.length; i++) buf[i] = 0

    fft.realTransform(spectrum, buf)
    fft.completeSpectrum(spectrum)

    for (let i = 0; i < PITCH_WINDOW; i++) {
      powerSpectrum[i] =
        spectrum[2 * i] * spectrum[2 * i] +
        spectrum[2 * i + 1] * spectrum[2 * i + 1]
    }

    fft.realTransform(corr, powerSpectrum)
    fft.completeSpectrum(corr)

    let d = 0
    while (corr[2 * d] > corr[2 * (d + 1)]) d++
    let maxVal = -1
    let maxPos = -1
    for (let i = d; i < nBuf / 2; i++) {
      if (corr[2 * i] > maxVal) {
        maxVal = corr[2 * i]
        maxPos = i
      }
    }

    let t0 = maxPos
    let x1 = corr[2 * (t0 - 1)]
    let x2 = corr[t0]
    let x3 = corr[2 * (t0 + 1)]
    let a = (x1 + x3 - 2 * x2) / 2
    let b = (x3 - x1) / 2
    if (a) t0 = t0 - b / (2 * a)

    return [sampleRate / t0, rms]
  }

  return {
    setBuffer: async (blob: Blob) => {
      if (!decoderContext) {
        decoderContext = new OfflineAudioContext({
          numberOfChannels: 2,
          length: 1,
          sampleRate: SAMPLE_RATE,
        })
      }
      audioBuffer = await decoderContext.decodeAudioData(await blob.arrayBuffer())
    },

    analyze: (timeSeconds: number): AudioFrame | null => {
      if (!audioBuffer) return null

      const off = Math.round(timeSeconds * SAMPLE_RATE)
      const ch0 = audioBuffer.getChannelData(0)
      // Mono tracks put the same waveform on both channels, like the old graph upmix
      const ch1 = audioBuffer.numberOfChannels > 1 ? audioBuffer.getChannelData(1) : ch0
      const n = Math.max(0, Math.min(WINDOW_LENGTH, ch0.length - off))

      let samples0: Float32Array
      let samples1: Float32Array
      if (n === WINDOW_LENGTH) {
        // Hot path: read-only views, zero allocation, zero copy
        samples0 = ch0.subarray(off, off + n)
        samples1 = ch1.subarray(off, off + n)
      } else {
        // Track tail only: zero-padded copy (a few allocations per track)
        samples0 = new Float32Array(WINDOW_LENGTH)
        samples1 = new Float32Array(WINDOW_LENGTH)
        if (n > 0) {
          samples0.set(ch0.subarray(off, off + n))
          samples1.set(ch1.subarray(off, off + n))
        }
      }

      // Pitch detection runs on a scratch copy (autoCorrelate is destructive)
      pitchScratch.set(samples0.subarray(0, PITCH_WINDOW))
      const [pitch0, rms0] = autoCorrelate(pitchScratch, SAMPLE_RATE)
      pitchScratch.set(samples1.subarray(0, PITCH_WINDOW))
      const [pitch1, rms1] = autoCorrelate(pitchScratch, SAMPLE_RATE)

      return {
        timeSeconds,
        pitch0,
        pitch1,
        rms0,
        rms1,
        sampleRate: SAMPLE_RATE,
        samples0,
        samples1,
      }
    },
  }
}
