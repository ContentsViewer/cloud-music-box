import { ArrowDownward } from "@mui/icons-material"
import { Badge, Box } from "@mui/material"

interface DownloadingIndicatorProps {
  count: number
  color: string
}

export default function DownloadingIndicator({
  count,
  color,
}: DownloadingIndicatorProps) {
  return (
    <Box sx={{ position: "relative", mr: 1 }}>
      <Badge
        badgeContent={
          <span
            style={{
              color: color,
            }}
          >
            {count}
          </span>
        }
      >
        <Box
          sx={{
            width: "20px",
            height: "20px",
            // clipPath: "polygon(50% 0%, 0% 100%, 100% 100%)",
            clipPath: "inset(0 0 0 0)",
          }}
        >
          <ArrowDownward
            fontSize="small"
            color="disabled"
            sx={{
              animation: "down 2s linear infinite",
              "@keyframes down": {
                "0%": { transform: "translateY(-20px)" },
                "50%": { transform: "translateY(0)" },
                "100%": { transform: "translateY(20px)" },
              },
            }}
          />
        </Box>
      </Badge>
    </Box>
  )
}
