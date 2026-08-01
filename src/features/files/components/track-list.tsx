"use client"

import {
  IconButton,
  Typography,
  List,
  ListItemButton,
  ListItemText,
  ListItemIcon,
  ListItem,
  Menu,
  MenuItem,
} from "@mui/material"
import React, { useCallback, useMemo, useRef, useState } from "react"
import { useThemeStore } from "@/src/stores/theme-store"
import {
  MaterialDynamicColors,
  hexFromArgb,
} from "@material/material-color-utilities"
import { MoreVert } from "@mui/icons-material"
import { useRouter } from "@/src/stores/router"
import { AudioTrackFileItem } from "../api/base-drive-client"
import { SerializedStyles } from "@emotion/react"

interface TrackListItemProps {
  track: AudioTrackFileItem
  activeTrack: AudioTrackFileItem | undefined
  playTrack?: (track: AudioTrackFileItem) => void
  onMenuClick: (
    event: React.MouseEvent<HTMLButtonElement>,
    track: AudioTrackFileItem
  ) => void
  secondaryAction?: (track: AudioTrackFileItem) => React.ReactNode
  hideTrackNumber?: boolean
}

const TrackListItem = React.memo(function TrackListItem({
  track,
  activeTrack,
  playTrack,
  onMenuClick,
  secondaryAction,
  hideTrackNumber,
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
          {secondaryAction?.(track)}
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
        {hideTrackNumber ? null : (
          <ListItemIcon>
            <Typography color={colorOnSurfaceVariant}>
              {track.metadata?.common.track.no}
            </Typography>
          </ListItemIcon>
        )}
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
  extraMenuItems,
  secondaryAction,
  hideTrackNumber,
}: {
  tracks?: AudioTrackFileItem[]
  activeTrack?: AudioTrackFileItem
  playTrack: (track: AudioTrackFileItem) => void
  extraMenuItems?: (
    track: AudioTrackFileItem,
    closeMenu: () => void
  ) => React.ReactNode
  secondaryAction?: (track: AudioTrackFileItem) => React.ReactNode
  hideTrackNumber?: boolean
}) {
  const [menuAnchorEl, setMenuAnchorEl] = useState<null | HTMLElement>(null)
  const [menuTrack, setMenuTrack] = useState<AudioTrackFileItem | null>(null)
  const refMenuTrack = useRef<AudioTrackFileItem | null>(null)
  const [, routerActions] = useRouter()

  const onMenuClick = useCallback(
    (event: React.MouseEvent<HTMLButtonElement>, track: AudioTrackFileItem) => {
      setMenuAnchorEl(event.currentTarget)
      refMenuTrack.current = track
      setMenuTrack(track)
    },
    []
  )

  const closeMenu = useCallback(() => setMenuAnchorEl(null), [])

  return (
    <List>
      {tracks?.map(track => (
        <TrackListItem
          key={track.id}
          track={track}
          activeTrack={activeTrack}
          playTrack={playTrack}
          onMenuClick={onMenuClick}
          secondaryAction={secondaryAction}
          hideTrackNumber={hideTrackNumber}
        />
      ))}
      <Menu
        anchorEl={menuAnchorEl}
        open={Boolean(menuAnchorEl)}
        onClose={closeMenu}
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
        {menuTrack ? extraMenuItems?.(menuTrack, closeMenu) : null}
      </Menu>
    </List>
  )
})

interface TrackListProps {
  tracks: AudioTrackFileItem[] | undefined
  /** Deep link the player card's back arrow returns to, e.g. `/albums#<id>` */
  sourceUrl?: string
  /** Album order. Off for playlists, where the given order is the order. */
  sortByTrackNumber?: boolean
  cssStyle?: SerializedStyles
  /** File of the currently playing track (for row highlighting) */
  activeTrack?: AudioTrackFileItem
  /** Play request. Pages wire this to playerActions.playTrack (avoids a reverse dependency between features) */
  onPlayTracks: (
    index: number,
    tracks: AudioTrackFileItem[],
    sourceUrl: string
  ) => void
  /**
   * Extra entries for the per-row overflow menu. Supplied by the page so that
   * other features (playlists) can act on a track without this feature
   * depending on them.
   */
  extraMenuItems?: (
    track: AudioTrackFileItem,
    closeMenu: () => void
  ) => React.ReactNode
  /** Inline controls rendered before the overflow button, e.g. Keep / Remove */
  secondaryAction?: (track: AudioTrackFileItem) => React.ReactNode
  hideTrackNumber?: boolean
}

export const TrackList = React.memo(function TrackList({
  tracks,
  sourceUrl,
  sortByTrackNumber = true,
  cssStyle,
  activeTrack,
  onPlayTracks,
  extraMenuItems,
  secondaryAction,
  hideTrackNumber,
}: TrackListProps) {
  const tracksSorted = useMemo(() => {
    if (!tracks) return tracks
    if (!sortByTrackNumber) return tracks
    // Copy first: sorting in place would reorder the caller's own array
    return [...tracks].sort((a, b) => {
      const aDiskN = a.metadata?.common.disk?.no || 1
      const bDiskN = b.metadata?.common.disk?.no || 1
      const aTrackN = a.metadata?.common.track.no || 1
      const bTrackN = b.metadata?.common.track.no || 1

      if (aDiskN !== bDiskN) return aDiskN - bDiskN
      return aTrackN - bTrackN
    })
  }, [tracks, sortByTrackNumber])

  const playTrack = useCallback(
    (file: AudioTrackFileItem) => {
      const tracks = tracksSorted

      if (!tracks) return
      if (!sourceUrl) return

      const index = tracks.findIndex(t => t.id === file.id)

      onPlayTracks(index, tracks, sourceUrl)
    },
    [tracksSorted, sourceUrl, onPlayTracks]
  )

  return (
    <div css={cssStyle}>
      <TrackListInner
        tracks={tracksSorted}
        activeTrack={activeTrack}
        playTrack={playTrack}
        extraMenuItems={extraMenuItems}
        secondaryAction={secondaryAction}
        hideTrackNumber={hideTrackNumber}
      />
    </div>
  )
})
