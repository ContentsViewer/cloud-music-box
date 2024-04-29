"use client"

import {
  AudioTrackFileItem,
  BaseFileItem,
  FolderItem,
  useFileStore,
} from "../stores/file-store"
import { useRouter } from "../router"
import { FileListItemAudioTrack, FileListItemBasic } from "./file-list-item"
import { AudioTrack, usePlayerStore } from "../stores/player-store"
import { InsertDriveFileOutlined, AudioFileOutlined } from "@mui/icons-material"
import FolderIcon from "@mui/icons-material/Folder"
import { useNetworkMonitor } from "../stores/network-monitor"
import { List, ListItemIcon, SxProps } from "@mui/material"
import { useCallback, useEffect, useMemo, useRef } from "react"
import React from "react"

const FileListItem = React.memo(function FileListItem({
  file,
  playTrack,
  activeTrack,
}: {
  file: BaseFileItem
  playTrack: (file: AudioTrackFileItem) => void
  activeTrack: AudioTrack | null
}) {
  const networkMonitor = useNetworkMonitor()
  const [, routerActions] = useRouter()

  const isOnline = networkMonitor.isOnline

  const playTrackWrapped = useCallback(() => { 
    playTrack(file as AudioTrackFileItem)
  }, [playTrack, file])

  if (file.type === "folder") {
    const folderItem = file as FolderItem
    // If the folderItem has childrenIds, can open it even if offline.
    const inLocal = folderItem.childrenIds !== undefined
    const disabled = folderItem.childrenIds === undefined && !isOnline
    const fileStatus = inLocal ? "local" : isOnline ? "online" : "offline"
    return (
      <FileListItemBasic
        disabled={disabled}
        key={file.id}
        name={file.name}
        icon={
          <ListItemIcon>
            <FolderIcon />
          </ListItemIcon>
        }
        fileStatus={fileStatus}
        onClick={() => {
          routerActions.goFile(file.id)
        }}
      />
    )
  }
  if (file.type === "audio-track") {
    return (
      <FileListItemAudioTrack
        key={file.id}
        file={file as AudioTrackFileItem}
        selected={activeTrack?.file.id === file.id}
        onClick={playTrackWrapped}
      />
    )
  }

  return (
    <FileListItemBasic
      key={file.id}
      name={file.name}
      icon={
        <ListItemIcon>
          <InsertDriveFileOutlined />
        </ListItemIcon>
      }
      disabled
      fileStatus="local"
    />
  )
})

export interface FileListProps {
  files: BaseFileItem[] | undefined
  sx?: SxProps
}

export function FileList(props: FileListProps) {
  const [playerStoreState, playerActions] = usePlayerStore()
  const playerActionsRef = useRef(playerActions)
  playerActionsRef.current = playerActions

  const playTrack = useCallback(
    (file: AudioTrackFileItem) => {
      if (!props.files) return
      if (!playerActionsRef.current) return
      const tracks = props.files.filter(
        f => f.type === "audio-track"
      ) as AudioTrackFileItem[]
      const index = tracks.findIndex(t => t.id === file.id)
      playerActionsRef.current.playTrack(index, tracks)
    },
    [props.files]
  )

  return (
    <List sx={props.sx}>
      {props.files?.map(file => (
        <FileListItem
          key={file.id}
          file={file}
          playTrack={playTrack}
          activeTrack={playerStoreState.activeTrack}
        />
      ))}
    </List>
  )
}
