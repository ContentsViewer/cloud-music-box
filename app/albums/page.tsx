"use client"
import { AlbumCover } from "@/src/components/album-cover"
import AppTopBar from "@/src/components/app-top-bar"
import { MarqueeText } from "@/src/components/marquee-text"
import { useRouter } from "@/src/router"
import {
  AlbumItem,
  AudioTrackFileItem,
  useFileStore,
} from "@/src/stores/file-store"
import { useThemeStore } from "@/src/stores/theme-store"
import { TrackList } from "@/src/components/track-list"
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
  SettingsRounded,
} from "@mui/icons-material"
import {
  Box,
  Fade,
  IconButton,
  SxProps,
  Toolbar,
  Divider,
  Typography,
  ButtonBase,
  Menu,
  MenuItem,
  ListItemIcon,
  ListItemText,
} from "@mui/material"
import React, { useCallback, useMemo, useRef } from "react"
import { useEffect, useState } from "react"
import DownloadingIndicator from "@/src/components/downloading-indicator"
import { usePlayerStore } from "@/src/stores/player-store"

const AlbumCard = React.memo(function AlbumCard({
  albumItem,
  openAlbum = () => {},
  appeal = false,
}: {
  albumItem: AlbumItem
  openAlbum?: (albumId: string) => void
  appeal?: boolean
}) {
  const [themeStoreState] = useThemeStore()
  const [coverUrl, setCoverUrl] = useState<string | undefined>(undefined)
  useEffect(() => {
    if (!albumItem.cover) return
    const url = URL.createObjectURL(albumItem.cover)
    setCoverUrl(url)
    return () => URL.revokeObjectURL(url)
  }, [albumItem.cover])

  const colorTertiary = hexFromArgb(
    MaterialDynamicColors.tertiary.getArgb(themeStoreState.scheme)
  )

  return (
    <Box
      sx={{
        display: "flex",
        flexDirection: "column",
        justifyContent: "center",
        alignItems: "center",
      }}
    >
      <ButtonBase
        sx={{
          borderRadius: "10%",
          // transition: "transform 1000ms cubic-bezier(0.4, 0, 0.2, 1), opacity 1000ms ease",
          transition: theme =>
            theme.transitions.create(["transform", "opacity"], {
              duration: 1000,
            }),
          ...(appeal
            ? {
                boxShadow: `0 0 10px 0 ${colorTertiary}`,
                animation: `appeal 5s ease-in-out infinite alternate`,
                "@keyframes appeal": {
                  "0%": {
                    transform:
                      "perspective(400px) translateY(-8px) scale(1.05) rotateX(10deg) rotateY(-10deg)",
                  },
                  "100%": {
                    transform:
                      "perspective(400px) translateY(-8px) scale(1.05) rotateX(10deg) rotateY(10deg)",
                  },
                },
              }
            : {}),
        }}
        onClick={event => {
          openAlbum(albumItem.name)
          const elem = event.currentTarget
          elem.style.animation = "none"
          // elem.style.transform = "scale(5) rotateY(180deg)"
          elem.style.opacity = "0"
          elem.style.zIndex = "100"
          // Get the initial position and size of the element
          const rect = elem.getBoundingClientRect()

          // Calculate the translate values
          const translateX =
            window.innerWidth / 2 - (rect.left + rect.width / 2)
          const translateY =
            window.innerHeight / 2 - (rect.top + rect.height / 2)

          // Calculate the scale value
          const scale = Math.max(
            window.innerWidth / rect.width,
            window.innerHeight / rect.height
          )

          // Set the transform property
          elem.style.transform = `perspective(400px) translate(${translateX}px, ${translateY}px) scale(${scale}) rotate3d(0, 1, 0, 180deg)`
        }}
      >
        <AlbumCover
          sx={{
            width: "100%",
            height: "auto",
            aspectRatio: "1 / 1",
          }}
          coverUrl={coverUrl}
        />
      </ButtonBase>
      <Typography
        sx={{
          mt: 0.5,
          whiteSpace: "nowrap",
          overflow: "hidden",
          textOverflow: "ellipsis",
          width: "100%",
          textAlign: "center",
        }}
      >
        {albumItem.name}
      </Typography>
    </Box>
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
      sx={{
        gap: 3,
        gridTemplateColumns: "repeat(auto-fill, minmax(144px, 1fr))",
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
}
const AlbumListPage = React.memo(function AlbumListPage(
  props: AlbumListPageProps
) {
  const [fileStoreState, fileStoreActions] = useFileStore()
  const fileStoreActionsRef = useRef(fileStoreActions)
  fileStoreActionsRef.current = fileStoreActions

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
    if (!fileStoreState.configured) return
    let isCanceled = false

    const getAlbums = async () => {
      const albumIds = await fileStoreActionsRef.current.getAlbumIds()
      if (isCanceled) return
      const albums = await Promise.all(
        albumIds.map(async albumId => {
          return await fileStoreActionsRef.current.getAlbumById(albumId)
        })
      )
      if (isCanceled) return
      setAlbums(albums)
    }

    getAlbums()

    return () => {
      isCanceled = true
    }
  }, [fileStoreState.configured])

  return (
    <Box
      sx={{
        p: 4,
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
}
const AlbumPage = React.memo(function AlbumPage({
  albumItem,
  sx,
}: AlbumPageProps) {
  const [fileStoreState, fileStoreActions] = useFileStore()
  const fileStoreActionsRef = useRef(fileStoreActions)
  fileStoreActionsRef.current = fileStoreActions
  const [routerState, routerActions] = useRouter()

  const [coverUrl, setCoverUrl] = useState<string | undefined>(undefined)
  const [tracks, setTracks] = useState<AudioTrackFileItem[] | undefined>([])

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

  useEffect(() => {
    if (!albumItem?.cover) return
    const url = URL.createObjectURL(albumItem.cover)
    setCoverUrl(url)
    return () => URL.revokeObjectURL(url)
  }, [albumItem?.cover])

  return (
    <Box
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
        sx={{
          display: "flex",
          flexDirection: {
            xs: "column",
            sm: "row",
          },
          px: 2,
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
            sx={{
              display: "flex",
              flexDirection: "row",
              // minWidth: "200px",
              justifyContent: "flex-end",
            }}
          >
            <IconButton
              color="inherit"
              onClick={() => {
                if (tracks === undefined) return
                if (tracks.length === 0) return
                const folderId = tracks[0].parentId
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
      <TrackList tracks={tracks} albumId={albumItem?.name} />
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
    <Box>
      <AppTopBar>
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
                <ListItemIcon>
                  <SettingsRounded />
                </ListItemIcon>
                <ListItemText>Settings</ListItemText>
              </MenuItem>
            </Menu>
          </div>
        </Toolbar>
      </AppTopBar>
      <Box
        sx={{
          mt: 8,
          ml: `env(safe-area-inset-left, 0)`,
          mr: `env(safe-area-inset-right, 0)`,
          position: "relative",
        }}
      >
        <Fade in={currentAlbum !== undefined} timeout={1000} unmountOnExit>
          <Box
            sx={{
              position: "absolute",
              top: 0,
              right: 0,
              left: 0,
              pb: `calc(env(safe-area-inset-bottom, 0) + 144px)`,
            }}
          >
            <AlbumPage albumItem={currentAlbum} />
          </Box>
        </Fade>
        <Fade in={currentAlbum === undefined} timeout={1000} unmountOnExit>
          <Box
            sx={{
              position: "absolute",
              top: 0,
              right: 0,
              left: 0,
              pb: `calc(env(safe-area-inset-bottom, 0) + 144px)`,
              overflow: "hidden",
              minHeight: "100vh",
            }}
          >
            <AlbumListPage />
          </Box>
        </Fade>
      </Box>
    </Box>
  )
}
