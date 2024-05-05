"use client"

import {
  AppBar,
  IconButton,
  alpha,
  useScrollTrigger,
  useTheme,
  Menu,
  MenuItem,
  ListItemIcon,
  ListItemText
} from "@mui/material"
import {
  ArrowBack,
  MoreVert,
  CloudDownload,
  CloudOff,
  ArrowDownward,
  HomeRounded,
  SettingsRounded,
  ArrowBackRounded,
  FolderRounded,
  ArrowUpwardRounded,
  ChevronRightRounded,
  ChevronLeftRounded,
} from "@mui/icons-material"
import { ReactNode, useState } from "react"
import { useThemeStore } from "../stores/theme-store"
import {
  MaterialDynamicColors,
  hexFromArgb,
} from "@material/material-color-utilities"

interface AppTopBarProps {
  children: ReactNode
}

export default function AppTopBar(props: AppTopBarProps) {
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

