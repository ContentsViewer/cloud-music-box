import { ListItemButton, ListItemIcon, ListItemText } from "@mui/material";
import FolderIcon from '@mui/icons-material/Folder';
import { AudioFileOutlined, CloudOff, InsertDriveFileOutlined } from '@mui/icons-material';

interface ListItemFileBasicProps {
  name: string;
  secondaryName?: string;
  icon: React.ReactElement;
  onClick?: () => void;
  disabled?: boolean;
}

export function ListItemFileBasic({ name, secondaryName, icon, onClick, disabled }: ListItemFileBasicProps) {
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
