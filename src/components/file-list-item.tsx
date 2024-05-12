"use client"

import {
  Avatar,
  Box,
  IconButton,
  ListItemAvatar,
  ListItemButton,
  ListItemIcon,
  ListItemText,
  ListItem,
  Menu,
  MenuItem,
} from "@mui/material"
import FolderIcon from "@mui/icons-material/Folder"
import {
  ArrowDownward,
  Audiotrack,
  MoreHoriz,
  CloudOff,
  CloudQueue,
  Inventory,
  MoreVert,
  SettingsRounded,
} from "@mui/icons-material"
import { useNetworkMonitor } from "../stores/network-monitor"
import { useEffect, useRef, useState } from "react"
import { AudioTrackFileItem, useFileStore } from "../stores/file-store"
import { enqueueSnackbar } from "notistack"
import * as mm from "music-metadata-browser"
import React from "react"
import { TrackCover } from "./track-cover"
import { useThemeStore } from "../stores/theme-store"
import {
  MaterialDynamicColors,
  hexFromArgb,
} from "@material/material-color-utilities"
import { useRouter } from "../router"

interface FileListItemBasicProps {
  name: string
  secondaryText?: string
  icon: React.ReactElement
  onClick?: (event: any) => void
  disabled?: boolean
  fileStatus: "online" | "offline" | "local" | "downloading"
  selected?: boolean
  children?: React.ReactNode
  menuItems?: React.ReactNode
}

export function FileListItemBasic({
  name,
  secondaryText,
  icon,
  onClick,
  disabled,
  fileStatus,
  selected,
  children,
  menuItems,
}: FileListItemBasicProps) {
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
      <ListItemButton disabled={disabled} selected={selected} onClick={onClick}>
        {icon}
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
          primary={name}
          secondary={secondaryText}
        />
        {children}
        {fileStatus === "online" ? (
          <CloudQueue fontSize="small" color="disabled" />
        ) : fileStatus === "offline" ? (
          <CloudOff fontSize="small" color="disabled" />
        ) : fileStatus === "local" ? (
          <Inventory fontSize="small" color="disabled" />
        ) : fileStatus === "downloading" ? (
          // <CircularProgress size={16} />
          <Box
            sx={{
              width: "20px",
              height: "20px",
              // clipPath: "polygon(50% 0%, 0% 100%, 100% 100%)",
              clipPath: "inset(0 0 0 0)",
            }}
          >
            <ArrowDownward
              fontSize="small"
              color="disabled"
              sx={{
                animation: "down 2s linear infinite",
                "@keyframes down": {
                  "0%": { transform: "translateY(-20px)" },
                  "50%": { transform: "translateY(0)" },
                  "100%": { transform: "translateY(20px)" },
                },
              }}
            />
          </Box>
        ) : null}
      </ListItemButton>
    </ListItem>
  )
}

interface FileListItemAudioTrackProps {
  file: AudioTrackFileItem
  selected?: boolean
  onClick?: (event: any) => void
}

export const FileListItemAudioTrack = React.memo(
  function FileListItemAudioTrack({
    file,
    selected,
    onClick,
  }: FileListItemAudioTrackProps) {
    const [fileStatus, setFileStatus] = useState<
      "online" | "offline" | "local"
    >("offline")
    const networkMonitor = useNetworkMonitor()
    const [fileStoreState, fileStoreActions] = useFileStore()
    const fileStoreActionsRef = useRef(fileStoreActions)
    fileStoreActionsRef.current = fileStoreActions
    const [routerState, routerActions] = useRouter()

    const [coverUrl, setCoverUrl] = useState<string | undefined>(undefined)

    const title = file.metadata?.common.title || file.name

    useEffect(() => {
      const cover = mm.selectCover(file.metadata?.common.picture)
      if (cover) {
        const url = URL.createObjectURL(
          new Blob([cover.data], { type: cover.format })
        )
        setCoverUrl(url)
        return () => URL.revokeObjectURL(url)
      }
    }, [file.metadata?.common.picture])

    useEffect(() => {
      fileStoreActionsRef.current
        .hasTrackBlobInLocal(file.id)
        .then(hasBlob => {
          setFileStatus(
            hasBlob ? "local" : networkMonitor.isOnline ? "online" : "offline"
          )
        })
        .catch(error => {
          console.error(error)
          enqueueSnackbar(`${error}`, { variant: "error" })
        })
    }, [networkMonitor.isOnline, file])

    const isSyncing = fileStoreState.syncingTrackFiles[file.id]

    const disabled = fileStatus === "offline" || isSyncing

    return (
      <FileListItemBasic
        name={title}
        icon={
          <ListItemAvatar>
            <TrackCover coverUrl={coverUrl} />
          </ListItemAvatar>
        }
        fileStatus={isSyncing ? "downloading" : fileStatus}
        selected={selected}
        disabled={disabled}
        onClick={onClick}
        secondaryText={file.metadata?.common.artists?.join(", ") || ""}
        menuItems={
          [
            <MenuItem key="go-to-album" onClick={() => {
              let albumName = file.metadata?.common.album
              if (albumName === undefined) albumName = "Unknown Album"
              albumName = albumName.replace(/\0+$/, "")
              routerActions.goAlbum(albumName)
            }}>
              <ListItemText>Open Album</ListItemText>
            </MenuItem>
          ]
        }
      />
    )
  }
)
