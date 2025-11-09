"use client"

import AppTopBar from "@/src/components/app-top-bar"
import { useRouter } from "@/src/router"
import { useFileStore } from "@/src/stores/file-store"
import { useThemeStore } from "@/src/stores/theme-store"
import {
  MaterialDynamicColors,
  hexFromArgb,
} from "@material/material-color-utilities"
import {
  Add,
  AlbumRounded,
  Cloud,
  CloudCircle,
  FolderRounded,
  HomeRounded,
  Login,
  MoreVert,
  SettingsRounded,
} from "@mui/icons-material"
import {
  Avatar,
  Box,
  List,
  ListItemAvatar,
  ListItemButton,
  ListItemIcon,
  Paper,
  Typography,
  Toolbar,
  IconButton,
  Menu,
  MenuItem,
  ListItemText,
  Card,
  CardContent,
  CardActionArea,
  alpha,
  Backdrop,
  CircularProgress,
} from "@mui/material"
import { useEffect, useRef, useState, ReactNode, memo } from "react"
import { css } from "@emotion/react"
import DownloadingIndicator from "@/src/components/downloading-indicator"
import {
  createOneDriveClient,
  OneDriveClient,
} from "@/src/drive-clients/onedrive-client"
import { setDriveConfig } from "@/src/drive-clients/base-drive-client"
import { createGoogleDriveClient } from "@/src/drive-clients/google-drive-client"

const LoginPage = () => {
  const [loading, setLoading] = useState(false)

  const signInOneDrive = async () => {
    setLoading(true)
    setDriveConfig({
      type: "onedrive",
    })
    const driveClient = await createOneDriveClient()
    const pca = driveClient.pca
    pca.setActiveAccount(null)
    const loginRequest = {
      scopes: ["Files.Read", "Sites.Read.All"],
    }
    console.log(pca.getActiveAccount())
    pca.loginRedirect(loginRequest)
  }

  const signInGoogleDrive = async () => {
    setLoading(true)
    setDriveConfig({
      type: "google-drive",
    })
    const driveClient = await createGoogleDriveClient()
    await driveClient.loginRedirect()
  }

  return (
    <div
      css={css({
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        marginTop: 64,
      })}
    >
      <Paper
        sx={{
          maxWidth: 400,
          width: "80%",
          padding: 2,
          margin: "auto",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          flexDirection: "column",
          borderRadius: "12px",
        }}
      >
        <Cloud sx={{ fontSize: 100 }} />
        <Typography variant="h5">Sign in to Cloud Storage</Typography>
        <List sx={{ width: "100%" }}>
          <ListItemButton onClick={signInOneDrive}>
            <ListItemIcon>
              <Cloud />
            </ListItemIcon>

            <ListItemText primary="OneDrive" />

            <Login sx={{ ml: 1 }} />
          </ListItemButton>
          <ListItemButton onClick={signInGoogleDrive}>
            <ListItemIcon>
              <Cloud />
            </ListItemIcon>

            <ListItemText primary="GoogleDrive" />

            <Login sx={{ ml: 1 }} />
          </ListItemButton>
        </List>
      </Paper>
      <Backdrop
        open={loading}
        sx={{
          zIndex: theme => theme.zIndex.drawer + 1,
          display: "flex",
          flexDirection: "column",
        }}
      >
        <CircularProgress />
      </Backdrop>
    </div>
  )
}

const CardButton = memo(function CardButton({
  children,
  onClick = () => {},
}: {
  children?: ReactNode
  onClick: () => void
}) {
  const [themeStoreState] = useThemeStore()
  const colorSurfaceContainer = hexFromArgb(
    MaterialDynamicColors.surfaceContainerHighest.getArgb(
      themeStoreState.scheme
    )
  )
  return (
    <Card
      sx={{
        background: alpha(colorSurfaceContainer, 0.5),
        borderRadius: "12px",
      }}
    >
      <CardActionArea onClick={onClick}>
        <Box
          component="div"
          sx={{
            p: 2,
            display: "flex",
            flexDirection: "column",
            gap: 2,
            alignItems: "center",
          }}
        >
          {children}
        </Box>
      </CardActionArea>
    </Card>
  )
})

export default function Page() {
  const [fileStoreState] = useFileStore()

  const [routerState, routerActions] = useRouter()
  const routerActionsRef = useRef(routerActions)
  routerActionsRef.current = routerActions
  const [themeStoreState] = useThemeStore()

  const [anchorEl, setAnchorEl] = useState<null | HTMLElement>(null)
  const scrollTargetRef = useRef<Node | undefined>(undefined)

  const driveStatus = fileStoreState.driveStatus
  // console.log(driveStatus)

  const colorOnSurfaceVariant = hexFromArgb(
    MaterialDynamicColors.onSurfaceVariant.getArgb(themeStoreState.scheme)
  )

  const downloadingCount = Object.keys(fileStoreState.syncingTrackFiles).length

  return (
    <div
      css={css({
        height: "100%",
        overflow: "hidden",
      })}
    >
      <AppTopBar scrollTarget={scrollTargetRef.current}>
        <Toolbar>
          <HomeRounded />
          <Typography sx={{ mx: 1 }} variant="h6">
            Home
          </Typography>
          <Box component="div" sx={{ flexGrow: 1 }}></Box>
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
              onClose={() => {
                setAnchorEl(null)
              }}
            >
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
      </AppTopBar>
      <Box
        component="div"
        ref={scrollTargetRef}
        sx={{
          pt: 8,
          overflow: "auto",
          height: "100%",
          scrollbarColor: `${colorOnSurfaceVariant} transparent`,
          scrollbarWidth: "thin",
          pb: `calc(env(safe-area-inset-bottom, 0) + 144px)`,
        }}
      >
        {driveStatus === "not-configured" ? null : driveStatus ===
          "no-account" ? (
          <LoginPage />
        ) : (
          <Box
            component="div"
            sx={{
              ml: `env(safe-area-inset-left, 0)`,
              mr: `env(safe-area-inset-right, 0)`,
              px: 2,
            }}
          >
            <Box
              component="div"
              sx={{
                gap: 2,
                gridTemplateColumns: "repeat(auto-fill, minmax(144px, 1fr))",
                display: "grid",
                maxWidth: "1040px",
                margin: "0 auto",
                width: "100%",
              }}
            >
              <CardButton
                onClick={() => {
                  const rootFolderId = fileStoreState.rootFolderId
                  if (!rootFolderId) return
                  routerActionsRef.current.goFile(rootFolderId)
                }}
              >
                <Typography variant="h6">Files</Typography>
                <FolderRounded fontSize="large"></FolderRounded>
              </CardButton>

              <CardButton
                onClick={() => {
                  routerActionsRef.current.goAlbum()
                }}
              >
                <Typography variant="h6">Albums</Typography>
                <AlbumRounded fontSize="large"></AlbumRounded>
              </CardButton>

              <CardButton
                onClick={() => {
                  routerActionsRef.current.goSettings()
                }}
              >
                <Typography variant="h6">Settings</Typography>
                <SettingsRounded fontSize="large"></SettingsRounded>
              </CardButton>
            </Box>
          </Box>
        )}
      </Box>
    </div>
  )
}
