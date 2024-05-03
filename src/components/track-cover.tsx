import { Audiotrack, AudiotrackRounded } from "@mui/icons-material";
import { Avatar, SxProps, Theme } from "@mui/material"

export const TrackCover = (props: { coverUrl?: string; sx?: SxProps<Theme> }) => {
    // const [themeStoreState] = useThemeStore()
    // const primaryColor = hexFromArgb(
    //   MaterialDynamicColors.primary.getArgb(themeStoreState.scheme)
    // )
    // const onPrimaryColor = hexFromArgb(
    //   MaterialDynamicColors.onPrimary.getArgb(themeStoreState.scheme)
    // )
    return (
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
          bgcolor: "rgba(255, 255, 255, 0.15)"
        }}
      >
        {props.coverUrl ? null : (
          <Audiotrack
            sx={{
              width: "50%",
              height: "50%",
              color: "rgba(255, 255, 255, 0.5)"
              // color: onPrimaryColor,
            }}
          />
        )}
      </Avatar>
    )
  }
  