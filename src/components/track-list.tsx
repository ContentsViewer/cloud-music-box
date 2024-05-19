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
import { AudioTrackFileItem } from "../stores/file-store"
import React, { useCallback, useMemo, useRef, useState } from "react"
import { usePlayerStore } from "../stores/player-store"
import { useThemeStore } from "../stores/theme-store"
import {
  MaterialDynamicColors,
  hexFromArgb,
} from "@material/material-color-utilities"
import { MoreVert } from "@mui/icons-material"
import { useRouter } from "../router"

interface TrackListItemProps {
  track: AudioTrackFileItem
  activeTrack: AudioTrackFileItem | undefined
  playTrack?: (track: AudioTrackFileItem) => void
  menuItems?: React.ReactNode
}

const TrackListItem = React.memo(function TrackListItem({
  track,
  activeTrack,
  playTrack,
  menuItems,
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

  const [anchorEl, setAnchorEl] = useState<null | HTMLElement>(null)

  return (
    <ListItem
      secondaryAction={
        <div>
          <IconButton
            sx={{
              color: colorOnSurfaceVariant,
            }}
            edge="end"
            onClick={event => {
              setAnchorEl(event.currentTarget)
            }}
            disabled={menuItems === undefined}
          >
            {/* <MoreHoriz /> */}
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
            {menuItems}
          </Menu>
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

interface TrackListProps {
  tracks: AudioTrackFileItem[] | undefined
  albumId?: string
  sx?: SxProps<Theme>
}

export const TrackList = React.memo(function TrackList({
  tracks,
  albumId,
  sx,
}: TrackListProps) {
  const [playerStoreState, playerActions] = usePlayerStore()
  const playerActionsRef = useRef(playerActions)
  playerActionsRef.current = playerActions
  const [routerState, routerActions] = useRouter()

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
      if (!playerActionsRef.current) return
      if (!albumId) return

      const index = tracks.findIndex(t => t.id === file.id)

      playerActionsRef.current.playTrack(
        index,
        tracks,
        `/albums#${encodeURIComponent(albumId)}`
      )
    },
    [tracksSorted, albumId]
  )
  const trackListItems = useMemo(() => {
    // console.log("!!!!!")
    return tracksSorted?.map(track => {
      return (
        <TrackListItem
          key={track.id}
          track={track}
          activeTrack={playerStoreState.activeTrack?.file}
          playTrack={playTrack}
          menuItems={[
            <MenuItem
              key="go-to-file"
              onClick={() => {
                const parentId = track.parentId
                if (!parentId) return
                routerActions.goFile(parentId)
              }}
            >
              <ListItemText>Open Files</ListItemText>
            </MenuItem>,
          ]}
        />
      )
    })
  }, [
    tracksSorted,
    playerStoreState.activeTrack?.file,
    playTrack,
    routerActions,
  ])

  return <List sx={{ ...sx }}>{trackListItems}</List>
})
