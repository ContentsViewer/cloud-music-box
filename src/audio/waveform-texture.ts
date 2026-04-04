import * as THREE from "three"
import { AudioFrame } from "@/src/stores/audio-dynamics-store"

const GRID_SIZE = 256

export function createWaveformTexture(): THREE.DataTexture {
  const data = new Float32Array(GRID_SIZE * GRID_SIZE * 4)
  // Initialize with neutral values (0.5 = no modulation)
  for (let i = 0; i < GRID_SIZE * GRID_SIZE; i++) {
    data[i * 4 + 0] = 0.5 // R: L channel
    data[i * 4 + 1] = 0.5 // G: R channel
    data[i * 4 + 2] = 0.0 // B: stereo difference
    data[i * 4 + 3] = 1.0 // A: unused
  }
  const texture = new THREE.DataTexture(
    data,
    GRID_SIZE,
    GRID_SIZE,
    THREE.RGBAFormat,
    THREE.FloatType
  )
  texture.needsUpdate = true
  return texture
}

export function updateWaveformTexture(
  texture: THREE.DataTexture,
  frame: AudioFrame
): void {
  const data = texture.image.data as unknown as Float32Array
  const samples0 = frame.samples0
  const samples1 = frame.samples1
  const sampleCount = samples0.length

  for (let y = 0; y < GRID_SIZE; y++) {
    const sampleIdxL = Math.floor((y / GRID_SIZE) * sampleCount)
    // Normalize from [-1,1] to [0,1]
    const valL = (samples0[sampleIdxL] + 1.0) * 0.5

    for (let x = 0; x < GRID_SIZE; x++) {
      const sampleIdxR = Math.floor((x / GRID_SIZE) * sampleCount)
      const valR = (samples1[sampleIdxR] + 1.0) * 0.5
      const diff = Math.abs(samples0[sampleIdxL] - samples1[sampleIdxR])

      const idx = (y * GRID_SIZE + x) * 4
      data[idx + 0] = valL
      data[idx + 1] = valR
      data[idx + 2] = diff
      data[idx + 3] = 1.0
    }
  }

  texture.needsUpdate = true
}
