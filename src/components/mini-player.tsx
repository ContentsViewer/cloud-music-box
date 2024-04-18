"use client"

import {
  Audiotrack,
  PlayArrow,
  PlayArrowRounded,
  SkipNext,
  SkipNextOutlined,
  SkipNextRounded,
  SkipPrevious,
  SkipPreviousRounded,
  Stop,
  StopRounded,
  Undo,
} from "@mui/icons-material"
import {
  Avatar,
  Box,
  Card,
  Fade,
  Grow,
  IconButton,
  LinearProgress,
  Slider,
  SxProps,
  Theme,
  Typography,
  alpha,
  rgbToHex,
  useTheme,
} from "@mui/material"
import { usePlayerStore } from "../stores/player-store"
import { useFileStore } from "../stores/file-store"
import { useThemeStore } from "../stores/theme-store"
import {
  MaterialDynamicColors,
  hexFromArgb,
  Hct,
} from "@material/material-color-utilities"
import { useEffect, useMemo, useRef, useState } from "react"
import * as mm from "music-metadata-browser"
import { Variant } from "@mui/material/styles/createTypography"
import { MarqueeText } from "./marquee-text"
import { useRouter } from "../router"

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

interface MiniPlayerProps {
  sx?: SxProps<Theme>
}

const TimelineSlider = () => {
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
        my: 1,
        mx: 4,
        // display: "grid",
        // gridTemplateColumns: "auto 1fr auto",
        display: "flex",
        flexDirection: "column",
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
          mt: -2,
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

export const MiniPlayer = (props: MiniPlayerProps) => {
  const [playerState, playerActions] = usePlayerStore()
  const [themeStoreState] = useThemeStore()
  const [coverUrl, setCoverUrl] = useState<string | undefined>(undefined)
  const [routerState, routerActions] = useRouter()
  const theme = useTheme()

  const activeTrack = playerState.activeTrack

  const title =
    activeTrack?.file.metadata?.common.title ||
    activeTrack?.file.name ||
    "No track playing"

  useEffect(() => {
    if (coverUrl) {
      URL.revokeObjectURL(coverUrl)
    }

    const cover = mm.selectCover(activeTrack?.file.metadata?.common.picture)
    let url: string | undefined
    if (cover) {
      url = URL.createObjectURL(new Blob([cover.data], { type: cover.format }))
    }
    setCoverUrl(url)

    return () => {
      if (coverUrl) {
        URL.revokeObjectURL(coverUrl)
      }
    }
  }, [activeTrack?.file.metadata?.common.picture])

  const goBackEnabled = (() => {
    const parentId = activeTrack?.file.parentId
    if (!parentId) return false
    if (`${routerState.pathname}${routerState.hash}` === `/files#${parentId}`)
      return false
    return true
  })()

  const primaryBackgroundColor = (() => {
    const hct = Hct.fromInt(
      MaterialDynamicColors.primaryContainer
        .getHct(themeStoreState.scheme)
        .toInt()
    )

    hct.tone /= 2
    hct.chroma /= 2
    return hexFromArgb(hct.toInt())
  })()

  const colorOnSurfaceVariant = hexFromArgb(
    MaterialDynamicColors.onSurfaceVariant.getArgb(themeStoreState.scheme)
  )

  return (
    <Card
      sx={{
        ...props.sx,
        backdropFilter: "blur(16px)",
        backgroundColor: alpha(primaryBackgroundColor, 0.5),
        display: "flex",
        m: 1,
        flexDirection: "column",
        borderRadius: 4,
      }}
    >
      <Box sx={{ position: "absolute", top: 0, left: 0, right: 0 }}>
        {goBackEnabled ? (
          <IconButton
            size="small"
            onClick={() => {
              const parentId = activeTrack?.file.parentId
              if (!parentId) return

              routerActions.goFile(parentId)
            }}
            sx={{
              color: colorOnSurfaceVariant,
            }}
          >
            <Undo fontSize="inherit" />
          </IconButton>
        ) : null}
      </Box>
      <TimelineSlider />
      <Box
        sx={{
          display: "flex",
          alignItems: "center",
          width: "100%",
          px: 2,
          pb: 1,
        }}
      >
        <Avatar
          src={coverUrl}
          variant="rounded"
          sx={{
            mr: 2,
          }}
        >
          {coverUrl ? null : <Audiotrack />}
        </Avatar>
        <Box sx={{ flexGrow: 1, minWidth: "0" }}>
          <MarqueeText
            text={title}
            color={hexFromArgb(
              MaterialDynamicColors.onSurface.getArgb(themeStoreState.scheme)
            )}
          />
          <MarqueeText
            text={activeTrack?.file.metadata?.common.artist || ""}
            color={colorOnSurfaceVariant}
          />
        </Box>
        <IconButton
          onClick={() => {
            playerActions.playPreviousTrack()
          }}
        >
          <SkipPreviousRounded />
        </IconButton>
        <IconButton
          size="large"
          sx={{
            backgroundColor: hexFromArgb(
              MaterialDynamicColors.primary.getArgb(themeStoreState.scheme)
            ),
            color: hexFromArgb(
              MaterialDynamicColors.onPrimary.getArgb(themeStoreState.scheme)
            ),
            "&:hover": {
              backgroundColor: hexFromArgb(
                MaterialDynamicColors.primary.getArgb(themeStoreState.scheme)
              ),
            },
          }}
          onClick={() => {
            if (playerState.isPlaying) {
              playerActions.pause()
            } else {
              playerActions.play()
            }
          }}
        >
          <Box
            sx={{
              position: "relative",
              width: "32px",
              height: "32px",
              display: "flex",
              justifyContent: "center",
              alignItems: "center",
            }}
          >
            <Grow in={playerState.isPlaying} timeout={500} appear={false}>
              <StopRounded sx={{ fontSize: 32, position: "absolute" }} />
            </Grow>
            <Grow in={!playerState.isPlaying} timeout={500} appear={false}>
              <PlayArrowRounded sx={{ fontSize: 32, position: "absolute" }} />
            </Grow>
          </Box>
        </IconButton>
        <IconButton
          onClick={() => {
            playerActions.playNextTrack()
          }}
        >
          <SkipNextRounded />
        </IconButton>
      </Box>
      <Box sx={{ position: "absolute", bottom: 0, left: 0, right: 0 }}>
        <Fade
          in={playerState.isActiveTrackLoading}
          style={{
            transitionDelay: playerState.isActiveTrackLoading ? "800ms" : "0ms",
          }}
        >
          <LinearProgress sx={{ width: "100%" }} />
        </Fade>
      </Box>
    </Card>
  )
}
