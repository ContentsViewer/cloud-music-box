'use client'

import { ListItemButton, ListItemIcon, ListItemText } from "@mui/material";
import FolderIcon from '@mui/icons-material/Folder';
import { AudioFileOutlined, CloudOff, InsertDriveFileOutlined } from '@mui/icons-material';

interface FileListItemBasicProps {
  name: string;
  secondaryName?: string;
  icon: React.ReactElement;
  onClick?: (event: any) => void;
  disabled?: boolean;
  
}

export function FileListItemBasic({ name, secondaryName, icon, onClick, disabled }: FileListItemBasicProps) {
  return (
    <ListItemButton onClick={onClick} disabled={disabled}>
      <ListItemIcon>{icon}</ListItemIcon>
      <ListItemText
        primaryTypographyProps={{
          style: {
            whiteSpace: 'nowrap',
            overflow: 'hidden',
            textOverflow: 'ellipsis'
          }
        }}
        primary={name}
        secondary={secondaryName} />
      <CloudOff fontSize="small" color="disabled"  />
    </ListItemButton>
  );
}