"use client"

import { useFileStore } from "@/src/features/files"
import { enqueueSnackbar } from "notistack"
import { useEffect, useRef, useState } from "react"
import { FileList } from "@/src/features/files"
import { usePlayerStore } from "@/src/features/player"
import {
  Backdrop,
  Badge,
  Box,
  Button,
  CircularProgress,
  DialogActions,
  DialogContent,
  Fade,
  IconButton,
  LinearProgress,
  ListItemIcon,
  ListItemText,
  Menu,
  MenuItem,
  Toolbar,
  Typography,
} from "@mui/material"
import Dialog from "@mui/material/Dialog"
import DialogTitle from "@mui/material/DialogTitle"
import {
  ArrowBack,
  MoreVert,
  CloseRounded,
  CloudDownload,
  CloudOff,
  HomeRounded,
  SettingsRounded,
  FolderRounded,
  ArrowUpwardRounded,
  ChevronRightRounded,
  DriveFileRenameOutlineRounded,
  OpenInNewRounded,
} from "@mui/icons-material"
import { createPortal } from "react-dom"
import { useRouter } from "@/src/stores/router"
import { useThemeStore } from "@/src/stores/theme-store"
import {
  MaterialDynamicColors,
  hexFromArgb,
} from "@material/material-color-utilities"
import { useNetworkMonitor } from "@/src/stores/network-monitor"
import { MarqueeText } from "@/src/components/marquee-text"
import AppTopBar from "@/src/components/app-top-bar"
import DownloadingIndicator from "@/src/components/downloading-indicator"
import {
  AudioTrackFileItem,
  BaseFileItem,
  getGooglePickerMode,
  loadPendingFolderNameIds,
  setGooglePickerMode,
  useGoogleDrivePickFlow,
} from "@/src/features/files"
import { AddRounded } from "@mui/icons-material"
import { css } from "@emotion/react"

export default function GoogleDrivePage() {
  const [fileStoreState, fileStoreActions] = useFileStore()
  const [playerState, playerActions] = usePlayerStore()

  const networkMonitor = useNetworkMonitor()
  const scrollTargetRef = useRef<Node | undefined>(undefined)
  const [currentFile, setCurrentFile] = useState<BaseFileItem | null>(null)
  const [files, setFiles] = useState<BaseFileItem[] | undefined>([])
  const [folderId, setFolderId] = useState<string | undefined>(undefined)
  const [anchorEl, setAnchorEl] = useState<null | HTMLElement>(null)
  const [remoteFetching, setRemoteFetching] = useState(false)

  // Google Picker round-trip UI state. The round trip itself (leaving,
  // resuming, committing) lives in the pick-flow engine; this page only
  // renders its states and confirms the hand-offs.
  const [introOpen, setIntroOpen] = useState(false)
  const [retryPromptIds, setRetryPromptIds] = useState<string[] | null>(null)
  // Bumped to re-read the folder from IndexedDB. The picker flow resumes before
  // `folderId` is necessarily known, so it cannot refresh the list by closing
  // over it.
  const [localRefreshNonce, setLocalRefreshNonce] = useState(0)

  const {
    handoff,
    folderGrantPrompt,
    pendingFolderNameCount,
    inAppPicker,
    beginFilesPick,
    beginFolderGrant,
    skipFolderGrant,
    beginFolderNamesRetry,
    dismissStuck,
    retryStuck,
    cancelInAppPicker,
    keepWaitingInAppPicker,
  } = useGoogleDrivePickFlow({
    getReturnHref: () =>
      folderId ? `/files#${encodeURIComponent(folderId)}` : "/files",
    getPickerParentId: () =>
      folderId && folderId !== fileStoreState.rootFolderId
        ? folderId
        : undefined,
    onCommitted: () => setLocalRefreshNonce(n => n + 1),
  })

  // Which picker method is active - drives dialog copy only, so a mount-time
  // read is enough (changing it happens on the settings page or through the
  // in-page fallback below, which updates this state as well). Kept in state
  // rather than read during render because the static export renders without
  // localStorage.
  const [pickerModeIsInApp, setPickerModeIsInApp] = useState(false)
  useEffect(() => {
    setPickerModeIsInApp(getGooglePickerMode() === "in-app")
  }, [])

  // ESC closes the picker when focus is on our document. (While focus sits
  // inside Google's cross-origin iframe, key events never reach us - the
  // clickable escape chip is the reliable exit; this is just a convenience.)
  useEffect(() => {
    if (inAppPicker === null) return
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") cancelInAppPicker()
    }
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  }, [inAppPicker, cancelInAppPicker])

  const [themeStoreState] = useThemeStore()

  const [routerState, routerActions] = useRouter()
  const routerActionsRef = useRef(routerActions)
  routerActionsRef.current = routerActions

  useEffect(() => {
    if (routerState.pathname !== "/files") return
    const folderId = decodeURIComponent(routerState.hash.slice(1))
    setFolderId(folderId)
    setFiles(undefined)
  }, [routerState.hash, routerState.pathname])

  useEffect(() => {
    if (!fileStoreState.configured) {
      return
    }

    let isCancelled = false

    const getFiles = async () => {
      if (!folderId) {
        return
      }
      const currentFile = await fileStoreActions.getFileById(folderId)
      if (isCancelled) return
      if (!currentFile) return
      setCurrentFile(currentFile)

      try {
        const localFiles = await fileStoreActions.getChildrenLocal(folderId)
        if (isCancelled) return
        // console.log("LOCAL")
        if (localFiles) {
          setFiles(localFiles)
        }
      } catch (error) {
        console.error(error)
        enqueueSnackbar(`${error}`, { variant: "error" })
      }
    }
    getFiles()
    return () => {
      isCancelled = true
    }
  }, [fileStoreState.configured, folderId, localRefreshNonce])

  // Auto-sync from remote when online
  // Note: Excluded for root folder because:
  // - Root folder is a virtual folder (id: "root") that exists only in IndexedDB
  // - It doesn't exist on Google Drive API (actual Drive root has a different ID)
  // - Root content is built by addPickerGroup() when user selects files via Picker
  // - Calling getChildrenRemote("root") would query 'root' in parents, which returns empty/error
  useEffect(() => {
    if (fileStoreState.driveStatus != "online" || !folderId) {
      return
    }

    // Skip auto-sync for root folder (virtual folder, not on Google Drive)
    if (folderId === fileStoreState.rootFolderId) {
      console.log(`[Google Drive] Skipping auto-sync for virtual root folder`)
      return
    }

    let isCancelled = false

    const getFiles = async () => {
      try {
        setRemoteFetching(true)
        console.log(`[Google Drive] Auto-syncing folder from remote: ${folderId}`)
        const remoteFiles = await fileStoreActions.getChildrenRemote(folderId)
        if (isCancelled) return
        // console.log("REMOTE")
        if (remoteFiles) {
          setFiles(remoteFiles)
        }
        setRemoteFetching(false)
      } catch (error) {
        console.error(error)
        enqueueSnackbar(`${error}`, { variant: "error" })
        setRemoteFetching(false)
      }
    }
    getFiles()
    return () => {
      isCancelled = true
    }
  }, [fileStoreState.driveStatus, folderId])

  const handleMoreClose = () => {
    setAnchorEl(null)
  }

  const handleDownload = async () => {
    handleMoreClose()
    if (!files) return

    const fileStoreAction = fileStoreActions

    const audioFiles = files.filter(
      file => file.type === "audio-track"
    ) as AudioTrackFileItem[]
    audioFiles.forEach(async file => {
      try {
        await fileStoreAction.requestDownloadTrack(file.id)
      } catch (error) {
        console.error(error)
        enqueueSnackbar(`${error}`, { variant: "error" })
      }
    })
  }

  // --- Adding files via the Google Picker -----------------------------------
  //
  // The picker is a top-level navigation to Google, not a modal. The resumable
  // flow (ownership lock, watchdog, continuation) lives in
  // useGoogleDrivePickFlow; this page renders its dialogs and overlays.

  const handleAddFiles = () => {
    // The intro dialog exists to warn that the redirect method leaves the app;
    // the in-app picker never leaves, so it opens directly.
    if (getGooglePickerMode() === "in-app") {
      beginFilesPick()
      return
    }
    // Shown every time, not just once: the pick navigates away from the app, and
    // being thrown out to Google with no warning is disorienting however often
    // it happens. Because it repeats, the dialog has to stay short enough to
    // skim rather than read.
    setIntroOpen(true)
  }

  const handleRetryFolderNames = () => {
    handleMoreClose()
    const ids = loadPendingFolderNameIds()
    if (ids.length === 0) return
    // Confirm first: this also leaves the app for Google.
    setRetryPromptIds(ids)
  }

  const confirmRetryFolderNames = () => {
    const ids = retryPromptIds
    setRetryPromptIds(null)
    if (!ids || ids.length === 0) return
    beginFolderNamesRetry(ids)
  }

  const colorOnSurfaceVariant = hexFromArgb(
    MaterialDynamicColors.onSurfaceVariant.getArgb(themeStoreState.scheme)
  )

  const downloadingCount = Object.keys(fileStoreState.syncingTrackFiles).length

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
            color="inherit"
            // edge="start"
            sx={{ ml: -1 }}
            onClick={() => {
              routerActions.goHome()
            }}
          >
            <HomeRounded />
          </IconButton>

          {/* <ChevronRightRounded color="inherit" /> */}

          <Typography
            sx={{
              // mx: 1,
              color: colorOnSurfaceVariant,
            }}
          >
            /
          </Typography>

          <IconButton
            size="large"
            // edge="start"
            color="inherit"
            onClick={() => {
              if (!currentFile) return
              if (currentFile.id === fileStoreState.rootFolderId) {
                routerActions.goHome()
                return
              }

              const parentId = currentFile.parentId
              if (!parentId) {
                return
              }
              routerActions.goFile(parentId)
            }}
          >
            <ArrowUpwardRounded />
          </IconButton>
          <FolderRounded color="inherit" sx={{ mr: 1 }} />

          <MarqueeText
            variant="h6"
            sx={{
              whiteSpace: "nowrap",
              overflow: "hidden",
              textOverflow: "ellipsis",
              flexGrow: 1,
            }}
            text={currentFile?.name || "Files"}
          />
          {downloadingCount > 0 ? (
            <DownloadingIndicator
              count={downloadingCount}
              color={colorOnSurfaceVariant}
            />
          ) : null}
          <IconButton
            color="inherit"
            onClick={handleAddFiles}
            disabled={!networkMonitor.isOnline}
          >
            <AddRounded />
          </IconButton>
          <div>
            <IconButton
              color="inherit"
              edge="end"
              onClick={event => {
                setAnchorEl(event.currentTarget)
              }}
            >
              <MoreVert />
            </IconButton>
            <Menu
              anchorEl={anchorEl}
              keepMounted
              open={Boolean(anchorEl)}
              onClose={handleMoreClose}
            >
              {pendingFolderNameCount > 0 ? (
                <MenuItem
                  disabled={!networkMonitor.isOnline}
                  onClick={handleRetryFolderNames}
                >
                  <ListItemIcon sx={{ color: "inherit" }}>
                    <DriveFileRenameOutlineRounded />
                  </ListItemIcon>
                  <ListItemText>
                    {`Get folder names (${pendingFolderNameCount})`}
                  </ListItemText>
                </MenuItem>
              ) : null}
              <MenuItem
                disabled={!networkMonitor.isOnline}
                onClick={handleDownload}
              >
                <ListItemIcon sx={{ color: "inherit" }}>
                  {networkMonitor.isOnline ? <CloudDownload /> : <CloudOff />}
                </ListItemIcon>
                <ListItemText>Download</ListItemText>
              </MenuItem>
              {/* <Divider /> */}
              <MenuItem
                onClick={() => {
                  routerActionsRef.current.goSettings()
                }}
              >
                <ListItemIcon sx={{ color: "inherit" }}>
                  <SettingsRounded />
                </ListItemIcon>
                <ListItemText>Settings</ListItemText>
              </MenuItem>
            </Menu>
          </div>
        </Toolbar>
        <Fade
          in={remoteFetching}
          style={{
            transitionDelay: remoteFetching ? "800ms" : "0ms",
          }}
          unmountOnExit
        >
          <LinearProgress sx={{ width: "100%" }} />
        </Fade>
      </AppTopBar>
      <Box
        component="div"
        ref={scrollTargetRef}
        sx={{
          // mt: 8,
          pt: 8,
          ml: `env(safe-area-inset-left, 0)`,
          mr: `env(safe-area-inset-right, 0)`,
          overflow: "auto",
          height: "100%",
          scrollbarColor: `${colorOnSurfaceVariant} transparent`,
          scrollbarWidth: "thin",
          pb: `calc(env(safe-area-inset-bottom, 0) + 144px)`,
        }}
      >
        <FileList
          cssStyle={css({
            maxWidth: "1040px",
            margin: "0 auto",
            width: "100%",
          })}
          files={files}
          folderId={folderId}
          activeFileId={playerState.activeTrack?.file.id}
          onPlayTracks={playerActions.playTrack}
        />
      </Box>

      {/* Shown before every hand-off to Google, so it is built to be skimmed. */}
      <Dialog
        open={introOpen}
        onClose={() => setIntroOpen(false)}
        sx={{ "& .MuiDialog-paper": { borderRadius: "28px" } }}
      >
        <DialogTitle
          sx={{
            paddingTop: "24px",
            paddingLeft: "24px",
            paddingRight: "24px",
            paddingBottom: "16px",
          }}
        >
          Add music from Google Drive
        </DialogTitle>
        <DialogContent sx={{ paddingBottom: "24px" }}>
          <Typography>
            Picking files happens on Google&apos;s own page, so this app steps
            aside for a moment.
          </Typography>
          <Box
            component="ol"
            sx={{ mt: 2, mb: 0, pl: 3, "& li": { mb: 0.5 } }}
          >
            <Typography component="li">Google opens in this tab</Typography>
            <Typography component="li">
              Choose as many tracks as you like
            </Typography>
            <Typography component="li">
              You come back here and they are added
            </Typography>
          </Box>
          <Typography sx={{ mt: 2, color: colorOnSurfaceVariant }}>
            Google asks you to allow access each time you pick — that is normal.
          </Typography>
        </DialogContent>
        <DialogActions
          sx={{
            paddingTop: "0px",
            paddingBottom: "24px",
            paddingLeft: "24px",
            paddingRight: "24px",
          }}
        >
          <Button onClick={() => setIntroOpen(false)}>Cancel</Button>
          <Button
            autoFocus
            variant="contained"
            // The icon marks this as the button that leaves the app.
            endIcon={<OpenInNewRounded />}
            onClick={() => {
              setIntroOpen(false)
              beginFilesPick()
            }}
          >
            Continue
          </Button>
        </DialogActions>
      </Dialog>

      {/* Only appears when a picked track sits in a folder we cannot read. */}
      <Dialog
        open={folderGrantPrompt !== null}
        onClose={() => {}}
        sx={{ "& .MuiDialog-paper": { borderRadius: "28px" } }}
      >
        <DialogTitle
          sx={{
            paddingTop: "24px",
            paddingLeft: "24px",
            paddingRight: "24px",
            paddingBottom: "16px",
          }}
        >
          Allow the folders too
        </DialogTitle>
        <DialogContent sx={{ paddingBottom: "24px" }}>
          <Typography>
            {`Google grants access one item at a time, so allowing your tracks did not include the ${folderGrantPrompt?.pendingFolderIds.length ?? 0} folder${(folderGrantPrompt?.pendingFolderIds.length ?? 0) > 1 ? "s" : ""} they came from. Without that, they appear under a temporary name.`}
          </Typography>
          <Typography sx={{ mt: 2 }}>
            {pickerModeIsInApp
              ? "The picker opens once for each folder."
              : "This opens Google once more — you can select them all in one go."}
          </Typography>
          <Typography sx={{ mt: 2, color: colorOnSurfaceVariant }}>
            Skipping is fine. Your music is already saved, and you can pick the
            names up later from the menu.
          </Typography>
        </DialogContent>
        <DialogActions
          sx={{
            paddingTop: "0px",
            paddingBottom: "24px",
            paddingLeft: "24px",
            paddingRight: "24px",
          }}
        >
          <Button
            onClick={() => {
              if (!folderGrantPrompt) return
              void skipFolderGrant(folderGrantPrompt)
            }}
          >
            Skip
          </Button>
          <Button
            autoFocus
            variant="contained"
            endIcon={pickerModeIsInApp ? undefined : <OpenInNewRounded />}
            onClick={() => {
              if (!folderGrantPrompt) return
              beginFolderGrant(folderGrantPrompt)
            }}
          >
            Allow folders
          </Button>
        </DialogActions>
      </Dialog>

      {/* Confirms the second hand-off when the user retries from the menu. */}
      <Dialog
        open={retryPromptIds !== null}
        onClose={() => setRetryPromptIds(null)}
        sx={{ "& .MuiDialog-paper": { borderRadius: "28px" } }}
      >
        <DialogTitle
          sx={{
            paddingTop: "24px",
            paddingLeft: "24px",
            paddingRight: "24px",
            paddingBottom: "16px",
          }}
        >
          Get folder names
        </DialogTitle>
        <DialogContent sx={{ paddingBottom: "24px" }}>
          <Typography>
            {pickerModeIsInApp
              ? `The picker opens once for each of the ${retryPromptIds?.length ?? 0} folder${(retryPromptIds?.length ?? 0) > 1 ? "s" : ""}.`
              : `This opens Google so you can allow the ${retryPromptIds?.length ?? 0} folder${(retryPromptIds?.length ?? 0) > 1 ? "s" : ""}. You come back here automatically.`}
          </Typography>
        </DialogContent>
        <DialogActions
          sx={{
            paddingTop: "0px",
            paddingBottom: "24px",
            paddingLeft: "24px",
            paddingRight: "24px",
          }}
        >
          <Button onClick={() => setRetryPromptIds(null)}>Cancel</Button>
          <Button
            autoFocus
            variant="contained"
            endIcon={pickerModeIsInApp ? undefined : <OpenInNewRounded />}
            onClick={confirmRetryFolderNames}
          >
            Continue
          </Button>
        </DialogActions>
      </Dialog>

      {/* Appears when tapping Continue produced no navigation at all - seen on
          Android when the Google Drive app is installed but never set up. */}
      <Dialog
        open={handoff.phase === "stuck"}
        onClose={dismissStuck}
        sx={{ "& .MuiDialog-paper": { borderRadius: "28px" } }}
      >
        <DialogTitle
          sx={{
            paddingTop: "24px",
            paddingLeft: "24px",
            paddingRight: "24px",
            paddingBottom: "16px",
          }}
        >
          Couldn&apos;t open Google
        </DialogTitle>
        <DialogContent sx={{ paddingBottom: "24px" }}>
          <Typography>
            Nothing happened when this app tried to open Google.
          </Typography>
          <Typography sx={{ mt: 2, color: colorOnSurfaceVariant }}>
            If the Google Drive app is installed but has never been set up, it
            can block this. Open the Drive app once and sign in, then try
            again.
          </Typography>
        </DialogContent>
        <DialogActions
          sx={{
            paddingTop: "0px",
            paddingBottom: "24px",
            paddingLeft: "24px",
            paddingRight: "24px",
          }}
        >
          <Button onClick={dismissStuck}>Close</Button>
          <Button
            autoFocus
            variant="contained"
            endIcon={<OpenInNewRounded />}
            onClick={retryStuck}
          >
            Try again
          </Button>
        </DialogActions>
      </Dialog>

      {/* Escape hatch above the in-app picker: whatever state Google's iframe
          is in (including the iOS cookie dead-end), this stays reachable. */}
      {inAppPicker !== null &&
        createPortal(
          <Box
            component="div"
            sx={{
              position: "fixed",
              top: `calc(env(safe-area-inset-top, 0px) + 8px)`,
              right: `calc(env(safe-area-inset-right, 0px) + 8px)`,
              zIndex: 100000,
              display: "flex",
              alignItems: "center",
              gap: 1,
              px: 1.5,
              py: 0.5,
              borderRadius: "999px",
              backgroundColor: "rgba(0, 0, 0, 0.65)",
              color: "#fff",
            }}
          >
            <Typography variant="body2">{inAppPicker.label}</Typography>
            <IconButton
              size="small"
              aria-label="Close the picker"
              onClick={cancelInAppPicker}
              sx={{ color: "#fff" }}
            >
              <CloseRounded fontSize="small" />
            </IconButton>
          </Box>,
          document.body
        )}

      {/* The in-app picker never reported LOADED - almost always the iOS
          cookie wall. Offer the way out instead of a dead end. */}
      <Dialog
        open={inAppPicker?.loadWarning === true}
        onClose={keepWaitingInAppPicker}
        sx={{ zIndex: 100001, "& .MuiDialog-paper": { borderRadius: "28px" } }}
      >
        <DialogTitle
          sx={{
            paddingTop: "24px",
            paddingLeft: "24px",
            paddingRight: "24px",
            paddingBottom: "16px",
          }}
        >
          The picker didn&apos;t load
        </DialogTitle>
        <DialogContent sx={{ paddingBottom: "24px" }}>
          <Typography>
            Google&apos;s picker has not appeared. In the installed app on iOS
            this usually cannot be fixed — the picker needs cookies that the
            system blocks there.
          </Typography>
          <Typography sx={{ mt: 2, color: colorOnSurfaceVariant }}>
            The Google-page method works instead: it opens Google in this tab
            and brings you back.
          </Typography>
        </DialogContent>
        <DialogActions
          sx={{
            paddingTop: "0px",
            paddingBottom: "24px",
            paddingLeft: "24px",
            paddingRight: "24px",
          }}
        >
          <Button onClick={keepWaitingInAppPicker}>Keep waiting</Button>
          <Button onClick={cancelInAppPicker}>Close</Button>
          <Button
            variant="contained"
            endIcon={<OpenInNewRounded />}
            onClick={() => {
              cancelInAppPicker()
              setGooglePickerMode("redirect")
              setPickerModeIsInApp(false)
              setIntroOpen(true)
            }}
          >
            Use Google page
          </Button>
        </DialogActions>
      </Dialog>

      {(handoff.phase === "busy" || handoff.phase === "leaving") &&
        createPortal(
          <Backdrop
            sx={theme => ({
              zIndex: theme.zIndex.modal + 1,
              display: "flex",
              flexDirection: "column",
              gap: 2,
            })}
            open
          >
            <CircularProgress />
            <Typography>
              {handoff.phase === "busy" ? handoff.message : "Opening Google…"}
            </Typography>
          </Backdrop>,
          document.body
        )}
    </Box>
  )
}
