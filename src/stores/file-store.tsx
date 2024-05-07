"use client"

import {
  AccountInfo,
  InteractionRequiredAuthError,
  PublicClientApplication,
} from "@azure/msal-browser"
import { Client, ResponseType } from "@microsoft/microsoft-graph-client"
import { SnackbarKey, closeSnackbar, enqueueSnackbar } from "notistack"
import {
  createContext,
  useContext,
  useEffect,
  useReducer,
  useRef,
  useState,
} from "react"
import { useNetworkMonitor } from "./network-monitor"
import * as mm from "music-metadata-browser"
import assert from "assert"
import { Button } from "@mui/material"

export interface BaseFileItem {
  name: string
  id: string
  type: "file" | "folder" | "audio-track"
  parentId?: string
}

export interface FileItem extends BaseFileItem {
  type: "file"
}

export interface FolderItem extends BaseFileItem {
  type: "folder"
  childrenIds?: string[]
}

export interface AudioTrackFileItem extends BaseFileItem {
  type: "audio-track"
  mimeType: string
  metadata?: mm.IAudioMetadata
}

interface SyncTask {
  fileId: string
  resolve: ({}: { file?: AudioTrackFileItem; blob?: Blob }) => void
  reject: (error: any) => void
}

export interface AlbumItem {
  name: string
  fileIds: string[]
  cover?: Blob
}

interface FileStoreStateProps {
  fileDb: IDBDatabase | undefined
  driveClient: Client | undefined
  pca: PublicClientApplication | undefined
  rootFolderId: string | undefined
  configured: boolean
  driveConfigureStatus: "not-configured" | "no-account" | "configured"

  syncingTrackFiles: { [key: string]: boolean }
  syncQueue: SyncTask[]
}

export const FileStoreStateContext = createContext<FileStoreStateProps>({
  fileDb: undefined,
  driveClient: undefined,
  pca: undefined,
  rootFolderId: undefined,
  configured: false,
  syncingTrackFiles: {},
  syncQueue: [],
  driveConfigureStatus: "not-configured",
})

type FileStoreAction =
  | { type: "setFileDb"; payload: IDBDatabase }
  | { type: "setDriveClient"; payload?: Client }
  | { type: "setPca"; payload: PublicClientApplication }
  | { type: "setRootFolderId"; payload: string | undefined }
  | { type: "setConfigured"; payload: boolean }
  | {
      type: "pushSyncTask"
      payload: SyncTask[]
    }
  | {
      type: "popSyncTask"
      payload: SyncTask[]
    }
  | {
      type: "setSyncingTrackFile"
      payload: {
        id: string
        syncing: boolean
      }
    }
  | {
      type: "setDriveConfigureStatus"
      payload: "not-configured" | "no-account" | "configured"
    }

export const FileStoreDispatchContext = createContext<
  React.Dispatch<FileStoreAction>
>(() => {})

export const useFileStore = () => {
  const state = useContext(FileStoreStateContext)
  const dispatch = useContext(FileStoreDispatchContext)

  const actions = {
    getFileById: async (id: string) => {
      if (!state.configured) {
        throw new Error("File store not configured")
      }
      if (!state.fileDb) {
        throw new Error("File database not initialized")
      }
      {
        const item = await getFileItemFromIdb(state.fileDb, id)
        if (item) return item
      }

      if (!state.driveClient) {
        throw new Error("Drive client not connected")
      }

      const response = await state.driveClient
        .api(`/me/drive/items/${id}`)
        .get()
      const item = await makeFileItemFromResponseAndSync(response, state.fileDb)
      return item
    },
    getChildrenLocal: async (id: string) => {
      if (!state.configured) {
        throw new Error("File store not configured")
      }
      if (!state.fileDb) {
        throw new Error("File database not initialized")
      }

      const currentFolder = (await getFileItemFromIdb(
        state.fileDb,
        id
      )) as FolderItem
      // if (currentFolder.type !== "folder") {
      //   throw new Error("Item is not a folder")
      // }

      const childrenIds = currentFolder.childrenIds
      let children: BaseFileItem[] | undefined
      if (childrenIds) {
        const childrenPromise: Promise<BaseFileItem | undefined>[] =
          childrenIds.map(childId => {
            if (!state.fileDb) throw new Error("File database not initialized")
            return getFileItemFromIdb(state.fileDb, childId)
          })
        children = (await Promise.all(childrenPromise)).filter(
          child => child !== undefined
        ) as BaseFileItem[]
      }
      return children
    },
    getChildrenRemote: async (id: string) => {
      if (!state.configured) {
        throw new Error("File store not configured")
      }
      if (!state.fileDb) {
        throw new Error("File database not initialized")
      }
      if (!state.driveClient) {
        throw new Error("Drive client not connected")
      }
      const currentFolder = (await getFileItemFromIdb(
        state.fileDb,
        id
      )) as FolderItem

      const response = await state.driveClient
        .api(`/me/drive/items/${id}/children`)
        .get()
      const children = (
        await Promise.all(
          response.value.map((item: any) => {
            if (!state.fileDb) throw new Error("File database not initialized")
            return makeFileItemFromResponseAndSync(item, state.fileDb)
          })
        )
      ).filter(child => child !== undefined) as BaseFileItem[]

      if (currentFolder) {
        const childrenIds = children.map(child => child.id)
        currentFolder.childrenIds = childrenIds
        state.fileDb
          .transaction("files", "readwrite")
          .objectStore("files")
          .put(currentFolder)
      }

      return children
    },
    hasTrackBlobInLocal: async (id: string) => {
      if (!state.configured) {
        throw new Error("File store not configured")
      }
      if (!state.fileDb) {
        throw new Error("File database not initialized")
      }

      const count = await getIdbRequest(
        state.fileDb.transaction("blobs").objectStore("blobs").count(id)
      )
      return count > 0
    },
    requestDownloadTrack: async (id: string) => {
      if (!state.configured) {
        throw new Error("File store not configured")
      }
      const { fileDb, driveClient } = state
      if (!fileDb) {
        throw new Error("File database not initialized")
      }
      const count = await getIdbRequest(
        fileDb.transaction("blobs").objectStore("blobs").count(id)
      )
      if (count > 0) return

      const promise = new Promise<void>((resolve, reject) => {
        const task: SyncTask = {
          fileId: id,
          resolve: () => {
            resolve()
          },
          reject: error => {
            reject(error)
          },
        }

        // console.log("PUSH(req)", id)

        dispatch({
          type: "setSyncingTrackFile",
          payload: {
            id,
            syncing: true,
          },
        })

        dispatch({
          type: "pushSyncTask",
          payload: [task],
        })
      })
      await promise
      return
    },
    getTrackContent: async (id: string) => {
      if (!state.configured) {
        throw new Error("File store not configured")
      }
      const { fileDb } = state
      if (!fileDb) {
        throw new Error("File database not initialized")
      }

      {
        const track = (await getFileItemFromIdb(
          fileDb,
          id
        )) as AudioTrackFileItem
        if (track.type !== "audio-track") {
          throw new Error("Item is not a track")
        }
        const blob = (await getIdbRequest(
          fileDb.transaction("blobs", "readonly").objectStore("blobs").get(id)
        )) as Blob | undefined
        if (blob) return { blob, file: track }
      }

      const promise = new Promise<{ blob?: Blob; file?: AudioTrackFileItem }>(
        (resolve, reject) => {
          const task: SyncTask = {
            fileId: id,
            resolve,
            reject,
          }

          // console.log("PUSH", id)

          dispatch({
            type: "setSyncingTrackFile",
            payload: {
              id,
              syncing: true,
            },
          })

          dispatch({
            type: "pushSyncTask",
            payload: [task],
          })
        }
      )

      const { file, blob } = await promise
      if (!file || !blob) {
        throw new Error("File or blob not found")
      }
      return { blob, file }
    },
    getAlbumById: async (id: string) => {
      if (!state.configured) {
        throw new Error("File store not configured")
      }
      if (!state.fileDb) {
        throw new Error("File database not initialized")
      }

      const album = await getAlbumItemFromIdb(state.fileDb, id)
      return album
    },
    getAlbumIds: async () => {
      if (!state.configured) {
        throw new Error("File store not configured")
      }
      if (!state.fileDb) {
        throw new Error("File database not initialized")
      }

      const albumIds = await getIdbRequest<string[]>(
        state.fileDb
          .transaction("albums")
          .objectStore("albums")
          .getAllKeys() as IDBRequest<string[]>
      )

      return albumIds
    },
  }

  return [state, actions] as const
}

function getFileItemFromIdb(
  db: IDBDatabase,
  id: string
): Promise<BaseFileItem | undefined> {
  return new Promise((resolve, reject) => {
    const request = db
      .transaction("files", "readwrite")
      .objectStore("files")
      .get(id)
    request.onsuccess = event => {
      const item = (event.target as IDBRequest).result
      resolve(item)
    }
    request.onerror = event => {
      reject((event.target as IDBRequest).error)
    }
  })
}

function getAlbumItemFromIdb(db: IDBDatabase, id: string): Promise<AlbumItem> {
  return new Promise((resolve, reject) => {
    const request = db
      .transaction("albums", "readwrite")
      .objectStore("albums")
      .get(id)
    request.onsuccess = event => {
      const item = (event.target as IDBRequest).result
      resolve(item)
    }
    request.onerror = event => {
      reject((event.target as IDBRequest).error)
    }
  })
}

const audioFormatMapping: { [key: string]: { mimeType: string } } = {
  aac: { mimeType: "audio/aac" },
  mp3: { mimeType: "audio/mpeg" },
  ogg: { mimeType: "audio/ogg" },
  wav: { mimeType: "audio/wav" },
  flac: { mimeType: "audio/flac" },
  m4a: { mimeType: "audio/mp4" },
}

async function makeFileItemFromResponseAndSync(
  responseItem: any,
  db: IDBDatabase
): Promise<BaseFileItem | undefined> {
  let dbItem = await getFileItemFromIdb(db, responseItem.id)
  if (responseItem.folder) {
    dbItem = {
      ...dbItem,
      name: responseItem.name,
      id: responseItem.id,
      type: "folder",
      parentId: responseItem.parentReference.id,
    } as FolderItem
  }
  if (responseItem.file) {
    const ext: string = responseItem.name.split(".").pop()
    const audioMimeType = audioFormatMapping[ext]?.mimeType

    if (audioMimeType !== undefined) {
      dbItem = {
        ...dbItem,
        name: responseItem.name,
        id: responseItem.id,
        type: "audio-track",
        mimeType: audioMimeType,
        parentId: responseItem.parentReference.id,
      } as AudioTrackFileItem
    } else {
      dbItem = {
        ...dbItem,
        name: responseItem.name,
        id: responseItem.id,
        type: "file",
        parentId: responseItem.parentReference.id,
      } as FileItem
    }
  }
  if (dbItem === undefined) {
    return undefined
  }

  db.transaction("files", "readwrite").objectStore("files").put(dbItem)
  return dbItem as BaseFileItem
}

function getIdbRequest<T>(request: IDBRequest<T>) {
  return new Promise<T>((resolve, reject) => {
    request.onsuccess = event => {
      resolve((event.target as IDBRequest).result)
    }
    request.onerror = event => {
      reject((event.target as IDBRequest).error)
    }
  })
}

const reducer = (
  state: FileStoreStateProps,
  action: FileStoreAction
): FileStoreStateProps => {
  switch (action.type) {
    case "setFileDb":
      return { ...state, fileDb: action.payload }
    case "setDriveClient":
      return { ...state, driveClient: action.payload }
    case "setPca":
      return { ...state, pca: action.payload }
    case "setRootFolderId":
      return { ...state, rootFolderId: action.payload }
    case "setConfigured":
      return { ...state, configured: action.payload }
    case "pushSyncTask": {
      const syncQueue = [...state.syncQueue, ...action.payload]
      // console.log("ACCEPT PUSH", syncQueue)
      return { ...state, syncQueue }
    }
    case "setSyncingTrackFile": {
      const { id, syncing } = action.payload
      const syncingTrackFiles = { ...state.syncingTrackFiles }
      if (syncing) {
        syncingTrackFiles[id] = true
      } else {
        delete syncingTrackFiles[id]
      }
      return { ...state, syncingTrackFiles }
    }
    case "popSyncTask": {
      const popped = action.payload
      // console.log("ACCEPT POP", state.syncQueue, popped)
      const syncQueue = state.syncQueue.filter(
        task => !popped.some(p => p.fileId === task.fileId)
      )
      return { ...state, syncQueue }
    }
    case "setDriveConfigureStatus": {
      return { ...state, driveConfigureStatus: action.payload }
    }
    default:
      throw new Error("Invalid action")
  }
}

export const FileStoreProvider = ({
  children,
}: {
  children: React.ReactNode
}) => {
  const [state, dispatch] = useReducer(reducer, {
    fileDb: undefined,
    driveClient: undefined,
    pca: undefined,
    rootFolderId: undefined,
    configured: false,
    syncingTrackFiles: {},
    syncQueue: [],
    driveConfigureStatus: "not-configured",
  })

  const syncPromiseRef = useRef<Promise<void>>(Promise.resolve())

  const networkMonitor = useNetworkMonitor()
  const initialized = useRef(false)

  useEffect(() => {
    if (initialized.current) {
      return
    }

    const init = async () => {
      const pca = new PublicClientApplication({
        auth: {
          clientId: "28af6fb9-c605-4ad3-8039-3e90df0933cb",
          redirectUri: `${window.location.origin}${
            process.env.NEXT_PUBLIC_BASE_PATH || ""
          }/redirect`,
        },
        cache: {
          cacheLocation: "localStorage",
        },
      })

      await pca.initialize()
      dispatch({ type: "setPca", payload: pca })

      let fileDb: IDBDatabase | undefined = undefined
      try {
        fileDb = await new Promise<IDBDatabase>((resolve, reject) => {
          const req = indexedDB.open("file-db")

          req.onsuccess = () => {
            resolve(req.result)
          }

          req.onerror = () => {
            reject(req.error)
          }

          req.onupgradeneeded = ev => {
            const db = req.result

            db.createObjectStore("files", { keyPath: "id" })
            db.createObjectStore("blobs")
            db.createObjectStore("albums")
          }
        })
        dispatch({ type: "setFileDb", payload: fileDb })
        enqueueSnackbar("File Database Connected", { variant: "success" })
      } catch (error) {
        console.error(error)
        enqueueSnackbar(`${error}`, { variant: "error" })
        throw error
      }

      {
        const localStorage = window.localStorage
        const rootFolderId = localStorage.getItem("rootFolderId")
        dispatch({
          type: "setRootFolderId",
          payload: rootFolderId || undefined,
        })
      }

      {
        const driveAccountJson = window.localStorage.getItem("drive-account")
        if (driveAccountJson === null) {
          dispatch({ type: "setDriveConfigureStatus", payload: "no-account" })
        } else {
          dispatch({ type: "setDriveConfigureStatus", payload: "configured" })
        }
      }
    }

    init()
      .then(() => {
        dispatch({ type: "setConfigured", payload: true })
      })
      .catch(error => {
        console.error(error)
        enqueueSnackbar(`${error}`, { variant: "error" })
      })

    return () => {
      initialized.current = true
    }
  }, [])

  const clientConfiguring = useRef(false)

  useEffect(() => {
    if (!state.configured) return
    if (!networkMonitor.isOnline) {
      // If offline, client should be disconnected.
      dispatch({ type: "setDriveClient", payload: undefined })
      return
    }
    const pca = state.pca

    if (!pca) return
    if (state.driveClient) return

    clientConfiguring.current = true

    let accessToken: string | null = null
    let account: AccountInfo | null = null

    pca
      .handleRedirectPromise()
      .then(response => {
        if (!response) return
        window.localStorage.setItem(
          "drive-account",
          JSON.stringify(response.account)
        )
        accessToken = response.accessToken
        // console.log("Redirect")
      })
      .catch(error => {
        console.error(error)
        enqueueSnackbar(`${error}`, { variant: "error" })
      })
      .then(() => {
        if (accessToken !== null) return
        const activeAccountJson = window.localStorage.getItem("drive-account")
        if (activeAccountJson === null) {
          return
        }
        account = JSON.parse(activeAccountJson) as AccountInfo

        const silentRequest = {
          scopes: ["Files.Read", "Sites.Read.All"],
          account: account,
        }
        // console.log("Silent")
        return pca.acquireTokenSilent(silentRequest)
      })
      .then(response => {
        if (!response) return
        accessToken = response.accessToken
        window.localStorage.setItem(
          "drive-account",
          JSON.stringify(response.account)
        )
      })
      .catch(error => {
        console.error(error)
        if (error instanceof InteractionRequiredAuthError) {
          // pca.acquireTokenRedirect({ scopes: ["Files.Read", "Sites.Read.All"] })
          // return
        }
        const action = (snackbarId: SnackbarKey) => {
          return (
            <>
              <Button
                color="error"
                onClick={() => {
                  if (!pca) return
                  if (!account) return
                  pca.acquireTokenRedirect({
                    scopes: ["Files.Read", "Sites.Read.All"],
                    account: account,
                  })
                  closeSnackbar(snackbarId)
                }}
              >
                Log In Cloud
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
        enqueueSnackbar(`${error}`, {
          variant: "error",
          action,
          persist: true,
        })
      })
      .then(() => {
        if (accessToken === null) return
        dispatch({ type: "setDriveConfigureStatus", payload: "configured" })
        const client = Client.init({
          authProvider: done => {
            done(null, accessToken)
          },
        })
        dispatch({ type: "setDriveClient", payload: client })
        enqueueSnackbar("Drive Client Connected", { variant: "success" })
        clientConfiguring.current = false
      })
      .catch(error => {
        console.error(error)
        enqueueSnackbar(`${error}`, { variant: "error" })
        clientConfiguring.current = false
      })
  }, [networkMonitor, state.configured, state.pca, state.driveClient])

  useEffect(() => {
    if (state.driveClient === undefined) return

    const driveClient = state.driveClient
    driveClient
      .api("/me/drive/root")
      .get()
      .then(response => {
        const rootId = response.id
        window.localStorage.setItem("rootFolderId", rootId)
        dispatch({ type: "setRootFolderId", payload: rootId })
      })
      .catch(error => {
        console.error(error)
        enqueueSnackbar(`${error}`, { variant: "error" })
      })
  }, [state.driveClient, state.fileDb])

  useEffect(() => {
    const syncQueue = state.syncQueue

    // console.log("POP", syncQueue)
    if (syncQueue.length === 0) return

    const syncPromise = syncPromiseRef.current
    assert(syncPromise !== undefined)

    syncPromiseRef.current = syncQueue.reduce((chain, task) => {
      const { fileId, resolve, reject } = task
      const fileDb = state.fileDb
      const driveClient = state.driveClient

      return chain
        .then(() => {
          // console.log("START", fileId)
          if (!driveClient) throw new Error("Drive client not connected")

          return driveClient
            .api(
              `/me/drive/items/${fileId}?select=id,@microsoft.graph.downloadUrl`
            )
            .get()
        })
        .then(response => {
          const downloadUrl = response["@microsoft.graph.downloadUrl"]
          return fetch(downloadUrl)
        })
        .then(response => response.blob())
        .then(blob => {
          return mm.parseBlob(blob).then(metadata => {
            return { blob, metadata }
          })
        })
        .then(({ blob, metadata }) => {
          if (!fileDb) throw new Error("File database not initialized")

          let trackFile: AudioTrackFileItem | undefined

          return getFileItemFromIdb(fileDb, fileId).then(item => {
            if (!item) throw new Error("Item not found")
            if (item.type !== "audio-track")
              throw new Error("Item is not a track")

            trackFile = item as AudioTrackFileItem
            trackFile.metadata = metadata
            fileDb
              .transaction("files", "readwrite")
              .objectStore("files")
              .put(trackFile)
            fileDb
              .transaction("blobs", "readwrite")
              .objectStore("blobs")
              .put(blob, fileId)

            let albumName = metadata.common.album
            if (albumName === undefined) albumName = "Unknown Album"
            albumName = albumName.replace(/\0+$/, "")

            return getAlbumItemFromIdb(fileDb, albumName).then(albumItem => {
              if (albumItem) {
                if (!albumItem.fileIds.includes(fileId)) {
                  // 追加
                  albumItem.fileIds.push(fileId)
                }
              } else {
                albumItem = {
                  name: albumName,
                  fileIds: [fileId],
                  cover: undefined,
                }
              }
              if (albumItem.cover === undefined) {
                const cover = mm.selectCover(metadata.common.picture)
                if (cover) {
                  albumItem.cover = new Blob([cover.data], {
                    type: cover.format,
                  })
                }
              }
              fileDb
                .transaction("albums", "readwrite")
                .objectStore("albums")
                .put(albumItem, albumName)
              return { file: trackFile, blob }
            })
          })
        })
        .then(result => {
          resolve(result)
        })
        .catch(error => {
          reject(error)
        })
        .then(() => {
          // console.log("END", fileId)
          dispatch({
            type: "setSyncingTrackFile",
            payload: {
              id: fileId,
              syncing: false,
            },
          })
        })
    }, syncPromise)

    dispatch({ type: "popSyncTask", payload: syncQueue })
  }, [state.syncQueue, state.fileDb, state.driveClient])

  return (
    <FileStoreStateContext.Provider value={state}>
      <FileStoreDispatchContext.Provider value={dispatch}>
        {children}
      </FileStoreDispatchContext.Provider>
    </FileStoreStateContext.Provider>
  )
}
