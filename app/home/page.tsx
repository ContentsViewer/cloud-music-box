"use client"

import { FileList } from "@/src/components/file-list"
import { useFileStore } from "@/src/stores/file-store"
import { Cloud, Login } from "@mui/icons-material"
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
} from "@mui/material"
import { useEffect } from "react"

const LoginPage = () => {
  const [fileStoreState] = useFileStore()

  const pca = fileStoreState.pca
  if (!pca) return null

  const accounts = pca.getAllAccounts()

  return (
    <Box>
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
        <List>
          {accounts.map(account => (
            <ListItemButton
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
              <Typography variant="body1" sx={{ flexGrow: 1 }}>
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

  useEffect(() => {
    if (fileStoreState.driveConfigureStatus !== "no-account") return
    console.log("no account")
  }, [fileStoreState])

  const driveConfigureStatus = fileStoreState.driveConfigureStatus

  return driveConfigureStatus ===
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
  )
}
