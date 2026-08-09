"use client"

import { AlbumCover } from "@/src/components/album-cover"
import { CoverCard } from "@/src/components/cover-card"
import AppTopBar from "@/src/components/app-top-bar"
import { MarqueeText } from "@/src/components/marquee-text"
import DownloadingIndicator from "@/src/components/downloading-indicator"
import { useRouter } from "@/src/stores/router"
import { useThemeStore } from "@/src/stores/theme-store"
import {
  AudioTrackFileItem,
  TrackList,
  useArtworkUrl,
  useFileStore,
} from "@/src/features/files"
import { usePlayerStore } from "@/src/features/player"
import {
  LastConfirmedTrackError,
  PlaylistItem,
  PlaylistNameDialog,
  playlistTrackIds,
  usePlaylistStore,
} from "@/src/features/playlists"
import {
  MaterialDynamicColors,
  hexFromArgb,
} from "@material/material-color-utilities"
import {
  ArrowUpwardRounded,
  CloseRounded,
  DeleteRounded,
  DriveFileRenameOutlineRounded,
  HomeRounded,
  MoreVert,
  PlayArrowRounded,
  PushPinRounded,
  QueueMusicRounded,
  SettingsRounded,
} from "@mui/icons-material"
import {
  Button,
  Dialog,
  DialogActions,
  DialogContent,
  DialogContentText,
  DialogTitle,
  Fade,
  IconButton,
  ListItemIcon,
  ListItemText,
  Menu,
  MenuItem,
  Toolbar,
  Tooltip,
  Typography,
} from "@mui/material"
import { css } from "@emotion/react"
import { enqueueSnackbar } from "notistack"
import React, { useCallback, useEffect, useMemo, useRef, useState } from "react"

/** Resolves track ids to file records, dropping any that no longer exist */
function useTracks(ids: string[] | undefined) {
  const [fileStoreState, fileStoreActions] = useFileStore()
  const refActions = useRef(fileStoreActions)
  refActions.current = fileStoreActions
  const [tracks, setTracks] = useState<AudioTrackFileItem[]>([])
  const key = ids?.join(",")

  useEffect(() => {
    if (!fileStoreState.configured || ids === undefined) {
      setTracks([])
      return
    }
    let canceled = false
    const load = async () => {
      const resolved = await Promise.all(
        ids.map(async id => {
          try {
            return (await refActions.current.getFileById(
              id
            )) as AudioTrackFileItem
          } catch {
            return undefined
          }
        })
      )
      if (canceled) return
      setTracks(
        resolved.filter((t): t is AudioTrackFileItem => t?.type === "audio-track")
      )
    }
    load()
    return () => {
      canceled = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, fileStoreState.configured])

  return tracks
}

function useCoverUrl(trackId: string | undefined) {
  const [fileStoreState, fileStoreActions] = useFileStore()
  const refActions = useRef(fileStoreActions)
  refActions.current = fileStoreActions
  const [artworkHash, setArtworkHash] = useState<string | undefined>(undefined)

  useEffect(() => {
    if (!trackId || !fileStoreState.configured) {
      setArtworkHash(undefined)
      return
    }
    let canceled = false
    const load = async () => {
      try {
        const file = (await refActions.current.getFileById(
          trackId
        )) as AudioTrackFileItem
        if (canceled) return
        setArtworkHash(file?.artworkHash)
      } catch {
        // A cover is optional; a missing file just means no art
      }
    }
    load()
    return () => {
      canceled = true
    }
  }, [trackId, fileStoreState.configured])

  return useArtworkUrl(artworkHash)
}

const PlaylistCard = React.memo(function PlaylistCard({
  playlist,
  onOpen,
  appeal = false,
}: {
  playlist: PlaylistItem
  onOpen: (id: string) => void
  appeal?: boolean
}) {
  const coverUrl = useCoverUrl(playlist.coverTrackId)
  const [themeStoreState] = useThemeStore()
  const colorOnSurfaceVariant = hexFromArgb(
    MaterialDynamicColors.onSurfaceVariant.getArgb(themeStoreState.scheme)
  )
  const count = playlistTrackIds(playlist).length

  return (
    <CoverCard
      id={playlist.id}
      title={playlist.name}
      coverUrl={coverUrl}
      appeal={appeal}
      onOpen={onOpen}
    >
      <Typography
        variant="body2"
        sx={{
          color: colorOnSurfaceVariant,
          whiteSpace: "nowrap",
          overflow: "hidden",
          textOverflow: "ellipsis",
          width: "100%",
          textAlign: "center",
        }}
      >
        {count} {count === 1 ? "track" : "tracks"}
      </Typography>
    </CoverCard>
  )
})

const PlaylistListPage = React.memo(function PlaylistListPage({
  onMount,
}: {
  onMount?: () => void
}) {
  const [playlistState] = usePlaylistStore()
  const [, routerActions] = useRouter()
  const routerActionsRef = useRef(routerActions)
  routerActionsRef.current = routerActions
  const [themeStoreState] = useThemeStore()

  // The detail page plays with sourceUrl "/playlists#<id>", so the playing
  // playlist can be recovered from it even after the queue advances.
  const [playerState] = usePlayerStore()
  const activePlaylistId = useMemo(() => {
    const prefix = "/playlists#"
    const url = playerState.playSourceUrl
    if (!url?.startsWith(prefix)) return undefined
    return decodeURIComponent(url.slice(prefix.length))
  }, [playerState.playSourceUrl])

  useEffect(() => {
    onMount?.()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const onOpen = useCallback((id: string) => {
    routerActionsRef.current.goPlaylist(id)
  }, [])

  const colorOnSurfaceVariant = hexFromArgb(
    MaterialDynamicColors.onSurfaceVariant.getArgb(themeStoreState.scheme)
  )

  return (
    <div
      css={css({
        padding: "24px",
        "@media (min-width: 600px)": { padding: "32px" },
      })}
    >
      {playlistState.playlists.length === 0 ? (
        <div
          css={css({
            maxWidth: "560px",
            margin: "0 auto",
            textAlign: "center",
          })}
        >
          <QueueMusicRounded
            sx={{ fontSize: 64, color: colorOnSurfaceVariant }}
          />
          <Typography variant="h6" sx={{ mt: 2 }}>
            No playlists yet
          </Typography>
          <Typography sx={{ mt: 1, color: colorOnSurfaceVariant }}>
            Open the menu on any track and choose{" "}
            <strong>Create Playlist</strong>. That track becomes the seed, and
            similar tracks you have played are suggested from then on.
          </Typography>
          <Typography sx={{ mt: 2, color: colorOnSurfaceVariant }}>
            {playlistState.analyzedTrackCount} played{" "}
            {playlistState.analyzedTrackCount === 1 ? "track has" : "tracks have"}{" "}
            been analyzed so far.
          </Typography>
        </div>
      ) : (
        <div
          css={css({
            gap: "24px",
            gridTemplateColumns: "repeat(auto-fill, minmax(120px, 1fr))",
            "@media (min-width: 600px)": {
              gridTemplateColumns: "repeat(auto-fill, minmax(144px, 1fr))",
            },
            display: "grid",
            maxWidth: "1040px",
            margin: "0 auto",
            width: "100%",
          })}
        >
          {playlistState.playlists.map(playlist => (
            <PlaylistCard
              key={playlist.id}
              playlist={playlist}
              onOpen={onOpen}
              appeal={playlist.id === activePlaylistId}
            />
          ))}
        </div>
      )}
    </div>
  )
})

const PlaylistPage = React.memo(function PlaylistPage({
  playlist,
  onMount,
}: {
  playlist?: PlaylistItem
  onMount?: () => void
}) {
  const [playerState, playerActions] = usePlayerStore()
  const [, playlistActions] = usePlaylistStore()
  const [, routerActions] = useRouter()
  const [themeStoreState] = useThemeStore()

  const coverUrl = useCoverUrl(playlist?.coverTrackId)
  const confirmedTracks = useTracks(playlist?.confirmedIds)
  const provisionalTracks = useTracks(playlist?.provisionalIds)

  const [menuAnchorEl, setMenuAnchorEl] = useState<null | HTMLElement>(null)
  const [renameOpen, setRenameOpen] = useState(false)
  const [deleteOpen, setDeleteOpen] = useState(false)

  useEffect(() => {
    onMount?.()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const allTracks = useMemo(
    () => [...confirmedTracks, ...provisionalTracks],
    [confirmedTracks, provisionalTracks]
  )
  const sourceUrl = playlist
    ? `/playlists#${encodeURIComponent(playlist.id)}`
    : undefined

  // Each section renders its own slice, but playing from either one queues the
  // whole playlist, so the track after the last confirmed one is the first
  // candidate rather than the end of the queue.
  const playFromSection = useCallback(
    (index: number, sectionTracks: AudioTrackFileItem[], url: string) => {
      const target = sectionTracks[index]
      if (!target) return
      const fullIndex = allTracks.findIndex(t => t.id === target.id)
      playerActions.playTrack(fullIndex < 0 ? 0 : fullIndex, allTracks, url)
    },
    [allTracks, playerActions]
  )

  const removeTrack = useCallback(
    async (trackId: string) => {
      if (!playlist) return
      try {
        await playlistActions.removeTrack(playlist.id, trackId)
      } catch (error) {
        if (error instanceof LastConfirmedTrackError) {
          enqueueSnackbar(error.message, { variant: "error" })
          return
        }
        console.error(error)
        enqueueSnackbar(`${error}`, { variant: "error" })
      }
    },
    [playlist, playlistActions]
  )

  const keepTrack = useCallback(
    async (trackId: string) => {
      if (!playlist) return
      try {
        await playlistActions.keepTrack(playlist.id, trackId)
      } catch (error) {
        console.error(error)
        enqueueSnackbar(`${error}`, { variant: "error" })
      }
    },
    [playlist, playlistActions]
  )

  const colorOnSurfaceVariant = hexFromArgb(
    MaterialDynamicColors.onSurfaceVariant.getArgb(themeStoreState.scheme)
  )

  const notMatchingYet = playlist !== undefined && playlist.radius === 0

  const confirmedMenuItems = useCallback(
    (track: AudioTrackFileItem, closeMenu: () => void) => (
      <MenuItem
        onClick={() => {
          closeMenu()
          removeTrack(track.id)
        }}
      >
        <ListItemText>Remove from Playlist</ListItemText>
      </MenuItem>
    ),
    [removeTrack]
  )

  const candidateActions = useCallback(
    (track: AudioTrackFileItem) => (
      <>
        <Tooltip title="Keep in Playlist — stops this track from dropping out later">
          <IconButton
            sx={{ color: colorOnSurfaceVariant }}
            onClick={() => keepTrack(track.id)}
          >
            <PushPinRounded />
          </IconButton>
        </Tooltip>
        <Tooltip title="Not this one">
          <IconButton
            sx={{ color: colorOnSurfaceVariant }}
            onClick={() => removeTrack(track.id)}
          >
            <CloseRounded />
          </IconButton>
        </Tooltip>
      </>
    ),
    [colorOnSurfaceVariant, keepTrack, removeTrack]
  )

  return (
    <div
      css={css({
        display: "flex",
        flexDirection: "column",
        maxWidth: "1040px",
        margin: "0 auto",
        width: "100%",
      })}
    >
      <div
        css={css({
          display: "flex",
          flexDirection: "column",
          "@media (min-width: 600px)": { flexDirection: "row" },
          paddingLeft: "32px",
          paddingRight: "32px",
          gap: "16px",
          width: "100%",
          marginTop: "24px",
          marginBottom: "24px",
        })}
      >
        <AlbumCover
          sx={{ width: "200px", height: "200px", alignSelf: "center" }}
          coverUrl={coverUrl}
        />
        <div
          css={css({
            flexGrow: 1,
            display: "flex",
            flexDirection: "column",
            minWidth: 0,
            width: "100%",
            justifyContent: "space-around",
          })}
        >
          <Typography
            variant="h5"
            sx={{
              fontWeight: "bold",
              overflow: "hidden",
              textAlign: { xs: "center", sm: "left" },
            }}
          >
            {playlist?.name ?? ""}
          </Typography>
          <Typography
            sx={{
              color: colorOnSurfaceVariant,
              textAlign: { xs: "center", sm: "left" },
            }}
          >
            {confirmedTracks.length} kept · {provisionalTracks.length} suggested
          </Typography>
          <div
            css={css({
              display: "flex",
              flexDirection: "row",
              justifyContent: "flex-end",
              alignItems: "center",
              gap: "8px",
            })}
          >
            <Button
              startIcon={<PlayArrowRounded />}
              disabled={allTracks.length === 0}
              onClick={() => {
                if (!sourceUrl || allTracks.length === 0) return
                playerActions.playTrack(0, allTracks, sourceUrl)
              }}
            >
              Play
            </Button>
            <IconButton
              color="inherit"
              onClick={event => setMenuAnchorEl(event.currentTarget)}
            >
              <MoreVert />
            </IconButton>
            <Menu
              anchorEl={menuAnchorEl}
              open={Boolean(menuAnchorEl)}
              onClose={() => setMenuAnchorEl(null)}
              keepMounted
            >
              <MenuItem
                onClick={() => {
                  setMenuAnchorEl(null)
                  setRenameOpen(true)
                }}
              >
                <ListItemIcon sx={{ color: "inherit" }}>
                  <DriveFileRenameOutlineRounded />
                </ListItemIcon>
                <ListItemText>Rename</ListItemText>
              </MenuItem>
              <MenuItem
                onClick={() => {
                  setMenuAnchorEl(null)
                  setDeleteOpen(true)
                }}
              >
                <ListItemIcon sx={{ color: "inherit" }}>
                  <DeleteRounded />
                </ListItemIcon>
                <ListItemText>Delete Playlist</ListItemText>
              </MenuItem>
            </Menu>
          </div>
        </div>
      </div>

      {notMatchingYet ? (
        <Typography sx={{ px: 4, pb: 2, color: colorOnSurfaceVariant }}>
          Play these tracks through once. Suggestions start as soon as this
          playlist has a track that has been listened to.
        </Typography>
      ) : null}

      <TrackList
        cssStyle={css({ paddingLeft: 0, paddingRight: 0 })}
        tracks={confirmedTracks}
        sourceUrl={sourceUrl}
        sortByTrackNumber={false}
        hideTrackNumber
        activeTrack={playerState.activeTrack?.file}
        onPlayTracks={playFromSection}
        extraMenuItems={confirmedMenuItems}
      />

      {provisionalTracks.length > 0 ? (
        <div css={css({ marginTop: "16px" })}>
          <div css={css({ paddingLeft: "32px", paddingRight: "32px" })}>
            <Typography variant="h6">Suggested</Typography>
            <Typography variant="body2" sx={{ color: colorOnSurfaceVariant }}>
              Matched by sound. These come and go as the playlist changes — pin
              one to keep it for good.
            </Typography>
          </div>
          <div css={css({ opacity: 0.72 })}>
            <TrackList
              cssStyle={css({ paddingLeft: 0, paddingRight: 0 })}
              tracks={provisionalTracks}
              sourceUrl={sourceUrl}
              sortByTrackNumber={false}
              hideTrackNumber
              activeTrack={playerState.activeTrack?.file}
              onPlayTracks={playFromSection}
              secondaryAction={candidateActions}
            />
          </div>
        </div>
      ) : null}

      <PlaylistNameDialog
        open={renameOpen}
        title="Rename Playlist"
        initialName={playlist?.name ?? ""}
        confirmLabel="Rename"
        onClose={() => setRenameOpen(false)}
        onSubmit={name => {
          setRenameOpen(false)
          if (!playlist) return
          playlistActions.renamePlaylist(playlist.id, name).catch(error => {
            console.error(error)
            enqueueSnackbar(`${error}`, { variant: "error" })
          })
        }}
      />

      <Dialog open={deleteOpen} onClose={() => setDeleteOpen(false)}>
        <DialogTitle>Delete this playlist?</DialogTitle>
        <DialogContent>
          <DialogContentText>
            The tracks themselves are not touched. Only this playlist and what it
            learned from you are removed.
          </DialogContentText>
        </DialogContent>
        <DialogActions>
          <Button autoFocus onClick={() => setDeleteOpen(false)}>
            Cancel
          </Button>
          <Button
            color="error"
            onClick={() => {
              setDeleteOpen(false)
              if (!playlist) return
              playlistActions
                .deletePlaylist(playlist.id)
                .then(() => routerActions.goPlaylist())
                .catch(error => {
                  console.error(error)
                  enqueueSnackbar(`${error}`, { variant: "error" })
                })
            }}
          >
            Delete
          </Button>
        </DialogActions>
      </Dialog>
    </div>
  )
})

export default function Page() {
  const [routerState, routerActions] = useRouter()
  const [themeStoreState] = useThemeStore()
  const [fileStoreState] = useFileStore()
  const [playlistState] = usePlaylistStore()

  const [anchorEl, setAnchorEl] = useState<null | HTMLElement>(null)
  const playlistPageRef = useRef<Node | undefined>(undefined)
  const playlistListRef = useRef<Node | undefined>(undefined)
  const [scrollTarget, setScrollTarget] = useState<Node | undefined>(undefined)

  const playlistId = decodeURIComponent(routerState.hash.slice(1))
  const currentPlaylist = playlistId
    ? playlistState.playlists.find(p => p.id === playlistId)
    : undefined

  const colorOnSurfaceVariant = hexFromArgb(
    MaterialDynamicColors.onSurfaceVariant.getArgb(themeStoreState.scheme)
  )
  const downloadingCount = Object.keys(fileStoreState.syncingTrackFiles).length

  return (
    <div css={css({ height: "100%", overflow: "hidden" })}>
      <AppTopBar scrollTarget={scrollTarget}>
        <Toolbar>
          <IconButton
            color="inherit"
            onClick={() => routerActions.goHome()}
            sx={{ ml: -1 }}
          >
            <HomeRounded />
          </IconButton>
          <Typography sx={{ color: colorOnSurfaceVariant }}>/</Typography>
          <IconButton
            size="large"
            color="inherit"
            onClick={() => {
              if (currentPlaylist) {
                routerActions.goPlaylist()
                return
              }
              routerActions.goHome()
            }}
          >
            <ArrowUpwardRounded />
          </IconButton>

          <QueueMusicRounded color="inherit" sx={{ mr: 1 }} />
          <MarqueeText
            variant="h6"
            sx={{
              whiteSpace: "nowrap",
              overflow: "hidden",
              textOverflow: "ellipsis",
              flexGrow: 1,
            }}
            text={currentPlaylist ? currentPlaylist.name : "Playlists"}
          />
          {downloadingCount > 0 ? (
            <DownloadingIndicator
              count={downloadingCount}
              color={colorOnSurfaceVariant}
            />
          ) : null}
          <div>
            <IconButton
              color="inherit"
              edge="end"
              onClick={event => setAnchorEl(event.currentTarget)}
            >
              <MoreVert />
            </IconButton>
            <Menu
              anchorEl={anchorEl}
              keepMounted
              open={Boolean(anchorEl)}
              onClose={() => setAnchorEl(null)}
            >
              <MenuItem onClick={() => routerActions.goSettings()}>
                <ListItemIcon sx={{ color: "inherit" }}>
                  <SettingsRounded />
                </ListItemIcon>
                <ListItemText>Settings</ListItemText>
              </MenuItem>
            </Menu>
          </div>
        </Toolbar>
      </AppTopBar>
      <div
        css={css({
          marginLeft: `env(safe-area-inset-left, 0)`,
          marginRight: `env(safe-area-inset-right, 0)`,
          position: "relative",
          height: "100%",
          overflow: "hidden",
        })}
      >
        <Fade in={currentPlaylist !== undefined} timeout={1000} unmountOnExit>
          <div
            ref={playlistPageRef as unknown as React.Ref<HTMLDivElement>}
            css={css({
              position: "absolute",
              top: 0,
              right: 0,
              left: 0,
              paddingTop: "64px",
              paddingBottom: `calc(env(safe-area-inset-bottom, 0) + 144px)`,
              overflow: "auto",
              height: "100%",
              scrollbarColor: `${colorOnSurfaceVariant} transparent`,
              scrollbarWidth: "thin",
            })}
          >
            <PlaylistPage
              playlist={currentPlaylist}
              onMount={() => setScrollTarget(playlistPageRef.current)}
            />
          </div>
        </Fade>
        <Fade in={currentPlaylist === undefined} timeout={1000} unmountOnExit>
          <div
            ref={playlistListRef as unknown as React.Ref<HTMLDivElement>}
            css={css({
              position: "absolute",
              top: 0,
              right: 0,
              left: 0,
              paddingTop: "64px",
              paddingBottom: `calc(env(safe-area-inset-bottom, 0) + 144px)`,
              overflow: "auto",
              height: "100%",
              scrollbarColor: `${colorOnSurfaceVariant} transparent`,
              scrollbarWidth: "thin",
            })}
          >
            <PlaylistListPage
              onMount={() => setScrollTarget(playlistListRef.current)}
            />
          </div>
        </Fade>
      </div>
    </div>
  )
}
