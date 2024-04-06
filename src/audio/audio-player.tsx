"use client"

import { useEffect, useRef, useState } from "react"
import { usePlayerStore, AudioTrack } from "../stores/player-store"
import { enqueueSnackbar } from "notistack"
import { useFileStore } from "../stores/file-store"
import * as mm from "music-metadata-browser"
import assert, { AssertionError } from "assert"
import { useDynamicThemeStore } from "../stores/dynamic-theme-store"

const makeAudioAnalyser = () => {
  let audioContext: OfflineAudioContext
  let sourceNode: AudioBufferSourceNode
  let audioBuffer: AudioBuffer
  let isAnalyzing = false
  let pitch: number = -1

  const ensureAudioContext = (reload: boolean= false) => {
    if (audioContext && !reload) return;

    audioContext = new OfflineAudioContext({
      numberOfChannels: 2,
      length: 2048,
      sampleRate: 44100,
    })
  }


  const autoCorrelate = (buf: Float32Array, sampleRate: number) => {
    let rms = 0
    let nBuf = buf.length
    for (let i = 0; i < nBuf; i++) {
      const val = buf[i]
      rms += val * val
    }
    rms = Math.sqrt(rms / nBuf)
    if (rms < 0.01) return -1

    let r1 = 0
    let r2 = nBuf - 1
    let threshold = 0.2
    for (let i = 0; i < nBuf/2; i++) {
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
    
    buf = buf.slice(r1, r2)
    nBuf = buf.length

    let c = new Array(nBuf).fill(0)
    for (let i = 0; i < nBuf; i++) {
      for (let j = 0; j < nBuf - i; j++) {
        c[i] += buf[j] * buf[j + i]
      }
    }

    let d = 0;
    while (c[d] > c[d + 1]) d++;
    let maxVal = -1
    let maxPos = -1
    for (let i = d; i < nBuf; i++) {
      if (c[i] > maxVal) {
        maxVal = c[i]
        maxPos = i
      }
    }
    let t0 = maxPos
    let x1 = c[t0 - 1]
    let x2 = c[t0]
    let x3 = c[t0 + 1]
    let a = (x1 + x3 - 2 * x2) / 2
    let b = (x3 - x1) / 2
    if (a) t0 = t0 - b / (2 * a)

    return sampleRate / t0
  }

  return {
    setBuffer: async (blob: Blob) => {
      ensureAudioContext()
      audioBuffer = await audioContext.decodeAudioData(await blob.arrayBuffer())
    },

    requestAnalyze: async (start: number) => {
      if (!audioBuffer) return
      if (isAnalyzing) return

      if (sourceNode) {
        sourceNode.stop()
        sourceNode.disconnect()
      }

      ensureAudioContext(true);

      sourceNode = audioContext.createBufferSource()
      sourceNode.buffer = audioBuffer
      sourceNode.connect(audioContext.destination)
      sourceNode.start(0, start, 1)

      audioContext
        .startRendering()
        .then(renderedBuffer => {
          const data0 = renderedBuffer.getChannelData(0)
          const data1 = renderedBuffer.getChannelData(1)
          const pitch0 = autoCorrelate(data0, renderedBuffer.sampleRate)
          const pitch1 = autoCorrelate(data1, renderedBuffer.sampleRate)
          pitch = Math.max(pitch0, pitch1)
          // console.log("Pitch", pitch0, pitch1)
        })
        .catch(error => {
          console.error(error)
        })
    },
    get pitch() {
      return pitch
    },
  }
}


export const AudioPlayer = () => {
  const [playerState, playerActions] = usePlayerStore()
  const playerActionsRef = useRef(playerActions)
  playerActionsRef.current = playerActions

  const [, dynamicThemeActions] = useDynamicThemeStore()
  const dynamicThemeActionsRef = useRef(dynamicThemeActions)

  const fileStore = useFileStore()
  const fileStoreRef = useRef(fileStore)
  fileStoreRef.current = fileStore

  const audioRef = useRef<HTMLAudioElement>(null)
  const sourceRef = useRef<HTMLSourceElement>(null)

  const audioAnalyserRef = useRef(makeAudioAnalyser())

  useEffect(() => {
    // if (configured.current) return

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

    const onDurationChange = () => {}
    const onTimeUpdate = () => {
      const analyser = audioAnalyserRef.current
      if (!analyser) return
      analyser.requestAnalyze(audio.currentTime)
      dynamicThemeActionsRef.current.setPitch(analyser.pitch)
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

      // configured.current = true
    }
  }, [])

  useEffect(() => {
    const audio = audioRef.current
    const source = sourceRef.current

    if (!audio || !source) {
      console.error("Audio player not initialized")
      return
    }

    console.log("Audio player effect", playerState)

    if (!playerState.isPlaying) {
      audio.pause()
      return
    }

    if (playerState.isActiveTrackLoading) {
      return
    }
    assert(playerState.activeTrack?.blob)

    if (source.src) {
      const previousSrc = source.src
      source.src = ""
      source.removeAttribute("src")
      URL.revokeObjectURL(previousSrc)
    }

    if (playerState.activeTrack) {
      const src = URL.createObjectURL(playerState.activeTrack.blob)

      source.src = src
      // safari(iOS) cannot detect the mime type(especially flac) from the binary.
      source.type = playerState.activeTrack.file.mimeType
      console.log("Setting source", src, source.type)
      audioAnalyserRef.current.setBuffer(playerState.activeTrack.blob)

      audio.load()
      audio.play().catch(error => {
        playerActionsRef.current.pause()

        console.error(error)
        enqueueSnackbar(`${error}`, { variant: "error" })
      })

      enqueueSnackbar("Playing", { variant: "info" })
    }
  }, [playerState])

  useEffect(() => {
    const ms = window.navigator.mediaSession
    if (!ms) {
      return
    }

    console.log("Setting media session handlers")

    ms.setActionHandler("play", () => {
      console.log("Play")
      playerActionsRef.current.play()
    })
    ms.setActionHandler("pause", () => {
      console.log("Pause")
      playerActionsRef.current.pause()
    })
    ms.setActionHandler("previoustrack", () => {
      // playPreviousTrack();
    })
    ms.setActionHandler("nexttrack", () => {
      console.log("Click next track")
      playerActionsRef.current.playNextTrack()
    })
    ms.setActionHandler("seekbackward", null)
    ms.setActionHandler("seekforward", null)

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

  useEffect(() => {
    const ms = window.navigator.mediaSession
    if (!ms) return

    if (playerState.activeTrack && !playerState.isActiveTrackLoading) {
      console.log("Setting metadata", playerState.activeTrack.file.name)
      const cover = mm.selectCover(
        playerState.activeTrack.file.metadata?.common.picture
      )
      const artwork = []
      if (cover) {
        const coverUrl = URL.createObjectURL(
          new Blob([cover.data], { type: cover.format })
        )
        artwork.push({ src: coverUrl, sizes: "512x512", type: cover.format })
      }

      ms.metadata = new MediaMetadata({
        title:
          playerState.activeTrack.file.metadata?.common.title ||
          playerState.activeTrack.file.name,
        artist:
          playerState.activeTrack.file.metadata?.common.artists?.join(", "),
        album: playerState.activeTrack.file.metadata?.common.album,
        artwork: artwork,
      })
    }

    ms.playbackState = playerState.isPlaying ? "playing" : "paused"

    return () => {
      if (ms.metadata && ms.metadata.artwork.length > 0) {
        URL.revokeObjectURL(ms.metadata.artwork[0].src)
      }
      ms.metadata = null
    }
  }, [playerState])

  return (
    <audio ref={audioRef}>
      <source ref={sourceRef} />
    </audio>
  )
}
