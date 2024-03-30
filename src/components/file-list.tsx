import { BaseFileItem } from "../stores/file-store";
import { useRouter } from 'next/navigation';
import { ListItemFolder, ListItemFile } from "./list-item";

export interface FileListProps {
  files: BaseFileItem[] | undefined;
}

export function FileList(props: FileListProps) {
  const router = useRouter();

  return (
    <div>
      {props.files?.map((file) => {
        if (file.type === 'folder') {
          return <ListItemFolder key={file.id} name={file.name} onClick={() => {
            console.log("Folder clicked", file.id)
            router.push(`/files?id=${file.id}`);
          }} />
        }
        if (file.type === 'track') {

        }
        return <ListItemFile key={file.id} name={file.name} onClick={() => {

        }} />
      })}
    </div>
  )
}