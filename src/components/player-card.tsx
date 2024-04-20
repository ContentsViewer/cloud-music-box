"use client"

import {
  Audiotrack,
  PlayArrowRounded,
  SkipNextRounded,
  SkipPreviousRounded,
  StopRounded,
  Undo,
} from "@mui/icons-material"
import {
  Avatar,
  Box,
  Card,
  Toolbar,
  Fade,
  Grow,
  IconButton,
  Button,
  LinearProgress,
  Slider,
  SxProps,
  Theme,
  Typography,
  alpha,
  rgbToHex,
  useTheme,
  ButtonBase,
  makeStyles,
  styled,
  AppBar,
  Zoom,
} from "@mui/material"
import { AudioTrack, usePlayerStore } from "../stores/player-store"
import { useFileStore } from "../stores/file-store"
import { useThemeStore } from "../stores/theme-store"
import { TimelineSlider } from "./timeline-slider"
import {
  MaterialDynamicColors,
  hexFromArgb,
  Hct,
} from "@material/material-color-utilities"
import { useEffect, useMemo, useRef, useState } from "react"
import * as mm from "music-metadata-browser"
import { MarqueeText } from "./marquee-text"
import { useRouter } from "../router"
import { transform } from "next/dist/build/swc"

const TrackCover = (props: {
  coverUrl?: string
  sx?: SxProps<Theme>
  ref?: React.RefObject<HTMLDivElement>
}) => {
  return (
    <Avatar
      src={props.coverUrl}
      variant="rounded"
      sx={{
        width: 48,
        height: 48,
        ...props.sx,
      }}
      ref={props.ref}
    >
      {props.coverUrl ? null : <Audiotrack />}
    </Avatar>
  )
}

const TrackCoverPlaceholder = styled(Box)(({ theme }) => ({
  width: 48,
  height: 48,
}))

interface MiniPlayerContentProps {
  activeTrack: AudioTrack | null
  title: string
  coverUrl?: string
  onExpand?: () => void
  sx?: SxProps<Theme>
  coverRef?: React.RefObject<HTMLDivElement>
  onMount?: () => void
}

const MiniPlayerContent = (props: MiniPlayerContentProps) => {
  const { activeTrack, coverUrl, title, onExpand } = props

  const [playerState, playerActions] = usePlayerStore()
  const [routerState, routerActions] = useRouter()
  const [themeStoreState] = useThemeStore()

  const parentId = activeTrack?.file.parentId

  const colorOnSurfaceVariant = hexFromArgb(
    MaterialDynamicColors.onSurfaceVariant.getArgb(themeStoreState.scheme)
  )

  useEffect(() => {
    if (props.onMount) {
      props.onMount()
    }
  }, [])

  return (
    <Box sx={props.sx}>
      <Box sx={{ position: "absolute", top: 0, left: 0, right: 0 }}>
        {parentId ? (
          <IconButton
            size="small"
            onClick={() => {
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
        <ButtonBase
          sx={{
            mr: 2,
            p: 0,
          }}
          onClick={() => {
            if (onExpand) {
              onExpand()
            }
          }}
        >
          <TrackCover coverUrl={coverUrl} ref={props.coverRef} />
        </ButtonBase>
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
    </Box>
  )
}

interface FullPlayerContentProps {
  onShrink?: () => void
  coverRef?: React.RefObject<HTMLDivElement>
  coverUrl?: string
  onMount?: () => void
}

const FullPlayerContent = (props: FullPlayerContentProps) => {
  useEffect(() => {
    if (props.onMount) {
      props.onMount()
    }
  }, [])

  return (
    <Box
      sx={{
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
      }}
    >
      <AppBar
        sx={{
          backgroundColor: "transparent",
        }}
        elevation={0}
      >
        <Toolbar>
          <IconButton
            size="large"
            edge="start"
            color="inherit"
            onClick={() => {
              if (props.onShrink) {
                props.onShrink()
              }
            }}
          >
            <Undo />
          </IconButton>
        </Toolbar>
      </AppBar>
      <TrackCover
        ref={props.coverRef}
        sx={{
          width: 256,
          height: 256,
        }}
        coverUrl={props.coverUrl}
      />
    </Box>
  )
}

interface PlayerCardProps {
  expand?: boolean
  onShrink?: () => void
  onExpand?: () => void
  sx?: SxProps<Theme>
}

export const PlayerCard = (props: PlayerCardProps) => {
  const [playerState, playerActions] = usePlayerStore()
  const [themeStoreState] = useThemeStore()
  const [coverUrl, setCoverUrl] = useState<string | undefined>(undefined)
  const [routerState, routerActions] = useRouter()
  const cardRef = useRef<HTMLDivElement>(null)
  const coverOnShrinkRef = useRef<HTMLDivElement>(null)
  const coverOnExpandRef = useRef<HTMLDivElement>(null)
  const [coverRect, setCoverRect] = useState<{
    x: Number
    y: Number
    width: Number
    height: Number
  } | null>(null)
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
    <div>
      <Box
        style={{
          // transform: props.expand ? "translateY(-50vh) scale(2)" : "scale(1)",
          transform: props.expand
            ? "perspective(160px) translateZ(80px)"
            : "none",
        }}
        sx={{
          position: "fixed",
          // transition: theme.transitions.create("all"),
          transition: "transform 1s",

          bottom: `calc(env(safe-area-inset-bottom, 0) + 8px)`,
          right: `calc(env(safe-area-inset-right, 0) + 8px)`,
          left: `calc(env(safe-area-inset-left, 0) + 8px)`,
          transformOrigin: "bottom",
          pointerEvents: "none",
        }}
      >
        <Fade in={!props.expand} timeout={1000} unmountOnExit>
          <Card
            sx={{
              display: "flex",
              flexDirection: "column",

              backdropFilter: "blur(16px)",
              maxWidth: 480,
              backgroundColor: alpha(primaryBackgroundColor, 0.5),
              borderRadius: 4,
              m: "auto",
              pointerEvents: "auto",
            }}
            ref={cardRef}
          >
            <MiniPlayerContent
              activeTrack={activeTrack}
              coverUrl={coverUrl}
              title={title}
              onExpand={props.onExpand}
              coverRef={coverOnShrinkRef}
            />
          </Card>
        </Fade>
      </Box>

      <Box
        style={{
          // transform: props.expand ? "translateY(-50vh) scale(2)" : "scale(1)",
          transform: props.expand
            ? "none"
            : "perspective(160px) translateZ(-800px)",
        }}
        sx={{
          position: "fixed",
          transition: "transform 1s",

          bottom: 0,
          right: 0,
          left: 0,
          top: 0,
          transformOrigin: "bottom",
          pointerEvents: "none",
        }}
      >
        <Fade in={props.expand} timeout={1000} unmountOnExit>
          <Box
            sx={
              {
                //position: "fixed",
                //top: 0,
                //left: 0,
                //right: 0,
                //bottom: 0,
                //transformOrigin: "bottom",
              pointerEvents: "auto",
              }
            }
          >
            <FullPlayerContent
              onShrink={props.onShrink}
              coverRef={coverOnExpandRef}
              coverUrl={coverUrl}
            />
          </Box>
        </Fade>
      </Box>
    </div>
  )
}
