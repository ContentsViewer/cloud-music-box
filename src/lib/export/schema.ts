/**
 * Versioned envelope for library export files.
 *
 * The envelope is validated by its `format` discriminator, never by file
 * extension. `formatVersion` only ever increases; an importer refuses files
 * newer than it understands and accepts anything older.
 */

export const EXPORT_FORMAT = "cloud-music-box-export"
export const EXPORT_FORMAT_VERSION = 1

/**
 * Projection of a track's parse result: exactly the fields the app reads
 * (title/artist/artists/album/track/disk + duration). `native`, `quality` and
 * `picture` are deliberately absent — artwork travels once per unique image in
 * `artworks`, and a full parse self-heals on first playback anyway.
 */
export interface ExportedTrackMetadata {
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

/**
 * `files` mirrors the IndexedDB `files` store: one heterogeneous array of tree
 * nodes discriminated by `type` — the same shape the data has at rest.
 *
 * Forward compatibility: importers MUST skip (and count) entries whose `type`
 * they do not recognize, so new node kinds can be added without bumping
 * `formatVersion`.
 */
export interface ExportedTrack {
  type: "audio-track"
  id: string
  name: string
  parentId?: string
  mimeType: string
  artworkHash?: string
  metadata?: ExportedTrackMetadata
}

/**
 * Only ancestors of exported tracks travel, and `childrenIds` is filtered to
 * ids that are themselves in the export (tracks ∪ selected folders) — a
 * partial cache by design, refreshed by remote browsing on OneDrive and
 * complete as-is for Google picker groups.
 */
export interface ExportedFolder {
  type: "folder"
  id: string
  name: string
  parentId?: string
  childrenIds: string[]
}

export type ExportedFileEntry = ExportedTrack | ExportedFolder

export interface ExportedAlbum {
  name: string
  fileIds: string[]
  coverHash?: string
}

/** Truth only — every derived field is rebuilt by the importer in one batch. */
export interface ExportedPlaylist {
  id: string
  name: string
  seedIds: string[]
  confirmedIds: string[]
  rejectedIds: string[]
  coverTrackId?: string
  createdAt: number
  updatedAt: number
}

export interface ExportedTrackFeature {
  id: string
  version: number
  /** base64 of the Float32Array's little-endian bytes (bit-exact round trip) */
  vector: string
  coverageSeconds: number
  durationSeconds: number
  updatedAt: number
}

export interface ExportedArtwork {
  hash: string
  mime: string
  /** base64 of the ORIGINAL image bytes — hash(data) must equal `hash` */
  data: string
}

export interface ExportEnvelope {
  format: typeof EXPORT_FORMAT
  formatVersion: number
  appVersion?: string
  exportedAt: number
  provider: "onedrive" | "google-drive"
  /** OneDrive: MSAL homeAccountId / Google: OIDC sub */
  accountKey: string
  /** Human-readable label when available (OneDrive UPN); Google has none */
  accountLabel?: string
  counts: {
    tracks: number
    folders: number
    albums: number
    playlists: number
    trackFeatures: number
    artworks: number
  }
  files: ExportedFileEntry[]
  albums: ExportedAlbum[]
  playlists: ExportedPlaylist[]
  trackFeatures: ExportedTrackFeature[]
  artworks: ExportedArtwork[]
}

export type EnvelopeErrorReason = "wrong-format" | "newer-version" | "malformed"

export class EnvelopeValidationError extends Error {
  constructor(
    public readonly reason: EnvelopeErrorReason,
    message: string
  ) {
    super(message)
    this.name = "EnvelopeValidationError"
  }
}

/** Structural validation; throws EnvelopeValidationError with a typed reason. */
export function validateEnvelope(parsed: unknown): ExportEnvelope {
  if (typeof parsed !== "object" || parsed === null) {
    throw new EnvelopeValidationError("malformed", "Not a JSON object")
  }
  const obj = parsed as Record<string, unknown>
  if (obj.format !== EXPORT_FORMAT) {
    throw new EnvelopeValidationError(
      "wrong-format",
      "Not a Cloud Music Box export file"
    )
  }
  if (typeof obj.formatVersion !== "number") {
    throw new EnvelopeValidationError("malformed", "Missing formatVersion")
  }
  if (obj.formatVersion > EXPORT_FORMAT_VERSION) {
    throw new EnvelopeValidationError(
      "newer-version",
      `File format version ${obj.formatVersion} is newer than this app understands (${EXPORT_FORMAT_VERSION})`
    )
  }
  if (obj.provider !== "onedrive" && obj.provider !== "google-drive") {
    throw new EnvelopeValidationError("malformed", "Missing provider")
  }
  if (typeof obj.accountKey !== "string" || obj.accountKey.length === 0) {
    throw new EnvelopeValidationError("malformed", "Missing accountKey")
  }
  for (const key of [
    "files",
    "albums",
    "playlists",
    "trackFeatures",
    "artworks",
  ]) {
    if (!Array.isArray(obj[key])) {
      throw new EnvelopeValidationError("malformed", `Missing array: ${key}`)
    }
  }
  return parsed as ExportEnvelope
}
