// google-auth-libraryとgoogleapisのインポートを削除
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

// Google Identity Services用の型定義
declare global {
  interface Window {
    google: any
    gapi: typeof gapi
  }
}

export interface GoogleDriveClient extends BaseDriveClient {
  loginRedirect(): Promise<void>
  saveAccessToken(token: string): void
  // fetchAccessToken(code: string): Promise<string>
  userInfo: any | undefined
  connect(): Promise<void>
}

const DB_KEY_USER_INFO = "googleDrive.userInfo"
const DB_KEY_ACCESS_TOKEN = "googleDrive.accessToken"
const DB_KEY_REFRESH_TOKEN = "googleDrive.refreshToken"
const DB_KEY_TOKEN_EXPIRES = "googleDrive.tokenExpires"

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

  // Google API スクリプトを動的に読み込み
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
          // GAPI クライアントを初期化
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

  // Google Identity Services スクリプトを読み込み
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

  const loginRedirectInternal = async () => {
    const params = new URLSearchParams({
      client_id: GOOGLE_CLIENT_ID,
      redirect_uri: redirectUri,
      response_type: "token id_token",
      scope: "https://www.googleapis.com/auth/drive.readonly",
      include_granted_scopes: "true", // 既存許可の再利用
      // prompt: "consent", // 毎回同意画面を出したいなら
      // prompt: "select_account", // アカウント選択を促す
      // login_hint: "",
      nonce: Math.random().toString(36),
    })

    if (userInfo) {
      // 既にユーザー情報がある場合はログインヒントを追加
      params.append("login_hint", userInfo)
    } else {
      params.append("prompt", "select_account") // アカウント選択を促す
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

  // リフレッシュトークンを使ってアクセストークンを更新
  const refreshAccessToken = async (): Promise<string> => {
    if (!refreshToken) {
      throw new Error("No refresh token available")
    }

    const response = await fetch("https://oauth2.googleapis.com/token", {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: new URLSearchParams({
        grant_type: "refresh_token",
        refresh_token: refreshToken,
        client_id: GOOGLE_CLIENT_ID,
      }),
    })

    if (!response.ok) {
      throw new Error(`Token refresh failed: ${response.statusText}`)
    }

    const tokenData = await response.json()

    if (tokenData.error) {
      throw new Error(`Token refresh error: ${tokenData.error}`)
    }

    accessToken = tokenData.access_token as string
    const expiresIn = tokenData.expires_in || 3600 // デフォルト1時間
    const expiresAt = Date.now() + expiresIn * 1000

    // 新しいリフレッシュトークンがある場合は更新
    if (tokenData.refresh_token) {
      refreshToken = tokenData.refresh_token as string
      localStorage.setItem(DB_KEY_REFRESH_TOKEN, refreshToken)
    }

    localStorage.setItem(DB_KEY_ACCESS_TOKEN, accessToken)
    localStorage.setItem(DB_KEY_TOKEN_EXPIRES, expiresAt.toString())

    window.gapi.client.setToken({ access_token: accessToken })

    return accessToken
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
      window.gapi.client.setToken(null)
    },
    async loginRedirect() {
      await loginRedirectInternal()
    },
    saveAccessToken(token: string) {
      localStorage.setItem(DB_KEY_ACCESS_TOKEN, token)
    },
    // async fetchAccessToken(code: string) {
    //   const redirectUri = `${window.location.origin}${
    //     process.env.NEXT_PUBLIC_BASE_PATH || ""
    //   }/redirect/google-drive`

    //   const tokenResponse = await fetch("https://oauth2.googleapis.com/token", {
    //     method: "POST",
    //     headers: {
    //       "Content-Type": "application/x-www-form-urlencoded",
    //     },
    //     body: new URLSearchParams({
    //       code: code,
    //       client_id: GOOGLE_CLIENT_ID,
    //       redirect_uri: redirectUri,
    //       grant_type: "authorization_code",
    //     }),
    //   })
    //   if (!tokenResponse.ok) {
    //     throw new Error(`Token exchange failed: ${tokenResponse.statusText}`)
    //   }

    //   const tokenData = await tokenResponse.json()
    //   const accessToken = tokenData.access_token
    //   if (!accessToken) {
    //     throw new Error("No access token received")
    //   }
    //   localStorage.setItem(DB_KEY_ACCESS_TOKEN, accessToken)
    //   return accessToken as string
    // },
    async connect() {
      await loadGoogleAPI()

      if (!accessToken) {
        throw new Error("No access token available")
      }

      if (!window.gapi) {
        throw new Error("GAPI client not loaded")
      }
      window.gapi.client.setToken({ access_token: accessToken })

      // // ユーザー情報を取得
      // if (!userInfo) {
      //   try {
      //     const response = await window.gapi.client.request({
      //       path: "https://www.googleapis.com/oauth2/v2/userinfo",
      //     })
      //     userInfo = response.result
      //     localStorage.setItem(DB_KEY_USER_INFO, JSON.stringify(userInfo))
      //   } catch (error) {
      //     console.error("Failed to get user info:", error)
      //   }
      // }
    },
    async getRootFolderId() {
      // 実際のルートフォルダIDを取得
      const response = await withAutoRefresh(() =>
        window.gapi.client.drive.files.get({
          fileId: "root", // エイリアスを使用して
          fields: "id",
        })
      )
      return response.result.id!
    },
    async getFile(fileId: string) {
      const response = await withAutoRefresh(() =>
        window.gapi.client.drive.files.get({
          fileId,
          fields: "id,name,mimeType,parents",
        })
      )

      return createFileItemFromDriveItem(response.result)
    },
    async getChildren(folderId: string) {
      const response = await withAutoRefresh(() =>
        window.gapi.client.drive.files.list({
          q: `'${folderId}' in parents and trashed=false`,
          fields: "files(id,name,mimeType,parents)",
          pageSize: 1000,
        })
      )
      return (response.result.files || []).map((item: any) =>
        createFileItemFromDriveItem(item)
      )
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
        throw new Error(`Failed to fetch file: ${response.statusText}`)
      }

      return await response.blob()
    },
  }
}
