/* eslint-disable @next/next/no-img-element */
"use client"

import AppTopBar from "@/src/components/app-top-bar"
import { useRouter } from "@/src/router"
import { useThemeStore } from "@/src/stores/theme-store"
import {
  MaterialDynamicColors,
  hexFromArgb,
} from "@material/material-color-utilities"
import { ArrowBackRounded, SettingsRounded } from "@mui/icons-material"
import {
  Box,
  IconButton,
  Paper,
  Toolbar,
  Typography,
  alpha,
  Link,
} from "@mui/material"
import { useRef } from "react"

export default function Page() {
  const [routerState, routerActions] = useRouter()
  const routerActionsRef = useRef(routerActions)
  routerActionsRef.current = routerActions

  const [themeStoreState] = useThemeStore()

  const colorOnSurface = hexFromArgb(
    MaterialDynamicColors.onSurface.getArgb(themeStoreState.scheme)
  )
  const colorOnSurfaceVariant = hexFromArgb(
    MaterialDynamicColors.onSurfaceVariant.getArgb(themeStoreState.scheme)
  )
  const colorSurfaceContainer = hexFromArgb(
    MaterialDynamicColors.surfaceContainer.getArgb(themeStoreState.scheme)
  )
  // console.log(colorSurfaceContainer)

  return (
    <Box>
      <AppTopBar>
        <Toolbar>
          <IconButton
            size="large"
            edge="start"
            color="inherit"
            onClick={() => {
              routerActionsRef.current.goBack()
            }}
          >
            <ArrowBackRounded />
          </IconButton>
          <SettingsRounded />
          <Typography sx={{ mx: 1 }} variant="h6">
            Settings
          </Typography>
        </Toolbar>
      </AppTopBar>
      <Box sx={{ mt: 8 }} />

      <Box
        sx={{
          display: "flex",
          flexDirection: "column",
          ml: `env(safe-area-inset-left, 0)`,
          mr: `env(safe-area-inset-right, 0)`,
          px: 2,
        }}
      >
        <Typography variant="h6">About</Typography>
        <Paper
          sx={{
            p: 2,
            mt: 2,
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            backgroundColor: alpha(colorSurfaceContainer, 0.5),
            alignSelf: "center",
          }}
        >
          <Typography variant="body1" sx={{ fontWeight: "bold" }}>
            Cloud Music Box
          </Typography>
          <img
            style={{
              maxWidth: "256px",
              width: "100%",
              aspectRatio: "1/1",
            }}
            src="./icon-512x512.png"
            loading="lazy"
            alt="icon"
          />
          <Typography
            variant="body2"
            sx={{
              color: colorOnSurfaceVariant,
            }}
          >
            version: 0.0.1
          </Typography>
          <Typography
            variant="body2"
            sx={{
              color: colorOnSurfaceVariant,
            }}
          >
            © 2024- Cloud Music Box
          </Typography>
          <Box
            sx={{
              display: "flex",
              flexDirection: "row",
              gap: 1,
              width: "100%",
              justifyContent: "flex-end",
            }}
          >
            <Link
              variant="body2"
              href="https://contentsviewer.work"
              target="_blank"
              rel="noopener"
            >
              Home Page
            </Link>
            <Link
              variant="body2"
              href="https://github.com/ContentsViewer/cloud-music-client"
              target="_blank"
              rel="noopener"
            >
              GitHub
            </Link>
          </Box>
        </Paper>
      </Box>
    </Box>
  )
}
