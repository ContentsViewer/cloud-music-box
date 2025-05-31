import { GoogleAuth, OAuth2Client } from "google-auth-library"
import { drive_v3, google } from "googleapis"
import {
  AUDIO_FORMAT_MAPPING,
  AudioTrackFileItem,
  BaseDriveClient,
  BaseFileItem,
  FileItem,
  FolderItem,
} from "./base-drive-client"
import { closeSnackbar, enqueueSnackbar, SnackbarKey } from "notistack"
import { Button } from "@mui/material"

export interface GoogleDriveClient extends BaseDriveClient {
  auth: OAuth2Client
  userInfo: any | undefined
  connect(): Promise<void>
}

const DB_KEY_USER_INFO = "googleDrive.userInfo"
const DB_KEY_TOKENS = "googleDrive.tokens"

export async function createGoogleDriveClient(): Promise<GoogleDriveClient> {
  console.log("createGoogleDriveClient")

  const auth = new OAuth2Client({
    clientId: process.env.NEXT_PUBLIC_GOOGLE_DRIVE_CLIENT_ID,
    clientSecret: "", // クライアントサイドでは不要
    redirectUri: `${window.location.origin}${
      process.env.NEXT_PUBLIC_BASE_PATH || ""
    }/redirect`,
  })

  let drive: drive_v3.Drive | undefined = undefined
  let userInfo: any | undefined = undefined
  let isConnected = false

  function createFileItemFromDriveItem(
    item: drive_v3.Schema$File
  ): BaseFileItem {
    if (item.mimeType === "application/vnd.google-apps.folder") {
      return {
        name: item.name || "",
        id: item.id || "",
        type: "folder",
        parentId: item.parents?.[0] || "",
      } as FolderItem
    }

    const ext = item.name?.split(".").pop()?.toLowerCase() || ""
    const audioMimeType = AUDIO_FORMAT_MAPPING[ext]?.mimeType

    if (audioMimeType !== undefined) {
      return {
        name: item.name || "",
        id: item.id || "",
        type: "audio-track",
        parentId: item.parents?.[0] || "",
        mimeType: audioMimeType,
      } as AudioTrackFileItem
    } else {
      return {
        name: item.name || "",
        id: item.id || "",
        type: "file",
        parentId: item.parents?.[0] || "",
      } as FileItem
    }
  }

  async function handleTokenRefresh(error: any) {
    if (error.status === 401 && userInfo) {
      try {
        const tokens = JSON.parse(localStorage.getItem(DB_KEY_TOKENS) || "{}")
        if (tokens.refresh_token) {
          auth.setCredentials(tokens)
          const { credentials } = await auth.refreshAccessToken()
          auth.setCredentials(credentials)
          localStorage.setItem(DB_KEY_TOKENS, JSON.stringify(credentials))

          // Initialize the Drive client with the new token
          drive = google.drive({ version: "v3", auth })

          console.log("Token refreshed successfully")
          return true
        }
      } catch (refreshError) {
        console.error("Token refresh failed:", refreshError)
        enqueueReauthorizeSnackbar()
        throw new Error("Drive requires reauthorization")
      }
    }
    return false
  }

  async function withAutoRefresh<T>(apiCall: () => Promise<T>): Promise<T> {
    try {
      return await apiCall()
    } catch (error: any) {
      console.warn("API call failed", error)
      if (await handleTokenRefresh(error)) {
        return await apiCall()
      }
      throw error
    }
  }

  const enqueueReauthorizeSnackbar = () => {
    const action = (snackbarId: SnackbarKey) => {
      return (
        <>
          <Button
            color="error"
            onClick={async () => {
              const authUrl = auth.generateAuthUrl({
                access_type: "offline",
                scope: ["https://www.googleapis.com/auth/drive.readonly"],
                prompt: "consent",
              })
              window.location.href = authUrl
              closeSnackbar(snackbarId)
            }}
          >
            Reauthorize
          </Button>
          <Button
            color="error"
            onClick={() => {
              closeSnackbar(snackbarId)
            }}
          >
            Dismiss
          </Button>
        </>
      )
    }

    enqueueSnackbar("Requires reauthorization to access Google Drive", {
      variant: "error",
      persist: true,
      action,
    })
  }

  const init = async () => {
    const userInfoJson = localStorage.getItem(DB_KEY_USER_INFO)
    if (userInfoJson) {
      userInfo = JSON.parse(userInfoJson)
    }

    const tokensJson = localStorage.getItem(DB_KEY_TOKENS)
    if (tokensJson) {
      const tokens = JSON.parse(tokensJson)
      auth.setCredentials(tokens)
    }

    // Handle OAuth redirect
    const urlParams = new URLSearchParams(window.location.search)
    const code = urlParams.get("code")
    if (code) {
      try {
        const { tokens } = await auth.getToken(code)
        auth.setCredentials(tokens)
        localStorage.setItem(DB_KEY_TOKENS, JSON.stringify(tokens))

        // Clear the code from URL
        window.history.replaceState(
          {},
          document.title,
          window.location.pathname
        )
      } catch (error) {
        console.error("OAuth token exchange failed:", error)
      }
    }
  }

  await init()

  return {
    auth,
    userInfo,
    async resetUser() {
      userInfo = undefined
      drive = undefined
      isConnected = false
      localStorage.removeItem(DB_KEY_USER_INFO)
      localStorage.removeItem(DB_KEY_TOKENS)
      auth.setCredentials({})
    },
    async connect() {
      const tokens = JSON.parse(localStorage.getItem(DB_KEY_TOKENS) || "{}")

      if (!tokens.access_token) {
        const authUrl = auth.generateAuthUrl({
          access_type: "offline",
          scope: ["https://www.googleapis.com/auth/drive.readonly"],
          prompt: "consent",
        })
        window.location.href = authUrl
        return
      }

      auth.setCredentials(tokens)
      drive = google.drive({ version: "v3", auth })

      // Get user info
      if (!userInfo) {
        try {
          const oauth2 = google.oauth2({ version: "v2", auth })
          const { data } = await oauth2.userinfo.get()
          userInfo = data
          localStorage.setItem(DB_KEY_USER_INFO, JSON.stringify(userInfo))
        } catch (error) {
          console.error("Failed to get user info:", error)
        }
      }

      isConnected = true
    },
    async getRootFolderId() {
      if (!drive) {
        throw new Error("Not connected")
      }
      return "root" // Google Drive uses 'root' as the root folder ID
    },
    async getFile(fileId: string) {
      if (!drive) {
        throw new Error("Not connected")
      }
      const response = await withAutoRefresh(() =>
        drive!.files.get({
          fileId,
          fields: "id,name,mimeType,parents",
        })
      )
      return createFileItemFromDriveItem(response.data)
    },
    async getChildren(folderId: string) {
      if (!drive) {
        throw new Error("Not connected")
      }

      const response = await withAutoRefresh(() =>
        drive!.files.list({
          q: `'${folderId}' in parents and trashed=false`,
          fields: "files(id,name,mimeType,parents)",
          pageSize: 1000,
        })
      )

      return (response.data.files || []).map(item =>
        createFileItemFromDriveItem(item)
      )
    },
    async fetchFileBlob(fileId: string) {
      if (!drive) {
        throw new Error("Not connected")
      }

      const response = await withAutoRefresh(() =>
        drive!.files.get(
          {
            fileId,
            alt: "media",
          },
          {
            responseType: "blob",
          }
        )
      )

      return response.data as Blob
    },
  }
}
