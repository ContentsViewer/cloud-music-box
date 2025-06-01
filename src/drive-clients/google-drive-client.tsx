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
    gapi: any
  }
}

export interface GoogleDriveClient extends BaseDriveClient {
  userInfo: any | undefined
  connect(): Promise<void>
}

const DB_KEY_USER_INFO = "googleDrive.userInfo"
const DB_KEY_ACCESS_TOKEN = "googleDrive.accessToken"

const GOOGLE_CLIENT_ID = "636784171461-qe09gc3cupq8iagds8hk16cb6k6cvle4.apps.googleusercontent.com"

export async function createGoogleDriveClient(): Promise<GoogleDriveClient> {
  console.log("createGoogleDriveClient")

  let userInfo: any | undefined = undefined
  let accessToken: string | undefined = undefined

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
        window.gapi.load("client", resolve)
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

  await Promise.all([loadGoogleAPI(), loadGoogleIdentity()])
  console.log(window.gapi, window.google)

  // GAPI クライアントを初期化
  await window.gapi.client.init({
    discoveryDocs: [
      "https://www.googleapis.com/discovery/v1/apis/drive/v3/rest",
    ],
  })
  console.log("AAAA")

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

  const init = async () => {
    const userInfoJson = localStorage.getItem(DB_KEY_USER_INFO)
    if (userInfoJson) {
      userInfo = JSON.parse(userInfoJson)
    }

    accessToken = localStorage.getItem(DB_KEY_ACCESS_TOKEN) || undefined
    if (accessToken) {
      window.gapi.client.setToken({ access_token: accessToken })
    }
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

    async connect() {
      if (!accessToken) {
        throw new Error("No access token available")
      }

      // ユーザー情報を取得
      if (!userInfo) {
        try {
          const response = await window.gapi.client.request({
            path: "https://www.googleapis.com/oauth2/v2/userinfo",
          })
          userInfo = response.result
          localStorage.setItem(DB_KEY_USER_INFO, JSON.stringify(userInfo))
        } catch (error) {
          console.error("Failed to get user info:", error)
        }
      }
    },
    async getRootFolderId() {
      return "root"
    },
    async getFile(fileId: string) {
      const response = await window.gapi.client.drive.files.get({
        fileId,
        fields: "id,name,mimeType,parents",
      })
      return createFileItemFromDriveItem(response.result)
    },
    async getChildren(folderId: string) {
      const response = await window.gapi.client.drive.files.list({
        q: `'${folderId}' in parents and trashed=false`,
        fields: "files(id,name,mimeType,parents)",
        pageSize: 1000,
      })

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
