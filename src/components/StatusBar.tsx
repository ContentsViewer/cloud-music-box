'use client'

import { Box, Typography, colors } from "@mui/material";
import { useState } from "react";

export function StatusBar() {
  const [isOnline, setIsOnline] = useState(navigator.onLine);

  window.addEventListener('offline', () => setIsOnline(false));
  window.addEventListener('online', () => setIsOnline(true));

  return (
    <Box sx={{
      display: 'flex',
      justifyContent: 'end',
    }}>
      {isOnline ?
        (<Typography color={colors.green[500]}>online</Typography>)
        : (<Typography color={colors.red[500]}>offline</Typography>)}
      {/* <div className="pointer-events-none flex place-items-center gap-2 p-8 lg:pointer-events-auto lg:p-0">
        {isOffline ? (
          <p className="text-red-500">You are offline</p>
        ) : (
          <p className="text-green-500">You are online</p>
        )}
      </div> */}
    </Box>
  )
}