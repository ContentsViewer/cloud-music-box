"use client"

import {
  PlayArrowRounded,
  SkipNextRounded,
  SkipPreviousRounded,
  StopRounded,
  Undo,
} from "@mui/icons-material"
import {
  Box,
  Card,
  Toolbar,
  Fade,
  Grow,
  IconButton,
  LinearProgress,
  SxProps,
  Theme,
  alpha,
  useTheme,
  ButtonBase,
  AppBar,
} from "@mui/material"
import { AudioTrack, usePlayerStore } from "../stores/player-store"
import { useThemeStore } from "../stores/theme-store"
import { TimelineSlider } from "./timeline-slider"
import {
  MaterialDynamicColors,
  hexFromArgb,
  Hct,
} from "@material/material-color-utilities"
import {
  memo,
  MouseEventHandler,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react"
import * as mm from "music-metadata-browser"
import { MarqueeText } from "./marquee-text"
import { useRouter } from "../router"
import { TrackCover } from "./track-cover"
import { useAudioDynamicsSettingsStore } from "../stores/audio-dynamics-settings"

const SkipPreviousButton = ({
  onClick,
  size = "medium",
}: {
  onClick?: MouseEventHandler<HTMLButtonElement>
  size?: "small" | "medium" | "large"
}) => {
  return (
    <IconButton onClick={onClick} size={size}>
      <SkipPreviousRounded fontSize="inherit" />
    </IconButton>
  )
}

const SkipNextButton = ({
  onClick,
  size = "medium",
}: {
  onClick?: MouseEventHandler<HTMLButtonElement>
  size?: "small" | "medium" | "large"
}) => {
  return (
    <IconButton onClick={onClick} size={size}>
      <SkipNextRounded fontSize="inherit" />
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
        component="div"
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

  const colorOnSurfaceVariant = hexFromArgb(
    MaterialDynamicColors.onSurfaceVariant.getArgb(themeStoreState.scheme)
  )
  const primaryColor = hexFromArgb(
    MaterialDynamicColors.primary.getArgb(themeStoreState.scheme)
  )
  const onPrimaryColor = hexFromArgb(
    MaterialDynamicColors.onPrimary.getArgb(themeStoreState.scheme)
  )

  const goBackEnabled = (() => {
    if (!playerState.playSourceUrl) return false
    if (
      `${routerState.pathname}${routerState.hash}` === playerState.playSourceUrl
    )
      return false
    return true
  })()

  return (
    <Box
      component="div"
      sx={{
        position: "relative",
        ...props.sx,
      }}
    >
      <Box
        component="div"
        sx={{ position: "absolute", top: 0, left: 0, right: 0 }}
      >
        {goBackEnabled ? (
          <IconButton
            size="small"
            onClick={() => {
              const sourceUrl = playerState.playSourceUrl
              if (!sourceUrl) return
              routerActions.go(sourceUrl)
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
        component="div"
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
            borderRadius: "10%",
          }}
          onClick={() => {
            if (onExpand) {
              onExpand()
            }
          }}
        >
          <TrackCover coverUrl={coverUrl} />
        </ButtonBase>
        <Box component="div" sx={{ flexGrow: 1, minWidth: "0" }}>
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
      <Box
        component="div"
        sx={{ position: "absolute", bottom: 0, left: 0, right: 0 }}
      >
        <Fade
          in={playerState.isActiveTrackLoading}
          style={{
            transitionDelay: playerState.isActiveTrackLoading ? "800ms" : "0ms",
          }}
          unmountOnExit
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
  const trackCoverWrapperRef = useRef<HTMLDivElement>(null)
  const trackCoverRef = useRef<HTMLDivElement>(null)

  const [audioDynamicsSettings, audioDynamicsSettingsActions] =
    useAudioDynamicsSettingsStore()

  useEffect(() => {
    const resizeObserver = new ResizeObserver(entries => {
      if (!trackCoverRef.current) return
      for (let entry of entries) {
        const { width, height } = entry.contentRect
        if (width < height) {
          trackCoverRef.current.style.width = "100%"
          trackCoverRef.current.style.height = "auto"
        } else {
          trackCoverRef.current.style.width = "auto"
          trackCoverRef.current.style.height = "100%"
        }
      }
    })

    if (trackCoverWrapperRef.current) {
      resizeObserver.observe(trackCoverWrapperRef.current)
    }

    return () => {
      resizeObserver.disconnect()
    }
  }, [])
  return (
    <Box component="div" sx={{ width: "100%", height: "100%" }}>
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
        component="div"
        sx={{
          display: "grid",
          "@media (orientation: portrait)": {
            // flexDirection: "column",
            // gridTemplateRows: "65% 35%",
            gridTemplateRows: "50% 50%",
          },
          "@media (orientation: landscape)": {
            // flexDirection: "row",
            gridTemplateColumns: "50% 50%",
          },
          // alignItems: "center",
          // justifyContent: "center",
          width: "100%",
          height: "100%",
        }}
      >
        <Box
          component="div"
          sx={{
            m: 5,
            boxSizing: "border-box",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            position: "relative",
            "@media (orientation: landscape)": {
              ml: "max(64px, env(safe-area-inset-left, 0))",
            },
            "@media (orientation: portrait)": {
              mt: 8,
            },
          }}
          ref={trackCoverWrapperRef}
        >
          <TrackCover
            sx={{
              position: "absolute",
              // maxWidth: "100%",
              aspectRatio: "1 / 1",
              width: "auto",
              height: "auto",

              boxShadow: "0 8px 32px rgba(0, 0, 0, 0.25)",
              boxSizing: "border-box",
            }}
            coverUrl={props.coverUrl}
            ref={trackCoverRef}
            onClick={() => {
              audioDynamicsSettingsActions.setDynamicsEffectAppeal(true)
            }}
          />
        </Box>
        <Box
          component="div"
          sx={{
            // flexBasis: "50%",
            display: "flex",
            flexDirection: "column",
            justifyContent: "center",
            minWidth: 0,
            // width: "100%",
            "@media (orientation: portrait)": {
              // alignSelf: "start",
              // alignSelf: "end",
              pb: 5,
              pr: "calc(env(safe-area-inset-right, 0) + 40px)",
              pl: "calc(env(safe-area-inset-left, 0) + 40px)",
            },
            "@media (orientation: landscape)": {
              pl: 0,
              pr: "max(64px, env(safe-area-inset-right, 0))",
            },
          }}
        >
          <MarqueeText
            text={props.title}
            variant="h4"
            typographySx={{
              fontWeight: "bold",
            }}
          />
          <MarqueeText
            text={activeTrack?.file.metadata?.common.artist || ""}
            variant="subtitle1"
          />

          <TimelineSlider sx={{ mt: 1 }} />
          <Box
            component="div"
            sx={{
              display: "flex",
              flexDirection: "row",
              alignItems: "center",
              justifyContent: "center",
              gap: 5,
            }}
          >
            <SkipPreviousButton
              onClick={() => {
                playerActions.playPreviousTrack()
              }}
              size="large"
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
              size="large"
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
  const [playerState] = usePlayerStore()

  const activeTrack = playerState.activeTrack

  return <PlayerCardInner {...props} activeTrack={activeTrack} />
}

interface PlayerCardInnerProps extends PlayerCardProps {
  activeTrack: AudioTrack | null
}

const PlayerCardInner = memo(function PlayerCardInner({
  activeTrack,
  ...props
}: PlayerCardInnerProps) {
  const [themeStoreState] = useThemeStore()
  const [coverUrl, setCoverUrl] = useState<string | undefined>(undefined)
  const cardRef = useRef<HTMLDivElement>(null)
  const coverOnExpandRef = useRef<HTMLDivElement>(null)

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
    <div>
      <Box
        component="div"
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
        component="div"
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
            component="div"
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
})
