"use client"

import {
  Avatar,
  ListItemAvatar,
  ListItemButton,
  ListItemIcon,
  ListItemText,
} from "@mui/material"
import FolderIcon from "@mui/icons-material/Folder"
import {
  AudioFileOutlined,
  Audiotrack,
  CloudOff,
  CloudQueue,
  InsertDriveFileOutlined,
  Inventory,
} from "@mui/icons-material"
import { useNetworkMonitor } from "../stores/network-monitor"
import { useEffect, useRef, useState } from "react"
import { AudioTrackFileItem, useFileStore } from "../stores/file-store"
import { enqueueSnackbar } from "notistack"
import { usePlayerStore } from "../stores/player-store"
import * as mm from "music-metadata-browser"

interface FileListItemBasicProps {
  name: string
  secondaryText?: string
  icon: React.ReactElement
  onClick?: (event: any) => void
  disabled?: boolean
  fileStatus: "online" | "offline" | "local"
  selected?: boolean
}

export function FileListItemBasic({
  name,
  secondaryText,
  icon,
  onClick,
  disabled,
  fileStatus,
  selected,
}: FileListItemBasicProps) {
  return (
    <ListItemButton onClick={onClick} disabled={disabled} selected={selected}>
      {icon}
      <ListItemText
        primaryTypographyProps={{
          style: {
            whiteSpace: "nowrap",
            overflow: "hidden",
            textOverflow: "ellipsis",
          },
        }}
        primary={name}
        secondary={secondaryText}
      />
      {fileStatus === "online" ? (
        <CloudQueue fontSize="small" color="disabled" />
      ) : fileStatus === "offline" ? (
        <CloudOff fontSize="small" color="disabled" />
      ) : fileStatus === "local" ? (
        <Inventory fontSize="small" color="disabled" />
      ) : null}
    </ListItemButton>
  )
}

interface FileListItemAudioTrackProps {
  file: AudioTrackFileItem
  onClick?: (event: any) => void
}

export function FileListItemAudioTrack({
  file,
  onClick,
}: FileListItemAudioTrackProps) {
  const [fileStatus, setFileStatus] = useState<"online" | "offline" | "local">(
    "offline"
  )
  const networkMonitor = useNetworkMonitor()
  const [fileStoreState, fileStoreActions] = useFileStore()
  const fileStoreActionsRef = useRef(fileStoreActions)
  fileStoreActionsRef.current = fileStoreActions

  const [playerState] = usePlayerStore()
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

  return (
    <FileListItemBasic
      name={title}
      icon={
        <ListItemAvatar>
          <Avatar src={coverUrl} variant="rounded">
            {coverUrl ? null : <Audiotrack />}
          </Avatar>
        </ListItemAvatar>
      }
      fileStatus={fileStatus}
      selected={playerState.activeTrack?.file.id === file.id}
      disabled={fileStatus === "offline"}
      onClick={onClick}
      secondaryText={file.metadata?.common.artists?.join(", ") || ""}
    />
  )
}
