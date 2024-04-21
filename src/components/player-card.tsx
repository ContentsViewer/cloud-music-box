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
import { MouseEventHandler, useEffect, useMemo, useRef, useState } from "react"
import * as mm from "music-metadata-browser"
import { MarqueeText } from "./marquee-text"
import { useRouter } from "../router"
import { transform } from "next/dist/build/swc"

const TrackCover = (props: { coverUrl?: string; sx?: SxProps<Theme> }) => {
  return (
    <Avatar
      src={props.coverUrl}
      variant="rounded"
      sx={{
        width: 48,
        height: 48,
        borderRadius: "10%",
        ...props.sx,
      }}
    >
      {props.coverUrl ? null : <Audiotrack />}
    </Avatar>
  )
}

const TrackCoverPlaceholder = styled(Box)(({ theme }) => ({
  width: 48,
  height: 48,
}))

const SkipPreviousButton = ({
  onClick,
}: {
  onClick?: MouseEventHandler<HTMLButtonElement>
}) => {
  return (
    <IconButton onClick={onClick}>
      <SkipPreviousRounded />
    </IconButton>
  )
}

const SkipNextButton = ({
  onClick,
}: {
  onClick?: MouseEventHandler<HTMLButtonElement>
}) => {
  return (
    <IconButton onClick={onClick}>
      <SkipNextRounded />
    </IconButton>
  )
}

const PlayPauseButton = ({
  onClick,
  isPlaying,
  primaryColor,
  onPrimaryColor,
}: {
  onClick?: MouseEventHandler<HTMLButtonElement>
  isPlaying: boolean
  primaryColor: string
  onPrimaryColor: string
}) => {
  return (
    <IconButton
      size="large"
      sx={{
        backgroundColor: primaryColor,
        color: onPrimaryColor,
        "&:hover": {
          backgroundColor: primaryColor,
        },
      }}
      onClick={onClick}
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
        <Grow in={isPlaying} timeout={500} appear={false}>
          <StopRounded sx={{ fontSize: 32, position: "absolute" }} />
        </Grow>
        <Grow in={!isPlaying} timeout={500} appear={false}>
          <PlayArrowRounded sx={{ fontSize: 32, position: "absolute" }} />
        </Grow>
      </Box>
    </IconButton>
  )
}

interface MiniPlayerContentProps {
  activeTrack: AudioTrack | null
  title: string
  coverUrl?: string
  onExpand?: () => void
  sx?: SxProps<Theme>
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
  const primaryColor = hexFromArgb(
    MaterialDynamicColors.primary.getArgb(themeStoreState.scheme)
  )
  const onPrimaryColor = hexFromArgb(
    MaterialDynamicColors.onPrimary.getArgb(themeStoreState.scheme)
  )

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
      <TimelineSlider
        sx={{
          my: 1,
          mx: 4,
        }}
      />
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
          <TrackCover coverUrl={coverUrl} />
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
        <SkipPreviousButton
          onClick={() => {
            playerActions.playPreviousTrack()
          }}
        />
        <PlayPauseButton
          onClick={() => {
            if (playerState.isPlaying) {
              playerActions.pause()
            } else {
              playerActions.play()
            }
          }}
          isPlaying={playerState.isPlaying}
          primaryColor={primaryColor}
          onPrimaryColor={onPrimaryColor}
        />
        <SkipNextButton
          onClick={() => {
            playerActions.playNextTrack()
          }}
        />
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
  title: string
  activeTrack: AudioTrack | null
  coverRef?: React.RefObject<HTMLDivElement>
  coverUrl?: string
}

const FullPlayerContent = (props: FullPlayerContentProps) => {
  const { activeTrack } = props

  const [themeStoreState] = useThemeStore()
  const [playerState, playerActions] = usePlayerStore()
  const primaryColor = hexFromArgb(
    MaterialDynamicColors.primary.getArgb(themeStoreState.scheme)
  )
  const onPrimaryColor = hexFromArgb(
    MaterialDynamicColors.onPrimary.getArgb(themeStoreState.scheme)
  )

  return (
    <Box sx={{ width: "100%", height: "100%" }}>
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
      <Box
        sx={{
          display: "flex",
          "@media (orientation: portrait)": {
            flexDirection: "column",
          },
          "@media (orientation: landscape)": {
            flexDirection: "row",
          },
          alignItems: "center",
          justifyContent: "center",
          width: "100%",
          height: "100%",
        }}
      >
        <Box
          sx={{
            flexBasis: "50%",
            p: 5,
            pl: "calc(env(safe-area-inset-left, 0) + 40px)",
            boxSizing: "border-box",
            // position: "relative"
            height: "50%",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
          }}
        >
          <TrackCover
            sx={{
              // position: "absolute",
              // top: 0,
              // left: 0,
              // width: "100%",
              "@media (orientation: portrait)": {
                height: "100%",
                width: "auto",
              },
              "@media (orientation: landscape)": {
                width: "100%",
                height: "auto",
              },
              boxShadow: "0 8px 32px rgba(0, 0, 0, 0.25)",
              aspectRatio: "1 / 1",
              boxSizing: "border-box",
            }}
            coverUrl={props.coverUrl}
          />
        </Box>
        <Box
          sx={{
            flexBasis: "50%",
            display: "flex",
            flexDirection: "column",
            justifyContent: "center",
            // alignItems: "center",
            minWidth: 0,
            width: "100%",
            p: 5,
            pr: "calc(env(safe-area-inset-right, 0) + 40px)",
          }}
        >
          <MarqueeText text={props.title} variant="h5" />

          <MarqueeText
            text={activeTrack?.file.metadata?.common.artist || ""}
            variant="subtitle1"
          />

          <TimelineSlider sx={{ mt: 1 }} />
          <Box
            sx={{
              display: "flex",
              flexDirection: "row",
              alignItems: "center",
              justifyContent: "center",
            }}
          >
            <SkipPreviousButton
              onClick={() => {
                playerActions.playPreviousTrack()
              }}
            />
            <PlayPauseButton
              onClick={() => {
                if (playerState.isPlaying) {
                  playerActions.pause()
                } else {
                  playerActions.play()
                }
              }}
              isPlaying={playerState.isPlaying}
              primaryColor={primaryColor}
              onPrimaryColor={onPrimaryColor}
            />
            <SkipNextButton
              onClick={() => {
                playerActions.playNextTrack()
              }}
            />
          </Box>
        </Box>
      </Box>
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
              maxWidth: 640,
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
            sx={{
              //position: "fixed",
              //top: 0,
              //left: 0,
              //right: 0,
              //bottom: 0,
              //transformOrigin: "bottom",
              width: "100%",
              height: "100%",
              pointerEvents: "auto",
            }}
          >
            <FullPlayerContent
              onShrink={props.onShrink}
              coverRef={coverOnExpandRef}
              coverUrl={coverUrl}
              title={title}
              activeTrack={activeTrack}
            />
          </Box>
        </Fade>
      </Box>
    </div>
  )
}
