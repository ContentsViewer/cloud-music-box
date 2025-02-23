"use client"

import { useRouter } from "../router"
import { FileListItemAudioTrack, FileListItemBasic } from "./file-list-item"
import { AudioTrack, usePlayerStore } from "../stores/player-store"
import { InsertDriveFileOutlined, AudioFileOutlined } from "@mui/icons-material"
import FolderIcon from "@mui/icons-material/Folder"
import { useNetworkMonitor } from "../stores/network-monitor"
import { List, ListItemIcon, SxProps } from "@mui/material"
import { useCallback, useEffect, useMemo, useRef } from "react"
import React from "react"
import {
  AudioTrackFileItem,
  BaseFileItem,
  FolderItem,
} from "../drive-clients/base-drive-client"
import { SerializedStyles } from "@emotion/react"

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
  console.log("isOnline", isOnline)

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

const FileListInner = React.memo(function FileListInner({
  files,
  playTrack,
}: {
  files?: BaseFileItem[]
  playTrack: (file: AudioTrackFileItem) => void
}) {
  return (
    <List>
      {files?.map(file => (
        <FileListItem
          key={file.id}
          file={file}
          playTrack={playTrack}
          activeTrack={null}
        />
      ))}
    </List>
  )
})

export interface FileListProps {
  folderId?: string
  files?: BaseFileItem[]
  cssStyle?: SerializedStyles
}

export function FileList(props: FileListProps) {
  const [, playerActions] = usePlayerStore()

  const playTrack = useCallback(
    (file: AudioTrackFileItem) => {
      if (!props.files) return
      const tracks = props.files.filter(
        f => f.type === "audio-track"
      ) as AudioTrackFileItem[]
      const index = tracks.findIndex(t => t.id === file.id)
      playerActions.playTrack(
        index,
        tracks,
        `/files#${props.folderId}`
      )
    },
    [props.files, props.folderId]
  )

  return (
    <div css={props.cssStyle}>
      <FileListInner files={props.files} playTrack={playTrack} />
    </div>
  )
}
