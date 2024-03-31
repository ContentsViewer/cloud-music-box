import { AudioTrackFileItem, BaseFileItem } from "../stores/file-store";
import { useRouter } from 'next/navigation';
import { ListItemFolder, ListItemFile, ListItemAudioTrack } from "./list-item";
import { usePlayerStore } from "../stores/player-store";

export interface FileListProps {
  files: BaseFileItem[] | undefined;
}

export function FileList(props: FileListProps) {
  const router = useRouter();
  const playerStore = usePlayerStore();

  return (
    <div>
      {props.files?.map((file) => {
        if (file.type === 'folder') {
          return <ListItemFolder key={file.id} name={file.name} onClick={() => {
            router.push(`/files?id=${file.id}`);
          }} />
        }
        if (file.type === 'audio-track') {
          return <ListItemAudioTrack key={file.id} name={file.name} onClick={() => {
            console.log("Audio track clicked", file.id)
            playerStore.playTrack(file as AudioTrackFileItem)
          }} />
        }
        return <ListItemFile key={file.id} name={file.name} disabled />
      })}
    </div>
  )
}