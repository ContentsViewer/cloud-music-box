/* eslint-disable @next/next/no-img-element */
"use client"

import AppTopBar from "@/src/components/app-top-bar"
import { useRouter } from "@/src/stores/router"
import {
  useAudioDynamicsSettingsStore,
  VisualizerType,
} from "@/src/stores/audio-dynamics-settings"
import {
  getDriveConfig,
  getGooglePickerMode,
  GooglePickerMode,
  setGooglePickerMode,
  useFileStore,
} from "@/src/features/files"
import { useThemeStore } from "@/src/stores/theme-store"
import {
  MaterialDynamicColors,
  hexFromArgb,
} from "@material/material-color-utilities"
import { ArrowBackRounded, Cloud, SettingsRounded } from "@mui/icons-material"
import {
  IconButton,
  Paper,
  Toolbar,
  Typography,
  alpha,
  Link,
  List,
  ListItem,
  ListItemIcon,
  ListItemText,
  ListItemButton,
  Button,
  DialogContent,
  DialogContentText,
  DialogActions,
  Backdrop,
  CircularProgress,
  Switch,
  FormControlLabel,
  Radio,
  RadioGroup,
} from "@mui/material"
import Dialog from "@mui/material/Dialog"
import DialogTitle from "@mui/material/DialogTitle"
import { enqueueSnackbar } from "notistack"
import { css } from "@emotion/react"
import { useInstallPrompt } from "@/src/hooks/use-install-prompt"
import {
  isTrackAnalysisEnabled,
  setTrackAnalysisEnabled,
  usePlaylistStore,
} from "@/src/features/playlists"
import { HowToInstallDialog } from "@/src/components/install-promo"
import { DataSettingsArea } from "./data-settings"
import {
  getControllerBuildInfo,
  readNavDiag,
  NavDiagEntry,
  SwBuildInfo,
} from "@/src/lib/sw-diag/nav-diag"

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

function StorageSettingsArea() {
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
    <div
      css={css({
        display: "flex",
        flexDirection: "column",
      })}
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
      >
        <DialogTitle>Clear Local Data</DialogTitle>
        <DialogContent>
          <DialogContentText>
            Clear the downloaded audio files. This action cannot be undone.
          </DialogContentText>
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
    </div>
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

function PlaylistSettingsArea() {
  const [themeStoreState] = useThemeStore()
  const [playlistState] = usePlaylistStore()
  const colorOnSurfaceVariant = hexFromArgb(
    MaterialDynamicColors.onSurfaceVariant.getArgb(themeStoreState.scheme)
  )
  // localStorage is read on the client only, so render the SSR default until
  // mounted to avoid a hydration mismatch (same trick as the visualizer area)
  const [mounted, setMounted] = useState(false)
  const [enabled, setEnabled] = useState(true)
  useEffect(() => {
    setMounted(true)
    setEnabled(isTrackAnalysisEnabled())
  }, [])

  return (
    <div
      css={css({
        display: "flex",
        flexDirection: "column",
        marginTop: "16px",
      })}
    >
      <Typography variant="h6">Playlists</Typography>
      <List>
        <ListItem>
          <ListItemText
            primary="Analyze played tracks"
            secondary={
              mounted
                ? `Describes each track as you listen so playlists can suggest similar ones. ${playlistState.analyzedTrackCount} analyzed so far.`
                : "Describes each track as you listen so playlists can suggest similar ones."
            }
            secondaryTypographyProps={{
              sx: {
                color: colorOnSurfaceVariant,
              },
            }}
          />
          <Switch
            checked={mounted ? enabled : true}
            edge="end"
            onChange={event => {
              setEnabled(event.target.checked)
              setTrackAnalysisEnabled(event.target.checked)
            }}
          />
        </ListItem>
      </List>
    </div>
  )
}

function VisualizerSettingsArea() {
  const [themeStoreState] = useThemeStore()
  const [audioDynamicsSettings, audioDynamicsSettingsActions] =
    useAudioDynamicsSettingsStore()
  const colorOnSurfaceVariant = hexFromArgb(
    MaterialDynamicColors.onSurfaceVariant.getArgb(themeStoreState.scheme)
  )
  // The settings store reads localStorage in its initializer, so the client's
  // first render can differ from the statically exported HTML (default
  // "lissajous"); showing the SSR default until mounted avoids the hydration
  // text mismatch
  const [mounted, setMounted] = useState(false)
  useEffect(() => setMounted(true), [])
  const [dialogOpen, setDialogOpen] = useState(false)

  const visualizerType = mounted
    ? audioDynamicsSettings.visualizerType
    : "lissajous"

  return (
    <div
      css={css({
        display: "flex",
        flexDirection: "column",
        marginTop: "16px",
      })}
    >
      <Typography variant="h6">Visualizer</Typography>
      <List>
        <ListItemButton onClick={() => setDialogOpen(true)}>
          <ListItemText
            primary="Type"
            secondary={
              visualizerType === "sparse-cortex" ? "Sparse Cortex" : "Lissajous"
            }
            secondaryTypographyProps={{
              sx: {
                color: colorOnSurfaceVariant,
              },
            }}
          />
        </ListItemButton>
      </List>
      <SettingsRadioDialog
        open={dialogOpen}
        title="Visualizer"
        value={visualizerType}
        options={[
          {
            value: "lissajous",
            label: "Lissajous",
            description:
              "A stream of nonlinear particles from the raw signal, driven by the dynamics and colored by the melody.",
          },
          {
            value: "sparse-cortex",
            label: "Sparse Cortex",
            description:
              "A learning particle field that organizes itself around the music.",
          },
        ]}
        onClose={() => setDialogOpen(false)}
        onSelect={next => {
          audioDynamicsSettingsActions.setVisualizerType(next as VisualizerType)
          setDialogOpen(false)
        }}
      />
    </div>
  )
}

interface SettingsRadioOption<T extends string> {
  value: T
  label: string
  description: string
}

// The Android ListPreference pattern (per MD3 / Android settings guidance):
// the list row shows only the current value; this dialog shows every option
// with its description so the trade-offs can be compared before choosing.
// Tapping a radio applies immediately and closes - there is no staged choice,
// so the only button is Cancel (the explicit close affordance on touch,
// where ESC does not exist and the back gesture is history navigation).
function SettingsRadioDialog<T extends string>({
  open,
  title,
  value,
  options,
  onClose,
  onSelect,
}: {
  open: boolean
  title: string
  value: T
  options: SettingsRadioOption<T>[]
  onClose: () => void
  onSelect: (value: T) => void
}) {
  const [themeStoreState] = useThemeStore()
  const colorOnSurfaceVariant = hexFromArgb(
    MaterialDynamicColors.onSurfaceVariant.getArgb(themeStoreState.scheme)
  )

  return (
    <Dialog open={open} onClose={onClose}>
      <DialogTitle>{title}</DialogTitle>
      {/* Radio rows carry their own bottom margin, so the content pane
          deliberately keeps less bottom padding than the MD3 default. */}
      <DialogContent sx={{ paddingBottom: "8px" }}>
        <RadioGroup
          value={value}
          onChange={event => onSelect(event.target.value as T)}
        >
          {options.map(option => (
            <FormControlLabel
              key={option.value}
              value={option.value}
              control={<Radio />}
              sx={{ alignItems: "flex-start", marginBottom: "12px", marginRight: 0 }}
              label={
                <div css={css({ paddingTop: "9px" })}>
                  <Typography>{option.label}</Typography>
                  <Typography
                    variant="body2"
                    sx={{ color: colorOnSurfaceVariant }}
                  >
                    {option.description}
                  </Typography>
                </div>
              }
            />
          ))}
        </RadioGroup>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>Cancel</Button>
      </DialogActions>
    </Dialog>
  )
}

function AccountSettingsArea() {
  const [themeStoreState] = useThemeStore()
  const [fileStoreState] = useFileStore()
  const colorOnSurfaceVariant = hexFromArgb(
    MaterialDynamicColors.onSurfaceVariant.getArgb(themeStoreState.scheme)
  )
  // The static export renders without localStorage, so the provider and the
  // current picker mode are read after mount (same hydration guard as the
  // other settings areas).
  const [providerType, setProviderType] = useState<
    "google-drive" | "onedrive" | undefined
  >(undefined)
  const [pickerMode, setPickerMode] = useState<GooglePickerMode>("redirect")
  const [pickerDialogOpen, setPickerDialogOpen] = useState(false)
  useEffect(() => {
    setProviderType(getDriveConfig()?.type)
    setPickerMode(getGooglePickerMode())
  }, [])

  if (!providerType) return null

  const signedIn =
    fileStoreState.driveStatus === "online" ||
    fileStoreState.driveStatus === "offline"

  return (
    <div
      css={css({
        display: "flex",
        flexDirection: "column",
        marginTop: "16px",
      })}
    >
      <Typography variant="h6">Account</Typography>
      <List>
        <ListItem>
          <ListItemIcon sx={{ color: "inherit" }}>
            <Cloud />
          </ListItemIcon>
          <ListItemText
            primary={providerType === "google-drive" ? "Google Drive" : "OneDrive"}
            secondary={signedIn ? "Signed in" : "Not signed in"}
            secondaryTypographyProps={{
              sx: {
                color: colorOnSurfaceVariant,
              },
            }}
          />
        </ListItem>
        {providerType === "google-drive" ? (
          <ListItemButton onClick={() => setPickerDialogOpen(true)}>
            <ListItemText
              primary="Add music using"
              secondary={pickerMode === "in-app" ? "In-app picker" : "Google page"}
              secondaryTypographyProps={{
                sx: {
                  color: colorOnSurfaceVariant,
                },
              }}
            />
          </ListItemButton>
        ) : null}
      </List>
      <SettingsRadioDialog
        open={pickerDialogOpen}
        title="Add music using"
        value={pickerMode}
        options={[
          {
            value: "redirect",
            label: "Google page",
            description:
              "Opens Google in this tab and comes back. Multi-select works everywhere; Google asks for consent each time.",
          },
          {
            value: "in-app",
            label: "In-app picker",
            description:
              "Stays inside the app; consent only once. On phones you pick one file at a time, and it may not load in the installed app on iOS.",
          },
        ]}
        onClose={() => setPickerDialogOpen(false)}
        onSelect={next => {
          setPickerMode(next)
          setGooglePickerMode(next)
          setPickerDialogOpen(false)
        }}
      />
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
      >
        <DialogTitle>Reset App</DialogTitle>
        <DialogContent>
          <DialogContentText>
            This will reset all settings and reload the app, including:
          </DialogContentText>
          <DialogContentText component="ul">
            <li>Clear cached local music data</li>
            <li>Sign out from connected cloud storage</li>
          </DialogContentText>
          <DialogContentText>This action cannot be undone.</DialogContentText>
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
                deleteReq.onblocked = () => resolve() // continue even when blocked
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

// Re-entry point for installing after the home-page card was dismissed, so
// this deliberately ignores the dismiss flag. Hidden entirely when no install
// path exists here: already installed / running standalone / no prompt event
// and no manual path (e.g. desktop Firefox).
function AppSettingsArea() {
  const [themeStoreState] = useThemeStore()
  const [fileStoreState] = useFileStore()
  const { canPrompt, canManualInstall, inBrowserTab, promptInstall } =
    useInstallPrompt()
  const [howToOpen, setHowToOpen] = useState(false)
  const colorOnSurfaceVariant = hexFromArgb(
    MaterialDynamicColors.onSurfaceVariant.getArgb(themeStoreState.scheme)
  )

  if (!inBrowserTab || (!canPrompt && !canManualInstall)) return null

  const signedIn =
    fileStoreState.driveStatus === "online" ||
    fileStoreState.driveStatus === "offline"

  return (
    <div
      css={css({
        display: "flex",
        flexDirection: "column",
        marginTop: "16px",
      })}
    >
      <Typography variant="h6">App</Typography>
      <List>
        <ListItemButton
          onClick={() => {
            if (canPrompt) {
              promptInstall()
            } else {
              setHowToOpen(true)
            }
          }}
        >
          <ListItemText
            primary="Install app"
            secondary="Works offline and keeps playing in the background."
            secondaryTypographyProps={{
              sx: {
                color: colorOnSurfaceVariant,
              },
            }}
          />
        </ListItemButton>
      </List>
      <HowToInstallDialog
        open={howToOpen}
        signedIn={signedIn}
        onClose={() => setHowToOpen(false)}
      />
    </div>
  )
}

// Read-only view of the update-window leak detectors (nav-diag ring buffer,
// SW build handshake, Stage-1 sw-diag cache). Exists so incidents can be
// inspected and copied on-device — including iOS, where no debugger is
// available. See docs/architecture.md "Service worker / static export".
function DiagnosticsSettingsArea() {
  const [themeStoreState] = useThemeStore()
  const [navEntries, setNavEntries] = useState<NavDiagEntry[]>([])
  const [swBuild, setSwBuild] = useState<
    SwBuildInfo | "timeout" | "no-controller" | null
  >(null)
  const [swWaiting, setSwWaiting] = useState(false)
  const [swDiag, setSwDiag] = useState<{ count: number; recent: unknown[] }>({
    count: 0,
    recent: [],
  })

  const colorError = hexFromArgb(
    MaterialDynamicColors.error.getArgb(themeStoreState.scheme)
  )
  const colorOnSurfaceVariant = hexFromArgb(
    MaterialDynamicColors.onSurfaceVariant.getArgb(themeStoreState.scheme)
  )

  useEffect(() => {
    setNavEntries(readNavDiag().slice().reverse())
    getControllerBuildInfo().then(setSwBuild)
    if ("serviceWorker" in navigator) {
      navigator.serviceWorker
        .getRegistration()
        .then(reg => setSwWaiting(!!reg?.waiting))
        .catch(() => {})
    }
    if ("caches" in window) {
      ;(async () => {
        try {
          if (!(await caches.has("sw-diag"))) return
          const cache = await caches.open("sw-diag")
          const keys = await cache.keys()
          const recent: unknown[] = []
          for (const key of keys.slice(-5)) {
            const res = await cache.match(key)
            if (res) recent.push(await res.json())
          }
          setSwDiag({ count: keys.length, recent })
        } catch {
          // read-only diagnostics
        }
      })()
    }
  }, [])

  const appVersion = process.env.APP_VERSION
  const swVersionText =
    swBuild === null
      ? "…"
      : swBuild === "no-controller"
        ? "no controller"
        : swBuild === "timeout"
          ? "no answer (pre-diagnostics SW?)"
          : `${swBuild.appVersion ?? "?"} (${swBuild.manifestRevision ?? "?"})`
  const crossBuildNow =
    typeof swBuild === "object" &&
    swBuild !== null &&
    swBuild.appVersion !== undefined &&
    swBuild.appVersion !== appVersion

  const copyAll = async () => {
    try {
      await navigator.clipboard.writeText(
        JSON.stringify(
          { t: Date.now(), appVersion, swBuild, swWaiting, navEntries, swDiag },
          null,
          2
        )
      )
      enqueueSnackbar("Diagnostics copied to clipboard")
    } catch {
      enqueueSnackbar("Could not copy diagnostics", { variant: "error" })
    }
  }

  const mono = css({
    fontFamily: "monospace",
    fontSize: 12,
    overflowWrap: "anywhere",
  })

  return (
    <div
      css={css({
        display: "flex",
        flexDirection: "column",
        marginTop: "16px",
      })}
    >
      <Typography variant="h6">Diagnostics</Typography>
      <List dense>
        <ListItem>
          <ListItemText
            primary={`App build: ${appVersion ?? "?"} / SW build: ${swVersionText}`}
            secondary={
              crossBuildNow
                ? "MISMATCH — page and service worker carry different builds"
                : swWaiting
                  ? "Update installed, waiting for reload"
                  : "Consistent"
            }
            secondaryTypographyProps={{
              sx: { color: crossBuildNow ? colorError : colorOnSurfaceVariant },
            }}
          />
        </ListItem>
        {navEntries.map(entry => {
          const flagged = entry.crossBuild || entry.bypassSuspect
          const flags = [
            entry.crossBuild ? "CROSS-BUILD" : null,
            entry.bypassSuspect ? "BYPASS?" : null,
            entry.bypassedRequests?.length
              ? `${entry.bypassedRequests.length} bypassed req`
              : null,
          ]
            .filter(Boolean)
            .join(" ")
          return (
            <ListItem key={entry.t} css={mono}>
              <ListItemText
                primary={`${new Date(entry.t).toLocaleString()}  v${entry.appVersion ?? "?"}  ${entry.path}`}
                secondary={
                  `${entry.navType ?? "?"}  controlled=${entry.controlled}  ` +
                  `workerStart=${entry.workerStart ?? "?"}  ` +
                  `sw=${
                    typeof entry.swBuild === "object"
                      ? (entry.swBuild.appVersion ?? "?")
                      : (entry.swBuild ?? "?")
                  }` +
                  (flags ? `  [${flags}]` : "") +
                  (entry.bypassedRequests?.length
                    ? ` ${entry.bypassedRequests.map(r => r.url).join(" ")}`
                    : "")
                }
                primaryTypographyProps={{ sx: { fontSize: 12 } }}
                secondaryTypographyProps={{
                  sx: {
                    fontSize: 12,
                    color: flagged ? colorError : colorOnSurfaceVariant,
                  },
                }}
              />
            </ListItem>
          )
        })}
        <ListItem>
          <ListItemText
            primary={`SW read failures recorded: ${swDiag.count}`}
            secondary={
              swDiag.recent.length > 0
                ? JSON.stringify(swDiag.recent)
                : "none"
            }
            primaryTypographyProps={{ sx: { fontSize: 12 } }}
            secondaryTypographyProps={{
              sx: {
                fontSize: 12,
                color:
                  swDiag.count > 0 ? colorError : colorOnSurfaceVariant,
                overflowWrap: "anywhere",
              },
            }}
          />
        </ListItem>
      </List>
      <Button onClick={copyAll} sx={{ alignSelf: "flex-start" }}>
        Copy diagnostics
      </Button>
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
    <div
      css={css({
        height: "100%",
        overflow: "hidden",
      })}
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
      <div
        ref={scrollTargetRef as unknown as React.Ref<HTMLDivElement>}
        css={css({
          marginLeft: `env(safe-area-inset-left, 0)`,
          marginRight: `env(safe-area-inset-right, 0)`,
          paddingLeft: "16px",
          paddingRight: "16px",
          paddingTop: "64px",
          overflow: "auto",
          height: "100%",
          scrollbarColor: `${colorOnSurfaceVariant} transparent`,
          scrollbarWidth: "thin",
          paddingBottom: `calc(env(safe-area-inset-bottom, 0) + 144px)`,
        })}
      >
        <div
          css={css({
            display: "flex",
            flexDirection: "column",
            maxWidth: "1040px",
            margin: "0 auto",
            width: "100%",
          })}
        >
          <AccountSettingsArea />
          <StorageSettingsArea />
          <ScreenSettingsArea />
          <PlaylistSettingsArea />
          <VisualizerSettingsArea />
          <DataSettingsArea />
          <ResetSettingsArea />
          <AppSettingsArea />
          <DiagnosticsSettingsArea />
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
              borderRadius: "12px",
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
            <div
              css={css({
                display: "flex",
                flexDirection: "row",
                gap: "8px",
                width: "100%",
                justifyContent: "flex-end",
              })}
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
            </div>
          </Paper>
          <div
            css={css({
              display: "flex",
              flexDirection: "column",
              // justifyContent: "center",
              marginTop: "128px",
              marginBottom: "32px",
              border: `1px solid ${colorOutlineVariant}`,
              borderRadius: "12px",
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
        </div>
      </div>
    </div>
  )
}
