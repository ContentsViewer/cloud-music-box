"use client"

import {
  InteractionRequiredAuthError,
  PublicClientApplication,
} from "@azure/msal-browser"
import { Client, ResponseType } from "@microsoft/microsoft-graph-client"
import { enqueueSnackbar } from "notistack"
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
import { request } from "http"

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

interface FileStoreStateProps {
  fileDb: IDBDatabase | undefined
  driveClient: Client | undefined
  pca: PublicClientApplication | undefined
  rootFiles: BaseFileItem[] | undefined
  configured: boolean

  syncingTrackFiles: { [key: string]: boolean }
  syncProcess: Promise<{
    file: AudioTrackFileItem | undefined
    blob: Blob | undefined
  }>
}

export const FileStoreStateContext = createContext<FileStoreStateProps>({
  fileDb: undefined,
  driveClient: undefined,
  pca: undefined,
  rootFiles: undefined,
  configured: false,
  syncingTrackFiles: {},
  syncProcess: Promise.resolve({ file: undefined, blob: undefined }),
})

type FileStoreAction =
  | { type: "setFileDb"; payload: IDBDatabase }
  | { type: "setDriveClient"; payload?: Client }
  | { type: "setPca"; payload: PublicClientApplication }
  | { type: "setRootFiles"; payload: BaseFileItem[] }
  | { type: "setConfigured"; payload: boolean }
  | {
      type: "appendSyncProcess"
      payload: {
        id: string
        resolve: ({
          file,
          blob,
        }: {
          file: AudioTrackFileItem | undefined
          blob: Blob | undefined
        }) => void
      }
    }
  | { type: "completeSyncProcess"; payload: { id: string } }

export const FileStoreDispatchContext = createContext<
  React.Dispatch<FileStoreAction>
>(() => {})

export const useFileStore = () => {
  const state = useContext(FileStoreStateContext)
  const dispatch = useContext(FileStoreDispatchContext)
  // const [ test, setTest ] = useState<string>("test")
  // console.log("!!!", state.syncProcess)

  const requestSyncTrack = (
    id: string,
    resolve: ({
      file,
      blob,
    }: {
      file: AudioTrackFileItem | undefined
      blob: Blob | undefined
    }) => void
  ) => {
    if (!state.configured) {
      throw new Error("File store not configured")
    }

    const {
      syncProcess,
      fileDb,
      driveClient,
      syncingTrackFiles: syncingTracks,
    } = state

    if (!fileDb) throw new Error("File database not initialized")
    if (!driveClient) throw new Error("Drive client not connected")

    let trackFile: AudioTrackFileItem | undefined
    let loadedBlob: Blob | undefined

    if (syncingTracks[id]) return resolve({ file: trackFile, blob: loadedBlob })

    dispatch({
      type: "appendSyncProcess",
      payload: { id, resolve },
    })
  }

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
    getChildren: async (id: string) => {
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
      if (currentFolder.type !== "folder") {
        throw new Error("Item is not a folder")
      }

      if (state.driveClient) {
        try {
          const response = await state.driveClient
            .api(`/me/drive/items/${id}/children`)
            .get()
          const children: BaseFileItem[] = await Promise.all(
            response.value.map((item: any) => {
              if (!state.fileDb)
                throw new Error("File database not initialized")
              return makeFileItemFromResponseAndSync(item, state.fileDb)
            })
          )

          const childrenIds = children.map(child => child.id)
          currentFolder.childrenIds = childrenIds
          state.fileDb
            .transaction("files", "readwrite")
            .objectStore("files")
            .put(currentFolder)

          return children
        } catch (error) {
          console.error(error)
          enqueueSnackbar(`${error}`, { variant: "error" })
          return []
        }
      } else {
        const folderItem = (await getFileItemFromIdb(
          state.fileDb,
          id
        )) as FolderItem
        const childrenIds = folderItem.childrenIds
        if (childrenIds === undefined) {
          return []
        }

        const childrenPromise: Promise<BaseFileItem | undefined>[] =
          childrenIds.map(childId => {
            if (!state.fileDb) throw new Error("File database not initialized")
            return getFileItemFromIdb(state.fileDb, childId)
          })
        const children = await Promise.all(childrenPromise)
        return children.filter(child => child !== undefined) as BaseFileItem[]
      }
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
        if (blob) return { blob, track }
      }

      const { file, blob } = await new Promise<{
        file: AudioTrackFileItem | undefined
        blob: Blob | undefined
      }>(resolve => {
        requestSyncTrack(id, resolve)
      })
      return { blob, file }
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
): Promise<BaseFileItem> {
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

  db.transaction("files", "readwrite").objectStore("files").put(dbItem)
  return dbItem as BaseFileItem
}

const acquireAccessToken = async (pca: PublicClientApplication) => {
  try {
    const redirectResponse = await pca.handleRedirectPromise()
    if (redirectResponse) {
      return redirectResponse.accessToken
    }
  } catch (error) {
    console.error(error)
    enqueueSnackbar(`${error}`, { variant: "error" })
  }

  const loginRequest = {
    scopes: ["Files.Read", "Sites.Read.All"],
  }

  const accounts = pca.getAllAccounts()
  if (accounts.length === 0) {
    pca.loginRedirect(loginRequest)
    return ""
  }

  const silentRequest = {
    scopes: ["Files.Read", "Sites.Read.All"],
    account: accounts[0],
  }

  try {
    const response = await pca.acquireTokenSilent(silentRequest)
    return response.accessToken
  } catch (error) {
    if (error instanceof InteractionRequiredAuthError) {
      pca.acquireTokenRedirect(loginRequest)
      return ""
    }
    throw error
  }
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

const getRootsAndSync = async (client: Client, db: IDBDatabase) => {
  const response = await client.api("/me/drive/root/children").get()

  db.transaction("roots", "readwrite").objectStore("roots").clear()

  const roots: BaseFileItem[] = await Promise.all(
    response.value.map((item: any) => {
      return makeFileItemFromResponseAndSync(item, db)
    })
  )

  roots.forEach(root => {
    db.transaction("roots", "readwrite")
      .objectStore("roots")
      .put({ id: root.id })
  })

  return roots
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
    case "setRootFiles":
      return { ...state, rootFiles: action.payload }
    case "setConfigured":
      return { ...state, configured: action.payload }
    case "appendSyncProcess": {
      const { id, resolve } = action.payload
      const { fileDb, driveClient } = state
      if (!fileDb) throw new Error("File database not initialized")
      if (!driveClient) throw new Error("Drive client not connected")

      let trackFile: AudioTrackFileItem | undefined
      let loadedBlob: Blob | undefined

      const nextProcess = state.syncProcess
        .then(() => getFileItemFromIdb(fileDb, id))
        .then(item => {
          if (!item) throw new Error("Item not found")
          trackFile = item as AudioTrackFileItem

          console.log("START", id)

          return driveClient
            .api(`/me/drive/items/${id}?select=id,@microsoft.graph.downloadUrl`)
            .get()
        })
        .then(response => {
          const downloadUrl = response["@microsoft.graph.downloadUrl"]
          return fetch(downloadUrl)
        })
        .then(response => response.blob())
        .then(blob => {
          loadedBlob = blob
          return mm.parseBlob(blob)
        })
        .then(metadata => {
          assert(trackFile !== undefined)
          trackFile.metadata = metadata
          fileDb
            .transaction("files", "readwrite")
            .objectStore("files")
            .put(trackFile)
          fileDb
            .transaction("blobs", "readwrite")
            .objectStore("blobs")
            .put(loadedBlob, id)
        })
        .catch(error => {
          console.error(error)
          enqueueSnackbar(`${error}`, { variant: "error" })
        })
        .then(() => {
          console.log("END", loadedBlob)
          resolve({ file: trackFile, blob: loadedBlob })
          return { file: trackFile, blob: loadedBlob }
        })
      return {
        ...state,
        syncingTrackFiles: { ...state.syncingTrackFiles, [id]: true },
        syncProcess: nextProcess,
      }
    }
    case "completeSyncProcess": {
      const { id } = action.payload
      const { [id]: _, ...syncingTracks } = state.syncingTrackFiles
      return {
        ...state,
        syncingTrackFiles: syncingTracks,
      }
    }

    default:
      return state
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
    rootFiles: undefined,
    configured: false,
    syncingTrackFiles: {},
    syncProcess: Promise.resolve({ file: undefined, blob: undefined }),
  })

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
          }`,
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
            {
              const store = db.createObjectStore("files", { keyPath: "id" })
              store.createIndex("path", "path")
            }
            {
              db.createObjectStore("roots", { keyPath: "id" })
            }
            {
              db.createObjectStore("blobs")
            }
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
        const rootIds = await getIdbRequest(
          fileDb.transaction("roots", "readonly").objectStore("roots").getAll()
        )
        const roots = await Promise.all(
          rootIds.map((elem: any) => {
            if (!fileDb) throw new Error("File database not initialized")
            return getIdbRequest(
              fileDb
                .transaction("files", "readwrite")
                .objectStore("files")
                .get(elem.id)
            )
          })
        )
        roots.sort((a, b) => a.name.localeCompare(b.name))
        dispatch({ type: "setRootFiles", payload: roots })
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

  useEffect(() => {
    if (!state.configured) return
    if (!networkMonitor.isOnline) {
      // If offline, client should be disconnected.
      dispatch({ type: "setDriveClient", payload: undefined })
      return
    }

    if (!state.pca) return

    acquireAccessToken(state.pca)
      .then(accessToken => {
        const client = Client.init({
          authProvider: done => {
            done(null, accessToken)
          },
        })
        dispatch({ type: "setDriveClient", payload: client })
        enqueueSnackbar("Drive Client Connected", { variant: "success" })
      })
      .catch(error => {
        console.error(error)
        enqueueSnackbar(`${error}`, { variant: "error" })
      })
  }, [networkMonitor, state.configured, state.pca])

  useEffect(() => {
    if (state.driveClient === undefined) return

    getRootsAndSync(state.driveClient, state.fileDb as IDBDatabase)
      .then(roots => {
        dispatch({ type: "setRootFiles", payload: roots })
      })
      .catch(error => {
        console.error(error)
        enqueueSnackbar(`${error}`, { variant: "error" })
      })
  }, [state.driveClient, state.fileDb])

  return (
    <FileStoreStateContext.Provider value={state}>
      <FileStoreDispatchContext.Provider value={dispatch}>
        {children}
      </FileStoreDispatchContext.Provider>
    </FileStoreStateContext.Provider>
  )
}
