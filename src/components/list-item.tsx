import { ListItemButton, ListItemIcon } from "@mui/material";
import FolderIcon from '@mui/icons-material/Folder';
import { AudioFileOutlined, InsertDriveFileOutlined } from '@mui/icons-material';

export function ListItemFile({ name, onClick }: { name: string, onClick: () => void }) {
  return (
    <ListItemButton onClick={onClick}>
      <ListItemIcon><InsertDriveFileOutlined /></ListItemIcon>
      {name}
    </ListItemButton>
  );
}

export function ListItemMusic({ name, onClick }: { name: string, onClick: () => void }) {
  return (
    <ListItemButton onClick={onClick}>
      <ListItemIcon><AudioFileOutlined /></ListItemIcon>
      {name}
    </ListItemButton>
  );
}

export function ListItemFolder({ name, onClick }: { name: string, onClick: () => void }) {
  return (
    <ListItemButton onClick={onClick}>
      <ListItemIcon><FolderIcon /></ListItemIcon>
      {name}
    </ListItemButton>
  );
}
