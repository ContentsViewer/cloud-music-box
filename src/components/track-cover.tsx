import { Audiotrack, AudiotrackRounded } from "@mui/icons-material"
import { Avatar, SxProps, Theme } from "@mui/material"
import React from "react"

interface TrackCoverProps {
  coverUrl?: string
  sx?: SxProps<Theme>
  onClick?: () => void
}

export const TrackCover = React.forwardRef(function TrackCover(
  props: TrackCoverProps,
  ref
) {
  return (
    <Avatar
      ref={ref as React.RefObject<HTMLDivElement>}
      src={props.coverUrl}
      variant="rounded"
      sx={{
        width: 48,
        height: 48,
        borderRadius: "10%",
        ...props.sx,
        // bgcolor: primaryColor
        // bgcolor: "rgba(142, 142, 142, 0.5)"
        bgcolor: "rgba(255, 255, 255, 0.15)",
      }}
      onClick={props.onClick}
    >
      {props.coverUrl ? null : (
        <Audiotrack
          sx={{
            width: "50%",
            height: "50%",
            color: "rgba(255, 255, 255, 0.7)",
            // color: onPrimaryColor,
          }}
        />
      )}
    </Avatar>
  )
})
