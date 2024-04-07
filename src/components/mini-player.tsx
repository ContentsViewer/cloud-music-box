'use client'

import { PlayArrow, PlayCircleFilled, SkipNext, SkipPrevious, Stop } from "@mui/icons-material"
import { Box, Card, Fab, Icon, IconButton, SxProps, Theme, alpha } from "@mui/material"
import { usePlayerStore } from "../stores/player-store"
import { useFileStore } from "../stores/file-store"
import { useThemeStore } from "../stores/theme-store"
import { MaterialDynamicColors, hexFromArgb } from "@material/material-color-utilities"

interface MiniPlayerProps {
  sx?: SxProps<Theme>
};

export const MiniPlayer = (props: MiniPlayerProps) => {
  const [playerState, playerActions] = usePlayerStore();
  const fileStore = useFileStore();
  const [themeStoreState] = useThemeStore();

  const activeTrack = playerState.activeTrack;

  const title = activeTrack?.file.metadata?.common.title
    || activeTrack?.file.name || "No track playing";

  return (
    <Card sx={{
      ...props.sx,
      // width: "100%",
      // height: 52,
      backdropFilter: 'blur(10px)',
      backgroundColor: alpha(
        hexFromArgb(MaterialDynamicColors.surfaceContainerHigh.getArgb(themeStoreState.scheme)), 0.1
      ),
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
      <IconButton
        sx={{
          backgroundColor: hexFromArgb(
            MaterialDynamicColors.tertiaryContainer.getArgb(themeStoreState.scheme)),
          "&:hover": {
            backgroundColor: hexFromArgb(
              MaterialDynamicColors.tertiaryContainer.getArgb(themeStoreState.scheme))
          },
        }}
        onClick={() => {
        if (playerState.isPlaying) {
          playerActions.pause();
        } else {
          playerActions.play();
        }
      }}>
        {playerState.isPlaying ? <Stop /> : <PlayArrow />}
      </IconButton>
      <IconButton onClick={() => {
        playerActions.playNextTrack();
      }}>
        <SkipNext />
      </IconButton>

    </Card>
  )
}