// One analysis frame, flowing over the audioBus at ~4 Hz while playing.
// samples0/1 are READ-ONLY views into the decoded track PCM (normalized to 44.1 kHz).
// Writing to them corrupts the decoded buffer itself, so consumers must never
// mutate them (copy into your own buffer first for any destructive processing).
export interface AudioFrame {
  timeSeconds: number
  pitch0: number
  pitch1: number
  rms0: number
  rms1: number
  sampleRate: number
  samples0: Float32Array
  samples1: Float32Array
}
