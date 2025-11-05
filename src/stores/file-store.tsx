"use client"

import { SnackbarKey, closeSnackbar, enqueueSnackbar } from "notistack"
import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useReducer,
  useRef,
  useState,
} from "react"
import { useNetworkMonitor } from "./network-monitor"
import * as mm from "music-metadata-browser"
import assert from "assert"
import {
  BaseFileItem,
  FolderItem,
  AudioTrackFileItem,
  getDriveConfig,
  AUDIO_FORMAT_MAPPING,
} from "../drive-clients/base-drive-client"
import { BaseDriveClient } from "../drive-clients/base-drive-client"
import { createOneDriveClient } from "../drive-clients/onedrive-client"
import { createGoogleDriveClient } from "../drive-clients/google-drive-client"

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

type DriveStatus = "not-configured" | "no-account" | "online" | "offline"

interface FileStoreStateProps {
  configured: boolean
  fileDb: IDBDatabase | undefined
  driveClient: BaseDriveClient | undefined
  driveStatus: DriveStatus
  rootFolderId: string | undefined

  syncingTrackFiles: { [key: string]: boolean }
  syncQueue: SyncTask[]

  blobsStorageMaxBytes?: number
  blobsStorageUsageBytes?: number
}

interface BlobsMetaRecord {
  id: string
  lastAccessed: number
  blobSize: number
}

export const FileStoreStateContext = createContext<FileStoreStateProps>({
  fileDb: undefined,
  driveClient: undefined,
  rootFolderId: undefined,
  configured: false,
  syncingTrackFiles: {},
  syncQueue: [],
  driveStatus: "not-configured",
})

type FileStoreAction =
  | { type: "setFileDb"; payload: IDBDatabase }
  | { type: "setDriveClient"; payload?: BaseDriveClient }
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
      type: "setDriveStatus"
      payload: DriveStatus
    }
  | { type: "setBlobsStorageMaxBytes"; payload: number }
  | { type: "setBlobsStorageUsageBytes"; payload: number }

export const FileStoreDispatchContext = createContext<
  React.Dispatch<FileStoreAction>
>(() => {})

export const useFileStore = () => {
  const state = useContext(FileStoreStateContext)
  const dispatch = useContext(FileStoreDispatchContext)
  const refState = useRef(state)
  refState.current = state

  const actions = useMemo(() => {
    return {
      getFileById: async (id: string) => {
        if (!refState.current.configured) {
          throw new Error("File store not configured")
        }
        if (!refState.current.fileDb) {
          throw new Error("File database not initialized")
        }
        {
          const item = await getFileItemFromIdb(refState.current.fileDb, id)
          if (item) return item
        }
        if (!refState.current.driveClient) {
          throw new Error("Drive client not connected")
        }

        const remoteFile = await refState.current.driveClient.getFile(id)
        const file = await mergeAndSyncFileItem(
          remoteFile,
          refState.current.fileDb
        )
        return file
      },
      getChildrenLocal: async (id: string) => {
        if (!refState.current.configured) {
          throw new Error("File store not configured")
        }
        if (!refState.current.fileDb) {
          throw new Error("File database not initialized")
        }

        const currentFolder = (await getFileItemFromIdb(
          refState.current.fileDb,
          id
        )) as FolderItem

        const childrenIds = currentFolder.childrenIds
        let children: BaseFileItem[] | undefined
        if (childrenIds) {
          const childrenPromise: Promise<BaseFileItem | undefined>[] =
            childrenIds.map(childId => {
              if (!refState.current.fileDb)
                throw new Error("File database not initialized")
              return getFileItemFromIdb(refState.current.fileDb, childId)
            })
          children = (await Promise.all(childrenPromise)).filter(
            child => child !== undefined
          ) as BaseFileItem[]
        }
        return children
      },
      getChildrenRemote: async (id: string) => {
        if (!refState.current.configured) {
          throw new Error("File store not configured")
        }
        if (!refState.current.fileDb) {
          throw new Error("File database not initialized")
        }
        if (!refState.current.driveClient) {
          throw new Error("Drive client not connected")
        }
        const currentFolder = (await getFileItemFromIdb(
          refState.current.fileDb,
          id
        )) as FolderItem

        const remoteChildren = await refState.current.driveClient.getChildren(
          id
        )
        const children = await Promise.all(
          remoteChildren.map((item: any) => {
            if (!refState.current.fileDb)
              throw new Error("File database not initialized")
            return mergeAndSyncFileItem(item, refState.current.fileDb)
          })
        )

        if (currentFolder) {
          const childrenIds = children.map(child => child.id)
          currentFolder.childrenIds = childrenIds
          refState.current.fileDb
            .transaction("files", "readwrite")
            .objectStore("files")
            .put(currentFolder)
        }

        return children
      },
      hasTrackBlobInLocal: async (id: string) => {
        if (!refState.current.configured) {
          throw new Error("File store not configured")
        }
        if (!refState.current.fileDb) {
          throw new Error("File database not initialized")
        }

        const count = await getIdbRequest(
          refState.current.fileDb
            .transaction("blobs")
            .objectStore("blobs")
            .count(id)
        )
        return count > 0
      },
      requestDownloadTrack: async (id: string) => {
        if (!refState.current.configured) {
          throw new Error("File store not configured")
        }
        const { fileDb, driveClient } = refState.current
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
        if (!refState.current.configured) {
          throw new Error("File store not configured")
        }
        const { fileDb } = refState.current
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
          if (blob) {
            markBlobAccessed(fileDb, id, blob)
            return { blob, file: track }
          }
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
        if (!refState.current.configured) {
          throw new Error("File store not configured")
        }
        if (!refState.current.fileDb) {
          throw new Error("File database not initialized")
        }

        const album = await getAlbumItemFromIdb(refState.current.fileDb, id)
        return album
      },
      getAlbumIds: async () => {
        if (!refState.current.configured) {
          throw new Error("File store not configured")
        }
        if (!refState.current.fileDb) {
          throw new Error("File database not initialized")
        }

        const albumIds = await getIdbRequest<string[]>(
          refState.current.fileDb
            .transaction("albums")
            .objectStore("albums")
            .getAllKeys() as IDBRequest<string[]>
        )

        return albumIds
      },
      setBlobsStorageMaxBytes: (bytes: number) => {
        dispatch({ type: "setBlobsStorageMaxBytes", payload: bytes })
      },
      clearAllLocalBlobs: async () => {
        if (!refState.current.configured) {
          throw new Error("File store not configured")
        }
        if (!refState.current.fileDb) {
          throw new Error("File database not initialized")
        }

        await getIdbRequest(
          refState.current.fileDb
            .transaction("blobs", "readwrite")
            .objectStore("blobs")
            .clear()
        )
        await getIdbRequest(
          refState.current.fileDb
            .transaction("blobs-meta", "readwrite")
            .objectStore("blobs-meta")
            .clear()
        )
        localStorage.setItem("blobsStorageUsageBytes", "0")
        dispatch({ type: "setBlobsStorageUsageBytes", payload: 0 })
      },
      addPickerGroup: async (files: Array<{id: string, name: string, mimeType: string}>) => {
        if (!refState.current.configured) {
          throw new Error("File store not configured")
        }
        if (!refState.current.fileDb) {
          throw new Error("File database not initialized")
        }

        // 仮想フォルダ（Picker Group）を作成
        const groupId = crypto.randomUUID()
        const groupFolder: FolderItem = {
          id: groupId,
          name: `Picked at ${new Date().toLocaleString()}`,
          type: "folder",
          parentId: "root",
          childrenIds: files.map(f => f.id),
        }

        // フォルダをIDBに保存
        await getIdbRequest(
          refState.current.fileDb
            .transaction("files", "readwrite")
            .objectStore("files")
            .put(groupFolder)
        )

        // 各ファイルをIDBに保存
        const transaction = refState.current.fileDb.transaction("files", "readwrite")
        const store = transaction.objectStore("files")

        for (const file of files) {
          const ext = file.name.split(".").pop()?.toLowerCase() || ""
          const audioFormatInfo = AUDIO_FORMAT_MAPPING[ext]

          const fileItem: BaseFileItem = {
            id: file.id,
            name: file.name,
            type: audioFormatInfo ? "audio-track" : "file",
            parentId: groupId,
            ...(audioFormatInfo && { mimeType: audioFormatInfo.mimeType }),
          }
          store.put(fileItem)
        }

        await new Promise<void>((resolve, reject) => {
          transaction.oncomplete = () => resolve()
          transaction.onerror = () => reject(transaction.error)
        })

        return groupId
      },
    }
  }, [])

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

async function mergeAndSyncFileItem(
  fileItem: BaseFileItem,
  db: IDBDatabase
): Promise<BaseFileItem> {
  const dbItem = await getFileItemFromIdb(db, fileItem.id)
  const merged = { ...dbItem }

  ;(Object.keys(fileItem) as Array<keyof BaseFileItem>).forEach(key => {
    if (fileItem[key] !== undefined) {
      ;(merged as any)[key] = fileItem[key]
    }
  })

  db.transaction("files", "readwrite").objectStore("files").put(merged)
  return merged as BaseFileItem
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

function releaseBlobsUntilLimit(
  db: IDBDatabase,
  limit: number,
  currentUsage: number
) {
  if (currentUsage <= limit) return Promise.resolve(currentUsage)

  return new Promise<void>((resolve, reject) => {
    const blobsMetaStore = db
      .transaction("blobs-meta", "readwrite")
      .objectStore("blobs-meta")
    const blobsMetaIndex = blobsMetaStore.index("last-accessed")

    const request = blobsMetaIndex.openCursor()
    request.onsuccess = event => {
      const cursor = (event.target as IDBRequest<IDBCursorWithValue>).result
      if (cursor) {
        const blobId = cursor.primaryKey
        currentUsage -= cursor.value.blobSize
        // console.log("!!!B", currentUsage, cursor.value.blobSize)

        db.transaction("blobs", "readwrite").objectStore("blobs").delete(blobId)
        cursor.delete()

        if (currentUsage <= limit) {
          resolve()
          return
        }

        cursor.continue()
      } else {
        resolve()
      }
    }
    request.onerror = event => {
      reject((event.target as IDBRequest).error)
    }
  }).then(() => {
    return currentUsage
  })
}

async function markBlobAccessed(db: IDBDatabase, id: string, blob: Blob) {
  const result = { appended: false }
  let record = (await getIdbRequest(
    db.transaction("blobs-meta", "readonly").objectStore("blobs-meta").get(id)
  )) as BlobsMetaRecord | undefined
  if (record === undefined) {
    record = {
      id,
      lastAccessed: Date.now(),
      blobSize: blob.size,
    }
    result.appended = true
  }
  record.lastAccessed = Date.now()

  await getIdbRequest(
    db
      .transaction("blobs-meta", "readwrite")
      .objectStore("blobs-meta")
      .put(record)
  )
  return result
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
    case "setDriveStatus": {
      return { ...state, driveStatus: action.payload }
    }
    case "setBlobsStorageMaxBytes": {
      return { ...state, blobsStorageMaxBytes: action.payload }
    }
    case "setBlobsStorageUsageBytes": {
      return { ...state, blobsStorageUsageBytes: action.payload }
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
    rootFolderId: undefined,
    configured: false,
    syncingTrackFiles: {},
    syncQueue: [],
    driveStatus: "not-configured",
  })

  const syncPromiseRef = useRef<Promise<void>>(Promise.resolve())
  const blobsStorageMaxBytesRef = useRef<number | undefined>(undefined)
  const blobsStorageUsageBytesRef = useRef<number | undefined>(undefined)

  const networkMonitor = useNetworkMonitor()
  const initialized = useRef(false)

  useEffect(() => {
    if (initialized.current) {
      return
    }

    const init = async () => {
      const localStorage = window.localStorage

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
            {
              const store = db.createObjectStore("blobs-meta", {
                keyPath: "id",
              })
              store.createIndex("last-accessed", "lastAccessed")
            }
          }
        })
        fileDb.onversionchange = event => {
          const { oldVersion, newVersion } = event
          // console.log("!!!!", event)
        }
        dispatch({ type: "setFileDb", payload: fileDb })
        // enqueueSnackbar("File Database Connected", { variant: "success" })
      } catch (error) {
        console.error(error)
        enqueueSnackbar(`${error}`, { variant: "error" })
        throw error
      }

      {
        const rootFolderId = localStorage.getItem("rootFolderId")
        dispatch({
          type: "setRootFolderId",
          payload: rootFolderId || undefined,
        })

        const blobsStorageMaxBytes = parseInt(
          localStorage.getItem("blobsStorageMaxBytes") || "NaN"
        )
        if (isNaN(blobsStorageMaxBytes)) {
          const estimate = await navigator.storage.estimate()
          const quota = estimate.quota

          const maxBytes = (quota || 100) * 0.7
          localStorage.setItem(
            "blobsStorageMaxBytes",
            `${Math.floor(maxBytes)}`
          )
          dispatch({ type: "setBlobsStorageMaxBytes", payload: maxBytes })
          blobsStorageMaxBytesRef.current = maxBytes
        } else {
          dispatch({
            type: "setBlobsStorageMaxBytes",
            payload: blobsStorageMaxBytes,
          })
          blobsStorageMaxBytesRef.current = blobsStorageMaxBytes
        }

        const blobsStorageUsageBytes = parseInt(
          localStorage.getItem("blobsStorageUsageBytes") || "NaN"
        )
        if (isNaN(blobsStorageUsageBytes)) {
          localStorage.setItem("blobsStorageUsageBytes", "0")
          dispatch({ type: "setBlobsStorageUsageBytes", payload: 0 })
          blobsStorageUsageBytesRef.current = 0
        } else {
          // console.log("SET USAGE", blobsStorageUsageBytes)
          dispatch({
            type: "setBlobsStorageUsageBytes",
            payload: blobsStorageUsageBytes,
          })
          blobsStorageUsageBytesRef.current = blobsStorageUsageBytes
        }
      }

      {
        const driveConfig = getDriveConfig()

        if (driveConfig?.type === "onedrive") {
          const onedriveClient = await createOneDriveClient()
          dispatch({ type: "setDriveClient", payload: onedriveClient })

          const accountInfo = onedriveClient.accountInfo
          if (accountInfo === undefined) {
            dispatch({ type: "setDriveStatus", payload: "no-account" })
          } else {
            dispatch({ type: "setDriveStatus", payload: "offline" })
          }
        } else if (driveConfig?.type === "google-drive") {
          const googleDriveClient = await createGoogleDriveClient()
          dispatch({ type: "setDriveClient", payload: googleDriveClient })

          const userInfo = googleDriveClient.userInfo
          if (userInfo) {
            dispatch({ type: "setDriveStatus", payload: "offline" })
          } else {
            dispatch({ type: "setDriveStatus", payload: "no-account" })
          }

          // Google Drive Pickerモード用の仮想rootフォルダを作成
          if (fileDb) {
            const rootFolder: FolderItem = {
              id: "root",
              name: "Google Drive Files",
              type: "folder",
              childrenIds: [],
            }
            // rootフォルダが存在しない場合のみ作成
            const existingRoot = await getIdbRequest(
              fileDb.transaction("files").objectStore("files").get("root")
            )
            if (!existingRoot) {
              await getIdbRequest(
                fileDb
                  .transaction("files", "readwrite")
                  .objectStore("files")
                  .put(rootFolder)
              )
            }
            // rootFolderIdを設定
            localStorage.setItem("rootFolderId", "root")
            dispatch({ type: "setRootFolderId", payload: "root" })
          }
        } else {
          dispatch({ type: "setDriveStatus", payload: "no-account" })
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

  const refClientConfiguring = useRef(false)

  useEffect(() => {
    if (refClientConfiguring.current) return
    if (!state.configured) return

    const driveClient = state.driveClient
    if (!driveClient) return
    if (state.driveStatus !== "online" && state.driveStatus !== "offline") {
      return
    }

    if (!networkMonitor.isOnline) {
      // If offline, client should be disconnected.
      // dispatch({ type: "setDriveClient", payload: undefined })
      dispatch({ type: "setDriveStatus", payload: "offline" })
      return
    }

    if (state.driveStatus === "online") return

    refClientConfiguring.current = true

    const process = async () => {
      try {
        await driveClient.connect()
        enqueueSnackbar("Drive Client Connected")
      } catch (error) {
        enqueueSnackbar(`${error}`, { variant: "error" })
        refClientConfiguring.current = false
        return
      }

      try {
        const rootFolderId = await driveClient.getRootFolderId()
        window.localStorage.setItem("rootFolderId", rootFolderId)
        dispatch({ type: "setRootFolderId", payload: rootFolderId })
      } catch (error) {
        console.error(error)
        enqueueSnackbar(`${error}`, { variant: "error" })
      }

      dispatch({ type: "setDriveStatus", payload: "online" })
      refClientConfiguring.current = false
    }

    process()
  }, [networkMonitor, state.configured, state.driveClient, state.driveStatus])

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

          return driveClient.fetchFileBlob(fileId)
        })
        .then(blob => {
          return mm.parseBlob(blob).then(metadata => {
            return { blob, metadata }
          })
        })
        .then(({ blob, metadata }) => {
          if (!fileDb) throw new Error("File database not initialized")

          let trackFile: AudioTrackFileItem | undefined

          return markBlobAccessed(fileDb, fileId, blob)
            .then(({ appended }) => {
              assert(
                blobsStorageMaxBytesRef.current !== undefined &&
                  blobsStorageUsageBytesRef.current !== undefined
              )
              if (appended) {
                const blobStorageUsageBytes =
                  blobsStorageUsageBytesRef.current + blob.size
                // console.log(
                //   "!!!A",
                //   blobsStorageUsageBytesRef.current,
                //   blob.size,
                //   blobStorageUsageBytes
                // )
                return releaseBlobsUntilLimit(
                  fileDb,
                  blobsStorageMaxBytesRef.current,
                  blobStorageUsageBytes
                ).then(usage => {
                  // console.log("!!!C", usage)
                  localStorage.setItem("blobsStorageUsageBytes", `${usage}`)
                  dispatch({
                    type: "setBlobsStorageUsageBytes",
                    payload: usage,
                  })
                  blobsStorageUsageBytesRef.current = usage
                })
              }
              return null
            })
            .then(() => getFileItemFromIdb(fileDb, fileId))
            .then(item => {
              if (!item) throw new Error("Item not found")
              if (item.type !== "audio-track")
                throw new Error("Item is not a track")
              assert(blobsStorageUsageBytesRef.current !== undefined)

              trackFile = item as AudioTrackFileItem
              trackFile.metadata = metadata
              fileDb
                .transaction("files", "readwrite")
                .objectStore("files")
                .put(trackFile)

              if (blobsStorageUsageBytesRef.current > 0) {
                fileDb
                  .transaction("blobs", "readwrite")
                  .objectStore("blobs")
                  .put(blob, fileId)
              }

              let albumName = metadata.common.album
              if (albumName === undefined) albumName = "Unknown Album"
              albumName = albumName.replace(/\0+$/, "")

              return getAlbumItemFromIdb(fileDb, albumName).then(albumItem => {
                if (albumItem) {
                  if (!albumItem.fileIds.includes(fileId)) {
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
