/**
 * Envelope construction: projects store records into the export schema and
 * encodes binary payloads (vectors, artwork bytes) to base64.
 */

import { blobToBase64, float32ToBase64 } from "./codec"
import { PlaylistTruth, TrackFeatureLike } from "./merge"
import {
  EXPORT_FORMAT,
  EXPORT_FORMAT_VERSION,
  ExportEnvelope,
  ExportedArtwork,
  ExportedFileEntry,
  ExportedFolder,
  ExportedTrack,
  ExportedTrackMetadata,
} from "./schema"

export interface ExportIdentity {
  provider: "onedrive" | "google-drive"
  accountKey: string
  accountLabel?: string
}

/** Structural view of a FolderItem (lib must not import features). */
export interface FolderSnapshotRecord {
  id: string
  name: string
  parentId?: string
  childrenIds?: string[]
}

/**
 * Selects the folders worth exporting: every ancestor of an exported track,
 * walked up through the local folder map. Google picker groups (the track's
 * direct parent, parented by the virtual root) are ancestors too, so the
 * whole picker tree rides along.
 */
export function selectAncestorFolders(
  tracks: ReadonlyArray<{ parentId?: string }>,
  folders: ReadonlyArray<FolderSnapshotRecord>
): FolderSnapshotRecord[] {
  const byId = new Map(folders.map(f => [f.id, f]))
  const selected = new Map<string, FolderSnapshotRecord>()
  for (const track of tracks) {
    let id = track.parentId
    while (id !== undefined && !selected.has(id)) {
      const folder = byId.get(id)
      if (!folder) break // top of the locally cached chain
      selected.set(id, folder)
      id = folder.parentId
    }
  }
  return Array.from(selected.values())
}

/** Structural view of an AudioTrackFileItem (lib must not import features). */
export interface TrackSnapshotRecord {
  id: string
  name: string
  parentId?: string
  mimeType: string
  artworkHash?: string
  metadata?: {
    format?: { duration?: number }
    common?: {
      title?: string
      artist?: string
      artists?: string[]
      album?: string
      track?: { no: number | null; of: number | null }
      disk?: { no: number | null; of: number | null }
    }
  }
}

/** Keeps exactly the fields the app reads; everything else stays home. */
export function projectTrackMetadata(
  metadata: TrackSnapshotRecord["metadata"]
): ExportedTrackMetadata | undefined {
  if (!metadata) return undefined
  const out: ExportedTrackMetadata = {}
  if (metadata.format?.duration !== undefined) {
    out.format = { duration: metadata.format.duration }
  }
  const common = metadata.common
  if (common) {
    out.common = {
      title: common.title,
      artist: common.artist,
      artists: common.artists,
      album: common.album,
      track: common.track,
      disk: common.disk,
    }
  }
  return out
}

export async function buildExportEnvelope(input: {
  identity: ExportIdentity
  appVersion?: string
  exportedAt: number
  tracks: TrackSnapshotRecord[]
  folders: FolderSnapshotRecord[]
  albums: Array<{ name: string; fileIds: string[]; coverHash?: string }>
  playlists: PlaylistTruth[]
  trackFeatures: TrackFeatureLike[]
  artworks: Array<{ hash: string; blob: Blob }>
  onProgress?: (done: number, total: number) => void
}): Promise<ExportEnvelope> {
  const {
    identity,
    appVersion,
    exportedAt,
    tracks,
    folders,
    albums,
    playlists,
    trackFeatures,
    artworks,
    onProgress,
  } = input

  const total = artworks.length
  let done = 0
  const exportedArtworks: ExportedArtwork[] = []
  for (const { hash, blob } of artworks) {
    exportedArtworks.push({
      hash,
      mime: blob.type || "image/jpeg",
      data: await blobToBase64(blob),
    })
    done++
    onProgress?.(done, total)
  }

  // Ancestors of exported tracks only; childrenIds filtered to ids that are
  // themselves in the export, so the file can never carry a reference to
  // something it does not contain.
  const selectedFolders = selectAncestorFolders(tracks, folders)
  const exportedIds = new Set<string>([
    ...tracks.map(t => t.id),
    ...selectedFolders.map(f => f.id),
  ])
  const folderEntries: ExportedFolder[] = selectedFolders.map(f => ({
    type: "folder",
    id: f.id,
    name: f.name,
    parentId: f.parentId,
    childrenIds: (f.childrenIds ?? []).filter(id => exportedIds.has(id)),
  }))

  const trackEntries: ExportedTrack[] = tracks.map(t => ({
    type: "audio-track",
    id: t.id,
    name: t.name,
    parentId: t.parentId,
    mimeType: t.mimeType,
    artworkHash: t.artworkHash,
    metadata: projectTrackMetadata(t.metadata),
  }))

  // Folders first: human-readable when gunzipped, and referents-before-
  // referrers (not required by the importer, just tidy).
  const files: ExportedFileEntry[] = [...folderEntries, ...trackEntries]

  return {
    format: EXPORT_FORMAT,
    formatVersion: EXPORT_FORMAT_VERSION,
    appVersion,
    exportedAt,
    provider: identity.provider,
    accountKey: identity.accountKey,
    accountLabel: identity.accountLabel,
    counts: {
      tracks: trackEntries.length,
      folders: folderEntries.length,
      albums: albums.length,
      playlists: playlists.length,
      trackFeatures: trackFeatures.length,
      artworks: exportedArtworks.length,
    },
    files,
    albums: albums.map(a => ({
      name: a.name,
      fileIds: [...a.fileIds],
      coverHash: a.coverHash,
    })),
    playlists: playlists.map(p => ({
      id: p.id,
      name: p.name,
      seedIds: [...p.seedIds],
      confirmedIds: [...p.confirmedIds],
      rejectedIds: [...p.rejectedIds],
      coverTrackId: p.coverTrackId,
      createdAt: p.createdAt,
      updatedAt: p.updatedAt,
    })),
    trackFeatures: trackFeatures.map(f => ({
      id: f.id,
      version: f.version,
      vector: float32ToBase64(f.vector),
      coverageSeconds: f.coverageSeconds,
      durationSeconds: f.durationSeconds,
      updatedAt: f.updatedAt,
    })),
    artworks: exportedArtworks,
  }
}
