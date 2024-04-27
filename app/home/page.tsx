"use client"

import AppTopBar from "@/src/components/app-top-bar"
import { FileList } from "@/src/components/file-list"
import { useRouter } from "@/src/router"
import { useFileStore } from "@/src/stores/file-store"
import {
  Cloud,
  HomeRounded,
  Login,
  MoreVert,
  Settings,
  SettingsRounded
} from "@mui/icons-material"
import {
  Avatar,
  Box,
  Button,
  List,
  ListItem,
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
} from "@mui/material"
import { useEffect, useRef, useState } from "react"

const LoginPage = () => {
  const [fileStoreState] = useFileStore()

  const pca = fileStoreState.pca
  if (!pca) return null

  const accounts = pca.getAllAccounts()

  return (
    <Box
      sx={{
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        mt: 8,
      }}
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
        }}
      >
        <Cloud sx={{ fontSize: 100 }} />
        <Typography variant="h5">Sign in to OneDrive</Typography>
        <List sx={{ width: "100%" }}>
          {accounts.map(account => (
            <ListItemButton
              sx={{ width: "100%" }}
              key={account.username}
              onClick={() => {
                const loginRequest = {
                  scopes: ["Files.Read", "Sites.Read.All"],
                  account: account,
                }
                pca.acquireTokenRedirect(loginRequest)
              }}
            >
              <ListItemAvatar>
                <Avatar />
              </ListItemAvatar>
              <Typography
                variant="body1"
                sx={{
                  flexGrow: 1,
                  whiteSpace: "nowrap",
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                }}
              >
                {account.username}
              </Typography>
              <Login sx={{ ml: 1 }} />
            </ListItemButton>
          ))}
          <ListItemButton
            onClick={() => {
              pca.setActiveAccount(null)
              const loginRequest = {
                scopes: ["Files.Read", "Sites.Read.All"],
              }
              console.log(pca.getActiveAccount())
              pca.loginRedirect(loginRequest)
            }}
          >
            <ListItemAvatar>
              <Avatar />
            </ListItemAvatar>
            <Typography variant="body1" sx={{ flexGrow: 1 }}>
              Add account
            </Typography>
            <Login sx={{ ml: 1 }} />
          </ListItemButton>
        </List>
      </Paper>
    </Box>
  )
}

export default function Page() {
  const [fileStoreState] = useFileStore()

  const [routerState, routerActions] = useRouter()
  const routerActionsRef = useRef(routerActions)
  routerActionsRef.current = routerActions

  const [anchorEl, setAnchorEl] = useState<null | HTMLElement>(null)

  useEffect(() => {
    if (fileStoreState.driveConfigureStatus !== "no-account") return
    console.log("no account")
  }, [fileStoreState])

  const driveConfigureStatus = fileStoreState.driveConfigureStatus

  return (
    <Box>
      <AppTopBar>
        <Toolbar>
          <HomeRounded />
          <Typography sx={{ mx: 1 }} variant="h6">
            Home
          </Typography>
          <Box sx={{ flexGrow: 1 }}></Box>
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
              onClose={() => {
                setAnchorEl(null)
              }}
            >
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
      </AppTopBar>
      <Box sx={{ mt: 8 }} />

      {driveConfigureStatus ===
      "not-configured" ? null : driveConfigureStatus === "no-account" ? (
        <LoginPage />
      ) : (
        <FileList
          files={fileStoreState.rootFiles}
          sx={{
            pl: `env(safe-area-inset-left, 0)`,
            pr: `env(safe-area-inset-right, 0)`,
          }}
        />
      )}
    </Box>
  )
}
