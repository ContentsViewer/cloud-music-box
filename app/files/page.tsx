"use client"

import { BaseFileItem, useFileStore } from "@/src/stores/file-store"
import { enqueueSnackbar } from "notistack"
import { Suspense, useEffect, useRef, useState } from "react"
import { FileList } from "@/src/components/file-list"
import {
  useParams,
  usePathname,
  useRouter,
  useSearchParams,
} from "next/navigation"
import {
  AppBar,
  Box,
  IconButton,
  Toolbar,
  Typography,
  alpha,
  useScrollTrigger,
  useTheme,
} from "@mui/material"
import { ArrowBack } from "@mui/icons-material"
import { useThemeStore } from "@/src/stores/theme-store"
import {
  MaterialDynamicColors,
  hexFromArgb,
} from "@material/material-color-utilities"

function ElevationAppBar(props: { children: React.ReactElement }) {
  const theme = useTheme()
  const [themeStoreState] = useThemeStore()

  const trigger = useScrollTrigger({
    disableHysteresis: true,
    threshold: 0,
  })

  return (
    <AppBar
      sx={{
        backdropFilter: "blur(16px)",
        WebkitBackdropFilter: "blur(16px)",
        backgroundColor: alpha(
          hexFromArgb(
            MaterialDynamicColors.surfaceContainer.getArgb(
              themeStoreState.scheme
            )
          ),
          trigger ? 0.5 : 0
        ),
        transition: theme.transitions.create([
          "background-color",
          "backdrop-filter",
        ]),
      }}
      elevation={0}
    >
      {props.children}
    </AppBar>
  )
}

export default function Page() {
  const router = useRouter()

  const [fileStoreState, fileStoreActions] = useFileStore()
  const fileStoreActionsRef = useRef(fileStoreActions)
  fileStoreActionsRef.current = fileStoreActions

  const [currentFile, setCurrentFile] = useState<BaseFileItem | null>(null)
  const [files, setFiles] = useState<BaseFileItem[]>([])
  const [folderId, setFolderId] = useState<string | null>(null)
  const params = useParams()
  const theme = useTheme()

  useEffect(() => {
    setFolderId(window.location.hash.slice(1))
  }, [params])

  useEffect(() => {
    if (!fileStoreState.configured) {
      return
    }

    const getFiles = async () => {
      if (!folderId) {
        return
      }
      const currentFile = await fileStoreActionsRef.current.getFileById(
        folderId
      )
      setCurrentFile(currentFile)
      try {
        const files = await fileStoreActionsRef.current.getChildren(folderId)
        setFiles(files)
      } catch (error) {
        console.error(error)
        enqueueSnackbar(`${error}`, { variant: "error" })
      }
    }
    getFiles()
  }, [fileStoreState, folderId])

  return (
    <Box>
      <ElevationAppBar>
        <Toolbar>
          <IconButton
            size="large"
            edge="start"
            color="inherit"
            aria-label="menu"
            sx={{ mr: 2 }}
            onClick={() => {
              const parentId = currentFile?.parentId
              if (!parentId) {
                return
              }
              router.push(`/files#${currentFile?.parentId}`)
            }}
          >
            <ArrowBack />
          </IconButton>
          <Typography
            variant="h6"
            sx={{
              whiteSpace: "nowrap",
              overflow: "hidden",
              textOverflow: "ellipsis",
            }}
          >
            {currentFile?.name || "Files"}
          </Typography>
        </Toolbar>
      </ElevationAppBar>
      <FileList sx={{ mt: 5 }} files={files} />
    </Box>
  )
}
