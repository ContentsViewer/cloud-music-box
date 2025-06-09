"use client"

import { useRouter } from "@/src/router"
import { Backdrop, Box, CircularProgress, Grow } from "@mui/material"
import { useEffect, useRef, useState } from "react"

export default function Page() {
  return (
    <div>
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
    </div>
  )
}
