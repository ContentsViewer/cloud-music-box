import { memo, useEffect, useMemo, useRef, useState } from "react"
import { useAudioBus } from "@/src/stores/audio-bus-provider"
import { useThemeStore } from "@/src/stores/theme-store"
import { Canvas } from "@react-three/fiber"
import * as THREE from "three"
import {
  MaterialDynamicColors,
  hexFromArgb,
  Blend,
  Hct,
} from "@material/material-color-utilities"
import { useAudioDynamicsSettingsStore } from "@/src/stores/audio-dynamics-settings"
import { css } from "@emotion/react"
import { useAutoHideCursor } from "@/src/hooks/useAutoHideCursor"
import { FbSparseCortex } from "./fb-sparse-cortex" // cochlea -> topographic sparse-coding map -> readout
import { LissajousCurve } from "./lissajous-curve" // classic Lissajous point cloud
import { noteFromPitch } from "../lib/pitch"

// Canvas config pinned at module scope (so parent re-renders never re-apply it)
const CAMERA_CONFIG = {
  fov: 90,
  position: [0, 0, 0.5] as [number, number, number],
  near: 0.01,
}
const createRenderer = (canvas: HTMLCanvasElement | OffscreenCanvas) =>
  new THREE.WebGLRenderer({
    canvas,
    alpha: true,
    powerPreference: "default",
  })

// Pitch -> background color layer. Split into a memoized child that subscribes
// to the bus and updates only its own state, so the parent (which hosts the
// Canvas) never re-renders at ~4 Hz.
const PitchBackdrop = memo(function PitchBackdrop({
  sourceColor,
  backgroundColor,
}: {
  sourceColor: number
  backgroundColor: string
}) {
  const audioBus = useAudioBus()
  const [pitchColor, setPitchColor] = useState("transparent")
  const pitchRef = useRef(-1)

  useEffect(() => {
    return audioBus.subscribe(frame => {
      const pitchCurrent = Math.max(frame.pitch0, frame.pitch1)
      const rms = Math.max(frame.rms0, frame.rms1)

      if (pitchCurrent !== -1) {
        pitchRef.current = pitchCurrent
      }

      const pitch = pitchRef.current
      if (pitch === -1) return

      const source = Hct.fromInt(sourceColor)
      const note = noteFromPitch(pitch)
      const tone = Math.min(100 * Math.pow(rms, 1 / 2.2), 100)
      const noteColor = Hct.from((note % 12) * 30, source.chroma, tone)
      const blended = Blend.harmonize(noteColor.toInt(), source.toInt())

      setPitchColor(hexFromArgb(blended))
    })
  }, [audioBus, sourceColor])

  return (
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
  )
})

export const DynamicBackground = () => {
  const [themeStoreState] = useThemeStore()
  const [isPageUnloading, setIsPageUnloading] = useState(false)

  // Auto-hide cursor after 3 seconds of inactivity
  const { showCursor, containerRef } = useAutoHideCursor(3000)

  // Theme-derived colors recompute only on theme changes (Hct/MaterialDynamicColors are not cheap)
  const primaryColor = useMemo(() => {
    const sourceColor = Hct.fromInt(themeStoreState.sourceColor)
    sourceColor.tone *= 0.5
    sourceColor.chroma *= 0.5
    return hexFromArgb(sourceColor.toInt())
  }, [themeStoreState.sourceColor])
  const backgroundColor = useMemo(
    () =>
      hexFromArgb(
        MaterialDynamicColors.background.getArgb(themeStoreState.scheme)
      ),
    [themeStoreState.scheme]
  )

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
      <PitchBackdrop
        sourceColor={themeStoreState.sourceColor}
        backgroundColor={backgroundColor}
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
          camera={CAMERA_CONFIG}
          dpr={1}
          gl={createRenderer}
        >
          {audioDynamicsSettings.visualizerType === "sparse-cortex" ? (
            <FbSparseCortex />
          ) : (
            <LissajousCurve />
          )}
        </Canvas>
      </div>
    </div>
  )
}
