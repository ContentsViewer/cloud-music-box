'use client'

import { useAudioPlayer } from "@/src/audio/audio-player";
import { StatusBar } from "@/src/components/status-bar";
import { MiniPlayer } from "@/src/components/mini-player";
import { FileStoreProvider } from "@/src/stores/file-store";
import { PlayerStoreProvider } from "@/src/stores/player-store";
import { Box, CssBaseline } from "@mui/material";
import { SnackbarProvider } from "notistack";

export function AppLayout({ children }: { children: React.ReactNode }) {
  useAudioPlayer();

  return (
    <SnackbarProvider>
      <FileStoreProvider>
        <PlayerStoreProvider>
          <Box sx={{ display: 'flex', flexDirection: 'column', height: '100vh' }}>
            <StatusBar />
            <Box sx={{ flexGrow: 1, overflowY: 'auto' }}>{children}</Box>
            <MiniPlayer />
          </Box>
        </PlayerStoreProvider>
      </FileStoreProvider>
    </SnackbarProvider>
  );
}
