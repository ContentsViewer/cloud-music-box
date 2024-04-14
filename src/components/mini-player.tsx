"use client"

import {
  Audiotrack,
  PlayArrow,
  SkipNext,
  SkipPrevious,
  Stop,
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

interface MiniPlayerProps {
  sx?: SxProps<Theme>
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

  return (
    <Card
      sx={{
        ...props.sx,
        backdropFilter: "blur(16px)",
        backgroundColor: alpha(primaryBackgroundColor, 0.5),
        display: "flex",
        m: 1,
        alignItems: "center",
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
              color: hexFromArgb(
                MaterialDynamicColors.onSurfaceVariant.getArgb(
                  themeStoreState.scheme
                )
              ),
            }}
          >
            <Undo fontSize="inherit" />
          </IconButton>
        ) : null}
      </Box>
      <Box sx={{ display: "flex", alignItems: "center", width: "100%", p: 2 }}>
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
            color={hexFromArgb(
              MaterialDynamicColors.onSurfaceVariant.getArgb(
                themeStoreState.scheme
              )
            )}
          />
        </Box>
        <IconButton
          onClick={() => {
            playerActions.playPreviousTrack()
          }}
        >
          <SkipPrevious />
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
              <Stop sx={{ fontSize: 32, position: "absolute" }} />
            </Grow>
            <Grow in={!playerState.isPlaying} timeout={500} appear={false}>
              <PlayArrow sx={{ fontSize: 32, position: "absolute" }} />
            </Grow>
          </Box>
        </IconButton>
        <IconButton
          onClick={() => {
            playerActions.playNextTrack()
          }}
        >
          <SkipNext />
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
