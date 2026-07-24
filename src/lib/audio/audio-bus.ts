import type { AudioFrame } from "./audio-frame"

// Pub/sub bus for audio analysis frames.
// Pushes synchronously from the producer (audio-player) to subscribers (visualizer
// logic layers etc.) without going through React state: no re-renders, and no
// intermediate values lost to the render cycle.
// Not a singleton: create with createAudioBus() and inject via AudioBusProvider
// (the instance is immutable, so providing it through Context re-renders nothing).
type Listener = (frame: AudioFrame) => void

export interface AudioBus {
  emit(frame: AudioFrame): void
  /** Start subscribing; returns an unsubscribe function (usable directly as a useEffect cleanup) */
  subscribe(listener: Listener): () => void
  getLatest(): AudioFrame | null
}

export function createAudioBus(): AudioBus {
  const listeners = new Set<Listener>()
  let latest: AudioFrame | null = null
  return {
    emit(frame) {
      latest = frame
      listeners.forEach(l => l(frame))
    },
    subscribe(listener) {
      listeners.add(listener)
      return () => {
        listeners.delete(listener)
      }
    },
    getLatest: () => latest,
  }
}
