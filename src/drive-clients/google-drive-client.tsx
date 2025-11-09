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

// Google Picker API用のDeveloper Key（API Key）
const GOOGLE_DEVELOPER_KEY = "AIzaSyDnV3ERZBz85HEqzGKXWIoNw79YEC8MsYQ"

// Google Cloud Projectのプロジェクト番号（App ID）
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

  // Google Picker API を読み込み
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

  // // リフレッシュトークンを使ってアクセストークンを更新
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
  //   const expiresIn = tokenData.expires_in || 3600 // デフォルト1時間
  //   const expiresAt = Date.now() + expiresIn * 1000

  //   // 新しいリフレッシュトークンがある場合は更新
  //   if (tokenData.refresh_token) {
  //     refreshToken = tokenData.refresh_token as string
  //     localStorage.setItem(DB_KEY_REFRESH_TOKEN, refreshToken)
  //   }

  //   localStorage.setItem(DB_KEY_ACCESS_TOKEN, accessToken)
  //   localStorage.setItem(DB_KEY_TOKEN_EXPIRES, expiresAt.toString())

  //   window.gapi.client.setToken({ access_token: accessToken })

  //   return accessToken
  // }

  // トークンの有効性をチェック
  const isTokenValid = (): boolean => {
    const expiresAt = localStorage.getItem(DB_KEY_TOKEN_EXPIRES)
    if (!expiresAt) return false

    // 5分前にマージンを取る（余裕を持って再認証を促す）
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

      // トークンの有効性をチェック
      if (!isTokenValid()) {
        enqueueSnackbarWithAction()
        throw new Error("Access token expired, reauthorization required")
      }

      return new Promise((resolve, reject) => {
        try {
          // DocsViewでフォルダも表示されるように設定
          const docsView = new window.google.picker.DocsView()
            .setIncludeFolders(true)  // フォルダを表示
            .setParent(parentId || 'root')  // 指定されたフォルダまたはDriveのルートから開始

          const picker = new window.google.picker.PickerBuilder()
            .addView(docsView)  // カスタムビューを使用
            .enableFeature(window.google.picker.Feature.MULTISELECT_ENABLED)  // 複数選択を有効化
            .setOAuthToken(accessToken)
            .setDeveloperKey(GOOGLE_DEVELOPER_KEY)
            .setAppId(GOOGLE_APP_ID)  // プロジェクト番号を設定（drive.fileスコープで必須）
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

      // トークンの有効性をチェック
      if (!isTokenValid()) {
        enqueueSnackbarWithAction()
        throw new Error("Access token expired, reauthorization required")
      }

      return new Promise((resolve, reject) => {
        try {
          // フォルダのみ選択可能なDocsView
          const docsView = new window.google.picker.DocsView()
            .setIncludeFolders(true)
            .setMimeTypes('application/vnd.google-apps.folder')
            .setSelectFolderEnabled(true)

          // setFileIds() を文字列形式で指定
          // 注意: setParent()と併用不可（setFileIdsが上書きする）
          console.log("Setting fileIds (string format):", parentId)
          docsView.setFileIds(parentId)  // 文字列として渡す

          const picker = new window.google.picker.PickerBuilder()
            .addView(docsView)
            .setOAuthToken(accessToken)
            .setDeveloperKey(GOOGLE_DEVELOPER_KEY)
            .setAppId(GOOGLE_APP_ID)
            .setTitle(`フォルダを選択してアクセス許可を付与してください`)
            .setCallback((data: any) => {
              if (data.action === window.google.picker.Action.PICKED) {
                const folder = data.docs[0]
                console.log("Folder selected:", folder)

                // 選択されたフォルダが対象のフォルダかチェック
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
          // トークンが無効
          console.warn("Token invalid (401/403), requesting reauthorization")
          enqueueSnackbarWithAction()
          return { hasAccess: false }
        } else if (response.status === 404) {
          // アクセス許可なし
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
      // Pickerモードでは仮想ルートフォルダIDを返す
      return "root"
    },
    async getFile(fileId: string) {
      // Pickerモードでは実装不要（file-storeがIDBから取得）
      throw new Error("getFile is not supported in Picker mode. Use file-store instead.")
    },
    async getChildren(folderId: string) {
      // drive.fileスコープでは、既にPickerで選択されたファイルのみ返される
      // 新しいファイルは権限がないため表示されない可能性が高い（実験的実装）
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

          // 403エラーの場合、権限がないことを明示
          if (error.status === 403) {
            console.warn(
              `403 Forbidden - drive.file scope does not grant access to list folder contents. ` +
              `Only files previously selected via Picker are accessible.`
            )
            return [] // 空の配列を返す（エラーではなく、権限による制限）
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
          // トークンが無効
          console.warn("Token invalid (401/403) on fetchFileBlob, requesting reauthorization")
          enqueueSnackbarWithAction()
        }
        throw new Error(`Failed to fetch file: ${response.statusText}`)
      }

      return await response.blob()
    },
  }
}
