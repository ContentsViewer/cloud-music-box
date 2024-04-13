import { useEffect, useState } from "react"
import { useDynamicThemeStore } from "../stores/dynamic-theme-store"
import { Box, styled } from "@mui/material"
import { useThemeStore } from "../stores/theme-store"
import { MaterialDynamicColors, hexFromArgb } from "@material/material-color-utilities"

export const DynamicBackground = () => {
  const [dynamicThemeState] = useDynamicThemeStore()
  const [themeStoreState] = useThemeStore()
  const [pitchColor, setPitchColor] = useState("transparent")

  const pitch = dynamicThemeState.pitch

  const noteFromPitch = (frequency: number) => {
    const noteNum = 12 * (Math.log(frequency / 440) / Math.log(2))
    return Math.round(noteNum) + 69
  }

  useEffect(() => {
    if (pitch === -1) return
    const note = noteFromPitch(pitch)
    setPitchColor(`hsl(${(note % 12) * 30}, 100%, 50%)`)
  }, [pitch])

  const primaryColor = hexFromArgb(
            MaterialDynamicColors.primary.getArgb(
              themeStoreState.scheme
    ))

  return (
    <div>
      <Box
        sx={{
          position: "fixed",
          top: 0,
          right: 0,
          bottom: 0,
          left: 0,
          background: `linear-gradient(transparent, ${primaryColor})`,
          opacity: 0.1,
        }}
      />
      <Box
        style={{ backgroundColor: pitchColor }}
        sx={{
          width: "30vw",
          height: "30vh",
          position: "fixed",
          borderRadius: "50%",
          mixBlendMode: "screen",
          // mixBlendMode: "saturate",
          filter: "blur(30vmin)",
          transition: "background-color 1s",
          top: 0,
          right: 0,
          opacity: 0.80,
        }}
      />
    </div>
  )
}
