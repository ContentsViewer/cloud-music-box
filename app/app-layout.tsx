'use client'

import { AudioPlayer } from "@/src/audio/audio-player";
import { StatusBar } from "@/src/components/status-bar";
import { MiniPlayer } from "@/src/components/mini-player";
import { FileStoreProvider } from "@/src/stores/file-store";
import { PlayerStoreProvider } from "@/src/stores/player-store";
import { Box } from "@mui/material";
import { SnackbarProvider } from "notistack";
import { NetworkMonitorProvider } from "@/src/stores/network-monitor";

export function AppLayout({ children }: { children: React.ReactNode }) {
  return (
    <SnackbarProvider>
      <NetworkMonitorProvider>
        <FileStoreProvider>
          <PlayerStoreProvider>
            <AudioPlayer />
            <StatusBar />
            <Box sx={{ flexGrow: 1, overflowY: 'auto', overflowX: 'hidden', mt: 4, mb: 10}}>{children}</Box>
            <MiniPlayer sx={{ position: "fixed", bottom: 0 }} />
          </PlayerStoreProvider>
        </FileStoreProvider>
      </NetworkMonitorProvider>
    </SnackbarProvider>
  );
}
