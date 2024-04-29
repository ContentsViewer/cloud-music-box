import { useEffect, useRef, useState } from "react"
import { useDynamicThemeStore } from "../stores/dynamic-theme-store"
import { Box, styled } from "@mui/material"
import { useThemeStore } from "../stores/theme-store"
import {
  MaterialDynamicColors,
  hexFromArgb,
  Blend,
  Hct,
} from "@material/material-color-utilities"

export const DynamicBackground = () => {
  const [dynamicThemeState] = useDynamicThemeStore()
  const [themeStoreState] = useThemeStore()
  const [pitchColor, setPitchColor] = useState("transparent")
  const pitchRef = useRef(-1)

  const noteFromPitch = (frequency: number) => {
    const noteNum = 12 * (Math.log(frequency / 440) / Math.log(2))
    return Math.round(noteNum) + 69
  }

  useEffect(() => {
    if (dynamicThemeState.pitch !== -1) {
      pitchRef.current = dynamicThemeState.pitch
    }

    const pitch = pitchRef.current
    const rms = dynamicThemeState.rms

    if (pitch === -1) return

    const sourceColor = Hct.fromInt(themeStoreState.sourceColor)
    // console.log(sourceColor.hue, sourceColor.chroma, sourceColor.tone)

    const note = noteFromPitch(pitch)
    // const tone = Math.min(10 + 150 * rms, 100);
    // const tone = Math.min(10 + 150 * Math.log(rms + 1), 100);
    const tone = Math.min(100 * Math.pow(rms, 1 / 2.2), 100)
    // console.log(rms, tone)
    const noteColor = Hct.from((note % 12) * 30, 50, tone)
    // console.log("#", note % 12, pitch, rms * 200)

    // const primaryColor = MaterialDynamicColors.primaryContainer.getHct(
    //   themeStoreState.scheme
    // )
    // const pitchColor = sourceColor.toInt()
    const pitchColor = Blend.harmonize(noteColor.toInt(), sourceColor.toInt())

    setPitchColor(hexFromArgb(pitchColor))
  }, [
    dynamicThemeState.pitch,
    dynamicThemeState.rms,
    themeStoreState.sourceColor,
  ])

  const primaryColor = (() => {
    const sourceColor = Hct.fromInt(themeStoreState.sourceColor)
    sourceColor.tone /= 2
    sourceColor.chroma /= 2
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

  // console.log(primaryColor)

  return (
    <div>
      <Box
        style={{ backgroundColor: pitchColor }}
        sx={{
          position: "fixed",
          // mixBlendMode: "screen",
          transition: "background-color 800ms",
          top: 0,
          right: 0,
          bottom: 0,
          left: 0,
          opacity: 1.0,
          // backgroundImage: `radical-gradient(transparent, ${backgroundColor})`,
          background: `radial-gradient(circle at 76% 26%, transparent, ${backgroundColor})`,
          zIndex: -1,
        }}
      />
      <Box
        sx={{
          position: "fixed",
          top: 0,
          right: 0,
          bottom: 0,
          left: 0,
          background: `linear-gradient(transparent, ${primaryColor})`,
          opacity: 1.0,
          zIndex: -1,
        }}
      />
    </div>
  )
}
