"use client"

import {
  AudioTrackFileItem,
  BaseFileItem,
  useFileStore,
} from "@/src/stores/file-store"
import { enqueueSnackbar } from "notistack"
import { Suspense, useEffect, useRef, useState } from "react"
import { FileList } from "@/src/components/file-list"
import { useParams } from "next/navigation"
import {
  AppBar,
  Backdrop,
  Box,
  CircularProgress,
  IconButton,
  ListItemIcon,
  ListItemText,
  Menu,
  MenuItem,
  Toolbar,
  Typography,
  alpha,
  useScrollTrigger,
  useTheme,
} from "@mui/material"
import {
  ArrowBack,
  DownloadForOffline,
  DownloadForOfflineOutlined,
  More,
  MoreVert,
  Download,
  FileDownload,
  CloudDownload,
  CloudOff,
} from "@mui/icons-material"
import { useRouter } from "@/src/router"
import { useThemeStore } from "@/src/stores/theme-store"
import {
  MaterialDynamicColors,
  hexFromArgb,
} from "@material/material-color-utilities"
import { useNetworkMonitor } from "@/src/stores/network-monitor"
import { MarqueeText } from "@/src/components/marquee-text"

function ElevationAppBar(props: { children: React.ReactElement }) {
  const theme = useTheme()
  const [themeStoreState] = useThemeStore()

  const trigger = useScrollTrigger({
    disableHysteresis: true,
    threshold: 0,
  })

  return (
    <AppBar
      sx={{
        backdropFilter: "blur(16px)",
        WebkitBackdropFilter: "blur(16px)",
        backgroundColor: alpha(
          hexFromArgb(
            MaterialDynamicColors.surfaceContainer.getArgb(
              themeStoreState.scheme
            )
          ),
          trigger ? 0.5 : 0
        ),
        transition: theme.transitions.create([
          "background-color",
          "backdrop-filter",
        ]),
      }}
      elevation={0}
    >
      {props.children}
    </AppBar>
  )
}

export default function Page() {
  const [fileStoreState, fileStoreActions] = useFileStore()
  const fileStoreActionsRef = useRef(fileStoreActions)
  fileStoreActionsRef.current = fileStoreActions

  const networkMonitor = useNetworkMonitor()

  const [currentFile, setCurrentFile] = useState<BaseFileItem | null>(null)
  const [files, setFiles] = useState<BaseFileItem[]>([])
  const [folderId, setFolderId] = useState<string | null>(null)
  const [anchorEl, setAnchorEl] = useState<null | HTMLElement>(null)

  const theme = useTheme()

  const [routerState, routerActions] = useRouter()
  const routerActionsRef = useRef(routerActions)
  routerActionsRef.current = routerActions

  useEffect(() => {
    routerActionsRef.current.goFile(window.location.hash.slice(1))
  }, [])
  useEffect(() => {
    setFolderId(routerState.currentFileId)
  }, [routerState.currentFileId])

  useEffect(() => {
    if (!fileStoreState.configured) {
      return
    }

    const getFiles = async () => {
      if (!folderId) {
        return
      }
      const currentFile = await fileStoreActionsRef.current.getFileById(
        folderId
      )
      setCurrentFile(currentFile)
      try {
        const files = await fileStoreActionsRef.current.getChildren(folderId)
        setFiles(files)
      } catch (error) {
        console.error(error)
        enqueueSnackbar(`${error}`, { variant: "error" })
      }
    }
    getFiles()
  }, [fileStoreState, folderId])

  const handleMoreClose = () => {
    setAnchorEl(null)
  }

  const handleDownload = async () => {
    handleMoreClose()

    const fileStoreAction = fileStoreActionsRef.current

    const audioFiles = files.filter(
      file => file.type === "audio-track"
    ) as AudioTrackFileItem[]
    audioFiles.forEach(async file => {
      try {
        await fileStoreAction.getTrackContent(file.id)
      } catch (error) {
        console.error(error)
        enqueueSnackbar(`${error}`, { variant: "error" })
      }
    })
    // fileStoreAction.getTrackContent()
  }

  return (
    <Box>
      <ElevationAppBar>
        <Toolbar>
          <IconButton
            size="large"
            edge="start"
            color="inherit"
            aria-label="menu"
            sx={{ mr: 2 }}
            onClick={() => {
              const parentId = currentFile?.parentId
              if (!parentId) {
                return
              }
              routerActions.goFile(parentId)
            }}
          >
            <ArrowBack />
          </IconButton>
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
          {Object.keys(fileStoreState.syncingTrackFiles).length > 0 ? (
            <CircularProgress size={24} />
          ) : null}
          <div>
            <IconButton
              color="inherit"
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
                <ListItemIcon>
                  {networkMonitor.isOnline ? <CloudDownload /> : <CloudOff />}
                </ListItemIcon>
                <ListItemText>Download</ListItemText>
              </MenuItem>
            </Menu>
          </div>
        </Toolbar>
      </ElevationAppBar>
      <FileList sx={{ mt: 5 }} files={files} />
    </Box>
  )
}
