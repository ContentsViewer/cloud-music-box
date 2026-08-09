"use client"

import { useCallback, useRef, useState } from "react"
import {
  Button,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  List,
  ListItemButton,
  ListItemIcon,
  ListItemText,
  MenuItem,
} from "@mui/material"
import { PlaylistAddRounded } from "@mui/icons-material"
import { enqueueSnackbar } from "notistack"
import { AudioTrackFileItem } from "@/src/features/files"
import {
  PlaylistItem,
  playlistTrackIds,
  usePlaylistStore,
} from "../stores/playlist-store"
import { PlaylistNameDialog } from "../components/playlist-name-dialog"

function suggestName(tracks: AudioTrackFileItem[]): string {
  if (tracks.length === 0) return "New Playlist"
  const album = tracks[0].metadata?.common.album
  if (
    tracks.length > 1 &&
    album &&
    tracks.every(t => t.metadata?.common.album === album)
  ) {
    return album.replace(/\0+$/, "")
  }
  return tracks[0].metadata?.common.title || tracks[0].name
}

/**
 * Playlist entry points for pages that render track lists. The files feature
 * must not know about playlists, so pages render `dialogs` and hand
 * `extraMenuItems` the openers — the same shape as onPlayTracks.
 */
export function usePlaylistActions(options?: {
  onCreated?: (playlist: PlaylistItem) => void
}) {
  const [playlistState, playlistActions] = usePlaylistStore()
  const refPlaylists = useRef(playlistState.playlists)
  refPlaylists.current = playlistState.playlists
  const refOnCreated = useRef(options?.onCreated)
  refOnCreated.current = options?.onCreated

  const [mode, setMode] = useState<"none" | "pick" | "create">("none")
  const [tracks, setTracks] = useState<AudioTrackFileItem[]>([])

  const close = useCallback(() => setMode("none"), [])

  const openAddTo = useCallback((next: AudioTrackFileItem[]) => {
    if (next.length === 0) return
    setTracks(next)
    // Nothing to add to yet — go straight to seeding a new one
    setMode(refPlaylists.current.length > 0 ? "pick" : "create")
  }, [])

  const openCreateFrom = useCallback((next: AudioTrackFileItem[]) => {
    if (next.length === 0) return
    setTracks(next)
    setMode("create")
  }, [])

  /** Drop-in `extraMenuItems` for TrackList / FileList */
  const trackMenuItems = useCallback(
    (track: AudioTrackFileItem, closeMenu: () => void) => (
      <MenuItem
        onClick={() => {
          closeMenu()
          openAddTo([track])
        }}
      >
        <ListItemText>Add to Playlist</ListItemText>
      </MenuItem>
    ),
    [openAddTo]
  )

  const addTo = useCallback(
    async (playlist: PlaylistItem) => {
      setMode("none")
      try {
        for (const track of tracks) {
          await playlistActions.keepTrack(playlist.id, track.id)
        }
        // default variant: MD3 snackbars are a neutral inverse surface —
        // the app uses only "error" and default
        enqueueSnackbar(`Added to ${playlist.name}`)
      } catch (error) {
        console.error(error)
        enqueueSnackbar(`${error}`, { variant: "error" })
      }
    },
    [tracks, playlistActions]
  )

  const create = useCallback(
    async (name: string) => {
      setMode("none")
      try {
        const playlist = await playlistActions.createPlaylist(
          name,
          tracks.map(t => t.id)
        )
        refOnCreated.current?.(playlist)
      } catch (error) {
        console.error(error)
        enqueueSnackbar(`${error}`, { variant: "error" })
      }
    },
    [tracks, playlistActions]
  )

  const dialogs = (
    <>
      <Dialog open={mode === "pick"} onClose={close} fullWidth>
        <DialogTitle>Add to Playlist</DialogTitle>
        <DialogContent sx={{ px: 0 }}>
          <List>
            {playlistState.playlists.map(playlist => (
              <ListItemButton
                key={playlist.id}
                onClick={() => {
                  addTo(playlist)
                }}
              >
                <ListItemText
                  primary={playlist.name}
                  secondary={`${playlistTrackIds(playlist).length} tracks`}
                />
              </ListItemButton>
            ))}
            <ListItemButton
              onClick={() => {
                setMode("create")
              }}
            >
              <ListItemIcon sx={{ color: "inherit" }}>
                <PlaylistAddRounded />
              </ListItemIcon>
              <ListItemText primary="New Playlist" />
            </ListItemButton>
          </List>
        </DialogContent>
        <DialogActions>
          <Button onClick={close}>Cancel</Button>
        </DialogActions>
      </Dialog>

      <PlaylistNameDialog
        open={mode === "create"}
        title="New Playlist"
        description={
          tracks.length === 1
            ? "This track becomes the seed. Similar tracks you have played will be suggested, and the playlist learns from what you keep and remove."
            : `These ${tracks.length} tracks become the seed. Similar tracks you have played will be suggested, and the playlist learns from what you keep and remove.`
        }
        initialName={suggestName(tracks)}
        confirmLabel="Create"
        onClose={close}
        onSubmit={create}
      />
    </>
  )

  return { openAddTo, openCreateFrom, trackMenuItems, dialogs }
}
