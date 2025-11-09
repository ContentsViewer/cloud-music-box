"use client"

import { Slider, Typography, alpha } from "@mui/material"
import { usePlayerStore } from "../stores/player-store"
import { useThemeStore } from "../stores/theme-store"
import { useEffect, useState, memo, useMemo } from "react"
import {
  MaterialDynamicColors,
  hexFromArgb,
} from "@material/material-color-utilities"
import { css } from "@emotion/react"

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

const containerStyle = css({
  display: "flex",
  flexDirection: "column",
})

interface TimeSliderProps {
  value: number
}

const TimeSlider = memo(({ value }: TimeSliderProps) => {
  return (
    <Slider
      sx={{
        height: 8,
        "& .MuiSlider-thumb": {
          width: 4,
          height: 16,
          borderRadius: 1,
          "&.Mui-active": {
            boxShadow: theme =>
              `0px 0px 0px 6px ${alpha(theme.palette.primary.main, 0.16)}`,
          },
        },
        "& .MuiSlider-track": {
          height: 8,
        },
        "& .MuiSlider-rail": {
          height: 8,
        },
      }}
      size="small"
      value={value}
      max={1000}
    />
  )
})

TimeSlider.displayName = "TimeSlider"

interface TimeDisplayProps {
  currentTime: number
  duration: number
  color: string
}

const TimeDisplay = memo(
  ({ currentTime, duration, color }: TimeDisplayProps) => {
    return (
      <div
        css={css({
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          marginTop: -16,
        })}
      >
        <Typography variant="caption" color={color}>
          {formatTime(currentTime)}
        </Typography>
        <Typography variant="caption" color={color}>
          {formatTime(duration)}
        </Typography>
      </div>
    )
  }
)

TimeDisplay.displayName = "TimeDisplay"

interface TimelineSliderProps {}

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
    <div css={containerStyle} {...props}>
      <TimeSlider value={inputValue} />
      <TimeDisplay
        currentTime={~~actualTime}
        duration={duration}
        color={colorOnSurfaceVariant}
      />
    </div>
  )
}
