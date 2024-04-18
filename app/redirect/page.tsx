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

  const [success, setSuccess] = useState(false)

  // useEffect(() => {
  //   let timerId: NodeJS.Timeout | null = null

  //   if (fileStoreState.driveClient) {
  //     setSuccess(true)
  //     timerId = setTimeout(() => {
  //       // routerActionsRef.current.goHome()
  //     }, 2000)
  //   }
  //   return () => {
  //     if (timerId) {
  //       clearTimeout(timerId)
  //     }
  //   }
  // }, [fileStoreState.driveClient])

  return (
    <Box>
      <Backdrop
        open={true}
        sx={{
          zIndex: theme => theme.zIndex.drawer + 1,
          display: "flex",
          flexDirection: "column",
        }}
      >
        <Box
          sx={{
            width: 100,
            height: 100,
            position: "relative",
          }}
        >
          <CloudRounded
            sx={{ fontSize: 100, position: "absolute" }}
          ></CloudRounded>
          {success ? (
            <Grow in={true}>
              <CheckCircleRounded
                sx={{
                  fontSize: 50,
                  position: "absolute",
                  color: theme => theme.palette.success.main,
                  top: 0,
                  left: 0,
                  right: 0,
                  bottom: 0,
                  margin: "auto",
                }}
              />
            </Grow>
          ) : (
            <CircularProgress
              sx={{
                position: "absolute",
                top: 0,
                left: 0,
                right: 0,
                bottom: 0,
                margin: "auto",
              }}
            />
          )}
        </Box>
        <Box>Connecting...</Box>
      </Backdrop>
    </Box>
  )
}
