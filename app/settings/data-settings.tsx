"use client"

import {
  getStoredAccountIdentity,
  useFileStore,
} from "@/src/features/files"
import { usePlaylistStore } from "@/src/features/playlists"
import { useThemeStore } from "@/src/stores/theme-store"
import { buildExportEnvelope } from "@/src/lib/export/build"
import {
  base64ToBlob,
  base64ToFloat32,
  compressJsonBlob,
  envelopeToJsonBlob,
  readExportFile,
  triggerDownload,
} from "@/src/lib/export/codec"
import {
  EnvelopeValidationError,
  ExportEnvelope,
  validateEnvelope,
} from "@/src/lib/export/schema"
import {
  MaterialDynamicColors,
  hexFromArgb,
} from "@material/material-color-utilities"
import {
  Button,
  Dialog,
  DialogActions,
  DialogContent,
  DialogContentText,
  DialogTitle,
  LinearProgress,
  List,
  ListItemButton,
  ListItemText,
  Typography,
} from "@mui/material"
import { css } from "@emotion/react"
import { enqueueSnackbar } from "notistack"
import { useEffect, useRef, useState } from "react"
import { ExportIdentity } from "@/src/lib/export/build"

const providerName = (provider: "onedrive" | "google-drive") =>
  provider === "onedrive" ? "OneDrive" : "Google Drive"

interface ProgressState {
  phase: string
  done: number
  total: number
}

/**
 * Export/Import of the library (albums, playlists, track analyses, track
 * metadata, artwork). Cross-feature composition happens here at the page
 * layer: files and playlists stores each import/export their own records.
 */
export function DataSettingsArea() {
  const [themeStoreState] = useThemeStore()
  const [, fileStoreActions] = useFileStore()
  const [, playlistActions] = usePlaylistStore()
  const refFileStoreActions = useRef(fileStoreActions)
  refFileStoreActions.current = fileStoreActions
  const refPlaylistActions = useRef(playlistActions)
  refPlaylistActions.current = playlistActions

  const colorOnSurfaceVariant = hexFromArgb(
    MaterialDynamicColors.onSurfaceVariant.getArgb(themeStoreState.scheme)
  )

  const [exportConfirmOpen, setExportConfirmOpen] = useState(false)
  const [progress, setProgress] = useState<ProgressState | null>(null)
  const [pendingImport, setPendingImport] = useState<ExportEnvelope | null>(
    null
  )
  const [blockMessage, setBlockMessage] = useState<string | null>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)

  const runExport = async () => {
    setExportConfirmOpen(false)
    const identity = getStoredAccountIdentity()
    if (!identity) {
      enqueueSnackbar("Sign in to a cloud drive before exporting.", {
        variant: "error",
      })
      return
    }
    try {
      setProgress({ phase: "Reading library…", done: 0, total: 1 })
      const { tracks, folders, albums, artworks } =
        await refFileStoreActions.current.readLibrarySnapshot()
      const { playlists, trackFeatures } =
        await refPlaylistActions.current.readPlaylistSnapshot()

      // Only artwork actually referenced by a track or an album travels.
      const referenced = new Set<string>()
      for (const t of tracks) if (t.artworkHash) referenced.add(t.artworkHash)
      for (const a of albums) if (a.coverHash) referenced.add(a.coverHash)
      const usedArtworks = artworks.filter(a => referenced.has(a.hash))

      const envelope = await buildExportEnvelope({
        identity,
        appVersion: process.env.APP_VERSION,
        exportedAt: Date.now(),
        tracks,
        folders,
        albums,
        playlists: playlists.map(p => ({
          id: p.id,
          name: p.name,
          seedIds: p.seedIds,
          confirmedIds: p.confirmedIds,
          rejectedIds: p.rejectedIds,
          coverTrackId: p.coverTrackId,
          createdAt: p.createdAt,
          updatedAt: p.updatedAt,
        })),
        trackFeatures,
        artworks: usedArtworks,
        onProgress: (done, total) =>
          setProgress({ phase: "Encoding artwork…", done, total }),
      })

      setProgress({ phase: "Writing file…", done: 0, total: 1 })
      const jsonBlob = await envelopeToJsonBlob(envelope)
      const { blob, gzipped } = await compressJsonBlob(jsonBlob)
      const now = new Date()
      const stamp = `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, "0")}${String(now.getDate()).padStart(2, "0")}`
      triggerDownload(
        blob,
        `cloud-music-box-export-${stamp}.json${gzipped ? ".gz" : ""}`
      )
      const c = envelope.counts
      enqueueSnackbar(
        `Exported ${c.tracks} tracks, ${c.folders} folders, ${c.albums} albums, ${c.playlists} playlists, ${c.trackFeatures} analyses.`
      )
    } catch (error) {
      console.error(error)
      enqueueSnackbar(`${error}`, { variant: "error" })
    } finally {
      setProgress(null)
    }
  }

  const inspectImportFile = async (file: File) => {
    try {
      setProgress({ phase: "Reading file…", done: 0, total: 1 })
      const text = await readExportFile(file)
      const envelope = validateEnvelope(JSON.parse(text))
      setProgress(null)

      const identity = getStoredAccountIdentity()
      if (!identity) {
        setBlockMessage("Sign in to your cloud drive before importing.")
        return
      }
      if (identity.provider !== envelope.provider) {
        setBlockMessage(
          `This file was exported from ${providerName(envelope.provider)}, but this device is connected to ${providerName(identity.provider)}. The tracks it references can only be read by the account that exported it.`
        )
        return
      }
      if (identity.accountKey !== envelope.accountKey) {
        setBlockMessage(
          envelope.accountLabel
            ? `This file was exported from ${envelope.accountLabel}, but this device is signed in to a different account. The tracks it references can only be read by the account that exported it.`
            : "This file was exported from a different account. The tracks it references can only be read by the account that exported it."
        )
        return
      }
      setPendingImport(envelope)
    } catch (error) {
      setProgress(null)
      if (error instanceof EnvelopeValidationError) {
        enqueueSnackbar(
          error.reason === "wrong-format"
            ? "This is not a Cloud Music Box export file."
            : error.reason === "newer-version"
              ? "This file was created by a newer version of the app — update this app first."
              : "The file is damaged or unreadable.",
          { variant: "error" }
        )
      } else if (error instanceof SyntaxError) {
        enqueueSnackbar("This is not a Cloud Music Box export file.", {
          variant: "error",
        })
      } else {
        console.error(error)
        enqueueSnackbar(`${error}`, { variant: "error" })
      }
    }
  }

  const runImport = async (envelope: ExportEnvelope) => {
    setPendingImport(null)
    try {
      setProgress({ phase: "Preparing…", done: 0, total: 1 })
      const artworks = envelope.artworks.map(a => ({
        hash: a.hash,
        blob: base64ToBlob(a.data, a.mime),
      }))
      const features = envelope.trackFeatures.map(f => ({
        id: f.id,
        version: f.version,
        vector: base64ToFloat32(f.vector),
        coverageSeconds: f.coverageSeconds,
        durationSeconds: f.durationSeconds,
        updatedAt: f.updatedAt,
      }))

      const lib = await refFileStoreActions.current.importLibraryData(
        { files: envelope.files, albums: envelope.albums, artworks },
        (done, total) =>
          setProgress({ phase: "Importing library…", done, total })
      )
      const pl = await refPlaylistActions.current.importPlaylistData(
        features,
        envelope.playlists,
        (done, total) =>
          setProgress({ phase: "Importing playlists…", done, total })
      )
      enqueueSnackbar(
        `Imported ${lib.tracksAdded + lib.tracksMerged} tracks, ` +
          `${lib.foldersAdded + lib.foldersMerged} folders, ` +
          `${lib.albumsAdded + lib.albumsMerged} albums, ` +
          `${pl.playlistsAdded + pl.playlistsMerged} playlists, ` +
          `${pl.featuresAdded + pl.featuresMerged} analyses` +
          (pl.featuresSkipped > 0 ? ` (${pl.featuresSkipped} skipped).` : ".")
      )
    } catch (error) {
      console.error(error)
      enqueueSnackbar(`${error}`, { variant: "error" })
    } finally {
      setProgress(null)
    }
  }

  // localStorage is client-only; render the SSR default until mounted (same
  // hydration guard as the other settings sections)
  const [exportIdentity, setExportIdentity] = useState<ExportIdentity | null>(
    null
  )
  useEffect(() => {
    setExportIdentity(getStoredAccountIdentity())
  }, [])

  return (
    <div
      css={css({
        display: "flex",
        flexDirection: "column",
        marginTop: "16px",
      })}
    >
      <Typography variant="h6">Data</Typography>
      <List>
        <ListItemButton onClick={() => setExportConfirmOpen(true)}>
          <ListItemText
            primary="Export library data"
            secondary="Save your albums, playlists, track analyses and artwork to a file."
            secondaryTypographyProps={{
              sx: { color: colorOnSurfaceVariant },
            }}
          />
        </ListItemButton>
        <ListItemButton onClick={() => fileInputRef.current?.click()}>
          <ListItemText
            primary="Import library data"
            secondary="Merge a file exported from the same account into this device."
            secondaryTypographyProps={{
              sx: { color: colorOnSurfaceVariant },
            }}
          />
        </ListItemButton>
      </List>
      <input
        ref={fileInputRef}
        type="file"
        accept=".gz,.json,application/gzip,application/json"
        hidden
        onChange={event => {
          const file = event.target.files?.[0]
          // Allow picking the same file twice in a row
          event.target.value = ""
          if (file) inspectImportFile(file)
        }}
      />

      {/* Export confirmation */}
      <Dialog
        open={exportConfirmOpen}
        onClose={() => setExportConfirmOpen(false)}
      >
        <DialogTitle>Export library data?</DialogTitle>
        <DialogContent>
          <DialogContentText>
            The file will contain your albums, playlists, track analyses, track
            metadata and album artwork
            {exportIdentity?.accountLabel
              ? ` for ${exportIdentity.accountLabel}`
              : ""}
            . It does not contain the audio files themselves, nor any sign-in
            tokens.
          </DialogContentText>
          <DialogContentText sx={{ mt: 2 }}>
            It can only be imported on a device connected to the same{" "}
            {exportIdentity ? providerName(exportIdentity.provider) : "cloud"}{" "}
            account.
          </DialogContentText>
        </DialogContent>
        <DialogActions>
          <Button autoFocus onClick={() => setExportConfirmOpen(false)}>
            Cancel
          </Button>
          <Button onClick={runExport}>Export</Button>
        </DialogActions>
      </Dialog>

      {/* Import preview */}
      <Dialog
        open={pendingImport !== null}
        onClose={() => setPendingImport(null)}
      >
        <DialogTitle>Import and merge this file?</DialogTitle>
        <DialogContent>
          <DialogContentText>
            Exported {new Date(pendingImport?.exportedAt ?? 0).toLocaleString()}
            {pendingImport?.accountLabel
              ? ` from ${pendingImport.accountLabel}`
              : ""}
            {pendingImport?.appVersion
              ? ` (app v${pendingImport.appVersion})`
              : ""}
            . It contains:
          </DialogContentText>
          <DialogContentText component="ul" sx={{ mt: 1 }}>
            <li>
              {pendingImport?.counts.tracks ?? 0} tracks&apos; metadata (
              {pendingImport?.counts.folders ?? 0} folders)
            </li>
            <li>{pendingImport?.counts.trackFeatures ?? 0} track analyses</li>
            <li>{pendingImport?.counts.playlists ?? 0} playlists</li>
            <li>
              {pendingImport?.counts.albums ?? 0} albums (
              {pendingImport?.counts.artworks ?? 0} artwork images)
            </li>
          </DialogContentText>
          <DialogContentText sx={{ mt: 2 }}>
            Existing data on this device will be kept and merged.
          </DialogContentText>
        </DialogContent>
        <DialogActions>
          <Button autoFocus onClick={() => setPendingImport(null)}>
            Cancel
          </Button>
          <Button
            onClick={() => {
              if (pendingImport) runImport(pendingImport)
            }}
          >
            Import & merge
          </Button>
        </DialogActions>
      </Dialog>

      {/* Account mismatch / not signed in — import is blocked */}
      <Dialog open={blockMessage !== null} onClose={() => setBlockMessage(null)}>
        <DialogTitle>Cannot import this file</DialogTitle>
        <DialogContent>
          <DialogContentText>{blockMessage}</DialogContentText>
        </DialogContent>
        <DialogActions>
          <Button autoFocus onClick={() => setBlockMessage(null)}>
            Close
          </Button>
        </DialogActions>
      </Dialog>

      {/* Determinate progress (no onClose on purpose — not dismissible) */}
      <Dialog open={progress !== null}>
        <DialogTitle>{progress?.phase}</DialogTitle>
        <DialogContent>
          <LinearProgress
            variant="determinate"
            value={
              progress && progress.total > 0
                ? (progress.done / progress.total) * 100
                : 0
            }
            sx={{ minWidth: 320 }}
          />
          <DialogContentText sx={{ mt: 1, textAlign: "right" }}>
            {progress && progress.total > 1
              ? `${progress.done} / ${progress.total}`
              : ""}
          </DialogContentText>
        </DialogContent>
      </Dialog>
    </div>
  )
}
