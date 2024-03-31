import { AppBar, Box, Typography, colors } from "@mui/material";
import { useEffect, useState } from "react";
import { useNetworkMonitor } from "../stores/network-monitor";

export function StatusBar() {
  const networkMonitor = useNetworkMonitor();
  
  return (
    <AppBar position="fixed" sx={{
      display: 'flex',
      justifyContent: 'end',
      backdropFilter: 'blur(10px)',
      backgroundColor: 'transparent'
    }}>
      {networkMonitor.isOnline ?
        (<Typography color={colors.green[500]}>online</Typography>)
        : (<Typography color={colors.red[500]}>offline</Typography>)}
    </AppBar>
  )
}