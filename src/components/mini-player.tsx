'use client'

import { Card, SxProps, Theme } from "@mui/material"

interface MiniPlayerProps {
  sx?: SxProps<Theme>
};

export const MiniPlayer = (props: MiniPlayerProps) => {
  return (
    <Card sx={{
      ...props.sx,
      width: "100%",
      height: 52,
      backdropFilter: 'blur(10px)',
      backgroundColor: 'transparent'
    }}>TEST</Card>
  )
}