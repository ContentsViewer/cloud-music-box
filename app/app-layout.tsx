"use client"

import { AudioPlayer } from "@/src/features/player"
import { PlayerCard } from "@/src/features/player"
import { FileStoreProvider } from "@/src/features/files"
import { PlayerStoreProvider, usePlayerStore } from "@/src/features/player"
import { DynamicBackground } from "@/src/features/visualizers"
import {
  PlaylistStoreProvider,
  TrackFeatureRecorder,
} from "@/src/features/playlists"
import { Box, Fade, Button, styled } from "@mui/material"
import {
  MaterialDesignContent,
  SnackbarKey,
  SnackbarProvider,
  closeSnackbar,
  enqueueSnackbar,
} from "notistack"
import { NetworkMonitorProvider } from "@/src/stores/network-monitor"
import { RouterProvider } from "@/src/stores/router"
import { useEffect, useRef, useState } from "react"
import { useThemeStore } from "@/src/stores/theme-store"
import * as mm from "music-metadata-browser"
import { AudioBusProvider } from "@/src/stores/audio-bus-provider"
import { css } from "@emotion/css"
import { registerServiceWorker } from "./register-sw"
// Side-effect import: beforeinstallprompt fires once per page load on
// whatever route the user landed on; the module-scope listener must be
// registered app-wide or the event is lost until the next full reload.
import "@/src/hooks/use-install-prompt"
import {
  AudioDynamicsSettingsProvider,
  useAudioDynamicsSettingsStore,
} from "@/src/stores/audio-dynamics-settings"
import {
  Hct,
  MaterialDynamicColors,
  hexFromArgb,
} from "@material/material-color-utilities"

const StyledMaterialDesignContent = styled(MaterialDesignContent)(() => {
  const [themeState] = useThemeStore()
  const sourceColor = themeState.sourceColor
  const surface = MaterialDynamicColors.inverseSurface.getArgb(
    themeState.scheme
  )
  const onSurface = MaterialDynamicColors.inverseOnSurface.getArgb(
    themeState.scheme
  )
  // console.log("!!!!", surface)
  // const surface = hexFromArgb(MaterialDynamicColors.errorContainer.getArgb(themeState.scheme))
  // const onSurface = hexFromArgb(MaterialDynamicColors.onErrorContainer.getArgb(themeState.scheme))
  // const errorSource = Hct.from(25, 100, 10).toInt()
  const errorSource = MaterialDynamicColors.error.getHct(themeState.scheme)

  // const errorSurface = hexFromArgb(Blend.harmonize(errorSource, sourceColor))
  // const errorOnSurface = hexFromArgb(Blend.harmonize(errorSource, sourceColor))
  const errorSurface = Hct.from(errorSource.hue, 10, 20).toInt()
  const errorOnSurface = Hct.from(errorSource.hue, 10, 80).toInt()
  // const errorSurface = TonalPalette.fromHct(errorSource).tone(40)
  // const errorOnSurface = TonalPalette.fromHct(errorSource).tone(90)
  return {
    "&.notistack-MuiContent-error": {
      backgroundColor: hexFromArgb(errorSurface),
      color: hexFromArgb(errorOnSurface),
    },
    "&.notistack-MuiContent-default": {
      backgroundColor: hexFromArgb(surface),
      color: hexFromArgb(onSurface),
    },
  }
})

const InverseColorButton = styled(Button)(() => {
  const [themeState] = useThemeStore()
  const colorPrimaryInverse = MaterialDynamicColors.inversePrimary.getArgb(
    themeState.scheme
  )
  return {
    color: hexFromArgb(colorPrimaryInverse),
  }
})

const ThemeChanger = () => {
  const [playerState] = usePlayerStore()
  const [, themeStoreActions] = useThemeStore()

  useEffect(() => {
    if (!playerState.activeTrack) return
    if (playerState.isActiveTrackLoading) return

    const cover = mm.selectCover(
      playerState.activeTrack.file.metadata?.common.picture
    )

    if (cover) {
      const blob = new Blob([cover.data], { type: cover.format })
      themeStoreActions.applyThemeFromImage(blob)
    } else {
      themeStoreActions.resetSourceColor()
    }
  }, [playerState.activeTrack, playerState.isActiveTrackLoading])

  return null
}

// The playlists feature does not import the player (only player → files is an
// allowed feature→feature edge), so the active track is wired in here — the same
// composition-at-the-page-layer rule as onPlayTracks.
const PlaylistTrackRecorder = () => {
  const [playerState] = usePlayerStore()
  const file = playerState.activeTrack?.file
  return (
    <TrackFeatureRecorder
      trackId={file?.id}
      durationSeconds={file?.metadata?.format.duration ?? playerState.duration}
    />
  )
}

const AppMain = ({ children }: { children: React.ReactNode }) => {
  const [playerCardExpanded, setPlayerCardExpanded] = useState<boolean>(false)
  const snackbarContainerClass = css`
    margin-left: env(safe-area-inset-left, 0);
    margin-bottom: calc(
      env(safe-area-inset-bottom, 0) + ${playerCardExpanded ? "0" : "136"}px
    );
  `
  const [audioDynamicsSettings] = useAudioDynamicsSettingsStore()

  return (
    <SnackbarProvider
      anchorOrigin={{
        vertical: "bottom",
        horizontal: "left",
      }}
      classes={{
        containerAnchorOriginBottomLeft: snackbarContainerClass,
      }}
      Components={{
        success: StyledMaterialDesignContent,
        error: StyledMaterialDesignContent,
        default: StyledMaterialDesignContent,
      }}
    >
      <ThemeChanger />
      <PlaylistTrackRecorder />
      <DynamicBackground />
      <AudioPlayer />
      <Box
        component="div"
        sx={{
          height: "100%",
          width: "100%",
          position: "absolute",

          zIndex: audioDynamicsSettings.dynamicsEffectAppeal ? -1 : 0,
          opacity: audioDynamicsSettings.dynamicsEffectAppeal ? 0.5 : 1,
          filter: audioDynamicsSettings.dynamicsEffectAppeal
            ? "blur(calc(1vmin + 5px))"
              // "blur(10px)"
            : "none",

          scale: audioDynamicsSettings.dynamicsEffectAppeal ? "0.9" : "1",
          transition: "opacity 0.5s ease-in-out, scale 0.5s ease-in-out",
          overflow: "hidden",
        }}
      >
        <Fade in={!playerCardExpanded} unmountOnExit>
          <Box
            component="div"
            sx={{
              // pb: `calc(env(safe-area-inset-bottom, 0) + 144px)`,
              height: "100%",
            }}
          >
            {children}
          </Box>
        </Fade>
        <PlayerCard
          expand={playerCardExpanded}
          onShrink={() => {
            setPlayerCardExpanded(false)
          }}
          onExpand={() => {
            setPlayerCardExpanded(true)
          }}
        />
      </Box>
    </SnackbarProvider>
  )
}

export function AppLayout({ children }: { children: React.ReactNode }) {
  useEffect(() => {
    registerServiceWorker({
      onNeedRefresh: updateSW => {
        const action = (snackbarId: SnackbarKey) => {
          return (
            <>
              <InverseColorButton
                onClick={() => {
                  updateSW()
                  closeSnackbar(snackbarId)
                }}
              >
                Reload
              </InverseColorButton>
            </>
          )
        }
        enqueueSnackbar("A New Version is Available.", {
          action,
          persist: true,
        })
      },
    })
  }, [])

  return (
    <RouterProvider>
      <NetworkMonitorProvider>
        <FileStoreProvider>
          <PlayerStoreProvider>
            <PlaylistStoreProvider>
              <AudioDynamicsSettingsProvider>
                <AudioBusProvider>
                  <AppMain>{children}</AppMain>
                </AudioBusProvider>
              </AudioDynamicsSettingsProvider>
            </PlaylistStoreProvider>
          </PlayerStoreProvider>
        </FileStoreProvider>
      </NetworkMonitorProvider>
    </RouterProvider>
  )
}
