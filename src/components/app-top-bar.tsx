"use client"

import {
  AppBar,
  alpha,
  useScrollTrigger,
  useTheme,
} from "@mui/material"
import { ReactNode, useState } from "react"
import { useThemeStore } from "../stores/theme-store"
import {
  MaterialDynamicColors,
  hexFromArgb,
} from "@material/material-color-utilities"

interface AppTopBarProps {
  children: ReactNode,
  scrollTarget?: Node | Window
}

export default function AppTopBar(props: AppTopBarProps) {
  const theme = useTheme()
  const [themeStoreState] = useThemeStore()

  const trigger = useScrollTrigger({
    disableHysteresis: true,
    threshold: 0,
    target: props.scrollTarget,
  })

  return (
    <AppBar
      sx={{
        backdropFilter: trigger ? "blur(16px)" : "blur(0px)",
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
          // "backdrop-filter",
        ]),
      }}
      elevation={0}
    >
      {props.children}
    </AppBar>
  )
}

