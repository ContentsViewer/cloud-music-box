"use client"

import {
  Avatar,
  Box,
  IconButton,
  ListItemAvatar,
  ListItemButton,
  ListItemIcon,
  ListItemText,
  ListItem,
  Menu,
  MenuItem,
} from "@mui/material"
import {
  ArrowDownward,
  CloudOff,
  CloudQueue,
  Inventory,
  MoreVert,
} from "@mui/icons-material"
import { useNetworkMonitor } from "../stores/network-monitor"
import { useEffect, useMemo, useRef, useState } from "react"
import { useFileStore } from "../stores/file-store"
import { enqueueSnackbar } from "notistack"
import * as mm from "music-metadata-browser"
import React from "react"
import { TrackCover } from "./track-cover"
import { useThemeStore } from "../stores/theme-store"
import {
  MaterialDynamicColors,
  hexFromArgb,
} from "@material/material-color-utilities"
import { useRouter } from "../router"
import { AudioTrackFileItem } from "../drive-clients/base-drive-client"


interface FileListItemBasicProps {
  name: string
  secondaryText?: string
  icon: React.ReactElement
  onClick?: (event: any) => void
  disabled?: boolean
  fileStatus: "online" | "offline" | "local" | "downloading"
  selected?: boolean
  children?: React.ReactNode
  onClickMenu?: (event: React.MouseEvent<HTMLButtonElement>) => void
}

export function FileListItemBasic({
  name,
  secondaryText,
  icon,
  onClick,
  disabled,
  fileStatus,
  selected,
  children,
  onClickMenu,
}: FileListItemBasicProps) {
  const [themeStoreState] = useThemeStore()
  const colorOnSurfaceVariant = hexFromArgb(
    MaterialDynamicColors.onSurfaceVariant.getArgb(themeStoreState.scheme)
  )
  const colorTertiary = hexFromArgb(
    MaterialDynamicColors.tertiary.getArgb(themeStoreState.scheme)
  )
  const colorOnSurface = hexFromArgb(
    MaterialDynamicColors.onSurface.getArgb(themeStoreState.scheme)
  )

  return (
    <ListItem
      secondaryAction={
        <div>
          <IconButton
            sx={{
              color: colorOnSurfaceVariant,
            }}
            edge="end"
            onClick={(event: React.MouseEvent<HTMLButtonElement, MouseEvent>) => { 
              onClickMenu && onClickMenu(event)
            }}
            disabled={onClickMenu === undefined}
          >
            <MoreVert />
          </IconButton>
        </div>
      }
      disablePadding
    >
      <ListItemButton disabled={disabled} selected={selected} onClick={onClick}>
        {icon}
        <ListItemText
          primaryTypographyProps={{
            style: {
              whiteSpace: "nowrap",
              overflow: "hidden",
              textOverflow: "ellipsis",
              color: selected ? colorTertiary : colorOnSurface,
            },
          }}
          secondaryTypographyProps={{
            style: {
              whiteSpace: "nowrap",
              overflow: "hidden",
              textOverflow: "ellipsis",
              color: colorOnSurfaceVariant,
            },
          }}
          primary={name}
          secondary={secondaryText}
        />
        {children}
        {fileStatus === "online" ? (
          <CloudQueue fontSize="small" color="disabled" />
        ) : fileStatus === "offline" ? (
          <CloudOff fontSize="small" color="disabled" />
        ) : fileStatus === "local" ? (
          <Inventory fontSize="small" color="disabled" />
        ) : fileStatus === "downloading" ? (
          // <CircularProgress size={16} />
          <Box
            component="div"
            sx={{
              width: "20px",
              height: "20px",
              // clipPath: "polygon(50% 0%, 0% 100%, 100% 100%)",
              clipPath: "inset(0 0 0 0)",
            }}
          >
            <ArrowDownward
              fontSize="small"
              color="disabled"
              sx={{
                animation: "down 2s linear infinite",
                "@keyframes down": {
                  "0%": { transform: "translateY(-20px)" },
                  "50%": { transform: "translateY(0)" },
                  "100%": { transform: "translateY(20px)" },
                },
              }}
            />
          </Box>
        ) : null}
      </ListItemButton>
    </ListItem>
  )
}

interface FileListItemAudioTrackProps {
  file: AudioTrackFileItem
  selected?: boolean
  onClick?: (event: any) => void
  onClickMenu?: (event: React.MouseEvent<HTMLButtonElement>) => void
}

export const FileListItemAudioTrack = React.memo(
  function FileListItemAudioTrack({
    file,
    selected,
    onClick,
    onClickMenu
  }: FileListItemAudioTrackProps) {
    const networkMonitor = useNetworkMonitor()

    const [fileStoreState, fileStoreActions] = useFileStore()

    const [, routerActions] = useRouter()
    const routerActionsRef = useRef(routerActions)
    routerActionsRef.current = routerActions

    const [updatedFile, setUpdatedFile] = useState<AudioTrackFileItem>(file)

    const [fileState, setFileState] = useState<{
      coverUrl: string | undefined
      hasBlob: boolean
      currentFile: AudioTrackFileItem
    }>({
      coverUrl: undefined,
      hasBlob: false,
      currentFile: file,
    })

    useEffect(() => {
      const newFileState = {
        coverUrl: undefined,
        hasBlob: false,
        currentFile: updatedFile,
      } as typeof fileState

      fileStoreActions
        .hasTrackBlobInLocal(updatedFile.id)
        .then(hasBlob => {
          newFileState.hasBlob = hasBlob || false
          const cover = mm.selectCover(updatedFile.metadata?.common.picture)
          if (cover) {
            const url = URL.createObjectURL(
              new Blob([cover.data], { type: cover.format })
            )
            newFileState.coverUrl = url
          }

          setFileState(newFileState)
        })
        .catch(error => {
          console.error(error)
          enqueueSnackbar(`${error}`, { variant: "error" })
        })

      return () => {
        if (newFileState.coverUrl) {
          URL.revokeObjectURL(newFileState.coverUrl)
        }
      }
    }, [updatedFile])

    const isSyncingLast = useRef(false)
    const isSyncing = fileStoreState.syncingTrackFiles[file.id] || false

    useEffect(() => {
      if (isSyncingLast.current && !isSyncing) {
        // console.log("###", file.id)
        fileStoreActions
          .getFileById(file.id)
          .then(updatedFile => {
            if (!updatedFile) return
            if (updatedFile.type !== "audio-track") return
            setUpdatedFile(updatedFile as AudioTrackFileItem)
          })
          .catch(error => {
            console.error(error)
            enqueueSnackbar(`${error}`, { variant: "error" })
          })
      }
      isSyncingLast.current = isSyncing
    }, [isSyncing, file])

    const item = useMemo(() => {
      const file = fileState.currentFile
      // console.log("!!!", file.id, isSyncing, networkMonitor.isOnline, selected)
      const title = file.metadata?.common.title || file.name
      const artists = file.metadata?.common.artists?.join(", ") || ""
      const fileStatus = (() => {
        if (isSyncing) return "downloading"
        if (fileState.hasBlob) return "local"
        if (networkMonitor.isOnline) return "online"
        return "offline"
      })()

      const disabled = fileStatus === "offline" || isSyncing

      return (
        <FileListItemBasic
          name={title}
          icon={
            <ListItemAvatar>
              <TrackCover coverUrl={fileState.coverUrl} />
            </ListItemAvatar>
          }
          fileStatus={fileStatus}
          selected={selected}
          disabled={disabled}
          onClick={onClick}
          secondaryText={artists}
          onClickMenu={onClickMenu}
        />
      )
    }, [isSyncing, selected, onClick, networkMonitor.isOnline, fileState, onClickMenu])

    return item
  }
)
