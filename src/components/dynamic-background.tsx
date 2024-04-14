import { useEffect, useState } from "react"
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

  const noteFromPitch = (frequency: number) => {
    const noteNum = 12 * (Math.log(frequency / 440) / Math.log(2))
    return Math.round(noteNum) + 69
  }

  useEffect(() => {
    const pitch = dynamicThemeState.pitch
    if (pitch === -1) return

    const note = noteFromPitch(pitch)
    const noteColor = Hct.from((note % 12) * 30, 100, 50)
    const primaryColor = MaterialDynamicColors.primaryContainer.getHct(
      themeStoreState.scheme
    )
    const pitchColor = Blend.harmonize(noteColor.toInt(), primaryColor.toInt())

    setPitchColor(hexFromArgb(pitchColor))
  }, [dynamicThemeState.pitch, themeStoreState.scheme])

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
          mixBlendMode: "screen",
          transition: "background-color 1s",
          top: 0,
          right: 0,
          bottom: 0,
          left: 0,
          opacity: 0.25,
          // backgroundImage: `radical-gradient(transparent, ${backgroundColor})`,
          background: `radial-gradient(circle at 76% 26%, transparent, ${backgroundColor})`,
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
          opacity: 0.2,
        }}
      />
    </div>
  )
}
