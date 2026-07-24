// Frequency → MIDI note number (A4 = 440 Hz = 69). Used to derive the hue (pitch class) in visualizers
export const noteFromPitch = (frequency: number) => {
  const noteNum = 12 * (Math.log(frequency / 440) / Math.log(2))
  return Math.round(noteNum) + 69
}
