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
} from "@mui/material"
import { AudioTrackFileItem } from "../stores/file-store"
import React, { useCallback, useMemo, useRef } from "react"
import { usePlayerStore } from "../stores/player-store"
import { useThemeStore } from "../stores/theme-store"
import {
  MaterialDynamicColors,
  hexFromArgb,
} from "@material/material-color-utilities"

interface TrackListItemProps {
  track: AudioTrackFileItem
  activeTrack: AudioTrackFileItem | undefined
  playTrack?: (track: AudioTrackFileItem) => void
}

const TrackListItem = React.memo(function TrackListItem({
  track,
  activeTrack,
  playTrack,
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
}: TrackListProps) {
  const [playerStoreState, playerActions] = usePlayerStore()
  const playerActionsRef = useRef(playerActions)
  playerActionsRef.current = playerActions

  const tracksSorted = tracks?.sort((a, b) => {
    const aDiskN = a.metadata?.common.disk?.no || 1
    const bDiskN = b.metadata?.common.disk?.no || 1
    const aTrackN = a.metadata?.common.track.no || 1
    const bTrackN = b.metadata?.common.track.no || 1

    if (aDiskN !== bDiskN) return aDiskN - bDiskN
    return aTrackN - bTrackN
  })

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
    return tracksSorted?.map(track => {
      return (
        <TrackListItem
          key={track.id}
          track={track}
          activeTrack={playerStoreState.activeTrack?.file}
          playTrack={playTrack}
        />
      )
    })
  }, [tracksSorted, playerStoreState.activeTrack?.file, playTrack])

  return <List>{trackListItems}</List>
})
