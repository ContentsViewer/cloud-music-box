"use client"

import { useRouter } from "@/src/stores/router"
import { FileListItemAudioTrack, FileListItemBasic } from "./file-list-item"
import { InsertDriveFileOutlined, AudioFileOutlined } from "@mui/icons-material"
import FolderIcon from "@mui/icons-material/Folder"
import { useNetworkMonitor } from "@/src/stores/network-monitor"
import { List, ListItemIcon, ListItemText, Menu, MenuItem } from "@mui/material"
import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react"

import {
  AudioTrackFileItem,
  BaseFileItem,
  FolderItem,
} from "../api/base-drive-client"
import { SerializedStyles } from "@emotion/react"

const FileListItem = memo(function FileListItem({
  file,
  playTrack,
  activeFileId,
  onClickMenu,
}: {
  file: BaseFileItem
  playTrack: (file: AudioTrackFileItem) => void
  activeFileId?: string
  onClickMenu?: (
    event: React.MouseEvent<HTMLButtonElement>,
    file: BaseFileItem
  ) => void
}) {
  const networkMonitor = useNetworkMonitor()
  const [, routerActions] = useRouter()

  const isOnline = networkMonitor.isOnline

  const playTrackWrapped = useCallback(() => {
    playTrack(file as AudioTrackFileItem)
  }, [playTrack, file])

  const onClickMenuWrapped = useCallback(
    (event: React.MouseEvent<HTMLButtonElement>) => {
      if (onClickMenu) {
        onClickMenu(event, file)
      }
    },
    [onClickMenu, file]
  )

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
        selected={activeFileId === file.id}
        onClick={playTrackWrapped}
        onClickMenu={onClickMenuWrapped}
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

const FileListInner = memo(function FileListInner({
  files,
  playTrack,
  activeFileId,
}: {
  files?: BaseFileItem[]
  playTrack: (file: AudioTrackFileItem) => void
  activeFileId?: string
}) {
  const [, routerActions] = useRouter()
  const [menuAnchorEl, setMenuAnchorEl] = useState<null | HTMLElement>(null)
  const refMenuFile = useRef<BaseFileItem | null>(null)

  const onClickMenu = useCallback(
    (event: React.MouseEvent<HTMLButtonElement>, file: BaseFileItem) => {
      refMenuFile.current = file
      setMenuAnchorEl(event.currentTarget)
    },
    []
  )

  return (
    <List>
      {files?.map(file => (
        <FileListItem
          key={file.id}
          file={file}
          playTrack={playTrack}
          activeFileId={activeFileId}
          onClickMenu={onClickMenu}
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
            if (!refMenuFile.current) return
            if (refMenuFile.current.type !== "audio-track") return
            const audioTrackFileItem = refMenuFile.current as AudioTrackFileItem
            let albumName = audioTrackFileItem.metadata?.common.album
            if (albumName === undefined) albumName = "Unknown Album"
            albumName = albumName.replace(/\0+$/, "")
            routerActions.goAlbum(albumName)
          }}
        >
          <ListItemText>Open Album</ListItemText>
        </MenuItem>
      </Menu>
    </List>
  )
})

export interface FileListProps {
  folderId?: string
  files?: BaseFileItem[]
  cssStyle?: SerializedStyles
  /** File id of the currently playing track (for row highlighting) */
  activeFileId?: string
  /** Play request. Pages wire this to playerActions.playTrack (avoids a reverse dependency between features) */
  onPlayTracks: (
    index: number,
    tracks: AudioTrackFileItem[],
    sourceUrl: string
  ) => void
}

export function FileList(props: FileListProps) {
  const { files, folderId, onPlayTracks } = props

  const playTrack = useCallback(
    (file: AudioTrackFileItem) => {
      if (!files) return
      const tracks = files.filter(
        f => f.type === "audio-track"
      ) as AudioTrackFileItem[]
      const index = tracks.findIndex(t => t.id === file.id)
      onPlayTracks(index, tracks, `/files#${folderId}`)
    },
    [files, folderId, onPlayTracks]
  )

  return (
    <div css={props.cssStyle}>
      <FileListInner
        files={files}
        playTrack={playTrack}
        activeFileId={props.activeFileId}
      />
    </div>
  )
}
