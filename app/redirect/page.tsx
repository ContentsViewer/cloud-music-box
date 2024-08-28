"use client"

import { useRouter } from "@/src/router"
import { useFileStore } from "@/src/stores/file-store"
import { CheckCircleRounded, CloudRounded } from "@mui/icons-material"
import { Backdrop, Box, CircularProgress, Grow } from "@mui/material"
import { useEffect, useRef, useState } from "react"

export default function Page() {
  const [fileStoreState, fileStoreActions] = useFileStore()
  const [routerState, routerActions] = useRouter()
  const routerActionsRef = useRef(routerActions)
  routerActionsRef.current = routerActions

  return (
    <Box component="div">
      <Backdrop
        open={true}
        sx={{
          zIndex: theme => theme.zIndex.drawer + 1,
          display: "flex",
          flexDirection: "column",
        }}
      >
        <CircularProgress />
      </Backdrop>
    </Box>
  )
}
