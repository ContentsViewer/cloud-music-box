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
  addPendingFolderNameIds,
  AudioTrackFileItem,
  BaseFileItem,
  clearPickSession,
  GoogleDriveClient,
  GooglePickerResult,
  loadPendingFolderNameIds,
  loadPickSession,
  PickSession,
  removePendingFolderNameIds,
  savePickSession,
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

  // Google Picker round-trip UI state
  const [introOpen, setIntroOpen] = useState(false)
  const [pickBusy, setPickBusy] = useState<string | null>(null)
  const [folderGrantPrompt, setFolderGrantPrompt] =
    useState<PickSession | null>(null)
  const [retryPromptIds, setRetryPromptIds] = useState<string[] | null>(null)
  const [pendingFolderNameCount, setPendingFolderNameCount] = useState(0)
  // Bumped to re-read the folder from IndexedDB. The picker flow resumes before
  // `folderId` is necessarily known, so it cannot refresh the list by closing
  // over it.
  const [localRefreshNonce, setLocalRefreshNonce] = useState(0)

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

  useEffect(() => {
    setPendingFolderNameCount(loadPendingFolderNameIds().length)
  }, [])

  // Picks up where we left off after coming back from Google. The redirect page
  // only records the outcome; the work happens here so progress and prompts show
  // up on the page the user started from.
  const resumeHandledRef = useRef(false)
  useEffect(() => {
    if (!fileStoreState.configured) return
    if (resumeHandledRef.current) return

    const session = loadPickSession()
    if (!session?.outcome) return

    resumeHandledRef.current = true
    resumePick(session)
  }, [fileStoreState.configured])

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
  // The picker is a top-level navigation to Google, not a modal, so this is a
  // resumable flow rather than a single async function:
  //   handleAddFiles -> (intro dialog) -> leave for Google -> come back
  //     -> resumePick -> (folder grant dialog) -> leave again -> come back
  //     -> resumePick -> finishPick
  // State that has to survive each hop lives in the pick session.

  const getGoogleDriveClient = (): GoogleDriveClient | undefined => {
    const driveClient = fileStoreState.driveClient
    if (!driveClient || !(driveClient as GoogleDriveClient).startFilesPick) {
      enqueueSnackbar("Drive client not connected", { variant: "error" })
      return undefined
    }
    return driveClient as GoogleDriveClient
  }

  const currentHref = () =>
    folderId ? `/files#${encodeURIComponent(folderId)}` : "/files"

  const leaveForFilesPick = () => {
    const client = getGoogleDriveClient()
    if (!client) return
    try {
      savePickSession({
        step: "files",
        startedAt: Date.now(),
        returnHref: currentHref(),
        files: [],
        folderNames: [],
        pendingFolderIds: [],
      })
      client.startFilesPick()
    } catch (error) {
      clearPickSession()
      console.error(error)
      enqueueSnackbar(`${error}`, { variant: "error" })
    }
  }

  const leaveForFolderGrant = (folderIds: string[], session: PickSession) => {
    const client = getGoogleDriveClient()
    if (!client) return
    try {
      savePickSession({ ...session, startedAt: Date.now(), outcome: undefined })
      client.startFolderGrant(folderIds)
    } catch (error) {
      console.error(error)
      enqueueSnackbar(`${error}`, { variant: "error" })
    }
  }

  const handleAddFiles = () => {
    // Shown every time, not just once: the pick navigates away from the app, and
    // being thrown out to Google with no warning is disorienting however often
    // it happens. Because it repeats, the dialog has to stay short enough to
    // skim rather than read.
    setIntroOpen(true)
  }

  const finishPick = async (
    picked: GooglePickerResult[],
    folderNames: Map<string, string>,
    unresolvedFolderIds: string[]
  ) => {
    if (picked.length > 0) {
      setPickBusy(`Adding ${picked.length} file${picked.length > 1 ? "s" : ""}…`)
      await fileStoreActions.addPickerGroup(picked, folderNames)
    }
    // Folders saved earlier under a placeholder keep that name, so apply the
    // real names explicitly.
    await fileStoreActions.updateFolderNames(folderNames)

    clearPickSession()
    removePendingFolderNameIds(Array.from(folderNames.keys()))
    addPendingFolderNameIds(unresolvedFolderIds)
    setPendingFolderNameCount(loadPendingFolderNameIds().length)

    if (picked.length > 0) {
      enqueueSnackbar(`Added ${picked.length} file${picked.length > 1 ? "s" : ""}`)
    } else if (folderNames.size > 0) {
      enqueueSnackbar(`Updated ${folderNames.size} folder name${folderNames.size > 1 ? "s" : ""}`)
    }

    setLocalRefreshNonce(n => n + 1)
  }

  const resumePick = async (session: PickSession) => {
    const outcome = session.outcome
    if (!outcome) return

    const client = getGoogleDriveClient()
    if (!client) {
      clearPickSession()
      return
    }

    try {
      if (session.step === "files") {
        if ("cancelled" in outcome) {
          clearPickSession()
          enqueueSnackbar("Cancelled adding files")
          return
        }

        setPickBusy(
          `Reading ${outcome.ids.length} selected item${outcome.ids.length > 1 ? "s" : ""}…`
        )
        // The picker only returns ids, so rebuild what the old in-page picker
        // used to hand back directly.
        const picked = await client.getFilesMetadata(outcome.ids)
        if (picked.length === 0) {
          clearPickSession()
          enqueueSnackbar("Could not read the selected files", {
            variant: "error",
          })
          return
        }

        const parentIds = Array.from(
          new Set(
            picked
              .map(f => f.parentId)
              .filter((id): id is string => id !== undefined)
          )
        )

        setPickBusy("Checking folders…")
        const folderNames = new Map<string, string>()
        const needAccess: string[] = []
        for (const parentId of parentIds) {
          const { hasAccess, folderName } = await client.checkFolderAccess(
            parentId
          )
          if (hasAccess && folderName) {
            folderNames.set(parentId, folderName)
          } else {
            needAccess.push(parentId)
          }
        }

        if (needAccess.length > 0) {
          // drive.file grants never cascade from a folder to its contents, so a
          // folder the user did not pick is unreadable - including its name.
          // Ask for those in one batch instead of stranding them on placeholders.
          const nextSession: PickSession = {
            ...session,
            step: "folders",
            files: picked,
            folderNames: Array.from(folderNames.entries()),
            pendingFolderIds: needAccess,
            outcome: undefined,
          }
          savePickSession(nextSession)
          setPickBusy(null)
          setFolderGrantPrompt(nextSession)
          return
        }

        await finishPick(picked, folderNames, [])
        return
      }

      // step === "folders"
      const folderNames = new Map(session.folderNames)
      if ("cancelled" in outcome) {
        // Nothing here is worth losing the user's tracks over: save them with
        // placeholder names and leave the retry available.
        await finishPick(session.files, folderNames, session.pendingFolderIds)
        if (session.pendingFolderIds.length > 0) {
          enqueueSnackbar("Saved with temporary folder names")
        }
        return
      }

      setPickBusy("Reading folder names…")
      const granted = await client.getFilesMetadata(outcome.ids)
      granted.forEach(g => folderNames.set(g.id, g.name))
      const stillMissing = session.pendingFolderIds.filter(
        id => !folderNames.has(id)
      )
      await finishPick(session.files, folderNames, stillMissing)
    } catch (error) {
      console.error(error)
      enqueueSnackbar(`${error}`, { variant: "error" })
      clearPickSession()
    } finally {
      setPickBusy(null)
    }
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
    leaveForFolderGrant(ids, {
      step: "folders",
      startedAt: Date.now(),
      returnHref: currentHref(),
      files: [],
      folderNames: [],
      pendingFolderIds: ids,
    })
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
              leaveForFilesPick()
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
            This opens Google once more — you can select them all in one go.
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
            onClick={async () => {
              const session = folderGrantPrompt
              setFolderGrantPrompt(null)
              if (!session) return
              setPickBusy("Saving…")
              try {
                await finishPick(
                  session.files,
                  new Map(session.folderNames),
                  session.pendingFolderIds
                )
                enqueueSnackbar("Saved with temporary folder names")
              } catch (error) {
                console.error(error)
                enqueueSnackbar(`${error}`, { variant: "error" })
                clearPickSession()
              } finally {
                setPickBusy(null)
              }
            }}
          >
            Skip
          </Button>
          <Button
            autoFocus
            variant="contained"
            endIcon={<OpenInNewRounded />}
            onClick={() => {
              const session = folderGrantPrompt
              setFolderGrantPrompt(null)
              if (!session) return
              leaveForFolderGrant(session.pendingFolderIds, session)
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
            {`This opens Google so you can allow the ${retryPromptIds?.length ?? 0} folder${(retryPromptIds?.length ?? 0) > 1 ? "s" : ""}. You come back here automatically.`}
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
            endIcon={<OpenInNewRounded />}
            onClick={confirmRetryFolderNames}
          >
            Continue
          </Button>
        </DialogActions>
      </Dialog>

      {pickBusy !== null &&
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
            <Typography>{pickBusy}</Typography>
          </Backdrop>,
          document.body
        )}
    </Box>
  )
}
