import { Box, ButtonBase, Typography } from "@mui/material"
import {
  MaterialDynamicColors,
  hexFromArgb,
} from "@material/material-color-utilities"
import React from "react"
import { AlbumCover } from "./album-cover"
import { useThemeStore } from "../stores/theme-store"

/**
 * Cover tile for grid pages (albums, playlists): square cover art with a
 * centered title, the zoom-flip open transition, and the "appeal" animation
 * on the currently playing item.
 */
export const CoverCard = React.memo(function CoverCard({
  id,
  title,
  coverUrl,
  appeal = false,
  onOpen,
  children,
}: {
  id: string
  title: string
  coverUrl?: string
  appeal?: boolean
  onOpen: (id: string) => void
  children?: React.ReactNode
}) {
  const [themeStoreState] = useThemeStore()

  const colorTertiary = hexFromArgb(
    MaterialDynamicColors.tertiary.getArgb(themeStoreState.scheme)
  )

  return (
    <Box
      component="div"
      sx={{
        display: "flex",
        flexDirection: "column",
        justifyContent: "center",
        alignItems: "center",
      }}
    >
      <ButtonBase
        sx={{
          borderRadius: "10%",
          transition: theme =>
            theme.transitions.create(["transform", "opacity"], {
              duration: 1000,
            }),
          ...(appeal
            ? {
                boxShadow: `0 0 10px 0 ${colorTertiary}`,
                animation: `appeal 5s ease-in-out infinite alternate`,
                "@keyframes appeal": {
                  "0%": {
                    transform:
                      "perspective(400px) translateY(-8px) scale(1.05) rotateX(10deg) rotateY(-10deg)",
                  },
                  "100%": {
                    transform:
                      "perspective(400px) translateY(-8px) scale(1.05) rotateX(10deg) rotateY(10deg)",
                  },
                },
              }
            : {}),
        }}
        onClick={event => {
          onOpen(id)
          const elem = event.currentTarget
          elem.style.animation = "none"
          elem.style.opacity = "0"
          elem.style.zIndex = "100"
          // Get the initial position and size of the element
          const rect = elem.getBoundingClientRect()

          // Calculate the translate values
          const translateX =
            window.innerWidth / 2 - (rect.left + rect.width / 2)
          const translateY =
            window.innerHeight / 2 - (rect.top + rect.height / 2)

          // Calculate the scale value
          const scale = Math.max(
            window.innerWidth / rect.width,
            window.innerHeight / rect.height
          )

          // Set the transform property
          elem.style.transform = `perspective(400px) translate(${translateX}px, ${translateY}px) scale(${scale}) rotate3d(0, 1, 0, 135deg)`
        }}
      >
        <AlbumCover
          sx={{
            width: "100%",
            height: "auto",
            aspectRatio: "1 / 1",
          }}
          coverUrl={coverUrl}
        />
      </ButtonBase>
      <Typography
        sx={{
          mt: 0.5,
          whiteSpace: "nowrap",
          overflow: "hidden",
          textOverflow: "ellipsis",
          width: "100%",
          textAlign: "center",
        }}
      >
        {title}
      </Typography>
      {children}
    </Box>
  )
})
