import { useEffect, useRef, useState } from "react"
import { useAudioDynamicsStore } from "../stores/audio-dynamics-store"
import { useThemeStore } from "../stores/theme-store"
import { Canvas } from "@react-three/fiber"
import * as THREE from "three"
import {
  MaterialDynamicColors,
  hexFromArgb,
  Blend,
  Hct,
} from "@material/material-color-utilities"
import { useAudioDynamicsSettingsStore } from "../stores/audio-dynamics-settings"
import { css } from "@emotion/react"
import { useAutoHideCursor } from "../hooks/useAutoHideCursor"
import { GeometricSwarm } from "./geometric-swarm"
// Other visualizers (uncomment to switch):
// import { LissajousCurve } from "./lissajous-curve"          // Original point cloud
// import { BandLissajous } from "./band-lissajous"            // Band-separated Lissajous
// import { ReactionDiffusionSurface } from "./reaction-diffusion-surface" // Phase-offset sweep

const noteFromPitch = (frequency: number) => {
  const noteNum = 12 * (Math.log(frequency / 440) / Math.log(2))
  return Math.round(noteNum) + 69
}

export const DynamicBackground = () => {
  const [audioDynamicsState] = useAudioDynamicsStore()
  const [themeStoreState] = useThemeStore()
  const [pitchColor, setPitchColor] = useState("transparent")
  const [isPageUnloading, setIsPageUnloading] = useState(false)
  const pitchRef = useRef(-1)

  // Auto-hide cursor after 3 seconds of inactivity
  const { showCursor, containerRef } = useAutoHideCursor(3000)

  useEffect(() => {
    const pitchCurrent = Math.max(
      audioDynamicsState.frame.pitch0,
      audioDynamicsState.frame.pitch1
    )
    const rmsCurrent = Math.max(
      audioDynamicsState.frame.rms0,
      audioDynamicsState.frame.rms1
    )

    if (pitchCurrent !== -1) {
      pitchRef.current = pitchCurrent
    }

    const pitch = pitchRef.current
    const rms = rmsCurrent

    if (pitch === -1) return

    const sourceColor = Hct.fromInt(themeStoreState.sourceColor)
    // console.log(sourceColor.hue, sourceColor.chroma, sourceColor.tone)

    const note = noteFromPitch(pitch)
    // const tone = Math.min(10 + 150 * rms, 100);
    // const tone = Math.min(10 + 150 * Math.log(rms + 1), 100);
    const tone = Math.min(100 * Math.pow(rms, 1 / 2.2), 100)
    // console.log(rms, tone)
    const noteColor = Hct.from((note % 12) * 30, sourceColor.chroma, tone)
    // const noteColor = Hct.from((note % 12) * 30, 50, tone)
    // console.log(sourceColor.chroma)
    // console.log("#", note % 12, pitch, rms * 200)

    // const primaryColor = MaterialDynamicColors.primaryContainer.getHct(
    //   themeStoreState.scheme
    // )
    // const pitchColor = sourceColor.toInt()
    const pitchColor = Blend.harmonize(noteColor.toInt(), sourceColor.toInt())

    setPitchColor(hexFromArgb(pitchColor))
  }, [audioDynamicsState.frame, themeStoreState.sourceColor])

  const primaryColor = (() => {
    const sourceColor = Hct.fromInt(themeStoreState.sourceColor)
    // CorePalette.of
    sourceColor.tone *= 0.5
    sourceColor.chroma *= 0.5
    // sourceColor.tone = 30
    // sourceColor.chroma = 16
    return hexFromArgb(
      // MaterialDynamicColors.primary.getArgb(themeStoreState.scheme)
      sourceColor.toInt()
    )
  })()
  const backgroundColor = (() => {
    const color = MaterialDynamicColors.background.getArgb(
      themeStoreState.scheme
    )
    return hexFromArgb(color)
  })()

  const [audioDynamicsSettings, audioDynamicsSettingsActions] =
    useAudioDynamicsSettingsStore()

  // console.log(primaryColor)
  useEffect(() => {
    const handleBeforeUnload = () => {
      setIsPageUnloading(true)
    }
    window.addEventListener("beforeunload", handleBeforeUnload)
    return () => {
      window.removeEventListener("beforeunload", handleBeforeUnload)
    }
  }, [])

  return (
    <div>
      <div
        css={css`
          position: fixed;
          transition: background-color 800ms;
          top: 0;
          right: 0;
          bottom: 0;
          left: 0;
          opacity: 1;
          z-index: -3;
          background: radial-gradient(
            circle at 76% 26%,
            transparent,
            ${backgroundColor}
          );
        `}
        style={{ backgroundColor: pitchColor }}
      />
      <div
        css={css`
          position: fixed;
          top: 0;
          right: 0;
          bottom: 0;
          left: 0;
          background: linear-gradient(transparent, ${primaryColor});
          opacity: 1;
          z-index: -3;
        `}
      />
      <div
        ref={containerRef}
        css={css`
          position: fixed;
          top: 0;
          right: 0;
          bottom: 0;
          left: 0;
          z-index: ${audioDynamicsSettings.dynamicsEffectAppeal ? 0 : -2};
          display: ${isPageUnloading ? "none" : "block"};
          background-color: ${audioDynamicsSettings.dynamicsEffectAppeal
            ? "rgba(0, 0, 0, 0.6)"
            : "transparent"};
          transition: background-color 0.5s ease-in-out;
          cursor: ${showCursor ? "default" : "none"};
        `}
        onClick={() => {
          audioDynamicsSettingsActions.setDynamicsEffectAppeal(false)
        }}
      >
        <Canvas
          style={{
            pointerEvents: "none",
          }}
          camera={{
            fov: 90,
            position: [0, 0, 0.5],
            near: 0.01,
          }}
          dpr={1}
          gl={canvas =>
            new THREE.WebGLRenderer({
              canvas,
              alpha: true,
              powerPreference: "default",
            })
          }
        >
          <GeometricSwarm />
          {/* <LissajousCurve /> */}
          {/* <BandLissajous /> */}
          {/* <ReactionDiffusionSurface /> */}
        </Canvas>
      </div>
    </div>
  )
}
