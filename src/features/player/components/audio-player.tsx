"use client"

import { useEffect, useMemo, useRef } from "react"
import { usePlayerStore, AudioTrack } from "../stores/player-store"
import { enqueueSnackbar } from "notistack"
import { resolveArtworkUrl, useFileStore } from "@/src/features/files"
import assert from "assert"
import { useAudioBus } from "@/src/stores/audio-bus-provider"
import { createAudioAnalyser } from "@/src/lib/audio/audio-analyser"


// [R2: pre-end handoff] Reaching the actual end of stream REMOVES the player
// from Chrome's media session (media_session_controller.cc:
// OnPlaybackPaused(reached_end_of_stream=true) -> RemovePlayer), which
// abandons system audio focus - and a focus re-request from the background is
// denied on Android 15+, killing continuous playback. A plain pause keeps the
// player registered and the focus held, so the handoff to the next track's
// element happens THIS long before the end instead of at 'ended'.
// 0.6 s > 2x the timeupdate cadence (~250 ms), so the watcher cannot miss the
// window; the sacrificed tail is the price of background continuity.
const PRE_END_HANDOFF_SEC = 0.6

const msSetPlaybackState = (state: "playing" | "paused") => {
  console.log("msSetPlaybackState", state)
  const ms = window.navigator.mediaSession
  if (!ms) return
  ms.playbackState = state
}

// Artwork URLs come from the shared per-image cache and are never revoked
// here — other consumers (list rows, the player card) may hold the same URL.
const msSetTrackMetadata = (track: AudioTrack, artworkUrl?: string) => {
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

export const AudioPlayer = () => {
  const [playerState, playerActions] = usePlayerStore()
  const [, fileStoreActions] = useFileStore()

  const audioBus = useAudioBus()

  // [R1: dual-element handoff] Two audio elements alternate between tracks.
  // Mechanism (verified against Chromium media_session_impl.cc + Android 15
  // audio-focus rules): when the ONLY registered player of a page's media
  // session is unloaded (src swap / load()), Chrome abandons system audio
  // focus; re-requesting it from the background is denied on Android 15+
  // (no top-app, no foreground service), and Android 12+ then fades the
  // unfocused stream out ~2 s into the next track. An ended-but-untouched
  // element, however, stays REGISTERED (the session merely suspends and
  // keeps holding focus). So: never touch the element being retired - start
  // the next track on the OTHER element, and release the retired one only
  // AFTER the new one is playing (its sibling then keeps the session
  // populated, so the removal cannot empty it).
  const audioARef = useRef<HTMLAudioElement>(null)
  const sourceARef = useRef<HTMLSourceElement>(null)
  const audioBRef = useRef<HTMLAudioElement>(null)
  const sourceBRef = useRef<HTMLSourceElement>(null)
  const activeIdxRef = useRef(0)

  const audioAnalyser = useMemo(() => createAudioAnalyser(), [])

  const activeAudioTrackRef = useRef<AudioTrack | null>(null)
  // The element retired by the last handoff; released once the new one plays.
  const retiredRef = useRef<{
    audio: HTMLAudioElement
    source: HTMLSourceElement
  } | null>(null)

  const getActiveAudio = () =>
    activeIdxRef.current === 0 ? audioARef.current : audioBRef.current

  // [Gesture priming] WebKit's playback restrictions are PER ELEMENT and are
  // lifted when load()/play() runs inside a user gesture (HTMLMediaElement::
  // prepareForLoad / play -> removeBehaviorRestrictionsAfterFirstUserGesture).
  // Blink's fallback per-element autoplay policy unlocks through load() the
  // same way (TryUnlockingUserGesture). The first tap therefore load()s BOTH
  // elements while they are still empty - without this, iOS rejects the
  // second element's first programmatic play() with NotAllowedError
  // (measured on device: first auto-advance in the foreground failed).
  useEffect(() => {
    const prime = () => {
      for (const [audio, source] of [
        [audioARef.current, sourceARef.current],
        [audioBRef.current, sourceBRef.current],
      ] as const) {
        if (audio && source && !source.src) audio.load()
      }
      document.removeEventListener("click", prime, true)
      document.removeEventListener("touchend", prime, true)
      console.log("Audio elements primed by first gesture")
    }
    document.addEventListener("click", prime, true)
    document.addEventListener("touchend", prime, true)
    return () => {
      document.removeEventListener("click", prime, true)
      document.removeEventListener("touchend", prime, true)
    }
  }, [])

  useEffect(() => {
    const audioA = audioARef.current
    const sourceA = sourceARef.current
    const audioB = audioBRef.current
    const sourceB = sourceBRef.current

    if (!audioA || !sourceA || !audioB || !sourceB) {
      return
    }

    console.log("Initializing audio player")

    // Events from the retired (ended) element must not drive the player.
    const isActiveEl = (target: EventTarget | null) =>
      target === getActiveAudio()

    const onError = (event: Event) => {
      if (!isActiveEl(event.target)) return
      console.error(event)
      playerActions.pause()
      enqueueSnackbar(`${event}`, { variant: "error" })
    }

    const onDurationChange = (event: Event) => {
      if (!isActiveEl(event.target)) return
      playerActions.setDuration((event.target as HTMLAudioElement).duration)
    }

    const onTimeUpdate = (event: Event) => {
      if (!isActiveEl(event.target)) return
      const audio = event.target as HTMLAudioElement
      // The playback position is never dispatched (kills the 4 Hz store re-render); displays read it from the bus
      playerActions.notePlaybackPosition(audio.currentTime)
      // Analysis is synchronous and zero-copy; frames reach all consumers via the bus (bypassing React)
      const frame = audioAnalyser.analyze(audio.currentTime)
      if (frame) audioBus.emit(frame)
      // [R2] hand off to the next track BEFORE 'ended' fires (see PRE_END_HANDOFF_SEC)
      const duration = audio.duration
      if (
        Number.isFinite(duration) &&
        duration > 0 &&
        !audio.paused &&
        duration - audio.currentTime <= PRE_END_HANDOFF_SEC
      ) {
        console.log("Pre-end handoff at", audio.currentTime, "/", duration)
        audio.pause()
        playerActions.playNextTrack()
      }
    }
    const onPlay = (event: Event) => {
      if (!isActiveEl(event.target)) return
      console.log("Track started playing")
    }

    const onEnded = (event: Event) => {
      if (!isActiveEl(event.target)) return
      console.log("Track ended")
      playerActions.playNextTrack()
    }

    for (const audio of [audioA, audioB]) {
      audio.addEventListener("error", onError)
      audio.addEventListener("ended", onEnded)
      audio.addEventListener("durationchange", onDurationChange)
      audio.addEventListener("timeupdate", onTimeUpdate)
      audio.addEventListener("play", onPlay)
    }

    console.log("Audio player initialized")

    return () => {
      for (const [audio, source] of [
        [audioA, sourceA],
        [audioB, sourceB],
      ] as const) {
        audio.removeEventListener("ended", onEnded)
        audio.removeEventListener("error", onError)
        audio.removeEventListener("durationchange", onDurationChange)
        audio.removeEventListener("timeupdate", onTimeUpdate)
        audio.removeEventListener("play", onPlay)

        audio.pause()
        source.removeAttribute("src")
        source.removeAttribute("type")
        audio.load()
      }
      console.log("Audio player disposed")
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    if (playerState.seekVersion === 0) return

    const audio = getActiveAudio()
    if (!audio) return

    audio.currentTime = playerState.currentTime
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [playerState.seekVersion])

  useEffect(() => {
    if (!playerState.isPlaying) {
      getActiveAudio()?.pause()
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

      // A manual skip (next/prev, list click) arrives with the outgoing
      // element still playing - pause it so the two tracks never overlap.
      // A plain pause keeps it registered in the media session, so the
      // focus bridge stays intact. (Auto-advance already paused it in the
      // pre-end handoff.)
      const retiredAudio = getActiveAudio()
      const retiredSource =
        activeIdxRef.current === 0 ? sourceARef.current : sourceBRef.current
      retiredAudio?.pause()
      retiredRef.current =
        retiredAudio && retiredSource
          ? { audio: retiredAudio, source: retiredSource }
          : null

      // [R1] load the next track into the STANDBY element and swap roles;
      // the outgoing element is otherwise left untouched until the new one
      // plays (see the comment at the refs). The previousSrc revoke below is
      // a fallback for handoffs whose release never ran (e.g. play errors).
      const standbyIdx = activeIdxRef.current === 0 ? 1 : 0
      const standbyAudio = standbyIdx === 0 ? audioARef.current : audioBRef.current
      const standbySource =
        standbyIdx === 0 ? sourceARef.current : sourceBRef.current
      if (!standbyAudio || !standbySource) {
        console.error("Audio player not initialized")
        return
      }

      const previousSrc = standbySource.src

      assert(activeTrack?.blob)
      const src = URL.createObjectURL(activeTrack.blob)

      standbySource.src = src
      // safari(iOS) cannot detect the mime type(especially flac) from the binary.
      standbySource.type = activeTrack.file.mimeType

      console.log("Setting source", src, standbySource.type, "element", standbyIdx)
      standbyAudio.load()
      if (previousSrc) URL.revokeObjectURL(previousSrc)
      activeIdxRef.current = standbyIdx

      // [diagnostic, kept from E2b] synchronous media session writes at swap
      msSetTrackMetadata(activeTrack, undefined)
      msSetPlaybackState("playing")

      // Media Session metadata with the resolved artwork follows once the
      // shared artwork URL settles (undefined = definitively no artwork).
      const trackId = activeTrack.file.id
      const artworkHash = activeTrack.file.artworkHash
      resolveArtworkUrl(artworkHash, () =>
        fileStoreActions.getArtwork(artworkHash!)
      ).then(url => {
        // A later track may have taken over while the artwork resolved.
        if (activeAudioTrackRef.current?.file.id !== trackId) return
        msSetTrackMetadata(activeTrack, url)
      })
    }

    const audio = getActiveAudio()
    if (!audio) {
      console.error("Audio player not initialized")
      return
    }

    // [E6, kept: matches the reference player] never call play() before the
    // duration is known - Chrome grants full audio focus / the notification
    // only to players with a known duration >= 5 s.
    const playWhenReady = (): Promise<void> => {
      if (audio.readyState >= HTMLMediaElement.HAVE_METADATA) {
        return audio.play()
      }
      console.log("Deferring play() until loadedmetadata")
      return new Promise<void>((resolve, reject) => {
        const onLoaded = () => {
          audio.removeEventListener("loadedmetadata", onLoaded)
          console.log("loadedmetadata: duration =", audio.duration)
          audio.play().then(resolve, reject)
        }
        audio.addEventListener("loadedmetadata", onLoaded)
      })
    }

    playWhenReady()
      .then(() => {
        console.log("Played")
        msSetPlaybackState("playing")
        // Release the retired element once the handoff succeeded. iOS's Now
        // Playing otherwise keeps tracking the lingering paused element
        // (measured: stale/laggy lock-screen info), and the old blob URL can
        // be freed. Safe for the Android focus bridge: the NEW element is
        // playing and registered at this point, so removing the retired
        // player cannot empty the media session.
        const retired = retiredRef.current
        if (retired && retired.audio !== audio) {
          const oldSrc = retired.source.src
          retired.source.removeAttribute("src")
          retired.source.removeAttribute("type")
          retired.audio.load()
          if (oldSrc) URL.revokeObjectURL(oldSrc)
          retiredRef.current = null
          console.log("Retired element released")
        }
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
    const ms = window.navigator.mediaSession
    if (!ms) {
      console.error("Media session not available")
      return
    }

    const audio = audioARef.current
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
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  return (
    <>
      <audio ref={audioARef}>
        <source ref={sourceARef} />
      </audio>
      <audio ref={audioBRef}>
        <source ref={sourceBRef} />
      </audio>
    </>
  )
}
