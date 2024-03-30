import { Card, SxProps, Theme } from "@mui/material"

interface MiniPlayerProps {
  sx?: SxProps<Theme>
};

export const MiniPlayer = (props: MiniPlayerProps) => {
  return (
    <Card sx={props.sx}>TEST</Card>
  )
}