"use client"

import { useCallback, useEffect, useMemo, useRef } from "react"
import { usePlayerStore, AudioTrack } from "../stores/player-store"
import { enqueueSnackbar } from "notistack"
import { useFileStore } from "@/src/features/files"
import assert from "assert"
import { useAudioBus } from "@/src/stores/audio-bus-provider"
import { createAudioAnalyser } from "@/src/lib/audio/audio-analyser"
import {
  announceNowPlaying,
  msSetPlaybackState,
  msSetTrackMetadataWhenArtworkSettles,
  runPlaybackHop,
  useAudioSeek,
  useMediaSessionActionHandlers,
} from "./audio-player-shared"

// The SINGLE-element player: one <audio>, its src swapped in place, 'ended'
// driving the track advance. This is the flow proven on iOS for over a year
// (through PR#67), and it is REQUIRED there: under lock, WebKit's
// processSystemWillSleep() interrupts every media session EXCEPT the audibly
// playing one (PlatformMediaSession.cpp, beginInterruption +
// shouldOverrideBackgroundPlaybackRestriction), so continuing the SAME
// element's session is the only handoff that keeps playing with the screen
// off — a second element would start a fresh, non-exempt session. Gecko fits
// here too: its tab-level MediaController tears down on a deactivation TIMER,
// not per element (MediaController.cpp, UpdateDeactivationTimerIfNeeded), so
// the sub-second gap of an in-place src swap is bridged by design.
export const SingleElementAudioPlayer = () => {
  const [playerState, playerActions] = usePlayerStore()
  const [, fileStoreActions] = useFileStore()

  const audioBus = useAudioBus()

  const audioRef = useRef<HTMLAudioElement>(null)
  const sourceRef = useRef<HTMLSourceElement>(null)

  const audioAnalyser = useMemo(() => createAudioAnalyser(), [])

  const activeAudioTrackRef = useRef<AudioTrack | null>(null)

  useEffect(() => {
    const audio = audioRef.current
    const source = sourceRef.current

    if (!audio || !source) {
      return
    }

    console.log("Initializing audio player")

    const onError = (error: any) => {
      console.error(error)
      playerActions.pause()
      enqueueSnackbar(`${error}`, { variant: "error" })
    }

    const onDurationChange = () => {
      playerActions.setDuration(audio.duration)
    }

    const onTimeUpdate = () => {
      runPlaybackHop(audio, playerActions, audioAnalyser, audioBus)
    }
    const onPlay = () => {
      console.log("Track started playing")
    }

    const onEnded = () => {
      console.log("Track ended")
      playerActions.playNextTrack()
    }

    audio.addEventListener("error", onError)
    audio.addEventListener("ended", onEnded)
    audio.addEventListener("durationchange", onDurationChange)
    audio.addEventListener("timeupdate", onTimeUpdate)
    audio.addEventListener("play", onPlay)

    console.log("Audio player initialized")

    return () => {
      audio.removeEventListener("ended", onEnded)
      audio.removeEventListener("error", onError)
      audio.removeEventListener("durationchange", onDurationChange)
      audio.removeEventListener("timeupdate", onTimeUpdate)
      audio.removeEventListener("play", onPlay)

      audio.pause()
      source.removeAttribute("src")
      source.removeAttribute("type")
      audio.load()
      console.log("Audio player disposed")
    }
  }, [playerActions, audioAnalyser, audioBus])

  useAudioSeek(playerState.seekVersion, playerState.currentTime, () =>
    audioRef.current
  )

  useEffect(() => {
    const audio = audioRef.current
    const source = sourceRef.current

    if (!audio || !source) {
      console.error("Audio player not initialized")
      return
    }

    if (!playerState.isPlaying) {
      audio.pause()
      msSetPlaybackState("paused")
      return
    }

    if (playerState.isActiveTrackLoading) {
      return
    }

    const activeTrack = playerState.activeTrack

    if (
      activeTrack &&
      activeTrack.file.id !== activeAudioTrackRef.current?.file.id
    ) {
      activeAudioTrackRef.current = activeTrack

      // Unload previous track
      if (source.src) {
        const previousSrc = source.src
        source.src = ""
        source.removeAttribute("src")
        URL.revokeObjectURL(previousSrc)
      }

      assert(activeTrack?.blob)
      const src = URL.createObjectURL(activeTrack.blob)

      source.src = src
      // safari(iOS) cannot detect the mime type(especially flac) from the binary.
      source.type = activeTrack.file.mimeType

      console.log("Setting source", src, source.type)
      audio.load()

      msSetTrackMetadataWhenArtworkSettles(
        activeTrack,
        fileStoreActions.getArtwork,
        trackId => activeAudioTrackRef.current?.file.id === trackId
      )
    }

    audio
      .play()
      .then(() => {
        console.log("Played")
        msSetPlaybackState("playing")
        const blob = activeTrack?.blob
        if (!blob) return
        audioAnalyser.setBuffer(blob)
      })
      .catch(error => {
        playerActions.pause()

        console.error(error)
        enqueueSnackbar(`${error}`, { variant: "error" })
      })
    console.log("To Playing")

    announceNowPlaying(activeTrack)
  }, [
    playerState.isActiveTrackLoading,
    playerState.isPlaying,
    playerState.activeTrack,
  ])

  // For Safari, we need to pause&load to register
  // playing action handlers(seekbackward, nexttrack, ...).
  // Or these handlers will not be registered and unexpected...
  const prepareActionHandlers = useCallback(() => {
    const audio = audioRef.current
    if (!audio) {
      console.log("Audio not initialized")
      return
    }
    audio.pause()
    audio.load()
  }, [])

  useMediaSessionActionHandlers(playerActions, prepareActionHandlers)

  return (
    <audio ref={audioRef}>
      <source ref={sourceRef} />
    </audio>
  )
}
