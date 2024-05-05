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
  ArrowBack,
  ArrowBackRounded,
  FolderRounded,
  HomeRounded,
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
} from "@mui/material"
import React, { useCallback, useRef } from "react"
import { useEffect, useState } from "react"

const AlbumCard = React.memo(function AlbumCard({
  albumItem,
  openAlbum = () => {},
}: {
  albumItem: AlbumItem
  openAlbum?: (albumId: string) => void
}) {
  const [coverUrl, setCoverUrl] = useState<string | undefined>(undefined)
  useEffect(() => {
    if (!albumItem.cover) return
    const url = URL.createObjectURL(albumItem.cover)
    setCoverUrl(url)
    return () => URL.revokeObjectURL(url)
  }, [albumItem.cover])
  return (
    <Box
      sx={{
        display: "flex",
        flexDirection: "column",
        justifyContent: "center",
        alignItems: "center",
      }}
    >
      {/* <Fade in={true}> */}
      <ButtonBase
        sx={{
          borderRadius: "10%",
        }}
        onClick={() => {
          openAlbum(albumItem.name)
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
      {/* </Fade> */}
      <Typography
        sx={{
          mt: 1,
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
}

const AlbumList = React.memo(function AlbumList({ albums }: AlbumListProps) {
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
        gap: 2,
        gridTemplateColumns: "repeat(auto-fill, minmax(144px, 1fr))",
        display: "grid",
        maxWidth: "1040px",
        margin: "0 auto",
        width: "100%",
      }}
    >
      {albums.map(album => {
        return (
          <AlbumCard key={album.name} albumItem={album} openAlbum={openAlbum} />
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
        px: 2,
        ...props.sx,
      }}
    >
      <AlbumList albums={albums} />
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
          gap: 1,
          alignItems: "center",
          width: "100%",
          my: 3,
        }}
      >
        {/* <Fade in={true}> */}
        <AlbumCover
          sx={{
            // flexBasis: "50%",
            // height: "auto",
            // width: "auto",
            // aspectRatio: "1 / 1",
            // maxWidth: "200px",
            width: "200px",
            height: "200px",
          }}
          coverUrl={coverUrl}
        />
        {/* </Fade> */}

        <Box
          sx={{
            flexGrow: 1,
            display: "flex",
            flexDirection: "column",
            // alignItems: "flex-start",
            // alignItems: "center",
            // alignItems: {
            //   xs: "",
            //   sm: "flex-start",
            // },

            minWidth: 0,
            // width: "100%",
          }}
        >
          <Typography
            variant="h5"
            sx={{
              // width: "100%",
              fontWeight: "bold",
              // display: "-webkit-box",
              overflow: "hidden",
              // WebkitBoxOrient: "vertical",
              // WebkitBoxOrient: "vertical",
              // WebkitLineClamp: 2,
              // -webkit-line-clamp: 3
              // textAlign: "center",
              // textAlign: {
              //   xs: "center",
              //   sm: "left",
              // },
            }}
          >
            {albumItem ? albumItem.name : ""}
          </Typography>
          {/* <MarqueeText
            variant="h5"
            sx={{
              width: "100%",
            }}
            typographySx={{
              fontWeight: "bold",
            }}
            text={albumItem ? albumItem.name : ""}
          /> */}
          <Box
            sx={{
              display: "flex",
              minWidth: "200px",
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

  return (
    <Box>
      <AppTopBar>
        <Toolbar>
          <IconButton
            size="large"
            edge="start"
            color="inherit"
            onClick={() => {
              if (currentAlbum) {
                routerActions.goAlbum()
                return
              }
              routerActions.goHome()
            }}
          >
            <ArrowBackRounded />
          </IconButton>

          <IconButton
            color="inherit"
            onClick={() => {
              routerActions.goHome()
            }}
          >
            <HomeRounded />
          </IconButton>
          <Typography
            sx={{
              mx: 1,
              color: colorOnSurfaceVariant,
            }}
          >
            /
          </Typography>
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
        </Toolbar>
      </AppTopBar>
      <Box
        sx={{
          mt: 8,
          ml: `env(safe-area-inset-left, 0)`,
          mr: `env(safe-area-inset-right, 0)`,
        }}
      >
        {currentAlbum ? (
          <AlbumPage albumItem={currentAlbum} />
        ) : (
          <AlbumListPage />
        )}
      </Box>
    </Box>
  )
}
