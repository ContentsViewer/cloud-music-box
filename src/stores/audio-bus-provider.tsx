"use client"
import { createContext, ReactNode, useContext, useMemo } from "react"
import { AudioBus, createAudioBus } from "../lib/audio/audio-bus"

// Dependency injection for the audioBus. Avoids a singleton by creating one
// instance per app and distributing it via Context. The instance is immutable,
// so no re-renders ever originate here (what the bus avoids is "frame state
// flowing through Context", not Context itself).
const AudioBusContext = createContext<AudioBus | null>(null)

export const useAudioBus = (): AudioBus => {
  const bus = useContext(AudioBusContext)
  if (!bus) {
    throw new Error("useAudioBus must be used within AudioBusProvider")
  }
  return bus
}

export const AudioBusProvider = ({ children }: { children: ReactNode }) => {
  const bus = useMemo(() => createAudioBus(), [])
  return <AudioBusContext.Provider value={bus}>{children}</AudioBusContext.Provider>
}
