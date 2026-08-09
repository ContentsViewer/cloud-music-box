"use client"

import { useEffect, useMemo, useRef, useState } from "react"
import { usePlayerStore, AudioTrack } from "../stores/player-store"
import { enqueueSnackbar } from "notistack"
import { useArtworkUrl } from "@/src/features/files"
import assert from "assert"
import { useAudioBus } from "@/src/stores/audio-bus-provider"
import { createAudioAnalyser } from "@/src/lib/audio/audio-analyser"


const msSetPlaybackState = (state: "playing" | "paused") => {
  console.log("msSetPlaybackState", state)
  const ms = window.navigator.mediaSession
  if (!ms) return
  ms.playbackState = state
}

// Artwork URLs come from the shared per-image cache and are never revoked
// here — other consumers (list rows, the player card) may hold the same URL.
const msSetTrackMetadata = (track: AudioTrack, artworkUrl?: string) => {
  const ms = window.navigator.mediaSession
  if (!ms) return

  const artwork: MediaImage[] = artworkUrl
    ? [{ src: artworkUrl, sizes: "512x512" }]
    : [
        {
          src: "./track-cover-512x512.png",
          sizes: "512x512",
          type: "image/png",
        },
      ]

  ms.metadata = new MediaMetadata({
    title: track.file.metadata?.common.title || track.file.name,
    artist: track.file.metadata?.common.artists?.join(", "),
    album: track.file.metadata?.common.album,
    artwork: artwork,
  })
}

const msSetPlayingTrack = (track: AudioTrack, artworkUrl?: string) => {
  console.log("msSetPlayingTrack", track.file.name)

  const ms = window.navigator.mediaSession
  if (!ms) return

  msSetTrackMetadata(track, artworkUrl)
  ms.playbackState = "playing"
}

export const AudioPlayer = () => {
  const [playerState, playerActions] = usePlayerStore()

  const audioBus = useAudioBus()

  // Shared per-image URL for the active track's artwork (Media Session).
  const artworkUrl = useArtworkUrl(playerState.activeTrack?.file.artworkHash)
  const artworkUrlRef = useRef(artworkUrl)
  artworkUrlRef.current = artworkUrl

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
      // The playback position is never dispatched (kills the 4 Hz store re-render); displays read it from the bus
      playerActions.notePlaybackPosition(audio.currentTime)
      // Analysis is synchronous and zero-copy; frames reach all consumers via the bus (bypassing React)
      const frame = audioAnalyser.analyze(audio.currentTime)
      if (frame) audioBus.emit(frame)
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
  }, [])

  useEffect(() => {
    if (playerState.seekVersion === 0) return

    const audio = audioRef.current
    if (!audio) return

    audio.currentTime = playerState.currentTime
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [playerState.seekVersion])

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
      msSetPlayingTrack(activeTrack, artworkUrlRef.current)
    }

    audio
      .play()
      .then(() => {
        console.log("Played")
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

    const title =
      activeTrack?.file.metadata?.common.title ||
      activeTrack?.file.name ||
      "Unknown"
    console.log(title)

    enqueueSnackbar(
      <span>
        Playing{" "}
        <span
          style={{
            fontWeight: "bold",
          }}
        >
          {title}
        </span>
      </span>
    )
  }, [
    playerState.isActiveTrackLoading,
    playerState.isPlaying,
    playerState.activeTrack,
  ])

  useEffect(() => {
    // The shared artwork URL resolves asynchronously, usually after
    // msSetPlayingTrack already ran for this track — refresh the Media Session
    // metadata (only) once it arrives.
    if (!artworkUrl) return
    const track = playerState.activeTrack
    if (!track) return
    if (window.navigator.mediaSession?.metadata === null) return
    msSetTrackMetadata(track, artworkUrl)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [artworkUrl])

  useEffect(() => {
    const ms = window.navigator.mediaSession
    if (!ms) {
      console.error("Media session not available")
      return
    }

    const audio = audioRef.current
    if (!audio) {
      console.log("Audio not initialized")
      return
    }

    // For Safari, we need to pause&load to register
    // playing action handlers(seekbackward, nexttrack, ...).
    // Or these handlers will not be registered and unexpected...
    audio.pause()
    audio.load()

    ms.playbackState = "paused"
    console.log("Setting media session handlers", ms)

    ms.setActionHandler("play", () => {
      console.log("Play")
      playerActions.play()
    })
    ms.setActionHandler("pause", () => {
      console.log("Pause")
      playerActions.pause()
    })

    ms.setActionHandler("previoustrack", () => {
      console.log("Click previous track")
      playerActions.playPreviousTrack()
    })
    ms.setActionHandler("nexttrack", () => {
      console.log("Click next track")
      playerActions.playNextTrack()
    })

    ms.setActionHandler("seekbackward", null)
    ms.setActionHandler("seekforward", null)

    ms.setActionHandler("seekto", details => {
      console.log("Seek to", details)
      if (details.fastSeek) return
      if (details.seekTime === undefined) return
      playerActions.changeCurrentTime(details.seekTime)
    })

    return () => {
      ms.setActionHandler("play", null)
      ms.setActionHandler("pause", null)
      ms.setActionHandler("previoustrack", null)
      ms.setActionHandler("nexttrack", null)
      ms.setActionHandler("seekbackward", null)
      ms.setActionHandler("seekforward", null)
      console.log("Unsetting media session handlers")
    }
  }, [])

  return (
    <audio ref={audioRef}>
      <source ref={sourceRef} />
    </audio>
  )
}
