'use client'

import { AudioPlayer } from "@/src/audio/audio-player";
import { StatusBar } from "@/src/components/status-bar";
import { MiniPlayer } from "@/src/components/mini-player";
import { FileStoreProvider } from "@/src/stores/file-store";
import { PlayerStoreProvider, usePlayerStore } from "@/src/stores/player-store";
import { Box } from "@mui/material";
import { SnackbarProvider } from "notistack";
import { NetworkMonitorProvider } from "@/src/stores/network-monitor";
import { useEffect, useRef } from "react";
import { useThemeStore } from "@/src/stores/theme-store";
import * as mm from "music-metadata-browser";

const ThemeChanger = () => {
  const [playerState] = usePlayerStore();
  const [theme, themeActions] = useThemeStore();
  const themeActionsRef = useRef(themeActions);
  themeActionsRef.current = themeActions;

  useEffect(() => {
    if (!playerState.activeTrack) return;
    if (playerState.isActiveTrackLoading) return;

    console.log("AAAA")

    const cover = mm.selectCover(playerState.activeTrack.file.metadata?.common.picture);
    console.log("BBB", cover)
    if (cover) {

      const url = URL.createObjectURL(new Blob([cover.data], { type: cover.format }));

      themeActionsRef.current.applyThemeFromImage(url);

      return () => URL.revokeObjectURL(url);
    }

  }, [playerState.activeTrack, playerState.isActiveTrackLoading]);

  return null;
}

export function AppLayout({ children }: { children: React.ReactNode }) {
  useEffect(() => {

    if ('serviceWorker' in navigator) {
      window.addEventListener('load', () => {
        navigator.serviceWorker.register('./sw.js').then(registration => {
          console.log('SW registered: ', registration);
        }).catch(registrationError => {
          console.log('SW registration failed: ', registrationError);
        });
      });
    }
  })

  return (
    <SnackbarProvider
      anchorOrigin={{
        vertical: 'bottom',
        horizontal: 'left',
      }}
      classes={{
        containerAnchorOriginBottomLeft: 'snackbar-container'
      }}
    >
      <NetworkMonitorProvider>
        <FileStoreProvider>
          <PlayerStoreProvider>
            <ThemeChanger />
            <AudioPlayer />
            <StatusBar />
            <Box sx={{ flexGrow: 1, overflowY: 'auto', overflowX: 'hidden', mt: 4, mb: 10 }}>{children}</Box>
            <MiniPlayer sx={{ position: "fixed", bottom: 0, left: 0, right: 0 }} />
          </PlayerStoreProvider>
        </FileStoreProvider>
      </NetworkMonitorProvider>
    </SnackbarProvider>
  );
}
