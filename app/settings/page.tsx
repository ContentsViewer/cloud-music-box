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
  ListItemButton,
  Button,
  DialogContent,
  DialogActions,
  Backdrop,
  CircularProgress,
  Switch,
} from "@mui/material"
import Dialog from "@mui/material/Dialog"
import DialogTitle from "@mui/material/DialogTitle"
import { enqueueSnackbar } from "notistack"
import { css } from "@emotion/react"

import { useEffect, useRef, useState } from "react"
import { createPortal } from "react-dom"

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
  const [routerState, routerActions] = useRouter()

  const [fileStoreState, fileStoreActions] = useFileStore()
  const [clearLocalDataDialogOpen, setClearLocalDataDialogOpen] =
    useState(false)
  const [backdropOpen, setBackdropOpen] = useState(false)

  const handleCloseClearLocalDataDialog = () => {
    setClearLocalDataDialogOpen(false)
  }

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
      component="div"
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

      <Button
        variant="outlined"
        color="error"
        onClick={() => {
          setClearLocalDataDialogOpen(true)
        }}
      >
        Clear Local Data
      </Button>
      <Dialog
        open={clearLocalDataDialogOpen}
        onClose={handleCloseClearLocalDataDialog}
        sx={{ "& .MuiDialog-paper": { borderRadius: 3 } }}
      >
        <DialogTitle>Clear Local Data</DialogTitle>
        <DialogContent>
          <Typography>
            Clear the downloaded audio files. This action cannot be undone.
          </Typography>
        </DialogContent>
        <DialogActions>
          <Button autoFocus onClick={handleCloseClearLocalDataDialog}>
            Cancel
          </Button>
          <Button
            color="error"
            onClick={() => {
              setBackdropOpen(true)
              fileStoreActions
                .clearAllLocalBlobs()
                .then(() => {
                  routerActions.goHome({ reload: true })
                })
                .catch(error => {
                  console.error(error)
                  setBackdropOpen(false)
                })
            }}
          >
            Clear & Reload
          </Button>
        </DialogActions>
      </Dialog>
      {backdropOpen &&
        createPortal(
          <Backdrop
            sx={theme => ({ zIndex: theme.zIndex.modal + 1 })}
            open={backdropOpen}
          >
            <CircularProgress />
          </Backdrop>,
          document.body
        )}
    </Box>
  )
}

function ScreenSettingsArea() {
  const [themeStoreState] = useThemeStore()
  const colorOnSurfaceVariant = hexFromArgb(
    MaterialDynamicColors.onSurfaceVariant.getArgb(themeStoreState.scheme)
  )

  const [isFullScreen, setIsFullScreen] = useState(false)

  useEffect(() => {
    setIsFullScreen(!!document.fullscreenElement)
  }, [])

  const toggleFullScreen = () => {
    if (!document.fullscreenElement) {
      document.documentElement.requestFullscreen().catch(err => {
        console.error(
          `Error attempting to enable full-screen mode: ${err.message} (${err.name})`
        )
        enqueueSnackbar(
          `Error attempting to enable full-screen mode: ${err.message} (${err.name})`,
          { variant: "error" }
        )
      })
    } else {
      document.exitFullscreen()
    }
  }

  const handleFullScreenToggle = () => {
    toggleFullScreen()
    setIsFullScreen(!isFullScreen)
  }

  useEffect(() => {
    const handleFullScreenChange = () => {
      setIsFullScreen(!!document.fullscreenElement)
    }

    document.addEventListener("fullscreenchange", handleFullScreenChange)

    return () => {
      document.removeEventListener("fullscreenchange", handleFullScreenChange)
    }
  }, [])

  return (
    <div
      css={css({
        display: "flex",
        flexDirection: "column",
        marginTop: "16px",
      })}
    >
      <Typography variant="h6">Screen</Typography>
      <List>
        <ListItem>
          <ListItemText
            primary="Full Screen"
            secondary="Toggle full screen mode."
            secondaryTypographyProps={{
              sx: {
                color: colorOnSurfaceVariant,
              },
            }}
          />
          <Switch
            checked={isFullScreen}
            edge="end"
            onChange={handleFullScreenToggle}
          />
        </ListItem>
      </List>
    </div>
  )
}

function ResetSettingsArea() {
  const [resetAppDialogOpen, setResetAppDialogOpen] = useState(false)
  const [backdropOpen, setBackdropOpen] = useState(false)
  const [routerState, routerActions] = useRouter()
  const [fileStoreState, fileStoreActions] = useFileStore()

  return (
    <div
      css={css({
        display: "flex",
        flexDirection: "column",
        marginTop: "16px",
      })}
    >
      <Typography variant="h6">Reset</Typography>
      <List>
        <ListItem disablePadding>
          <ListItemButton
            onClick={() => {
              setResetAppDialogOpen(true)
            }}
          >
            <ListItemText
              primary="Reset App"
              secondary="Reset all settings and reload the app."
            />
          </ListItemButton>
        </ListItem>
      </List>
      <Dialog
        open={resetAppDialogOpen}
        onClose={() => {
          setResetAppDialogOpen(false)
        }}
        sx={{ "& .MuiDialog-paper": { borderRadius: 3 } }}
      >
        <DialogTitle>Reset App</DialogTitle>
        <DialogContent>
          <Typography>
            This will reset all settings and reload the app, including:
          </Typography>
          <ul>
            <li>Clear cached local music data</li>
            <li>Sign out from connected cloud storage</li>
          </ul>
          <Typography>This action cannot be undone.</Typography>
        </DialogContent>
        <DialogActions>
          <Button
            autoFocus
            onClick={() => {
              setResetAppDialogOpen(false)
            }}
          >
            Cancel
          </Button>
          <Button
            color="error"
            onClick={async () => {
              setBackdropOpen(true)
              localStorage.clear()

              sessionStorage.clear()

              const fileDb = fileStoreState.fileDb
              if (fileDb) {
                fileDb.close()
              }
              await new Promise<void>((resolve, reject) => {
                const deleteReq = indexedDB.deleteDatabase("file-db")
                deleteReq.onsuccess = () => resolve()
                deleteReq.onerror = () => reject(deleteReq.error)
                deleteReq.onblocked = () => resolve() // ブロック時も続行
              })

              // const databases = await indexedDB.databases()
              // await Promise.all(
              //   databases.map(db => {
              //     if (db.name) {
              //       return new Promise<void>((resolve, reject) => {
              //         const deleteReq = indexedDB.deleteDatabase(db.name!)
              //         deleteReq.onsuccess = () => resolve()
              //         deleteReq.onerror = () => reject(deleteReq.error)
              //       })
              //     }
              //   })
              // )
              routerActions.goHome({ reload: true })
            }}
          >
            Reset & Reload
          </Button>
        </DialogActions>
      </Dialog>
      {backdropOpen &&
        createPortal(
          <Backdrop
            sx={theme => ({ zIndex: theme.zIndex.modal + 1 })}
            open={backdropOpen}
          >
            <CircularProgress />
          </Backdrop>,
          document.body
        )}
    </div>
  )
}

export default function Page() {
  const [routerState, routerActions] = useRouter()
  const [themeStoreState] = useThemeStore()

  const scrollTargetRef = useRef<Node | undefined>(undefined)

  const colorOnSurface = hexFromArgb(
    MaterialDynamicColors.onSurface.getArgb(themeStoreState.scheme)
  )
  const colorOnSurfaceVariant = hexFromArgb(
    MaterialDynamicColors.onSurfaceVariant.getArgb(themeStoreState.scheme)
  )
  const colorSurfaceContainer = hexFromArgb(
    MaterialDynamicColors.surfaceContainer.getArgb(themeStoreState.scheme)
  )
  const colorOutlineVariant = hexFromArgb(
    MaterialDynamicColors.outlineVariant.getArgb(themeStoreState.scheme)
  )

  return (
    <Box
      component="div"
      sx={{
        height: "100%",
        overflow: "hidden",
      }}
    >
      <AppTopBar scrollTarget={scrollTargetRef.current}>
        <Toolbar>
          <IconButton
            size="large"
            edge="start"
            color="inherit"
            onClick={() => {
              routerActions.goBack()
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
      <Box
        component="div"
        ref={scrollTargetRef}
        sx={{
          ml: `env(safe-area-inset-left, 0)`,
          mr: `env(safe-area-inset-right, 0)`,
          px: 2,
          pt: 8,
          overflow: "auto",
          height: "100%",
          scrollbarColor: `${colorOnSurfaceVariant} transparent`,
          scrollbarWidth: "thin",
          pb: `calc(env(safe-area-inset-bottom, 0) + 144px)`,
        }}
      >
        <Box
          component="div"
          sx={{
            display: "flex",
            flexDirection: "column",
            maxWidth: "1040px",
            margin: "0 auto",
            width: "100%",
          }}
        >
          <StorageSettingsArea />
          <ScreenSettingsArea />
          <ResetSettingsArea />
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
              borderRadius: "24px",
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
              component="div"
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
                href="https://contentsviewer.work/Master/apps/cloud-music-box/docs"
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
          <div
            css={css({
              display: "flex",
              flexDirection: "column",
              // justifyContent: "center",
              marginTop: "128px",
              marginBottom: "32px",
              border: `1px solid ${colorOutlineVariant}`,
              borderRadius: "24px",
              padding: "16px",
              color: colorOnSurfaceVariant,
              alignSelf: "center",
            })}
          >
            <Typography variant="body2">
              If you like this app, please consider buying me a coffee.
              <br /> Thank you!
            </Typography>
            <div
              css={css({
                marginTop: "16px",
                display: "flex",
                justifyContent: "flex-end",
              })}
            >
              <a
                href="https://www.buymeacoffee.com/contentsviewer"
                target="_blank"
              >
                <img
                  src="https://cdn.buymeacoffee.com/buttons/v2/default-yellow.png"
                  alt="Buy Me A Coffee"
                  style={{ height: "60px", width: "217px" }}
                />
              </a>
            </div>
          </div>
        </Box>
      </Box>
    </Box>
  )
}
