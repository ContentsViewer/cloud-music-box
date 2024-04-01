'use client'

import { ListItemButton, ListItemIcon, ListItemText } from "@mui/material";
import FolderIcon from '@mui/icons-material/Folder';
import { AudioFileOutlined, CloudOff, CloudQueue, InsertDriveFileOutlined, Inventory } from '@mui/icons-material';
import { useNetworkMonitor } from "../stores/network-monitor";
import { useEffect, useState } from "react";
import { useFileStore } from "../stores/file-store";
import { enqueueSnackbar } from "notistack";

interface FileListItemBasicProps {
  name: string;
  secondaryName?: string;
  icon: React.ReactElement;
  onClick?: (event: any) => void;
  disabled?: boolean;
  fileStatus: 'online' | 'offline' | 'local';
}

export function FileListItemBasic(
  { name, secondaryName, icon, onClick, disabled, fileStatus }: FileListItemBasicProps
) {
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
      {
        fileStatus === 'online' ? <CloudQueue fontSize="small" color="disabled" /> :
          fileStatus === 'offline' ? <CloudOff fontSize="small" color="disabled" /> :
            fileStatus === 'local' ? <Inventory fontSize="small" color="disabled" /> :
              null
      }
    </ListItemButton>
  );
}

interface FileListItemAudioTrackProps {
  fileId: string;
  name: string;
  onClick?: (event: any) => void;
}

export function FileListItemAudioTrack(
  { fileId, name, onClick }: FileListItemAudioTrackProps
) {
  const [fileStatus, setFileStatus] = useState<'online' | 'offline' | 'local'>('offline');
  const networkMonitor = useNetworkMonitor();
  const fileStore = useFileStore();

  useEffect(() => {
    fileStore.hasTrackBlobInLocal(fileId).then((hasBlob) => {
      setFileStatus(hasBlob ? 'local' : networkMonitor.isOnline ? 'online' : 'offline');
    }).catch((error) => {
      console.error(error);
      enqueueSnackbar(`${error}`, { variant: "error" });
    });
  }, [networkMonitor.isOnline, fileStore, fileId])

  return (
    <FileListItemBasic
      name={name}
      icon={<AudioFileOutlined />}
      fileStatus={fileStatus}
      disabled={fileStatus === 'offline'}
      onClick={onClick}
    />
  )
}
