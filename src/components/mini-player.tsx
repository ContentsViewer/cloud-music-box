'use client'

import { PlayArrow, PlayCircleFilled, SkipNext, SkipPrevious, Stop } from "@mui/icons-material"
import { Box, Card, Fab, Icon, IconButton, SxProps, Theme } from "@mui/material"
import { usePlayerStore } from "../stores/player-store"
import { useFileStore } from "../stores/file-store"

interface MiniPlayerProps {
  sx?: SxProps<Theme>
};

export const MiniPlayer = (props: MiniPlayerProps) => {
  const [playerState, playerDispatch] = usePlayerStore();
  const fileStore = useFileStore();

  const title = playerState.activeTrack?.file.name || "No track playing";

  return (
    <Card sx={{
      ...props.sx,
      // width: "100%",
      // height: 52,
      backdropFilter: 'blur(10px)',
      backgroundColor: 'transparent',
      display: 'flex',
      p: 2,
      m: 1
    }}>
      <Box sx={{ flexGrow: 1 }}>
        {title}
      </Box>
      <IconButton>
        <SkipPrevious />
      </IconButton>
      <IconButton onClick={() => { 
        if (playerState.isPlaying) {
          playerDispatch({ type: "pause" });
        } else {
          playerDispatch({ type: "play" });
        }
      }}>
        {playerState.isPlaying ? <Stop /> : <PlayArrow />}
      </IconButton>
      <IconButton onClick={() => {
        playerDispatch({ type: "playNextTrack", payload: { fileStore } });
      }}>
        <SkipNext />
      </IconButton>

    </Card>
  )
}