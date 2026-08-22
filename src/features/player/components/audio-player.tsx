"use client"

import { useEffect, useState } from "react"
import { PlayerKind, resolvePlayerKind } from "../player-mode"
import { SingleElementAudioPlayer } from "./single-element-audio-player"
import { DualElementAudioPlayer } from "./dual-element-audio-player"

// Selects the engine-appropriate player (the split and the detection are
// explained in ../player-mode.ts). The choice is made after mount because the
// static prerender has no `navigator`; audio is not a visual element and
// playback always starts from a user action, so the one-tick delay is inert.
// The mode is read exactly once per launch - a changed setting applies on
// reload (the settings page prompts for it), so no reactive store is needed.
export const AudioPlayer = () => {
  const [kind, setKind] = useState<PlayerKind | null>(null)

  useEffect(() => {
    setKind(resolvePlayerKind())
  }, [])

  if (kind === null) return null
  return kind === "dual" ? (
    <DualElementAudioPlayer />
  ) : (
    <SingleElementAudioPlayer />
  )
}
