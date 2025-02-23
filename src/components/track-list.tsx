"use client"

import {
  Box,
  Card,
  Icon,
  IconButton,
  SxProps,
  Toolbar,
  CardActionArea,
  CardContent,
  Typography,
  ButtonBase,
  List,
  ListItemButton,
  ListItemText,
  Theme,
  ListItemIcon,
  ListItem,
  Menu,
  MenuItem,
} from "@mui/material"
import React, { useCallback, useMemo, useRef, useState } from "react"
import { usePlayerStore } from "../stores/player-store"
import { useThemeStore } from "../stores/theme-store"
import {
  MaterialDynamicColors,
  hexFromArgb,
} from "@material/material-color-utilities"
import { MoreVert } from "@mui/icons-material"
import { useRouter } from "../router"
import { AudioTrackFileItem } from "../drive-clients/base-drive-client"
import { SerializedStyles } from "@emotion/react"

interface TrackListItemProps {
  track: AudioTrackFileItem
  activeTrack: AudioTrackFileItem | undefined
  playTrack?: (track: AudioTrackFileItem) => void
  onMenuClick: (
    event: React.MouseEvent<HTMLButtonElement>,
    track: AudioTrackFileItem
  ) => void
}

const TrackListItem = React.memo(function TrackListItem({
  track,
  activeTrack,
  playTrack,
  onMenuClick,
}: TrackListItemProps) {
  const [themeStoreState] = useThemeStore()

  const colorOnSurfaceVariant = hexFromArgb(
    MaterialDynamicColors.onSurfaceVariant.getArgb(themeStoreState.scheme)
  )
  const colorTertiary = hexFromArgb(
    MaterialDynamicColors.tertiary.getArgb(themeStoreState.scheme)
  )
  const colorOnSurface = hexFromArgb(
    MaterialDynamicColors.onSurface.getArgb(themeStoreState.scheme)
  )
  const selected = activeTrack?.id === track.id

  return (
    <ListItem
      secondaryAction={
        <div>
          <IconButton
            sx={{
              color: colorOnSurfaceVariant,
            }}
            edge="end"
            onClick={(
              event: React.MouseEvent<HTMLButtonElement, MouseEvent>
            ) => {
              onMenuClick(event, track)
            }}
          >
            <MoreVert />
          </IconButton>
        </div>
      }
      disablePadding
    >
      <ListItemButton
        onClick={() => {
          if (playTrack) playTrack(track)
        }}
        selected={selected}
      >
        <ListItemIcon>
          <Typography color={colorOnSurfaceVariant}>
            {track.metadata?.common.track.no}
          </Typography>
        </ListItemIcon>
        <ListItemText
          primaryTypographyProps={{
            style: {
              whiteSpace: "nowrap",
              overflow: "hidden",
              textOverflow: "ellipsis",
              color: selected ? colorTertiary : colorOnSurface,
            },
          }}
          secondaryTypographyProps={{
            style: {
              whiteSpace: "nowrap",
              overflow: "hidden",
              textOverflow: "ellipsis",
              color: colorOnSurfaceVariant,
            },
          }}
          primary={track.metadata?.common?.title || track.name}
          secondary={track.metadata?.common?.artists?.join(", ") || ""}
        />
      </ListItemButton>
    </ListItem>
  )
})

const TrackListInner = React.memo(function TrackListInner({
  tracks,
  activeTrack,
  playTrack,
}: {
  tracks?: AudioTrackFileItem[]
  activeTrack?: AudioTrackFileItem
  playTrack: (track: AudioTrackFileItem) => void
}) {
  const [menuAnchorEl, setMenuAnchorEl] = useState<null | HTMLElement>(null)
  const refMenuTrack = useRef<AudioTrackFileItem | null>(null)
  const [, routerActions] = useRouter()

  const onMenuClick = useCallback(
    (event: React.MouseEvent<HTMLButtonElement>, track: AudioTrackFileItem) => {
      setMenuAnchorEl(event.currentTarget)
      refMenuTrack.current = track
    },
    []
  )

  return (
    <List>
      {tracks?.map(track => (
        <TrackListItem
          key={track.id}
          track={track}
          activeTrack={activeTrack}
          playTrack={playTrack}
          onMenuClick={onMenuClick}
        />
      ))}
      <Menu
        anchorEl={menuAnchorEl}
        open={Boolean(menuAnchorEl)}
        onClose={() => setMenuAnchorEl(null)}
        keepMounted
      >
        <MenuItem
          onClick={() => {
            const parentId = refMenuTrack.current?.parentId
            if (!parentId) return
            routerActions.goFile(parentId)
          }}
        >
          <ListItemText>Open Files</ListItemText>
        </MenuItem>
      </Menu>
    </List>
  )
})

interface TrackListProps {
  tracks: AudioTrackFileItem[] | undefined
  albumId?: string
  cssStyle?: SerializedStyles
}

export const TrackList = React.memo(function TrackList({
  tracks,
  albumId,
  cssStyle,
}: TrackListProps) {
  const [playerStoreState, playerActions] = usePlayerStore()

  const tracksSorted = useMemo(() => {
    return tracks?.sort((a, b) => {
      const aDiskN = a.metadata?.common.disk?.no || 1
      const bDiskN = b.metadata?.common.disk?.no || 1
      const aTrackN = a.metadata?.common.track.no || 1
      const bTrackN = b.metadata?.common.track.no || 1

      if (aDiskN !== bDiskN) return aDiskN - bDiskN
      return aTrackN - bTrackN
    })
  }, [tracks])

  const playTrack = useCallback(
    (file: AudioTrackFileItem) => {
      const tracks = tracksSorted

      if (!tracks) return
      if (!albumId) return

      const index = tracks.findIndex(t => t.id === file.id)

      playerActions.playTrack(
        index,
        tracks,
        `/albums#${encodeURIComponent(albumId)}`
      )
    },
    [tracksSorted, albumId]
  )

  return (
    <div css={cssStyle}>
      <TrackListInner
        tracks={tracksSorted}
        activeTrack={playerStoreState.activeTrack?.file}
        playTrack={playTrack}
      />
    </div>
  )
})
