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
  /** Leaves the app for the Google Picker so the user can choose tracks. */
  startFilesPick(): void
  /** Leaves the app for a picker limited to `folderIds`, to grant access to them. */
  startFolderGrant(folderIds: string[]): void
  /** The picker only hands back ids, so names/types have to be fetched separately. */
  getFilesMetadata(fileIds: string[]): Promise<GooglePickerResult[]>
  checkFolderAccess(folderId: string): Promise<{ hasAccess: boolean; folderName?: string }>
}

const DB_KEY_USER_INFO = "googleDrive.userInfo"
const DB_KEY_ACCESS_TOKEN = "googleDrive.accessToken"
const DB_KEY_REFRESH_TOKEN = "googleDrive.refreshToken"
const DB_KEY_TOKEN_EXPIRES = "googleDrive.tokenExpires"

// Must stay on the same Cloud project as the existing library: drive.file grants
// are recorded per app, so a different client would lose access to every track
// the user has already picked.
const GOOGLE_CLIENT_ID =
  "636784171461-qe09gc3cupq8iagds8hk16cb6k6cvle4.apps.googleusercontent.com"

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

  // Builds the authorization URL that opens the Google Picker.
  //
  // The picker rides on top of the OAuth consent screen rather than being a
  // separate widget, which has two consequences worth knowing before touching
  // these parameters:
  //   - `prompt=consent` is mandatory. Drop it and Google short-circuits the
  //     whole flow on the second run, redirecting back with no picked_file_ids
  //     and no visible picker.
  //   - The response is an authorization code, but a static PWA has no client
  //     secret to exchange it with. We deliberately ignore the code: drive.file
  //     grants attach to the app, so the existing implicit-flow access token can
  //     already read whatever the user just picked.
  const buildPickerAuthUrl = (extraParams: Record<string, string>) => {
    const params = new URLSearchParams({
      client_id: GOOGLE_CLIENT_ID,
      redirect_uri: redirectUri,
      scope: "https://www.googleapis.com/auth/drive.file",
      response_type: "code",
      access_type: "offline",
      prompt: "consent",
      trigger_onepick: "true",
      allow_multiple: "true",
      ...extraParams,
    })
    // Skips the account chooser, leaving just the consent screen.
    if (userInfo) {
      params.append("login_hint", userInfo)
    }
    return `https://accounts.google.com/o/oauth2/v2/auth?${params.toString()}`
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
    startFilesPick() {
      // The picker itself needs no token, but everything after the round trip
      // does. Failing here is far friendlier than sending the user through
      // Google only to hit an expired token on the way back.
      if (!accessToken || !isTokenValid()) {
        enqueueSnackbarWithAction()
        throw new Error("Access token expired, reauthorization required")
      }
      window.location.href = buildPickerAuthUrl({})
    },
    startFolderGrant(folderIds: string[]) {
      if (folderIds.length === 0) return
      if (!accessToken || !isTokenValid()) {
        enqueueSnackbarWithAction()
        throw new Error("Access token expired, reauthorization required")
      }
      // `file_ids` switches the picker into a "grant access to these items" view:
      // no browsing, no search, just the listed folders ready to be selected in
      // one pass. That is what keeps this to a single round trip.
      window.location.href = buildPickerAuthUrl({
        allow_folder_selection: "true",
        file_ids: folderIds.join(","),
      })
    },
    async getFilesMetadata(fileIds: string[]): Promise<GooglePickerResult[]> {
      const results = await Promise.all(
        fileIds.map(async id => {
          const response = await fetch(
            `https://www.googleapis.com/drive/v3/files/${id}?fields=id,name,mimeType,parents`,
            { headers: { Authorization: `Bearer ${accessToken}` } }
          )
          if (!response.ok) {
            if (response.status === 401 || response.status === 403) {
              enqueueSnackbarWithAction()
            }
            console.warn(`Failed to read metadata for ${id}: ${response.status}`)
            return undefined
          }
          const data = await response.json()
          return {
            id: data.id,
            name: data.name,
            mimeType: data.mimeType,
            parentId: data.parents?.[0] || undefined,
          } as GooglePickerResult
        })
      )
      return results.filter((r): r is GooglePickerResult => r !== undefined)
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
