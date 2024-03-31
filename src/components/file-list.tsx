import { AudioTrackFileItem, BaseFileItem, FolderItem } from "../stores/file-store";
import { useRouter } from 'next/navigation';
import { FileListItemBasic } from "./file-list-item";
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

  return (
    <div>
      {props.files?.map((file) => {
        if (file.type === 'folder') {
          const folderItem = file as FolderItem;
          // If the folderItem has childrenIds, can open it even if offline.
          const inLocal = folderItem.childrenIds !== undefined;
          const disabled = (folderItem.childrenIds === undefined) && !networkMonitor.isOnline; 

          return <FileListItemBasic
            disabled={disabled}
            key={file.id} name={file.name}
            icon={<FolderIcon />}
            onClick={() => {
              router.push(`/files?id=${file.id}`);
            }} />
        }
        if (file.type === 'audio-track') {
          return <FileListItemBasic
            key={file.id} name={file.name}
            icon={<AudioFileOutlined />}
            onClick={() => {
              console.log("Audio track clicked", file.id)
              playerStore.playTrack(file as AudioTrackFileItem)
            }} />
        }
        return <FileListItemBasic
          key={file.id} name={file.name}
          icon={<InsertDriveFileOutlined />}
          disabled
        />
      })}
    </div>
  )
}