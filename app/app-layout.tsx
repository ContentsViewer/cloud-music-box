"use client"

import { AudioPlayer } from "@/src/audio/audio-player"
import { PlayerCard } from "@/src/components/player-card"
import { FileStoreProvider } from "@/src/stores/file-store"
import { PlayerStoreProvider, usePlayerStore } from "@/src/stores/player-store"
import { DynamicBackground } from "@/src/components/dynamic-background"
import { Box, Fade, Button } from "@mui/material"
import {
  SnackbarKey,
  SnackbarProvider,
  closeSnackbar,
  enqueueSnackbar,
} from "notistack"
import { NetworkMonitorProvider } from "@/src/stores/network-monitor"
import { RouterProvider } from "@/src/router"
import { useEffect, useRef, useState } from "react"
import { useThemeStore } from "@/src/stores/theme-store"
import * as mm from "music-metadata-browser"
import { AudioDynamicsProvider } from "@/src/stores/audio-dynamics-store"
import { css } from "@emotion/css"
import { registerServiceWorker } from "./register-sw"
import { AudioDynamicsSettingsProvider, useAudioDynamicsSettingsStore } from "@/src/stores/audio-dynamics-settings"

const ThemeChanger = () => {
  const [playerState] = usePlayerStore()
  const [theme, themeActions] = useThemeStore()
  const themeActionsRef = useRef(themeActions)
  themeActionsRef.current = themeActions

  useEffect(() => {
    if (!playerState.activeTrack) return
    if (playerState.isActiveTrackLoading) return

    const cover = mm.selectCover(
      playerState.activeTrack.file.metadata?.common.picture
    )

    if (cover) {
      const blob = new Blob([cover.data], { type: cover.format })
      themeActionsRef.current.applyThemeFromImage(blob)
    } else {
      themeActionsRef.current.resetSourceColor()
    }
  }, [playerState.activeTrack, playerState.isActiveTrackLoading])

  return null
}

const AppMain = ({ children }: { children: React.ReactNode }) => {
  const [playerCardExpanded, setPlayerCardExpanded] = useState<boolean>(false)
  const snackbarContainerClass = css`
    margin-left: env(safe-area-inset-left, 0);
    margin-bottom: calc(
      env(safe-area-inset-bottom, 0) + ${playerCardExpanded ? "0" : "136"}px
    );
  `
  const [audioDynamicsSettings,] = useAudioDynamicsSettingsStore();

  return (
    <SnackbarProvider
      anchorOrigin={{
        vertical: "bottom",
        horizontal: "left",
      }}
      classes={{
        containerAnchorOriginBottomLeft: snackbarContainerClass,
      }}
    >
      <ThemeChanger />
      <DynamicBackground />
      <AudioPlayer />
      <Box
        component="div"
        sx={{
          height: "100%",
          width: "100%",
          position: "absolute",

          zIndex: audioDynamicsSettings.dynamicsEffectAppeal ? -1 : 0,
          opacity: audioDynamicsSettings.dynamicsEffectAppeal ? 0.4 : 1,
          scale: audioDynamicsSettings.dynamicsEffectAppeal ? "0.8" : "1",
          transition: "opacity 0.5s ease-in-out, scale 0.5s ease-in-out",
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
  const [audioDynamicsEffectAppeal, setAudioDynamicsEffectAppeal] =
    useState<boolean>(false)

  useEffect(() => {
    registerServiceWorker({
      onNeedRefresh: updateSW => {
        const action = (snackbarId: SnackbarKey) => {
          return (
            <>
              <Button
                onClick={() => {
                  updateSW()
                  closeSnackbar(snackbarId)
                }}
              >
                Reload
              </Button>
            </>
          )
        }
        enqueueSnackbar("A New Version is Available.", {
          variant: "info",
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
            <AudioDynamicsSettingsProvider>
              <AudioDynamicsProvider>
                <AppMain>{children}</AppMain>
              </AudioDynamicsProvider>
            </AudioDynamicsSettingsProvider>
          </PlayerStoreProvider>
        </FileStoreProvider>
      </NetworkMonitorProvider>
    </RouterProvider>
  )
}
