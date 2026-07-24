// google-auth-library and googleapis imports removed
// import { GoogleAuth, OAuth2Client } from "google-auth-library"
// import { drive_v3, google } from "googleapis"

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

// Type definitions for Google Identity Services
declare global {
  interface Window {
    google: any
    gapi: typeof gapi
  }
}

export interface GooglePickerResult {
  id: string
  name: string
  mimeType: string
  parentId?: string
}

export interface GoogleDriveClient extends BaseDriveClient {
  loginRedirect(): Promise<void>
  saveAccessToken(token: string): void
  userInfo: any | undefined
  connect(): Promise<void>
  openFilesPicker(parentId?: string): Promise<GooglePickerResult[]>
  openFolderPicker(parentId: string): Promise<GooglePickerResult | null>
  checkFolderAccess(folderId: string): Promise<{ hasAccess: boolean; folderName?: string }>
}

const DB_KEY_USER_INFO = "googleDrive.userInfo"
const DB_KEY_ACCESS_TOKEN = "googleDrive.accessToken"
const DB_KEY_REFRESH_TOKEN = "googleDrive.refreshToken"
const DB_KEY_TOKEN_EXPIRES = "googleDrive.tokenExpires"

const GOOGLE_CLIENT_ID =
  "636784171461-qe09gc3cupq8iagds8hk16cb6k6cvle4.apps.googleusercontent.com"

// Developer Key (API Key) for the Google Picker API
const GOOGLE_DEVELOPER_KEY = "AIzaSyDnV3ERZBz85HEqzGKXWIoNw79YEC8MsYQ"

// Google Cloud Project number (App ID)
const GOOGLE_APP_ID = "636784171461"

export function saveAccessToken(token: string) {
  localStorage.setItem(DB_KEY_ACCESS_TOKEN, token)
}

export function saveUserInfo(userInfo: string) {
  localStorage.setItem(DB_KEY_USER_INFO, userInfo)
}

export async function createGoogleDriveClient(): Promise<GoogleDriveClient> {
  console.log("createGoogleDriveClient")

  const redirectUri = `${window.location.origin}${
    process.env.NEXT_PUBLIC_BASE_PATH || ""
  }/redirect/google-drive`

  let userInfo: string | undefined = undefined
  let accessToken: string | undefined = undefined
  let refreshToken: string | undefined = undefined

  // Dynamically load the Google API script
  const loadGoogleAPI = () => {
    return new Promise<void>(resolve => {
      if (window.gapi) {
        resolve()
        return
      }

      const script = document.createElement("script")
      script.src = "https://apis.google.com/js/api.js"
      script.onload = () => {
        window.gapi.load("client", async () => {
          // Initialize the GAPI client
          await window.gapi.client.init({
            discoveryDocs: [
              "https://www.googleapis.com/discovery/v1/apis/drive/v3/rest",
            ],
          })

          resolve()
        })
      }
      document.head.appendChild(script)
    })
  }

  // Load the Google Identity Services script
  const loadGoogleIdentity = () => {
    return new Promise<void>(resolve => {
      if (window.google?.accounts) {
        resolve()
        return
      }

      const script = document.createElement("script")
      script.src = "https://accounts.google.com/gsi/client"
      script.onload = () => resolve()
      document.head.appendChild(script)
    })
  }

  // Load the Google Picker API
  const loadGooglePicker = () => {
    return new Promise<void>(resolve => {
      if (window.google?.picker) {
        resolve()
        return
      }

      window.gapi.load("picker", () => {
        resolve()
      })
    })
  }

  const loginRedirectInternal = async () => {
    const params = new URLSearchParams({
      client_id: GOOGLE_CLIENT_ID,
      redirect_uri: redirectUri,
      response_type: "token id_token",
      scope: "https://www.googleapis.com/auth/drive.file",
      include_granted_scopes: "true", // reuse previously granted scopes
      // prompt: "consent", // to force the consent screen every time
      // prompt: "select_account", // to prompt for account selection
      // login_hint: "",
      nonce: Math.random().toString(36),
    })

    if (userInfo) {
      // Add a login hint when user info already exists
      params.append("login_hint", userInfo)
    } else {
      params.append("prompt", "select_account") // prompt for account selection
    }
    const authUrl = `https://accounts.google.com/o/oauth2/v2/auth?${params.toString()}`
    window.location.href = authUrl
    return
  }

  const enqueueSnackbarWithAction = () => {
    const action = (snackbarId: SnackbarKey) => {
      return (
        <>
          <Button
            color="error"
            onClick={() => {
              loginRedirectInternal()
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

    enqueueSnackbar("Requires reauthorization to access the drive", {
      variant: "error",
      persist: true,
      action,
    })
  }

  async function withAutoRefresh<T>(apiCall: () => Promise<T>): Promise<T> {
    try {
      return await apiCall()
    } catch (error: any) {
      console.warn("API call failed", error)
      if (error.status === 401 || error.status === 403) {
        enqueueSnackbarWithAction()
        throw new Error("Drive requires reauthorization")
      }
      throw error
    }
  }

  function createFileItemFromDriveItem(item: any): BaseFileItem {
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

  // // Refresh the access token using the refresh token
  // const refreshAccessToken = async (): Promise<string> => {
  //   if (!refreshToken) {
  //     throw new Error("No refresh token available")
  //   }

  //   const response = await fetch("https://oauth2.googleapis.com/token", {
  //     method: "POST",
  //     headers: {
  //       "Content-Type": "application/x-www-form-urlencoded",
  //     },
  //     body: new URLSearchParams({
  //       grant_type: "refresh_token",
  //       refresh_token: refreshToken,
  //       client_id: GOOGLE_CLIENT_ID,
  //     }),
  //   })

  //   if (!response.ok) {
  //     throw new Error(`Token refresh failed: ${response.statusText}`)
  //   }

  //   const tokenData = await response.json()

  //   if (tokenData.error) {
  //     throw new Error(`Token refresh error: ${tokenData.error}`)
  //   }

  //   accessToken = tokenData.access_token as string
  //   const expiresIn = tokenData.expires_in || 3600 // default 1 hour
  //   const expiresAt = Date.now() + expiresIn * 1000

  //   // Update when a new refresh token is present
  //   if (tokenData.refresh_token) {
  //     refreshToken = tokenData.refresh_token as string
  //     localStorage.setItem(DB_KEY_REFRESH_TOKEN, refreshToken)
  //   }

  //   localStorage.setItem(DB_KEY_ACCESS_TOKEN, accessToken)
  //   localStorage.setItem(DB_KEY_TOKEN_EXPIRES, expiresAt.toString())

  //   window.gapi.client.setToken({ access_token: accessToken })

  //   return accessToken
  // }

  // Check token validity
  const isTokenValid = (): boolean => {
    const expiresAt = localStorage.getItem(DB_KEY_TOKEN_EXPIRES)
    if (!expiresAt) return false

    // Keep a 5-minute margin (prompt re-auth with headroom)
    const marginMs = 5 * 60 * 1000
    return Date.now() < parseInt(expiresAt) - marginMs
  }

  const init = async () => {
    userInfo = localStorage.getItem(DB_KEY_USER_INFO) || undefined
    accessToken = localStorage.getItem(DB_KEY_ACCESS_TOKEN) || undefined
    refreshToken = localStorage.getItem(DB_KEY_REFRESH_TOKEN) || undefined

    console.log("Google Drive Client initialized", userInfo)
  }

  await init()

  return {
    userInfo,
    async resetUser() {
      userInfo = undefined
      accessToken = undefined
      localStorage.removeItem(DB_KEY_USER_INFO)
      localStorage.removeItem(DB_KEY_ACCESS_TOKEN)
      localStorage.removeItem(DB_KEY_TOKEN_EXPIRES)
      localStorage.removeItem(DB_KEY_REFRESH_TOKEN)
      window.gapi.client.setToken(null)
    },
    async loginRedirect() {
      await loginRedirectInternal()
    },
    saveAccessToken(token: string) {
      localStorage.setItem(DB_KEY_ACCESS_TOKEN, token)
    },
    async connect() {
      await loadGoogleAPI()

      if (!accessToken) {
        throw new Error("No access token available")
      }

      if (!window.gapi) {
        throw new Error("GAPI client not loaded")
      }
      window.gapi.client.setToken({ access_token: accessToken })
      // console.log("!!!!", gapi.client.getToken())
    },
    async openFilesPicker(parentId?: string): Promise<GooglePickerResult[]> {
      await loadGoogleAPI()
      await loadGooglePicker()

      if (!accessToken) {
        throw new Error("No access token available for Picker")
      }

      // Check token validity
      if (!isTokenValid()) {
        enqueueSnackbarWithAction()
        throw new Error("Access token expired, reauthorization required")
      }

      return new Promise((resolve, reject) => {
        try {
          // Configure DocsView to show folders too
          const docsView = new window.google.picker.DocsView()
            .setIncludeFolders(true)  // show folders
            .setParent(parentId || 'root')  // start from the given folder or the Drive root

          const picker = new window.google.picker.PickerBuilder()
            .addView(docsView)  // use the custom view
            .enableFeature(window.google.picker.Feature.MULTISELECT_ENABLED)  // enable multi-select
            .setOAuthToken(accessToken)
            .setDeveloperKey(GOOGLE_DEVELOPER_KEY)
            .setAppId(GOOGLE_APP_ID)  // set the project number (required for the drive.file scope)
            .setCallback((data: any) => {
              if (data.action === window.google.picker.Action.PICKED) {
                console.log("Picker data:", data)
                const results: GooglePickerResult[] = data.docs.map((doc: any) => {
                  return {
                    id: doc.id,
                    name: doc.name,
                    mimeType: doc.mimeType,
                    parentId: doc.parentId || doc.parents?.[0] || doc.parent || undefined,
                  }
                })
                resolve(results)
              } else if (data.action === window.google.picker.Action.CANCEL) {
                resolve([])
              }
            })
            .build()
          picker.setVisible(true)
        } catch (error) {
          reject(error)
        }
      })
    },
    async openFolderPicker(parentId: string): Promise<GooglePickerResult | null> {
      await loadGoogleAPI()
      await loadGooglePicker()

      if (!accessToken) {
        throw new Error("No access token available for Picker")
      }

      // Check token validity
      if (!isTokenValid()) {
        enqueueSnackbarWithAction()
        throw new Error("Access token expired, reauthorization required")
      }

      return new Promise((resolve, reject) => {
        try {
          // DocsView restricted to folder selection
          const docsView = new window.google.picker.DocsView()
            .setIncludeFolders(true)
            .setMimeTypes('application/vnd.google-apps.folder')
            .setSelectFolderEnabled(true)

          // Pass setFileIds() as a string
          // Note: cannot be combined with setParent() (setFileIds overrides it)
          console.log("Setting fileIds (string format):", parentId)
          docsView.setFileIds(parentId)  // passed as a string

          const picker = new window.google.picker.PickerBuilder()
            .addView(docsView)
            .setOAuthToken(accessToken)
            .setDeveloperKey(GOOGLE_DEVELOPER_KEY)
            .setAppId(GOOGLE_APP_ID)
            .setTitle(`Select the folder to grant access`)
            .setCallback((data: any) => {
              if (data.action === window.google.picker.Action.PICKED) {
                const folder = data.docs[0]
                console.log("Folder selected:", folder)

                // Check whether the selected folder is the target folder
                if (folder.id === parentId) {
                  console.log("✅ Correct folder selected!")
                } else {
                  console.warn("⚠️ Different folder selected. Expected:", parentId, "Got:", folder.id)
                }

                resolve({
                  id: folder.id,
                  name: folder.name,
                  mimeType: folder.mimeType,
                  parentId: folder.parentId || folder.parents?.[0] || undefined,
                })
              } else if (data.action === window.google.picker.Action.CANCEL) {
                resolve(null)
              }
            })
            .build()
          picker.setVisible(true)
        } catch (error) {
          reject(error)
        }
      })
    },
    async checkFolderAccess(folderId: string): Promise<{ hasAccess: boolean; folderName?: string }> {
      try {
        const response = await fetch(
          `https://www.googleapis.com/drive/v3/files/${folderId}?fields=name`,
          {
            headers: {
              Authorization: `Bearer ${accessToken}`,
            },
          }
        )

        if (response.ok) {
          const data = await response.json()
          return { hasAccess: true, folderName: data.name }
        } else if (response.status === 401 || response.status === 403) {
          // Token is invalid
          console.warn("Token invalid (401/403), requesting reauthorization")
          enqueueSnackbarWithAction()
          return { hasAccess: false }
        } else if (response.status === 404) {
          // No access permission
          return { hasAccess: false }
        } else {
          throw new Error(`Failed to check folder access: ${response.statusText}`)
        }
      } catch (error) {
        console.error("Error checking folder access:", error)
        return { hasAccess: false }
      }
    },
    async getRootFolderId() {
      // Picker mode returns the virtual root folder id
      return "root"
    },
    async getFile(fileId: string) {
      // Not needed in Picker mode (file-store reads from IDB)
      throw new Error("getFile is not supported in Picker mode. Use file-store instead.")
    },
    async getChildren(folderId: string) {
      // With the drive.file scope, only files already picked via the Picker are returned
      // New files likely will not appear due to missing permissions (experimental)
      return withAutoRefresh(async () => {
        console.log(`Attempting to list children of folder: ${folderId}`)

        try {
          const response = await window.gapi.client.drive.files.list({
            q: `'${folderId}' in parents and trashed=false`,
            fields: 'files(id, name, mimeType, parents)',
            pageSize: 256,
            orderBy: 'folder,name',
          })

          console.log(`API Response for folder ${folderId}:`, response)

          const items = response.result.files || []
          console.log(`Found ${items.length} files with drive.file scope`)

          if (items.length === 0) {
            console.warn(
              `No files returned for folder ${folderId}. ` +
              `This is expected with drive.file scope - only previously selected files are accessible.`
            )
          }

          return items.map(createFileItemFromDriveItem)
        } catch (error: any) {
          console.error(`Error listing children of folder ${folderId}:`, error)

          // On 403, make the missing permission explicit
          if (error.status === 403) {
            console.warn(
              `403 Forbidden - drive.file scope does not grant access to list folder contents. ` +
              `Only files previously selected via Picker are accessible.`
            )
            return [] // return an empty array (a permission limitation, not an error)
          }

          throw error
        }
      })
    },
    async fetchFileBlob(fileId: string) {
      const response = await fetch(
        `https://www.googleapis.com/drive/v3/files/${fileId}?alt=media`,
        {
          headers: {
            Authorization: `Bearer ${accessToken}`,
          },
        }
      )

      if (!response.ok) {
        if (response.status === 401 || response.status === 403) {
          // Token is invalid
          console.warn("Token invalid (401/403) on fetchFileBlob, requesting reauthorization")
          enqueueSnackbarWithAction()
        }
        throw new Error(`Failed to fetch file: ${response.statusText}`)
      }

      return await response.blob()
    },
  }
}
