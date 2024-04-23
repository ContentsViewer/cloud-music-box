"use client"

import { Box, Slider, SxProps, Theme, Typography } from "@mui/material"
import { usePlayerStore } from "../stores/player-store"
import { useThemeStore } from "../stores/theme-store"
import { useEffect, useState } from "react"
import {
  MaterialDynamicColors,
  hexFromArgb,
} from "@material/material-color-utilities"

const getNumberWithLeadingZero = (n: number) => `${n < 10 ? "0" : ""}${n}`

const formatTime = (ms: number) => {
  if (typeof ms !== "number" || !Number.isFinite(ms) || ms < 0) {
    return "--:--"
  }

  const hours = Math.floor(ms / 60 / 60)
  const minutes = Math.floor((ms % 3600) / 60)
  const seconds = Math.floor((ms % 3600) % 60)
  const time: (number | string)[] = [
    getNumberWithLeadingZero(minutes),
    getNumberWithLeadingZero(seconds),
  ]

  if (hours) {
    time.unshift(hours)
  }

  return time.join(":")
}

interface TimelineSliderProps {
  sx?: SxProps<Theme>
}

export const TimelineSlider = (props: TimelineSliderProps) => {
  const [playerState] = usePlayerStore()
  const [themeStoreState] = useThemeStore()

  const duration = playerState.duration

  const actualTime = playerState.currentTime

  const [inputValue, setInputValue] = useState<number>(0)

  const colorOnSurfaceVariant = hexFromArgb(
    MaterialDynamicColors.onSurfaceVariant.getArgb(themeStoreState.scheme)
  )

  useEffect(() => {
    const time = actualTime

    setInputValue(time ? (actualTime / duration) * 1000 : 0)
  }, [actualTime, duration])

  return (
    <Box
      sx={{
        display: "flex",
        flexDirection: "column",
        ...props.sx,
      }}
    >
      <Slider
        sx={{
          height: 4,
          // gridColumn: "1 / 4",
          // mx: 4,
          // px: 4,
          // pt: 1,
        }}
        size="small"
        value={inputValue}
        max={1000}
      />
      <Box
        sx={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          mt: -1.5,
        }}
      >
        <Typography variant="caption" color={colorOnSurfaceVariant} sx={{}}>
          {formatTime(actualTime)}
        </Typography>
        <Typography
          variant="caption"
          sx={
            {
              // gridColumn: "3",
            }
          }
          color={colorOnSurfaceVariant}
        >
          {formatTime(duration)}
        </Typography>
      </Box>
    </Box>
  )
}
