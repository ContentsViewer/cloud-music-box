"use client"

import { useEffect } from "react"
import { enqueueSnackbar } from "notistack"
import { resolveArtworkUrl } from "@/src/features/files"
import type { ArtworkRecord } from "@/src/lib/artworks/artworks"
import { AudioTrack } from "../stores/player-store"
import { createAudioAnalyser } from "@/src/lib/audio/audio-analyser"
import { useAudioBus } from "@/src/stores/audio-bus-provider"

// Engine-NEUTRAL steps shared by the two audio players: Media Session writes,
// the artwork one-shot, action-handler wiring, seek, and the ~4 Hz playback
// hop. Anything about how audio ELEMENTS are used during a track handoff is
// engine policy and belongs to the players themselves
// (single-element-audio-player / dual-element-audio-player; the split is
// explained in ../player-mode.ts).

export const msSetPlaybackState = (state: "playing" | "paused") => {
  console.log("msSetPlaybackState", state)
  const ms = window.navigator.mediaSession
  if (!ms) return
  ms.playbackState = state
}

// Artwork URLs come from the shared per-image cache and are never revoked
// here — other consumers (list rows, the player card) may hold the same URL.
export const msSetTrackMetadata = (track: AudioTrack, artworkUrl?: string) => {
  console.log("msSetTrackMetadata", track.file.name, artworkUrl)
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

// The one-shot metadata contract: metadata is written once per track, after
// the artwork URL settles (undefined = the track definitively has no artwork
// → placeholder). resolveArtworkUrl never rejects. `isCurrent` guards against
// a later track having taken over while the artwork resolved.
export const msSetTrackMetadataWhenArtworkSettles = (
  track: AudioTrack,
  getArtwork: (hash: string) => Promise<ArtworkRecord | undefined>,
  isCurrent: (trackId: string) => boolean
) => {
  const trackId = track.file.id
  const artworkHash = track.file.artworkHash
  resolveArtworkUrl(artworkHash, () => getArtwork(artworkHash!)).then(url => {
    if (!isCurrent(trackId)) return
    msSetTrackMetadata(track, url)
  })
}

// One playback hop (~4 Hz timeupdate): note the position into the store's
// mutable ref (never dispatched — that would re-render the store tree at
// 4 Hz) and push the analysis frame onto the bus for the visual consumers.
export const runPlaybackHop = (
  audio: HTMLAudioElement,
  playerActions: { notePlaybackPosition: (time: number) => void },
  audioAnalyser: ReturnType<typeof createAudioAnalyser>,
  audioBus: ReturnType<typeof useAudioBus>
) => {
  playerActions.notePlaybackPosition(audio.currentTime)
  const frame = audioAnalyser.analyze(audio.currentTime)
  if (frame) audioBus.emit(frame)
}

export const announceNowPlaying = (track: AudioTrack | null) => {
  const title =
    track?.file.metadata?.common.title || track?.file.name || "Unknown"
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
}

// Seeking still dispatches (unlike the 4 Hz position), so the version bump is
// the signal to write the store's currentTime into the element.
export const useAudioSeek = (
  seekVersion: number,
  currentTime: number,
  getAudio: () => HTMLAudioElement | null
) => {
  useEffect(() => {
    if (seekVersion === 0) return

    const audio = getAudio()
    if (!audio) return

    audio.currentTime = currentTime
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [seekVersion])
}

// Media Session action-handler wiring. `prepare` runs inside the effect
// before registration and must be referentially stable (useCallback) — the
// single player passes its Safari pause/load registration hack there.
// playerActions is a stable contract (provider useMemo), so the effect runs
// once per mount in practice.
export const useMediaSessionActionHandlers = (
  playerActions: {
    play: () => void
    pause: () => void
    playNextTrack: () => void
    playPreviousTrack: () => void
    changeCurrentTime: (time: number) => void
  },
  prepare?: () => void
) => {
  useEffect(() => {
    const ms = window.navigator.mediaSession
    if (!ms) {
      console.error("Media session not available")
      return
    }

    prepare?.()

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
  }, [playerActions, prepare])
}
