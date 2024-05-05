import {
  AlbumRounded,
  Audiotrack,
  AudiotrackRounded,
} from "@mui/icons-material"
import { Avatar, Fade, SxProps, Theme } from "@mui/material"

export const AlbumCover = (props: {
  coverUrl?: string
  sx?: SxProps<Theme>
}) => {
  // const [themeStoreState] = useThemeStore()
  // const primaryColor = hexFromArgb(
  //   MaterialDynamicColors.primary.getArgb(themeStoreState.scheme)
  // )
  // const onPrimaryColor = hexFromArgb(
  //   MaterialDynamicColors.onPrimary.getArgb(themeStoreState.scheme)
  // )
  return (
    <Fade in>
      <Avatar
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
      >
        {props.coverUrl ? null : (
          <AlbumRounded
            sx={{
              width: "50%",
              height: "50%",
              color: "rgba(255, 255, 255, 0.7)",
              // color: onPrimaryColor,
            }}
          />
        )}
      </Avatar>
    </Fade>
  )
}
