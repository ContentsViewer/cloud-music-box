"use client"

import AppTopBar from "@/src/components/app-top-bar"
import { useRouter } from "@/src/stores/router"
import { useFileStore } from "@/src/features/files"
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
  QueueMusicRounded,
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
} from "@/src/features/files"
import { setDriveConfig } from "@/src/features/files"
import { createGoogleDriveClient } from "@/src/features/files"
import { pendingPickWorkHref } from "@/src/features/files"
import { InstallPromoCard } from "@/src/components/install-promo"

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
        flexDirection: "column",
        alignItems: "center",
      })}
    >
      {/* Install first is the loss-free order on iOS (a home-screen app's
          storage is separate from this tab), so the promotion banner sits
          above the sign-in card. The old 64px top margin doubles as its
          reserved slot: with no banner the sign-in card sits exactly where it
          always did, and a banner arriving later (Chromium fires
          beforeinstallprompt seconds in) barely moves it. */}
      <div
        css={css({
          minHeight: 64,
          alignSelf: "stretch",
          display: "flex",
          flexDirection: "column",
          justifyContent: "center",
        })}
      >
        {/* Width formula identical to the sign-in card below - one column,
            pixel-aligned at every viewport. 8px up to the app bar, 16px down
            to the sign-in card (standard surface separation). */}
        <InstallPromoCard
          signedIn={false}
          css={css({
            width: "80%",
            maxWidth: 400,
            margin: "8px auto 16px",
          })}
        />
      </div>
      <Paper
        sx={{
          maxWidth: 400,
          width: "80%",
          padding: 2,
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

  // A cold relaunch lands here (start_url) even when a picker round trip is
  // still waiting to be finished on the files page - route back to it so the
  // pick resumes instead of rotting until its TTL.
  useEffect(() => {
    const pendingHref = pendingPickWorkHref()
    if (pendingHref) {
      routerActionsRef.current.go(pendingHref)
    }
  }, [])

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
            {/* Banner spans the same 1040px content column as the grid, so
                its edges line up with the tiles. */}
            <InstallPromoCard
              signedIn
              css={css({
                width: "100%",
                maxWidth: "1040px",
                margin: "0 auto 16px",
              })}
            />
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
                  routerActionsRef.current.goPlaylist()
                }}
              >
                <Typography variant="h6">Playlists</Typography>
                <QueueMusicRounded fontSize="large"></QueueMusicRounded>
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
