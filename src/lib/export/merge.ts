/**
 * Pure merge rules for import. Every function takes (local | undefined,
 * imported) and returns the merged record plus an outcome tag, so the caller
 * gets result counts for free and the rules stay unit-testable without
 * IndexedDB.
 *
 * Shared principles:
 * - Local data is never downgraded (full metadata beats a projection, a longer
 *   listen beats a shorter one, a newer edit beats an older one).
 * - Order is preserved: local order first, imported additions appended.
 */

import {
  ExportedAlbum,
  ExportedFileEntry,
  ExportedFolder,
  ExportedPlaylist,
  ExportedTrack,
} from "./schema"

export type MergeOutcome = "added" | "merged" | "unchanged" | "skipped"

/** Concatenation that keeps first-occurrence order and drops duplicates. */
function dedupeConcat(a: readonly string[], b: readonly string[]): string[] {
  const seen = new Set<string>()
  const out: string[] = []
  for (const id of [...a, ...b]) {
    if (seen.has(id)) continue
    seen.add(id)
    out.push(id)
  }
  return out
}

function sameIdSet(a: readonly string[], b: readonly string[]): boolean {
  if (a.length !== b.length) return false
  const set = new Set(a)
  return b.every(id => set.has(id))
}

// ---------------------------------------------------------------------------
// files (tree nodes: folders + tracks, mirroring the IDB `files` store)

export interface LocalTrackRecord {
  id: string
  name: string
  type: "audio-track"
  parentId?: string
  mimeType: string
  metadata?: unknown
  artworkHash?: string
}

export interface LocalFolderRecord {
  id: string
  name: string
  type: "folder"
  parentId?: string
  childrenIds?: string[]
}

export type LocalFileRecord = LocalTrackRecord | LocalFolderRecord

/**
 * Local metadata is untouchable: a locally present parse is always a superset
 * of the exported projection. `parentId` is stored verbatim — it is a cloud
 * id, and pointing at a folder that is not cached yet is a normal state of
 * the lazy tree cache (the files page resolves or reports it; see
 * docs/architecture.md).
 */
export function mergeTrackRecord(
  local: LocalTrackRecord | undefined,
  imported: ExportedTrack
): { record: LocalTrackRecord; outcome: MergeOutcome } {
  if (!local) {
    return {
      record: {
        id: imported.id,
        name: imported.name,
        type: "audio-track",
        parentId: imported.parentId,
        mimeType: imported.mimeType,
        metadata: imported.metadata,
        artworkHash: imported.artworkHash,
      },
      outcome: "added",
    }
  }

  const record: LocalTrackRecord = { ...local }
  let changed = false
  if (record.parentId === undefined && imported.parentId !== undefined) {
    record.parentId = imported.parentId
    changed = true
  }
  if (record.metadata === undefined && imported.metadata !== undefined) {
    record.metadata = imported.metadata
    changed = true
  }
  if (record.artworkHash === undefined && imported.artworkHash !== undefined) {
    record.artworkHash = imported.artworkHash
    changed = true
  }
  return { record, outcome: changed ? "merged" : "unchanged" }
}

/**
 * Folders are a (partial) cache of the cloud tree: fill-if-undefined for
 * scalars, union for `childrenIds` (same rule as albums.fileIds — remote
 * browsing rewrites the full truth later on OneDrive; Google picker groups
 * are primary data and the union is exact).
 */
export function mergeFolderRecord(
  local: LocalFolderRecord | undefined,
  imported: ExportedFolder
): { record: LocalFolderRecord; outcome: MergeOutcome } {
  if (!local) {
    return {
      record: {
        id: imported.id,
        name: imported.name,
        type: "folder",
        parentId: imported.parentId,
        childrenIds: [...imported.childrenIds],
      },
      outcome: "added",
    }
  }

  const record: LocalFolderRecord = { ...local }
  let changed = false
  if (record.parentId === undefined && imported.parentId !== undefined) {
    record.parentId = imported.parentId
    changed = true
  }
  const childrenIds = dedupeConcat(
    local.childrenIds ?? [],
    imported.childrenIds
  )
  if (childrenIds.length !== (local.childrenIds?.length ?? 0)) {
    record.childrenIds = childrenIds
    changed = true
  }
  return { record, outcome: changed ? "merged" : "unchanged" }
}

/**
 * Entry point for one `files` entry. Dispatches on `type`; an entry whose
 * type this build does not know — or whose id collides with a local record of
 * a DIFFERENT type — is skipped (never clobber across kinds).
 */
export function mergeFileEntry(
  local: LocalFileRecord | undefined,
  imported: ExportedFileEntry
): { record: LocalFileRecord | null; outcome: MergeOutcome } {
  if (imported.type === "audio-track") {
    if (local && local.type !== "audio-track") {
      return { record: null, outcome: "skipped" }
    }
    return mergeTrackRecord(local as LocalTrackRecord | undefined, imported)
  }
  if (imported.type === "folder") {
    if (local && local.type !== "folder") {
      return { record: null, outcome: "skipped" }
    }
    return mergeFolderRecord(local as LocalFolderRecord | undefined, imported)
  }
  // Unknown node kind from a newer app: ignore, per the forward-compat rule.
  return { record: null, outcome: "skipped" }
}

// ---------------------------------------------------------------------------
// albums

export interface LocalAlbumRecord {
  name: string
  fileIds: string[]
  coverHash?: string
}

export function mergeAlbumRecord(
  local: LocalAlbumRecord | undefined,
  imported: ExportedAlbum
): { record: LocalAlbumRecord; outcome: MergeOutcome } {
  if (!local) {
    return {
      record: {
        name: imported.name,
        fileIds: [...imported.fileIds],
        coverHash: imported.coverHash,
      },
      outcome: "added",
    }
  }
  const fileIds = dedupeConcat(local.fileIds, imported.fileIds)
  const coverHash = local.coverHash ?? imported.coverHash
  const changed =
    fileIds.length !== local.fileIds.length || coverHash !== local.coverHash
  return {
    record: { ...local, fileIds, coverHash },
    outcome: changed ? "merged" : "unchanged",
  }
}

// ---------------------------------------------------------------------------
// track features

export interface TrackFeatureLike {
  id: string
  version: number
  vector: Float32Array
  coverageSeconds: number
  durationSeconds: number
  updatedAt: number
}

/**
 * "A shorter listen must not overwrite a longer one": the record with the
 * larger coverage wins; ties go to the newer record. Wrong version or wrong
 * dimension is skipped, mirroring the corpus load filter.
 */
export function mergeTrackFeature(
  local: TrackFeatureLike | undefined,
  imported: TrackFeatureLike,
  expectedVersion: number,
  expectedDim: number
): { record: TrackFeatureLike | null; outcome: MergeOutcome } {
  if (
    imported.version !== expectedVersion ||
    imported.vector.length !== expectedDim
  ) {
    return { record: null, outcome: "skipped" }
  }
  if (!local) return { record: imported, outcome: "added" }
  if (local.coverageSeconds > imported.coverageSeconds) {
    return { record: local, outcome: "unchanged" }
  }
  if (
    local.coverageSeconds === imported.coverageSeconds &&
    local.updatedAt >= imported.updatedAt
  ) {
    return { record: local, outcome: "unchanged" }
  }
  return { record: imported, outcome: "merged" }
}

// ---------------------------------------------------------------------------
// playlists (truth only)

export interface PlaylistTruth {
  id: string
  name: string
  seedIds: string[]
  confirmedIds: string[]
  rejectedIds: string[]
  coverTrackId?: string
  createdAt: number
  updatedAt: number
}

/**
 * Same id on both sides: the record with the newer `updatedAt` is the winner.
 * confirmed/rejected are unions; a track claimed by both sets follows the
 * winner's classification. seedIds stay a subset of confirmedIds. If the
 * merge would leave no confirmed track, the winner's sets are used verbatim
 * (mirror of LastConfirmedTrackError — a playlist never goes empty).
 */
export function mergePlaylistTruth(
  local: PlaylistTruth | undefined,
  imported: ExportedPlaylist
): { record: PlaylistTruth; outcome: MergeOutcome } {
  if (!local) {
    return {
      record: {
        id: imported.id,
        name: imported.name,
        seedIds: [...imported.seedIds],
        confirmedIds: [...imported.confirmedIds],
        rejectedIds: [...imported.rejectedIds],
        coverTrackId: imported.coverTrackId,
        createdAt: imported.createdAt,
        updatedAt: imported.updatedAt,
      },
      outcome: "added",
    }
  }

  const winner: PlaylistTruth =
    imported.updatedAt > local.updatedAt ? { ...imported } : local
  const loser: PlaylistTruth = winner === local ? { ...imported } : local

  const winnerConfirmed = new Set(winner.confirmedIds)

  let confirmedIds = dedupeConcat(local.confirmedIds, imported.confirmedIds)
  let rejectedIds = dedupeConcat(local.rejectedIds, imported.rejectedIds)
  const rejectedSet = new Set(rejectedIds)

  // Conflicts (confirmed on one side, rejected on the other) → the winner's
  // classification decides.
  confirmedIds = confirmedIds.filter(
    id => !rejectedSet.has(id) || winnerConfirmed.has(id)
  )
  const confirmedSet = new Set(confirmedIds)
  rejectedIds = rejectedIds.filter(id => !confirmedSet.has(id))

  let seedIds = dedupeConcat(local.seedIds, imported.seedIds).filter(id =>
    confirmedSet.has(id)
  )

  if (confirmedIds.length === 0) {
    confirmedIds = [...winner.confirmedIds]
    const winnerConfirmedSet = new Set(confirmedIds)
    seedIds = winner.seedIds.filter(id => winnerConfirmedSet.has(id))
    rejectedIds = rejectedIds.filter(id => !winnerConfirmedSet.has(id))
  }

  const pickCover = (candidate?: string) =>
    candidate !== undefined && confirmedIds.includes(candidate)
      ? candidate
      : undefined
  const coverTrackId =
    pickCover(winner.coverTrackId) ??
    pickCover(loser.coverTrackId) ??
    confirmedIds[0]

  const record: PlaylistTruth = {
    id: local.id,
    name: winner.name,
    seedIds,
    confirmedIds,
    rejectedIds,
    coverTrackId,
    createdAt: Math.min(local.createdAt, imported.createdAt),
    updatedAt: Math.max(local.updatedAt, imported.updatedAt),
  }

  const sameAsLocal =
    record.name === local.name &&
    record.coverTrackId === local.coverTrackId &&
    sameIdSet(record.seedIds, local.seedIds) &&
    sameIdSet(record.confirmedIds, local.confirmedIds) &&
    sameIdSet(record.rejectedIds, local.rejectedIds)

  return { record, outcome: sameAsLocal ? "unchanged" : "merged" }
}
