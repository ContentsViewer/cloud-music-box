/* eslint-disable @next/next/no-img-element */
"use client"

import AppTopBar from "@/src/components/app-top-bar"
import { useRouter } from "@/src/router"
import { useFileStore } from "@/src/stores/file-store"
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
  SxProps,
  Theme,
  List,
  ListItem,
  ListItemText,
} from "@mui/material"
import { useEffect, useRef, useState } from "react"

function formatBytes(bytes: number, decimals = 2) {
  if (bytes === 0) return "0 Bytes"

  const k = 1024
  const dm = decimals < 0 ? 0 : decimals
  const sizes = ["Bytes", "KB", "MB", "GB", "TB", "PB", "EB", "ZB", "YB"]

  const i = Math.floor(Math.log(bytes) / Math.log(k))

  return parseFloat((bytes / Math.pow(k, i)).toFixed(dm)) + " " + sizes[i]
}

interface StorageSettingsAreaProps {
  sx?: SxProps<Theme>
}

function StorageSettingsArea({ sx }: StorageSettingsAreaProps) {
  const [quota, setQuota] = useState<number | undefined>(undefined)
  const [usage, setUsage] = useState<number | undefined>(undefined)
  const [themeStoreState] = useThemeStore()

  const [fileStoreState, fileStoreActions] = useFileStore()

  async function getStorageInfo() {
    const { quota, usage } = await navigator.storage.estimate()
    setQuota(quota)
    setUsage(usage)
  }

  useEffect(() => {
    getStorageInfo()
  }, [])

  const { blobsStorageMaxBytes, blobsStorageUsageBytes } = fileStoreState

  const colorOnSurfaceVariant = hexFromArgb(
    MaterialDynamicColors.onSurfaceVariant.getArgb(themeStoreState.scheme)
  )

  return (
    <Box
      sx={{
        ...sx,
        display: "flex",
        flexDirection: "column",
      }}
    >
      <Typography variant="h6">Storage</Typography>
      <List>
        <ListItem>
          <ListItemText
            primary="Local File"
            secondary="Usage of downloaded audio files."
            secondaryTypographyProps={{
              sx: {
                color: colorOnSurfaceVariant,
              },
            }}
          />

          <Typography>
            {blobsStorageUsageBytes !== undefined
              ? formatBytes(blobsStorageUsageBytes)
              : "---"}
            {" / "}
            {blobsStorageMaxBytes !== undefined
              ? formatBytes(blobsStorageMaxBytes)
              : "---"}
          </Typography>
        </ListItem>
        <ListItem>
          <ListItemText
            primary="App"
            secondary="Usage of the entire application."
            secondaryTypographyProps={{
              sx: {
                color: colorOnSurfaceVariant,
              },
            }}
          />
          <Typography>
            {usage !== undefined ? formatBytes(usage) : "---"} {" / "}
            {quota !== undefined ? formatBytes(quota) : "---"}
          </Typography>
        </ListItem>
      </List>
    </Box>
  )
}

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
          ml: `env(safe-area-inset-left, 0)`,
          mr: `env(safe-area-inset-right, 0)`,
          px: 2,
        }}
      >
        <Box
          sx={{
            display: "flex",
            flexDirection: "column",
            maxWidth: "1040px",
            margin: "0 auto",
            width: "100%",
          }}
        >
          <StorageSettingsArea />
          <Typography variant="h6" sx={{ mt: 2 }}>
            About
          </Typography>
          <Paper
            sx={{
              p: 2,
              mt: 2,
              display: "flex",
              flexDirection: "column",
              alignItems: "center",
              backgroundColor: alpha(colorSurfaceContainer, 0.5),
              alignSelf: "center",
              width: "100%",
              maxWidth: "288px",
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
              version: {process.env.APP_VERSION}
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
                href="https://github.com/ContentsViewer/cloud-music-box"
                target="_blank"
                rel="noopener"
              >
                GitHub
              </Link>
            </Box>
          </Paper>
        </Box>
      </Box>
    </Box>
  )
}
