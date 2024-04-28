'use client'

import { AudioTrackFileItem, BaseFileItem, FolderItem, useFileStore } from "../stores/file-store";
import { useRouter } from '../router';
import { FileListItemAudioTrack, FileListItemBasic } from "./file-list-item";
import { usePlayerStore } from "../stores/player-store";
import { InsertDriveFileOutlined, AudioFileOutlined } from "@mui/icons-material";
import FolderIcon from '@mui/icons-material/Folder';
import { useNetworkMonitor } from "../stores/network-monitor";
import { List, ListItemIcon, SxProps } from "@mui/material";
import { useEffect } from "react";

export interface FileListProps {
  files: BaseFileItem[] | undefined;
  sx?: SxProps;
}

export function FileList(props: FileListProps) {
  const [routerState, routerActions] = useRouter();
  const [playerState, playerActions] = usePlayerStore();
  const networkMonitor = useNetworkMonitor();
  const [ fileStoreState, fileStoreActions ] = useFileStore();

  return (
    <List sx={props.sx}>
      {props.files?.map((file) => {
        if (file.type === 'folder') {
          const folderItem = file as FolderItem;
          // If the folderItem has childrenIds, can open it even if offline.
          const inLocal = folderItem.childrenIds !== undefined;
          const disabled = (folderItem.childrenIds === undefined) && !networkMonitor.isOnline;
          const fileStatus = inLocal ? 'local' : networkMonitor.isOnline ? 'online' : 'offline';
          return <FileListItemBasic
            disabled={disabled}
            key={file.id} name={file.name}
            icon={
              <ListItemIcon>
                <FolderIcon />
              </ListItemIcon>
            }
            fileStatus={fileStatus}
            onClick={(event) => {
              routerActions.goFile(file.id);
            }} />
        }
        if (file.type === 'audio-track') {
          return <FileListItemAudioTrack
            key={file.id} file={file as AudioTrackFileItem}
            onClick={(event) => {
              if (!props.files) return;
              const tracks = props.files.filter((f) => f.type === 'audio-track') as AudioTrackFileItem[];
              const index = tracks.findIndex((t) => t.id === file.id);
              // console.log('play track', index, tracks);
              playerActions.playTrack(index, tracks);
            }}
          />
        }

        return <FileListItemBasic
          key={file.id} name={file.name}
          icon={
            <ListItemIcon>
              <InsertDriveFileOutlined />
            </ListItemIcon>
          }
          disabled
          fileStatus='local'
        />
      })}
    </List>
  )
}