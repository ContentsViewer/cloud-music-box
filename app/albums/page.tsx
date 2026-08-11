"use client"
import { AlbumCover } from "@/src/components/album-cover"
import { CoverCard } from "@/src/components/cover-card"
import AppTopBar from "@/src/components/app-top-bar"
import { MarqueeText } from "@/src/components/marquee-text"
import { useRouter } from "@/src/stores/router"
import { enqueueSnackbar } from "notistack"
import { AlbumItem, useArtworkUrl, useFileStore } from "@/src/features/files"
import { useThemeStore } from "@/src/stores/theme-store"
import { TrackList } from "@/src/features/files"
import { Theme } from "@emotion/react"
import {
  MaterialDynamicColors,
  hexFromArgb,
} from "@material/material-color-utilities"
import {
  AlbumRounded,
  FolderRounded,
  ArrowUpwardRounded,
  HomeRounded,
  MoreVert,
  PlaylistAddRounded,
  SettingsRounded,
} from "@mui/icons-material"
import { usePlaylistActions } from "@/src/features/playlists"
import {
  Box,
  Fade,
  IconButton,
  SxProps,
  Toolbar,
  Typography,
  Menu,
  MenuItem,
  ListItemIcon,
  ListItemText,
} from "@mui/material"
import React, { useCallback, useMemo, useRef } from "react"
import { useEffect, useState } from "react"
import { SerializedStyles, css } from "@emotion/react"
import DownloadingIndicator from "@/src/components/downloading-indicator"
import { usePlayerStore } from "@/src/features/player"
import { AudioTrackFileItem } from "@/src/features/files"

const AlbumCard = React.memo(function AlbumCard({
  albumItem,
  openAlbum = () => {},
  appeal = false,
}: {
  albumItem: AlbumItem
  openAlbum?: (albumId: string) => void
  appeal?: boolean
}) {
  const coverUrl = useArtworkUrl(albumItem.coverHash)

  return (
    <CoverCard
      id={albumItem.name}
      title={albumItem.name}
      coverUrl={coverUrl}
      appeal={appeal}
      onOpen={openAlbum}
    />
  )
})

interface AlbumListProps {
  albums: AlbumItem[]
  activeAlbumId: string | undefined
}

const AlbumList = React.memo(function AlbumList({
  albums,
  activeAlbumId,
}: AlbumListProps) {
  const [routerState, routerActions] = useRouter()
  const routerActionsRef = useRef(routerActions)
  routerActionsRef.current = routerActions

  const openAlbum = useCallback((albumId: string) => {
    if (!routerActionsRef.current) return
    routerActionsRef.current.goAlbum(albumId)
  }, [])
  return (
    <Box
      component="div"
      sx={{
        gap: 3,
        gridTemplateColumns: {
          xs: "repeat(auto-fill, minmax(120px, 1fr))",
          sm: "repeat(auto-fill, minmax(144px, 1fr))",
        },
        display: "grid",
        maxWidth: "1040px",
        margin: "0 auto",
        width: "100%",
      }}
    >
      {albums.map(album => {
        return (
          <AlbumCard
            key={album.name}
            albumItem={album}
            openAlbum={openAlbum}
            appeal={album.name === activeAlbumId}
          />
        )
      })}
    </Box>
  )
})

interface AlbumListPageProps {
  sx?: SxProps<Theme>
  onMount?: () => void
}
const AlbumListPage = React.memo(function AlbumListPage(
  props: AlbumListPageProps
) {
  const [fileStoreState, fileStoreActions] = useFileStore()

  const [playerState] = usePlayerStore()
  const activeAlbumId = useMemo(() => {
    if (!playerState.activeTrack) return undefined
    let albumName = playerState.activeTrack.file.metadata?.common.album
    if (albumName === undefined) albumName = "Unknown Album"
    albumName = albumName.replace(/\0+$/, "")
    return albumName
  }, [playerState.activeTrack])
  // console.log(activeAlbumId)

  const [albums, setAlbums] = useState<AlbumItem[]>([])

  useEffect(() => {
    props.onMount?.()
  }, [])

  useEffect(() => {
    if (!fileStoreState.configured) return
    let isCanceled = false
    let retryTimer: number | undefined

    // This list refetches on every remount (the page unmounts while an album
    // is open), so an unhandled rejection here would leave the grid empty
    // until the next navigation — retry once, then surface the error.
    const getAlbums = async (attempt: number) => {
      try {
        const albumIds = await fileStoreActions.getAlbumIds()
        if (isCanceled) return
        const albums = await Promise.all(
          albumIds.map(async albumId => {
            return await fileStoreActions.getAlbumById(albumId)
          })
        )
        if (isCanceled) return
        setAlbums(albums)
      } catch (error) {
        console.error(error)
        if (isCanceled) return
        if (attempt === 0) {
          retryTimer = window.setTimeout(() => {
            if (!isCanceled) getAlbums(1)
          }, 1000)
        } else {
          enqueueSnackbar(`${error}`, { variant: "error" })
        }
      }
    }

    getAlbums(0)

    return () => {
      isCanceled = true
      if (retryTimer !== undefined) window.clearTimeout(retryTimer)
    }
  }, [fileStoreState.configured])

  return (
    <Box
      component="div"
      sx={{
        p: {
          xs: 3,
          sm: 4,
        },
        ...props.sx,
      }}
    >
      <AlbumList albums={albums} activeAlbumId={activeAlbumId} />
    </Box>
  )
})

interface AlbumPageProps {
  sx?: SxProps<Theme>
  albumItem?: AlbumItem
  onMount?: () => void
}
const AlbumPage = React.memo(function AlbumPage({
  albumItem,
  onMount,
  sx,
}: AlbumPageProps) {
  const [fileStoreState, fileStoreActions] = useFileStore()
  const fileStoreActionsRef = useRef(fileStoreActions)
  fileStoreActionsRef.current = fileStoreActions
  const [playerState, playerActions] = usePlayerStore()
  const [routerState, routerActions] = useRouter()

  const coverUrl = useArtworkUrl(albumItem?.coverHash)
  const [tracks, setTracks] = useState<AudioTrackFileItem[] | undefined>([])

  const routerActionsRef = useRef(routerActions)
  routerActionsRef.current = routerActions
  // Playlist entry points are wired in by the page: the files feature must not
  // depend on the playlists feature (see docs/architecture.md dependency rules)
  const { openCreateFrom, trackMenuItems, dialogs } = usePlaylistActions({
    onCreated: playlist => routerActionsRef.current.goPlaylist(playlist.id),
  })

  useEffect(() => {
    onMount?.()
  }, [])

  useEffect(() => {
    if (!albumItem?.fileIds) return
    const getTracks = async () => {
      const tracks = await Promise.all(
        albumItem.fileIds.map(async fileId => {
          return (await fileStoreActionsRef.current.getFileById(
            fileId
          )) as AudioTrackFileItem
        })
      )
      setTracks(tracks)
    }
    getTracks()
  }, [albumItem?.fileIds])

  return (
    <Box
      component="div"
      sx={{
        ...sx,
        display: "flex",
        flexDirection: "column",
        maxWidth: "1040px",
        margin: "0 auto",
        width: "100%",
      }}
    >
      <Box
        component="div"
        sx={{
          display: "flex",
          flexDirection: {
            xs: "column",
            sm: "row",
          },
          px: 4,
          gap: 2,
          // alignItems: "center",
          width: "100%",
          my: 3,
        }}
      >
        <AlbumCover
          sx={{
            width: "200px",
            height: "200px",
            alignSelf: "center",
          }}
          coverUrl={coverUrl}
        />

        <Box
          component="div"
          sx={{
            flexGrow: 1,
            display: "flex",
            flexDirection: "column",
            minWidth: 0,
            width: "100%",
            justifyContent: "space-around",
          }}
        >
          <Typography
            variant="h5"
            sx={{
              fontWeight: "bold",
              overflow: "hidden",
              textAlign: {
                xs: "center",
                sm: "left",
              },
            }}
          >
            {albumItem ? albumItem.name : ""}
          </Typography>
          <Box
            component="div"
            sx={{
              display: "flex",
              flexDirection: "row",
              // minWidth: "200px",
              justifyContent: "flex-end",
            }}
          >
            <IconButton
              color="inherit"
              title="Create a playlist seeded with this album"
              disabled={!tracks || tracks.length === 0}
              onClick={() => {
                if (!tracks || tracks.length === 0) return
                openCreateFrom(tracks)
              }}
            >
              <PlaylistAddRounded color="inherit" />
            </IconButton>
            <IconButton
              color="inherit"
              title="Open this album's folder in Files"
              // Any track with a known parent will do — imported records can
              // lack one until their folder is known on this device.
              disabled={!tracks?.some(track => track.parentId !== undefined)}
              onClick={() => {
                const folderId = tracks?.find(
                  track => track.parentId !== undefined
                )?.parentId
                if (folderId === undefined) return
                routerActions.goFile(folderId)
              }}
            >
              <FolderRounded color="inherit" />
            </IconButton>
          </Box>
        </Box>
      </Box>
      {/* <Divider /> */}
      <TrackList
        cssStyle={css({
          paddingLeft: 0,
          paddingRight: 0,
        })}
        tracks={tracks}
        sourceUrl={
          albumItem ? `/albums#${encodeURIComponent(albumItem.name)}` : undefined
        }
        activeTrack={playerState.activeTrack?.file}
        onPlayTracks={playerActions.playTrack}
        extraMenuItems={trackMenuItems}
      />
      {dialogs}
    </Box>
  )
})

export default function Page() {
  const [routerState, routerActions] = useRouter()
  const [themeStoreState] = useThemeStore()
  const [currentAlbum, setCurrentAlbum] = useState<AlbumItem | undefined>(
    undefined
  )
  const [fileStoreState, fileStoreActions] = useFileStore()
  const fileStoreActionsRef = useRef(fileStoreActions)
  fileStoreActionsRef.current = fileStoreActions

  const [anchorEl, setAnchorEl] = useState<null | HTMLElement>(null)
  const albumPageRef = useRef<Node | undefined>(undefined)
  const albumListRef = useRef<Node | undefined>(undefined)
  const [scrollTarget, setScrollTarget] = useState<Node | undefined>(undefined)

  useEffect(() => {
    const albumId = decodeURIComponent(routerState.hash.slice(1))
    if (albumId === "") {
      setCurrentAlbum(undefined)
      return
    }
    if (!fileStoreState.configured) return

    const getAlbum = async () => {
      const album = await fileStoreActionsRef.current.getAlbumById(albumId)
      setCurrentAlbum(album)
    }
    getAlbum()
  }, [routerState.hash, fileStoreState.configured])

  const colorOnSurfaceVariant = hexFromArgb(
    MaterialDynamicColors.onSurfaceVariant.getArgb(themeStoreState.scheme)
  )

  const downloadingCount = Object.keys(fileStoreState.syncingTrackFiles).length

  return (
    <Box
      component="div"
      sx={{
        height: "100%",
        overflow: "hidden",
      }}
    >
      <AppTopBar
        scrollTarget={scrollTarget}
        // scrollTarget={

        //   const ref = currentAlbum == undefined ? albumListRef.current : albumPageRef.current
        //   if (ref === null) return undefined
        //   return ref
      >
        <Toolbar>
          <IconButton
            color="inherit"
            onClick={() => {
              routerActions.goHome()
            }}
            sx={{ ml: -1 }}
          >
            <HomeRounded />
          </IconButton>
          <Typography
            sx={{
              color: colorOnSurfaceVariant,
            }}
          >
            /
          </Typography>
          <IconButton
            size="large"
            // edge="start"
            // sx={{ ml: -1 }}
            color="inherit"
            onClick={() => {
              if (currentAlbum) {
                routerActions.goAlbum()
                return
              }
              routerActions.goHome()
            }}
          >
            <ArrowUpwardRounded />
          </IconButton>

          <AlbumRounded color="inherit" sx={{ mr: 1 }} />
          <MarqueeText
            variant="h6"
            sx={{
              whiteSpace: "nowrap",
              overflow: "hidden",
              textOverflow: "ellipsis",
              flexGrow: 1,
            }}
            text={currentAlbum ? currentAlbum.name : "Albums"}
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
              onClick={event => {
                setAnchorEl(event.currentTarget)
              }}
            >
              <MoreVert />
            </IconButton>
            <Menu
              anchorEl={anchorEl}
              keepMounted
              open={Boolean(anchorEl)}
              onClose={() => {
                setAnchorEl(null)
              }}
            >
              <MenuItem
                onClick={() => {
                  routerActions.goSettings()
                }}
              >
                <ListItemIcon sx={{ color: "inherit" }}>
                  <SettingsRounded />
                </ListItemIcon>
                <ListItemText>Settings</ListItemText>
              </MenuItem>
            </Menu>
          </div>
        </Toolbar>
      </AppTopBar>
      <Box
        component="div"
        sx={{
          ml: `env(safe-area-inset-left, 0)`,
          mr: `env(safe-area-inset-right, 0)`,
          position: "relative",
          height: "100%",
          overflow: "hidden",
        }}
      >
        <Fade in={currentAlbum !== undefined} timeout={1000} unmountOnExit>
          <Box
            component="div"
            ref={albumPageRef}
            sx={{
              position: "absolute",
              top: 0,
              right: 0,
              left: 0,
              pt: 8,
              pb: `calc(env(safe-area-inset-bottom, 0) + 144px)`,
              overflow: "auto",
              height: "100%",
              scrollbarColor: `${colorOnSurfaceVariant} transparent`,
              scrollbarWidth: "thin",
            }}
          >
            <AlbumPage
              albumItem={currentAlbum}
              onMount={() => {
                setScrollTarget(albumPageRef.current)
              }}
            />
          </Box>
        </Fade>
        <Fade in={currentAlbum === undefined} timeout={1000} unmountOnExit>
          <Box
            component="div"
            ref={albumListRef}
            sx={{
              position: "absolute",
              top: 0,
              right: 0,
              left: 0,
              pt: 8,
              pb: `calc(env(safe-area-inset-bottom, 0) + 144px)`,
              overflow: "auto",
              // minHeight: "100vh",
              height: "100%",
              scrollbarColor: `${colorOnSurfaceVariant} transparent`,
              scrollbarWidth: "thin",
            }}
          >
            <AlbumListPage
              onMount={() => {
                setScrollTarget(albumListRef.current)
              }}
            />
          </Box>
        </Fade>
      </Box>
    </Box>
  )
}
