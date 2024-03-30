'use client'

import { Inter } from "next/font/google";
import "./globals.css";
import { AppContextProvider } from '@/src/AppContext'
import { StatusBar } from '@/src/components/StatusBar'
import App from "next/app";
import { ThemeProvider } from '@mui/material/styles';
import theme from '@/src/theme';
import { AppRouterCacheProvider } from '@mui/material-nextjs/v13-appRouter';
import { Box, CssBaseline } from "@mui/material";
import { PlayerStoreProvider } from "@/src/stores/player-store";
import { MiniPlayer } from "@/src/components/mini-player";
import { FileStoreProvider } from "@/src/stores/file-store";
import { SnackbarProvider } from "notistack";

// const inter = Inter({ subsets: ["latin"] });


export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <head>
        <link rel="manifest" href="/manifest.json" />
      </head>
      <body>
        <AppRouterCacheProvider>
          <SnackbarProvider>
            <AppContextProvider>
              <FileStoreProvider>
                <PlayerStoreProvider>
                  <ThemeProvider theme={theme}>
                    <CssBaseline />
                    <Box sx={{ display: 'flex', flexDirection: 'column', height: '100vh' }}>
                      <StatusBar />
                      <Box sx={{ flexGrow: 1, overflowY: 'auto' }}>{children}</Box>
                      <MiniPlayer />
                    </Box>
                  </ThemeProvider>
                </PlayerStoreProvider>
              </FileStoreProvider>
            </AppContextProvider>
          </SnackbarProvider>
        </AppRouterCacheProvider>
      </body>
    </html>
  );
}
