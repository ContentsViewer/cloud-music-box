"use client"

import { useEffect, useMemo, useRef } from "react"
import { usePlayerStore, AudioTrack } from "../stores/player-store"
import { enqueueSnackbar } from "notistack"
import { useFileStore } from "@/src/features/files"
import assert from "assert"
import { useAudioBus } from "@/src/stores/audio-bus-provider"
import { createAudioAnalyser } from "@/src/lib/audio/audio-analyser"
import {
  announceNowPlaying,
  msSetPlaybackState,
  msSetTrackMetadata,
  msSetTrackMetadataWhenArtworkSettles,
  runPlaybackHop,
  useAudioSeek,
  useMediaSessionActionHandlers,
} from "./audio-player-shared"

// The DUAL-element player: two <audio> take turns across track handoffs.
// Chromium REQUIRES this (all verified in its source): 'ended' and load()
// REMOVE the element's player from the page's media session
// (media_session_controller.cc, OnPlaybackPaused(reached_end_of_stream) ->
// AddOrRemovePlayer), and the moment the player set empties, Chrome abandons
// system audio focus (media_session_impl.cc, AbandonSystemAudioFocusIfNeeded).
// Android 15+ denies re-acquiring focus from the background (no top-app, no
// foreground service) and Android 12+ fades out streams playing without focus
// ~2 s in - measured on device as playback dying right after an auto
// track-advance during sleep. A plain pause() keeps the player registered and
// the focus held, so the handoff below never lets the set empty.

// [R2: pre-end handoff] Reaching the actual end of stream is exactly the
// removal case above, so the handoff happens THIS long before the end
// instead of at 'ended'. 0.6 s > 2x the timeupdate cadence (~250 ms), so the
// watcher cannot miss the window; the sacrificed tail is the price of
// background continuity.
const PRE_END_HANDOFF_SEC = 0.6

export const DualElementAudioPlayer = () => {
  const [playerState, playerActions] = usePlayerStore()
  const [, fileStoreActions] = useFileStore()

  const audioBus = useAudioBus()

  // [R1: dual-element handoff] Never touch the element being retired - start
  // the next track on the OTHER element, and release the retired one only
  // AFTER the new one is playing (its sibling then keeps the session
  // populated, so the removal cannot empty it). An ended-but-untouched
  // element stays REGISTERED: the session merely suspends and keeps holding
  // focus.
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
      runPlaybackHop(audio, playerActions, audioAnalyser, audioBus)
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

  useAudioSeek(playerState.seekVersion, playerState.currentTime, getActiveAudio)

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
      const standbyAudio =
        standbyIdx === 0 ? audioARef.current : audioBRef.current
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
      msSetTrackMetadataWhenArtworkSettles(
        activeTrack,
        fileStoreActions.getArtwork,
        trackId => activeAudioTrackRef.current?.file.id === trackId
      )
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
        // Release the retired element once the handoff succeeded: the old
        // blob URL can be freed, and a lingering paused element would stay a
        // Now Playing candidate. Safe for the focus bridge: the NEW element
        // is playing and registered at this point, so removing the retired
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

    announceNowPlaying(activeTrack)
  }, [
    playerState.isActiveTrackLoading,
    playerState.isPlaying,
    playerState.activeTrack,
  ])

  useMediaSessionActionHandlers(playerActions)

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
