import { useEffect, useState } from "react"
import { useDynamicThemeStore } from "../stores/dynamic-theme-store"
import { Box, styled } from "@mui/material"

export const DynamicBackground = () => {
  const [dynamicThemeState] = useDynamicThemeStore()
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

  return (
    <Box
      style={{ backgroundColor: pitchColor }}
      sx={{
        width: "30vmax",
        height: "30vmax",
        position: "fixed",
        borderRadius: "50%",
        mixBlendMode: "screen",
        filter: "blur(30vmax)",
        transition: "background-color 1s",
        top: 0,
        right: 0,
        // opacity: 0.5,
      }}
    />
  )
}
