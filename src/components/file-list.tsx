'use client'

import { AudioTrackFileItem, BaseFileItem, FolderItem, useFileStore } from "../stores/file-store";
import { useRouter } from 'next/navigation';
import { FileListItemAudioTrack, FileListItemBasic } from "./file-list-item";
import { usePlayerStore } from "../stores/player-store";
import { InsertDriveFileOutlined, AudioFileOutlined } from "@mui/icons-material";
import FolderIcon from '@mui/icons-material/Folder';
import { useNetworkMonitor } from "../stores/network-monitor";

export interface FileListProps {
  files: BaseFileItem[] | undefined;
}

export function FileList(props: FileListProps) {
  const router = useRouter();
  const playerStore = usePlayerStore();
  const networkMonitor = useNetworkMonitor();
  const fileStore = useFileStore();

  return (
    <div>
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
            icon={<FolderIcon />}
            fileStatus={fileStatus}
            onClick={(event) => {
              router.push(`/files#${file.id}`);
            }} />
        }
        if (file.type === 'audio-track') {
          return <FileListItemAudioTrack
            key={file.id} fileId={file.id} name={file.name}
            onClick={(event) => {
              if (!props.files) return;
              const tracks = props.files.filter((f) => f.type === 'audio-track') as AudioTrackFileItem[];
              const index = tracks.findIndex((t) => t.id === file.id);
              playerStore.playTrack(index, tracks);
            }}
          />
        }

        return <FileListItemBasic
          key={file.id} name={file.name}
          icon={<InsertDriveFileOutlined />}
          disabled
          fileStatus='local'
        />
      })}
    </div>
  )
}