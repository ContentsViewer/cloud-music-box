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
import { useNetworkMonitor } from "@/src/stores/network-monitor"
import { idbRequest } from "@/src/lib/idb/request"
import * as mm from "music-metadata-browser"
import assert from "assert"
import {
  BaseFileItem,
  FolderItem,
  AudioTrackFileItem,
  getDriveConfig,
  AUDIO_FORMAT_MAPPING,
} from "../api/base-drive-client"
import { BaseDriveClient } from "../api/base-drive-client"
import { createOneDriveClient } from "../api/onedrive-client"
import { createGoogleDriveClient } from "../api/google-drive-client"
import { ArtworkRecord, sha256Hex } from "@/src/lib/artworks/artworks"
import { extractColorFromImage } from "@/src/lib/theming/color-from-image"
import {
  LocalFileRecord,
  mergeAlbumRecord,
  mergeFileEntry,
} from "@/src/lib/export/merge"
import { ExportedAlbum, ExportedFileEntry } from "@/src/lib/export/schema"

export const FILE_DB_NAME = "file-db"

/**
 * IndexedDB schema version. Bump when adding an object store.
 *
 * The upgrade handler is **idempotent**: every store is created behind an
 * `objectStoreNames.contains` guard, so a user on any older version reaches the
 * current schema in one step. Never drop those guards — v1 databases (opened
 * without a version argument) re-enter the handler on the way to v2, and an
 * unguarded `createObjectStore("files")` would throw ConstraintError and abort
 * the whole upgrade, leaving the app permanently unconfigured.
 */
export const FILE_DB_VERSION = 4

/**
 * Set once the one-time move of embedded pictures into the `artworks` store has
 * completed. Purely an optimization to skip the (idempotent) startup sweep —
 * losing the flag only costs one harmless re-scan.
 */
const ARTWORKS_MIGRATED_KEY = "artworks.migrated"

interface SyncTask {
  fileId: string
  resolve: ({}: { file?: AudioTrackFileItem; blob?: Blob }) => void
  reject: (error: any) => void
}

export interface AlbumItem {
  name: string
  fileIds: string[]
  /** SHA-256 key into the `artworks` store (replaced the old `cover?: Blob`). */
  coverHash?: string
}

/** Shape of pre-v3 records, only ever seen by the startup migration. */
type LegacyAlbumItem = AlbumItem & { cover?: Blob }

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

  /**
   * Non-null while the one-time artwork migration is running at startup.
   * `configured` stays false for the whole window, so the modal this drives is
   * the only thing the user can interact with.
   */
  migrationProgress: { done: number; total: number } | null
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
  migrationProgress: null,
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
  | {
      type: "setMigrationProgress"
      payload: { done: number; total: number } | null
    }

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
        )) as FolderItem | undefined
        // No local record for this folder yet (e.g. a jump to an imported
        // track's parent) — nothing cached to list; the remote path fills in.
        if (!currentFolder) return undefined

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

        const count = await idbRequest(
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
        const count = await idbRequest(
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
          const blob = (await idbRequest(
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

        const albumIds = await idbRequest<string[]>(
          refState.current.fileDb
            .transaction("albums")
            .objectStore("albums")
            .getAllKeys() as IDBRequest<string[]>
        )

        return albumIds
      },
      getArtwork: async (hash: string): Promise<ArtworkRecord | undefined> => {
        if (!refState.current.configured) {
          throw new Error("File store not configured")
        }
        if (!refState.current.fileDb) {
          throw new Error("File database not initialized")
        }

        return getArtworkFromIdb(refState.current.fileDb, hash)
      },
      /**
       * Theme source color for an artwork, computed at most once per image (the
       * color is a pure function of the image bytes the hash addresses).
       *
       * Cached in `artworks-meta`, NEVER written back into the `artworks`
       * record: those records are write-once (CAS invariant) because rewriting
       * a record that carries a displayed blob may orphan the blob file backing
       * a live object URL — the pre-v3 "covers vanish during downloads" bug
       * class. Legacy records may still carry the color inline (pre-v4 writes);
       * it is read as a fallback and copied forward into the meta store.
       */
      getArtworkThemeColor: async (
        hash: string
      ): Promise<number | undefined> => {
        if (!refState.current.configured) {
          throw new Error("File store not configured")
        }
        const fileDb = refState.current.fileDb
        if (!fileDb) {
          throw new Error("File database not initialized")
        }

        const meta = (await idbRequest(
          fileDb
            .transaction("artworks-meta")
            .objectStore("artworks-meta")
            .get(hash)
        )) as { themeSourceColor?: number } | undefined
        if (meta?.themeSourceColor !== undefined) {
          return meta.themeSourceColor
        }

        const artwork = await getArtworkFromIdb(fileDb, hash)
        if (!artwork) return undefined
        const color =
          artwork.themeSourceColor !== undefined
            ? artwork.themeSourceColor
            : await extractColorFromImage(artwork.blob)
        await idbRequest(
          fileDb
            .transaction("artworks-meta", "readwrite")
            .objectStore("artworks-meta")
            .put({ themeSourceColor: color }, hash)
        )
        return color
      },
      /** Everything the export file needs from this store, read in one shot.
       *  Records are picture-free post-v3, so getAll stays lightweight; the
       *  artwork blobs come back as disk-backed handles, not loaded bytes. */
      readLibrarySnapshot: async (): Promise<{
        tracks: AudioTrackFileItem[]
        folders: FolderItem[]
        albums: AlbumItem[]
        artworks: Array<{ hash: string; blob: Blob }>
      }> => {
        if (!refState.current.configured) {
          throw new Error("File store not configured")
        }
        const fileDb = refState.current.fileDb
        if (!fileDb) {
          throw new Error("File database not initialized")
        }

        const all = await idbRequest<BaseFileItem[]>(
          fileDb.transaction("files").objectStore("files").getAll()
        )
        const tracks = all.filter(
          item => item.type === "audio-track"
        ) as AudioTrackFileItem[]
        const folders = all.filter(
          item => item.type === "folder"
        ) as FolderItem[]
        const albums = await idbRequest<AlbumItem[]>(
          fileDb.transaction("albums").objectStore("albums").getAll()
        )
        const artworks = await new Promise<
          Array<{ hash: string; blob: Blob }>
        >((resolve, reject) => {
          const out: Array<{ hash: string; blob: Blob }> = []
          const req = fileDb
            .transaction("artworks")
            .objectStore("artworks")
            .openCursor()
          req.onsuccess = () => {
            const cursor = req.result
            if (!cursor) {
              resolve(out)
              return
            }
            const record = cursor.value as ArtworkRecord
            out.push({ hash: String(cursor.key), blob: record.blob })
            cursor.continue()
          }
          req.onerror = () => reject(req.error)
        })
        return { tracks, folders, albums, artworks }
      },

      /**
       * Batch import with the pure merge rules: artworks first (so hash
       * references resolve), then file-tree entries (folders + tracks in one
       * chunked loop, get→merge→put chained inside each tx), then albums.
       * Local data is never downgraded.
       */
      importLibraryData: async (
        data: {
          files: ExportedFileEntry[]
          albums: ExportedAlbum[]
          artworks: Array<{ hash: string; blob: Blob }>
        },
        onProgress?: (done: number, total: number) => void
      ): Promise<{
        tracksAdded: number
        tracksMerged: number
        foldersAdded: number
        foldersMerged: number
        entriesSkipped: number
        albumsAdded: number
        albumsMerged: number
        artworksAdded: number
      }> => {
        if (!refState.current.configured) {
          throw new Error("File store not configured")
        }
        const fileDb = refState.current.fileDb
        if (!fileDb) {
          throw new Error("File database not initialized")
        }

        const counts = {
          tracksAdded: 0,
          tracksMerged: 0,
          foldersAdded: 0,
          foldersMerged: 0,
          entriesSkipped: 0,
          albumsAdded: 0,
          albumsMerged: 0,
          artworksAdded: 0,
        }
        const total =
          data.artworks.length + data.files.length + data.albums.length
        let done = 0

        for (const { hash, blob } of data.artworks) {
          const existing = await getArtworkFromIdb(fileDb, hash)
          if (!existing) {
            // CAS integrity: the key must be the SHA-256 of the bytes.
            // A record failing this came from a damaged/tampered file.
            const actual = await sha256Hex(
              new Uint8Array(await blob.arrayBuffer())
            )
            if (actual === hash) {
              const record: ArtworkRecord = { blob }
              await idbRequest(
                fileDb
                  .transaction("artworks", "readwrite")
                  .objectStore("artworks")
                  .put(record, hash)
              )
              counts.artworksAdded++
            } else {
              console.warn("Skipping artwork with mismatched hash", hash)
            }
          }
          done++
          onProgress?.(done, total)
        }

        const CHUNK = 200
        for (let i = 0; i < data.files.length; i += CHUNK) {
          const chunk = data.files.slice(i, i + CHUNK)
          await new Promise<void>((resolve, reject) => {
            const tx = fileDb.transaction("files", "readwrite")
            const store = tx.objectStore("files")
            for (const imported of chunk) {
              const getReq = store.get(imported.id)
              getReq.onsuccess = () => {
                const local = getReq.result as LocalFileRecord | undefined
                // Dispatches by entry type; cross-type id collisions and
                // unknown node kinds come back as "skipped".
                const { record, outcome } = mergeFileEntry(local, imported)
                if (outcome === "skipped") {
                  counts.entriesSkipped++
                  return
                }
                const isFolder = imported.type === "folder"
                if (outcome === "added") {
                  if (isFolder) counts.foldersAdded++
                  else counts.tracksAdded++
                } else if (outcome === "merged") {
                  if (isFolder) counts.foldersMerged++
                  else counts.tracksMerged++
                }
                if (
                  record &&
                  (outcome === "added" || outcome === "merged")
                ) {
                  store.put(record)
                }
              }
            }
            tx.oncomplete = () => resolve()
            tx.onerror = () => reject(tx.error)
            tx.onabort = () => reject(tx.error ?? new Error("aborted"))
          })
          done += chunk.length
          onProgress?.(done, total)
        }

        for (const imported of data.albums) {
          const local = (await getAlbumItemFromIdb(fileDb, imported.name)) as
            | AlbumItem
            | undefined
          const { record, outcome } = mergeAlbumRecord(local, imported)
          if (outcome === "added" || outcome === "merged") {
            await idbRequest(
              fileDb
                .transaction("albums", "readwrite")
                .objectStore("albums")
                .put(record, imported.name)
            )
          }
          if (outcome === "added") counts.albumsAdded++
          else if (outcome === "merged") counts.albumsMerged++
          done++
          onProgress?.(done, total)
        }

        return counts
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

        await idbRequest(
          refState.current.fileDb
            .transaction("blobs", "readwrite")
            .objectStore("blobs")
            .clear()
        )
        await idbRequest(
          refState.current.fileDb
            .transaction("blobs-meta", "readwrite")
            .objectStore("blobs-meta")
            .clear()
        )
        localStorage.setItem("blobsStorageUsageBytes", "0")
        dispatch({ type: "setBlobsStorageUsageBytes", payload: 0 })
      },
      addPickerGroup: async (
        files: Array<{id: string, name: string, mimeType: string, parentId?: string}>,
        folderNames?: Map<string, string>
      ) => {
        console.log("addPickerGroup called with files:", files)
        console.log("folderNames:", folderNames)

        if (!refState.current.configured) {
          throw new Error("File store not configured")
        }
        if (!refState.current.fileDb) {
          throw new Error("File database not initialized")
        }

        // Group files by parentId
        const filesByParent = new Map<string, Array<{id: string, name: string, mimeType: string, parentId?: string}>>()

        for (const file of files) {
          const parentId = file.parentId || "unknown"
          if (!filesByParent.has(parentId)) {
            filesByParent.set(parentId, [])
          }
          filesByParent.get(parentId)!.push(file)
        }

        const transaction = refState.current.fileDb.transaction("files", "readwrite")
        const store = transaction.objectStore("files")
        const createdFolderIds: string[] = []

        // Create/update a folder for each parentId
        for (const [driveParentId, groupFiles] of Array.from(filesByParent.entries())) {
          // Use the Drive folder id as the virtual folder id
          const folderId = driveParentId

          // Fetch the existing folder
          const existingFolderRequest = store.get(folderId)
          const existingFolder = await new Promise<FolderItem | undefined>((resolve) => {
            existingFolderRequest.onsuccess = () => {
              resolve(existingFolderRequest.result as FolderItem | undefined)
            }
            existingFolderRequest.onerror = () => {
              resolve(undefined)
            }
          })

          // Folder name: from folderNames, preferring the existing name, else a default
          const folderName = existingFolder?.name || folderNames?.get(driveParentId) || `Folder ${driveParentId.substring(0, 8)}`

          // Append the new file ids to the existing childrenIds (avoiding duplicates)
          const existingChildrenIds = new Set(existingFolder?.childrenIds || [])
          groupFiles.forEach((f: {id: string}) => existingChildrenIds.add(f.id))

          const groupFolder: FolderItem = {
            id: folderId,
            name: folderName,
            type: "folder",
            parentId: "root",
            childrenIds: Array.from(existingChildrenIds),
          }

          console.log("Creating/Updating folder:", groupFolder)
          store.put(groupFolder)
          createdFolderIds.push(folderId)

          // Save each file into IDB
          for (const file of groupFiles) {
            const ext = file.name.split(".").pop()?.toLowerCase() || ""
            const audioFormatInfo = AUDIO_FORMAT_MAPPING[ext]

            const fileItem: BaseFileItem = {
              id: file.id,
              name: file.name,
              type: audioFormatInfo ? "audio-track" : "file",
              parentId: folderId,
              ...(audioFormatInfo && { mimeType: audioFormatInfo.mimeType }),
            }
            console.log("Creating file:", fileItem)
            store.put(fileItem)
          }
        }

        // Update the root folder childrenIds
        const getRootRequest = store.get("root")
        getRootRequest.onsuccess = () => {
          const rootFolder = getRootRequest.result as FolderItem | undefined
          if (rootFolder) {
            // Append the new folder ids to the existing childrenIds (avoiding duplicates)
            const existingIds = new Set(rootFolder.childrenIds || [])
            createdFolderIds.forEach(id => existingIds.add(id))
            rootFolder.childrenIds = Array.from(existingIds)
            store.put(rootFolder)
            console.log("Updated root folder childrenIds:", rootFolder.childrenIds)
          }
        }

        await new Promise<void>((resolve, reject) => {
          transaction.oncomplete = () => {
            console.log("Transaction completed successfully")
            resolve()
          }
          transaction.onerror = () => {
            console.error("Transaction error:", transaction.error)
            reject(transaction.error)
          }
        })

        console.log("Created folder IDs:", createdFolderIds)

        // Return the first created folder id (for compatibility)
        return createdFolderIds[0] || "root"
      },
      // Renames already-stored picker folders once their real names become
      // available. addPickerGroup keeps whatever name a folder already has, so
      // folders first saved under a placeholder need this to be corrected.
      updateFolderNames: async (folderNames: Map<string, string>) => {
        if (folderNames.size === 0) return
        if (!refState.current.fileDb) {
          throw new Error("File database not initialized")
        }

        const transaction = refState.current.fileDb.transaction(
          "files",
          "readwrite"
        )
        const store = transaction.objectStore("files")

        // Each put has to be issued from inside its get's onsuccess. Awaiting
        // between the two would hand control back to the event loop, which ends
        // the transaction and makes the write silently fail.
        for (const [folderId, name] of Array.from(folderNames.entries())) {
          const request = store.get(folderId)
          request.onsuccess = () => {
            const existing = request.result as FolderItem | undefined
            if (!existing || existing.name === name) return
            store.put({ ...existing, name })
          }
        }

        await new Promise<void>((resolve, reject) => {
          transaction.oncomplete = () => resolve()
          transaction.onerror = () => reject(transaction.error)
          transaction.onabort = () => reject(transaction.error)
        })
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

function getArtworkFromIdb(
  db: IDBDatabase,
  hash: string
): Promise<ArtworkRecord | undefined> {
  return idbRequest<ArtworkRecord | undefined>(
    db.transaction("artworks").objectStore("artworks").get(hash)
  )
}

/**
 * The persisted copy of a parse result: embedded pictures live once in the
 * `artworks` store and `native` (raw per-format tag dictionaries) is read by
 * nothing, so neither is written to IndexedDB. The in-memory object of the
 * playing track keeps the full parse.
 */
function stripMetadataForPersistence(
  metadata: mm.IAudioMetadata
): mm.IAudioMetadata {
  return {
    ...metadata,
    native: {},
    common: { ...metadata.common, picture: undefined },
  }
}

/**
 * Content-addresses the selected embedded picture: SHA-256 of the ORIGINAL
 * bytes is the key (stable across devices), the untouched bytes are the value.
 * Returns the hash, or undefined when the metadata carries no picture.
 */
async function storeEmbeddedArtwork(
  db: IDBDatabase,
  metadata: mm.IAudioMetadata
): Promise<string | undefined> {
  const cover = mm.selectCover(metadata.common.picture)
  if (!cover) return undefined
  const bytes =
    cover.data instanceof Uint8Array ? cover.data : new Uint8Array(cover.data)
  const hash = await sha256Hex(bytes)
  const existing = await getArtworkFromIdb(db, hash)
  if (!existing) {
    const record: ArtworkRecord = {
      blob: new Blob([bytes], { type: cover.format }),
    }
    await idbRequest(
      db.transaction("artworks", "readwrite").objectStore("artworks").put(record, hash)
    )
  }
  return hash
}

/**
 * One-time move of embedded pictures out of `files`/`albums` records into the
 * content-addressed `artworks` store (v3). Idempotent: the contract is the
 * observable fact "does this record still carry picture bytes", so an
 * interrupted run resumes where it stopped on the next launch. Records are
 * fetched one at a time (never getAll — that would load every image at once,
 * the very failure mode this migration removes), with a few in flight so
 * native SHA-256 overlaps IndexedDB IO.
 */
async function migrateToContentAddressedArtworks(
  db: IDBDatabase,
  onProgress: (done: number, total: number) => void
) {
  const fileKeys = await idbRequest<IDBValidKey[]>(
    db.transaction("files").objectStore("files").getAllKeys()
  )
  const albumKeys = await idbRequest<IDBValidKey[]>(
    db.transaction("albums").objectStore("albums").getAllKeys()
  )

  const migrateFileRecord = async (key: IDBValidKey) => {
    const item = await idbRequest<BaseFileItem | undefined>(
      db.transaction("files").objectStore("files").get(key)
    )
    if (!item || item.type !== "audio-track") return
    const track = item as AudioTrackFileItem
    const metadata = track.metadata
    if (!metadata) return
    const hasPicture = !!metadata.common.picture?.length
    const hasNative = Object.keys(metadata.native ?? {}).length > 0
    if (!hasPicture && !hasNative) return

    if (hasPicture) {
      const hash = await storeEmbeddedArtwork(db, metadata)
      if (hash && track.artworkHash === undefined) track.artworkHash = hash
    }
    track.metadata = stripMetadataForPersistence(metadata)
    await idbRequest(
      db.transaction("files", "readwrite").objectStore("files").put(track)
    )
  }

  const migrateAlbumRecord = async (key: IDBValidKey) => {
    const album = await idbRequest<LegacyAlbumItem | undefined>(
      db.transaction("albums").objectStore("albums").get(key)
    )
    if (!album || album.cover === undefined) return
    const bytes = new Uint8Array(await album.cover.arrayBuffer())
    const hash = await sha256Hex(bytes)
    const existing = await getArtworkFromIdb(db, hash)
    if (!existing) {
      const record: ArtworkRecord = { blob: album.cover }
      await idbRequest(
        db.transaction("artworks", "readwrite").objectStore("artworks").put(record, hash)
      )
    }
    if (album.coverHash === undefined) album.coverHash = hash
    delete album.cover
    await idbRequest(
      db.transaction("albums", "readwrite").objectStore("albums").put(album, key)
    )
  }

  const tasks: Array<() => Promise<void>> = [
    ...fileKeys.map(key => () => migrateFileRecord(key)),
    ...albumKeys.map(key => () => migrateAlbumRecord(key)),
  ]
  const total = tasks.length
  let done = 0
  onProgress(done, total)

  const CONCURRENCY = 4
  let next = 0
  const workers = Array.from(
    { length: Math.min(CONCURRENCY, tasks.length) },
    async () => {
      while (next < tasks.length) {
        const task = tasks[next++]
        await task()
        done++
        onProgress(done, total)
      }
    }
  )
  await Promise.all(workers)
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
  let record = (await idbRequest(
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

  await idbRequest(
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
    case "setMigrationProgress": {
      return { ...state, migrationProgress: action.payload }
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
    migrationProgress: null,
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
          const req = indexedDB.open(FILE_DB_NAME, FILE_DB_VERSION)

          req.onsuccess = () => {
            resolve(req.result)
          }

          req.onerror = () => {
            reject(req.error)
          }

          // Another tab still holds a connection at the old version, so the
          // upgrade cannot start. Without this the promise never settles and
          // init hangs silently (a stranded OAuth redirect tab is enough).
          req.onblocked = () => {
            enqueueSnackbar(
              "Please close the other tabs of this app to finish updating the local database.",
              { variant: "error", persist: true }
            )
          }

          req.onupgradeneeded = () => {
            const db = req.result
            const names = db.objectStoreNames

            if (!names.contains("files")) {
              db.createObjectStore("files", { keyPath: "id" })
            }
            if (!names.contains("blobs")) {
              db.createObjectStore("blobs")
            }
            if (!names.contains("albums")) {
              db.createObjectStore("albums")
            }
            if (!names.contains("blobs-meta")) {
              const store = db.createObjectStore("blobs-meta", {
                keyPath: "id",
              })
              store.createIndex("last-accessed", "lastAccessed")
            }
            // v2: audio feature vectors and seed-grown playlists
            if (!names.contains("track-features")) {
              db.createObjectStore("track-features", { keyPath: "id" })
            }
            if (!names.contains("playlists")) {
              db.createObjectStore("playlists", { keyPath: "id" })
            }
            if (!names.contains("playlist-model")) {
              db.createObjectStore("playlist-model")
            }
            // v3: content-addressed artwork blobs (key = SHA-256 of the bytes)
            if (!names.contains("artworks")) {
              db.createObjectStore("artworks")
            }
            // v4: derived artwork metadata (key = same SHA-256). Kept OUTSIDE
            // the `artworks` records so those stay write-once after creation:
            // rewriting a record that carries a displayed blob is the bug class
            // that made covers vanish during downloads before v3 (the engine
            // may orphan the blob file backing a displayed object URL).
            if (!names.contains("artworks-meta")) {
              db.createObjectStore("artworks-meta")
            }
          }
        })
        // Another tab wants to upgrade: release the connection so it is not
        // blocked by us. Everything below this point needs a reload, so mark
        // the store unconfigured instead of letting transactions throw.
        fileDb.onversionchange = () => {
          fileDb?.close()
          dispatch({ type: "setConfigured", payload: false })
          enqueueSnackbar(
            "The local database was updated in another tab. Please reload the app.",
            { variant: "error", persist: true }
          )
        }
        // One-time v3 data migration. It runs while the db handle is still
        // local to init() and `configured` is false — every store action
        // double-guards on those, so no user-triggered DB operation can
        // interleave with it. The localStorage flag only skips the (idempotent)
        // sweep; losing it costs one harmless re-scan.
        if (localStorage.getItem(ARTWORKS_MIGRATED_KEY) === null) {
          try {
            let lastDispatched = -1
            await migrateToContentAddressedArtworks(fileDb, (done, total) => {
              if (total === 0) return
              // Dispatching every record would re-render per record; every ~1%
              // (plus the final tick) is plenty for a progress bar.
              const step = Math.max(1, Math.floor(total / 100))
              if (done !== total && done - lastDispatched < step) return
              lastDispatched = done
              dispatch({
                type: "setMigrationProgress",
                payload: { done, total },
              })
            })
            localStorage.setItem(ARTWORKS_MIGRATED_KEY, "1")
          } finally {
            dispatch({ type: "setMigrationProgress", payload: null })
          }
        }
        dispatch({ type: "setFileDb", payload: fileDb })
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

          // Create the virtual root folder for Google Drive Picker mode
          if (fileDb) {
            const rootFolder: FolderItem = {
              id: "root",
              name: "Google Drive Files",
              type: "folder",
              childrenIds: [],
            }
            // Create the root folder only if it does not exist
            const existingRoot = await idbRequest(
              fileDb.transaction("files").objectStore("files").get("root")
            )
            if (!existingRoot) {
              await idbRequest(
                fileDb
                  .transaction("files", "readwrite")
                  .objectStore("files")
                  .put(rootFolder)
              )
            }
            // Set the rootFolderId
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
            .then(async item => {
              if (!item) throw new Error("Item not found")
              if (item.type !== "audio-track")
                throw new Error("Item is not a track")
              assert(blobsStorageUsageBytesRef.current !== undefined)

              trackFile = item as AudioTrackFileItem
              // The in-memory object keeps the full parse (the player reads it
              // right away); the persisted copy carries artworkHash instead of
              // the picture bytes.
              trackFile.metadata = metadata
              const artworkHash = await storeEmbeddedArtwork(fileDb, metadata)
              if (artworkHash) trackFile.artworkHash = artworkHash
              const persistedTrack: AudioTrackFileItem = {
                ...trackFile,
                metadata: stripMetadataForPersistence(metadata),
              }
              fileDb
                .transaction("files", "readwrite")
                .objectStore("files")
                .put(persistedTrack)

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
                  }
                }
                if (albumItem.coverHash === undefined && artworkHash) {
                  albumItem.coverHash = artworkHash
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
