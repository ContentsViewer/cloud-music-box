"use client"

import { Slider, Typography, alpha } from "@mui/material"
import type { SxProps, Theme } from "@mui/material/styles"
import { usePlayerStore } from "../stores/player-store"
import { useAudioBus } from "@/src/stores/audio-bus-provider"
import { useThemeStore } from "@/src/stores/theme-store"
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

// Hoisted: this component re-renders at ~4 Hz while playing; a fresh sx object
// per render forced MUI/emotion to re-resolve styles every tick (steady GC food)
const timeSliderSx: SxProps<Theme> = {
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
}

const timeDisplayStyle = css({
  display: "flex",
  alignItems: "center",
  justifyContent: "space-between",
  marginTop: -16,
})

interface TimeSliderProps {
  value: number
}

const TimeSlider = memo(({ value }: TimeSliderProps) => {
  return <Slider sx={timeSliderSx} size="small" value={value} max={1000} />

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
      <div css={timeDisplayStyle}>
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
  const audioBus = useAudioBus()

  const duration = playerState.duration

  // The playback position comes straight from the bus, not the store (prevents the
  // 4 Hz re-render of every store consumer and localizes updates to this leaf).
  // The bar still moves on every frame arrival (~4 Hz) as before; the text is
  // effectively 1 Hz via the memoized TimeDisplay + integer-seconds prop.
  const [actualTime, setActualTime] = useState<number>(
    () => audioBus.getLatest()?.timeSeconds ?? 0
  )
  useEffect(() => {
    return audioBus.subscribe(frame => {
      setActualTime(frame.timeSeconds)
    })
  }, [audioBus])

  const colorOnSurfaceVariant = useMemo(
    () =>
      hexFromArgb(
        MaterialDynamicColors.onSurfaceVariant.getArgb(themeStoreState.scheme)
      ),
    [themeStoreState.scheme]
  )

  const inputValue = duration ? (actualTime / duration) * 1000 : 0

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
