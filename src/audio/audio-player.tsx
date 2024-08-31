"use client"

import { useEffect, useMemo, useRef, useState } from "react"
import { usePlayerStore, AudioTrack } from "../stores/player-store"
import { enqueueSnackbar } from "notistack"
import { useFileStore } from "../stores/file-store"
import * as mm from "music-metadata-browser"
import assert from "assert"
import { useAudioDynamicsStore } from "../stores/audio-dynamics-store"
import FFT from "fft.js"

const makeAudioAnalyser = () => {
  let audioContext: OfflineAudioContext
  let sourceNode: AudioBufferSourceNode
  let audioBuffer: AudioBuffer
  let isAnalyzing = false
  const bufferLength = 2048
  // const sampleRate = 44100
  const sampleRate = 22050
  const fft = new FFT(bufferLength)
  const spectrum = fft.createComplexArray()
  const powerSpectrum = new Float32Array(bufferLength)
  const corr = fft.createComplexArray()

  const ensureAudioContext = (reload: boolean = false) => {
    if (audioContext && !reload) return

    audioContext = new OfflineAudioContext({
      numberOfChannels: 2,
      length: sampleRate * 0.5,
      sampleRate: sampleRate,
    })
  }

  // 37ms
  const autoCorrelate = (buf: Float32Array, sampleRate: number) => {
    let rms = 0
    let nBuf = buf.length
    for (let i = 0; i < nBuf; i++) {
      const val = buf[i]
      rms += val * val
    }
    rms = Math.sqrt(rms / nBuf)
    if (rms < 0.01) return [-1, rms]

    let r1 = 0
    let r2 = nBuf - 1
    const threshold = 0.2
    for (let i = 0; i < nBuf / 2; i++) {
      if (Math.abs(buf[i]) < threshold) {
        r1 = i
        break
      }
    }
    for (let i = 1; i < nBuf / 2; i++) {
      if (Math.abs(buf[nBuf - i]) < threshold) {
        r2 = nBuf - i
        break
      }
    }

    for (let i = 0; i < r1; i++) buf[i] = 0
    for (let i = r2 + 1; i < buf.length; i++) buf[i] = 0

    fft.realTransform(spectrum, buf)
    fft.completeSpectrum(spectrum)

    for (let i = 0; i < bufferLength; i++) {
      powerSpectrum[i] =
        spectrum[2 * i] * spectrum[2 * i] +
        spectrum[2 * i + 1] * spectrum[2 * i + 1]
    }

    fft.realTransform(corr, powerSpectrum)
    fft.completeSpectrum(corr)

    let d = 0
    while (corr[2 * d] > corr[2 * (d + 1)]) d++
    let maxVal = -1
    let maxPos = -1
    for (let i = d; i < nBuf / 2; i++) {
      if (corr[2 * i] > maxVal) {
        maxVal = corr[2 * i]
        maxPos = i
      }
    }

    let t0 = maxPos
    let x1 = corr[2 * (t0 - 1)]
    let x2 = corr[t0]
    let x3 = corr[2 * (t0 + 1)]
    let a = (x1 + x3 - 2 * x2) / 2
    let b = (x3 - x1) / 2
    if (a) t0 = t0 - b / (2 * a)

    return [sampleRate / t0, rms]
  }

  return {
    setBuffer: async (blob: Blob) => {
      ensureAudioContext()
      audioBuffer = await audioContext.decodeAudioData(await blob.arrayBuffer())
    },

    requestAnalyze: async (start: number) => {
      if (!audioBuffer) throw new Error("Audio buffer not set")
      if (isAnalyzing) throw new Error("Analyzing in progress")

      if (sourceNode) {
        sourceNode.stop()
        sourceNode.disconnect()
      }

      ensureAudioContext(true)

      sourceNode = audioContext.createBufferSource()
      sourceNode.buffer = audioBuffer
      sourceNode.connect(audioContext.destination)
      sourceNode.start(0, start, 1)

      return audioContext
        .startRendering()
        .then(renderedBuffer => {
          const samples0 = renderedBuffer.getChannelData(0)
          const samples1 = renderedBuffer.getChannelData(1)
          const [pitch0, rms0] = autoCorrelate(samples0.slice(0, bufferLength), sampleRate)
          const [pitch1, rms1] = autoCorrelate(samples1.slice(0, bufferLength), sampleRate)
          return {
            timeSeconds: start,
            pitch0, pitch1,
            rms0, rms1,
            sampleRate: renderedBuffer.sampleRate,
            samples0, samples1
          }
        })
    }
  }
}

const msSetPlaybackState = (state: "playing" | "paused") => {
  console.log("msSetPlaybackState", state)
  const ms = window.navigator.mediaSession
  if (!ms) return
  ms.playbackState = state
}

const msSetPlayingTrack = (track: AudioTrack) => {
  console.log("msSetPlayingTrack", track.file.name)

  const ms = window.navigator.mediaSession
  if (!ms) return

  if (ms.metadata && ms.metadata.artwork.length > 0) {
    URL.revokeObjectURL(ms.metadata.artwork[0].src)
  }

  const cover = mm.selectCover(track.file.metadata?.common.picture)
  const artwork = []
  if (cover) {
    const coverUrl = URL.createObjectURL(
      new Blob([cover.data], { type: cover.format })
    )
    artwork.push({ src: coverUrl, sizes: "512x512", type: cover.format })
  }

  ms.metadata = new MediaMetadata({
    title: track.file.metadata?.common.title || track.file.name,
    artist: track.file.metadata?.common.artists?.join(", "),
    album: track.file.metadata?.common.album,
    artwork: artwork,
  })
  ms.playbackState = "playing"
}

export const AudioPlayer = () => {
  const [playerState, playerActions] = usePlayerStore()
  const playerActionsRef = useRef(playerActions)
  playerActionsRef.current = playerActions

  const [, dynamicThemeActions] = useAudioDynamicsStore()
  const dynamicThemeActionsRef = useRef(dynamicThemeActions)

  const fileStore = useFileStore()
  const fileStoreRef = useRef(fileStore)
  fileStoreRef.current = fileStore

  const audioRef = useRef<HTMLAudioElement>(null)
  const sourceRef = useRef<HTMLSourceElement>(null)

  const audioAnalyser = useMemo(() => makeAudioAnalyser(), [])

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
      playerActionsRef.current.pause()
      enqueueSnackbar(`${error}`, { variant: "error" })
    }

    const onDurationChange = () => {
      playerActionsRef.current.setDuration(audio.duration)
    }

    const onTimeUpdate = () => {
      playerActionsRef.current.setCurrentTime(audio.currentTime)

      audioAnalyser.requestAnalyze(audio.currentTime)
        .then(frame => { 
          dynamicThemeActionsRef.current.setFrame(frame)
        }).catch(error => {
          console.warn("Failed to analyze audio", error)
        })
    }
    const onPlay = () => {
      console.log("Track started playing")
    }

    const onEnded = () => {
      console.log("Track ended")
      playerActionsRef.current.playNextTrack()
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
    if (!playerState.currentTimeChanged) return

    const audio = audioRef.current
    if (!audio) return

    audio.currentTime = playerState.currentTime
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [playerState.currentTimeChanged])

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

    if (
      playerState.activeTrack &&
      playerState.activeTrack.file.id !== activeAudioTrackRef.current?.file.id
    ) {
      activeAudioTrackRef.current = playerState.activeTrack

      // Unload previous track
      if (source.src) {
        const previousSrc = source.src
        source.src = ""
        source.removeAttribute("src")
        URL.revokeObjectURL(previousSrc)
      }

      assert(playerState.activeTrack?.blob)
      const src = URL.createObjectURL(playerState.activeTrack.blob)

      source.src = src
      // safari(iOS) cannot detect the mime type(especially flac) from the binary.
      source.type = playerState.activeTrack.file.mimeType

      console.log("Setting source", src, source.type)
      audio.load()
      msSetPlayingTrack(playerState.activeTrack)
    }

    audio
      .play()
      .then(() => {
        console.log("Played")
        const blob = playerState.activeTrack?.blob
        if (!blob) return
        audioAnalyser.setBuffer(blob)
      })
      .catch(error => {
        playerActionsRef.current.pause()

        console.error(error)
        enqueueSnackbar(`${error}`, { variant: "error" })
      })
    console.log("To Playing")

    enqueueSnackbar("Playing", { variant: "info" })
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
      playerActionsRef.current.play()
    })
    ms.setActionHandler("pause", () => {
      console.log("Pause")
      playerActionsRef.current.pause()
    })

    ms.setActionHandler("previoustrack", () => {
      console.log("Click previous track")
      playerActionsRef.current.playPreviousTrack()
    })
    ms.setActionHandler("nexttrack", () => {
      console.log("Click next track")
      playerActionsRef.current.playNextTrack()
    })

    ms.setActionHandler("seekbackward", null)
    ms.setActionHandler("seekforward", null)

    ms.setActionHandler("seekto", details => {
      console.log("Seek to", details)
      if (details.fastSeek) return
      if (details.seekTime === undefined) return
      playerActionsRef.current.changeCurrentTime(details.seekTime)
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
