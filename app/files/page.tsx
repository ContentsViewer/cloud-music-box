"use client"

import { useFileStore } from "@/src/stores/file-store"
import { enqueueSnackbar } from "notistack"
import { useEffect, useRef, useState } from "react"
import { FileList } from "@/src/components/file-list"
import {
  Badge,
  Box,
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
} from "@mui/icons-material"
import { useRouter } from "@/src/router"
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
} from "@/src/drive-clients/base-drive-client"
import { SerializedStyles, css } from "@emotion/react"

export default function Page() {
  const [fileStoreState, fileStoreActions] = useFileStore()

  const networkMonitor = useNetworkMonitor()
  const scrollTargetRef = useRef<Node | undefined>(undefined)
  const [currentFile, setCurrentFile] = useState<BaseFileItem | null>(null)
  const [files, setFiles] = useState<BaseFileItem[] | undefined>([])
  const [folderId, setFolderId] = useState<string | undefined>(undefined)
  const [anchorEl, setAnchorEl] = useState<null | HTMLElement>(null)
  const [remoteFetching, setRemoteFetching] = useState(false)

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
  }, [fileStoreState.configured, folderId])

  useEffect(() => {
    if (fileStoreState.driveStatus != "online" || !folderId) {
      return
    }

    let isCancelled = false

    const getFiles = async () => {
      try {
        setRemoteFetching(true)
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
          cssStyle={css({ maxWidth: "1040px", margin: "0 auto", width: "100%" })}
          files={files}
          folderId={folderId}
        />
      </Box>
    </Box>
  )
}
