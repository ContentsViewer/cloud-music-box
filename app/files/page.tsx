"use client"

import {
  AudioTrackFileItem,
  BaseFileItem,
  useFileStore,
} from "@/src/stores/file-store"
import { enqueueSnackbar } from "notistack"
import { useEffect, useRef, useState } from "react"
import { FileList } from "@/src/components/file-list"
import {
  Badge,
  Box,
  Divider,
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
  ArrowDownward,
  HomeRounded,
  SettingsRounded,
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
import { removeListener } from "process"

export default function Page() {
  const [fileStoreState, fileStoreActions] = useFileStore()
  const fileStoreActionsRef = useRef(fileStoreActions)
  fileStoreActionsRef.current = fileStoreActions

  const networkMonitor = useNetworkMonitor()

  const [currentFile, setCurrentFile] = useState<BaseFileItem | null>(null)
  const [files, setFiles] = useState<BaseFileItem[] | undefined>([])
  const [folderId, setFolderId] = useState<string | null>(null)
  const [anchorEl, setAnchorEl] = useState<null | HTMLElement>(null)
  const [remoteFetching, setRemoteFetching] = useState(false)

  const [themeStoreState] = useThemeStore()

  const [routerState, routerActions] = useRouter()
  const routerActionsRef = useRef(routerActions)
  routerActionsRef.current = routerActions

  useEffect(() => {
    setFolderId(routerState.hash.slice(1))
    setFiles(undefined)
  }, [routerState.hash])

  useEffect(() => {
    if (!fileStoreState.configured) {
      return
    }

    let isCancelled = false

    const getFiles = async () => {
      if (!folderId) {
        return
      }
      const currentFile = await fileStoreActionsRef.current.getFileById(
        folderId
      )
      if (isCancelled) return
      if (!currentFile) return
      setCurrentFile(currentFile)

      try {
        const localFiles = await fileStoreActionsRef.current.getChildrenLocal(
          folderId
        )
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
    if (!fileStoreState.driveClient || !folderId) {
      return
    }

    let isCancelled = false

    const getFiles = async () => {
      try {
        setRemoteFetching(true)
        const remoteFiles = await fileStoreActionsRef.current.getChildrenRemote(
          folderId
        )
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
  }, [fileStoreState.driveClient, folderId])

  const handleMoreClose = () => {
    setAnchorEl(null)
  }

  const handleDownload = async () => {
    handleMoreClose()
    if (!files) return

    const fileStoreAction = fileStoreActionsRef.current

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

  return (
    <Box>
      <AppTopBar>
        <Toolbar>
          <IconButton
            size="large"
            edge="start"
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
            <ArrowBack />
          </IconButton>

          <IconButton
            onClick={() => {
              routerActions.goHome()
            }}
          >
            <HomeRounded />
          </IconButton>
          <Typography
            sx={{
              mx: 1,
              color: hexFromArgb(
                MaterialDynamicColors.onSurfaceVariant.getArgb(
                  themeStoreState.scheme
                )
              ),
            }}
          >
            /
          </Typography>
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
            <Box sx={{ position: "relative", mr: 1 }}>
              <Badge
                badgeContent={
                  <span
                    style={{
                      color: hexFromArgb(
                        MaterialDynamicColors.onSurfaceVariant.getArgb(
                          themeStoreState.scheme
                        )
                      ),
                    }}
                  >
                    {Object.keys(fileStoreState.syncingTrackFiles).length}
                  </span>
                }
              >
                <Box
                  sx={{
                    width: "20px",
                    height: "20px",
                    // clipPath: "polygon(50% 0%, 0% 100%, 100% 100%)",
                    clipPath: "inset(0 0 0 0)",
                  }}
                >
                  <ArrowDownward
                    fontSize="small"
                    color="disabled"
                    sx={{
                      animation: "down 2s linear infinite",
                      "@keyframes down": {
                        "0%": { transform: "translateY(-20px)" },
                        "50%": { transform: "translateY(0)" },
                        "100%": { transform: "translateY(20px)" },
                      },
                    }}
                  />
                </Box>
              </Badge>
            </Box>
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
              {/* <Divider /> */}
              <MenuItem
                onClick={() => {
                  routerActionsRef.current.goSettings()
                }}
              >
                <ListItemIcon>
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
        sx={{
          mt: 8,
          pl: `env(safe-area-inset-left, 0)`,
          pr: `env(safe-area-inset-right, 0)`,
        }}
      ></Box>
      <FileList
        sx={{ maxWidth: "1040px", margin: "0 auto", width: "100%" }}
        files={files}
      />
    </Box>
  )
}
