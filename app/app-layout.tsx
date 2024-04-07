"use client"

import { AudioPlayer } from "@/src/audio/audio-player"
import { StatusBar } from "@/src/components/status-bar"
import { MiniPlayer } from "@/src/components/mini-player"
import { FileStoreProvider } from "@/src/stores/file-store"
import { PlayerStoreProvider, usePlayerStore } from "@/src/stores/player-store"
import { Box } from "@mui/material"
import { SnackbarProvider } from "notistack"
import { NetworkMonitorProvider } from "@/src/stores/network-monitor"
import { useEffect, useRef, useState } from "react"
import { useThemeStore } from "@/src/stores/theme-store"
import * as mm from "music-metadata-browser"
import {
  DynamicThemeStoreProvider,
  useDynamicThemeStore,
} from "@/src/stores/dynamic-theme-store"

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
      const url = URL.createObjectURL(
        new Blob([cover.data], { type: cover.format })
      )

      themeActionsRef.current.applyThemeFromImage(url)

      return () => URL.revokeObjectURL(url)
    }
  }, [playerState.activeTrack, playerState.isActiveTrackLoading])

  return null
}

const DynamicBackground = () => {
  const [dynamicThemeState] = useDynamicThemeStore()
  const [pitchColor, setPitchColor] = useState("transparent")

  const pitch = dynamicThemeState.pitch

  const noteFromPitch = (frequency: number) => {
    const noteNum = 12 * (Math.log(frequency / 440) / Math.log(2))
    return Math.round(noteNum) + 69
  }

  useEffect(() => {
    if (pitch === -1) return
    const note = noteFromPitch(pitch)
    setPitchColor(`hsl(${(note % 12) * 30}, 100%, 50%)`)
  }, [pitch])
  return (
    <div
      style={{
        // backgroundColor: `hsl(0 100% 50%)`,
        backgroundColor: pitchColor,
        width: "30vmax",
        height: "30vmax",
        borderRadius: "50%",
        mixBlendMode: 'screen',
        filter: "blur(30vmax)",
        transition: "background-color 1.0s",
        position: "fixed",
        // left: "80%",
        // top: "15%",
        top: 0,
        right: 0,
        opacity: 0.5,
        // transform: "translate(-50%, -50%)",
      }}
    ></div>
  )
}

export function AppLayout({ children }: { children: React.ReactNode }) {
  useEffect(() => {
    if ("serviceWorker" in navigator) {
      window.addEventListener("load", () => {
        navigator.serviceWorker
          .register("./sw.js")
          .then(registration => {
            console.log("SW registered: ", registration)
          })
          .catch(registrationError => {
            console.log("SW registration failed: ", registrationError)
          })
      })
    }
  })

  return (
    <SnackbarProvider
      anchorOrigin={{
        vertical: "bottom",
        horizontal: "left",
      }}
      classes={{
        containerAnchorOriginBottomLeft: "snackbar-container",
      }}
    >
      <NetworkMonitorProvider>
        <FileStoreProvider>
          <PlayerStoreProvider>
            <DynamicThemeStoreProvider>
              <ThemeChanger />
              <DynamicBackground />
              <AudioPlayer />
              {/* <StatusBar /> */}
              <Box
                sx={{
                  flexGrow: 1,
                  overflowY: "auto",
                  overflowX: "hidden",
                  mt: 4,
                  mb: 10,
                }}
              >
                {children}
              </Box>
              <MiniPlayer
                sx={{ position: "fixed", bottom: 0, left: 0, right: 0 }}
              />
            </DynamicThemeStoreProvider>
          </PlayerStoreProvider>
        </FileStoreProvider>
      </NetworkMonitorProvider>
    </SnackbarProvider>
  )
}
