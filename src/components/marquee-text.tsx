"use client"

import { Box, Typography, SxProps, Theme } from "@mui/material"
import { Variant } from "@mui/material/styles/createTypography"
import { useEffect, useRef, useState } from "react"

interface MarqueeTextProps {
  text: string
  variant?: Variant
  color?: string
  sx?: SxProps<Theme>
  typographySx?: SxProps<Theme>
}

export const MarqueeText = ({
  text,
  variant,
  color,
  sx,
  typographySx,
}: MarqueeTextProps) => {
  const firstTextRef = useRef<HTMLSpanElement>(null)
  const secondTextRef = useRef<HTMLSpanElement>(null)
  const containerRef = useRef<HTMLDivElement>(null)

  const updateScrollAnimation = () => {
    if (!firstTextRef.current || !containerRef.current) return

    const textWidth = firstTextRef.current.offsetWidth
    const containerWidth = containerRef.current.offsetWidth

    for (const ref of [firstTextRef, secondTextRef]) {
      if (!ref.current) continue

      const style = ref.current.style
      if (textWidth <= containerWidth) {
        style.animation = "none"
        style.setProperty("--marquee-animation-play-state", "none")
      }
      if (textWidth > containerWidth) {
        const playState = style.getPropertyValue(
          "--marquee-animation-play-state"
        )
        if (playState === "none" || playState === "") {
          style.animation = `marquee ${textWidth / 16}s linear infinite`
          style.setProperty("--marquee-animation-play-state", "running")
        }
      }
    }

    if (secondTextRef.current) {
      const style = secondTextRef.current.style
      if (textWidth <= containerWidth) {
        style.display = "none"
      } else {
        style.display = "block"
      }
    }
  }

  useEffect(() => {
    const observer = new ResizeObserver(entries => {
      updateScrollAnimation()
    })

    if (containerRef.current) {
      observer.observe(containerRef.current)
    }

    return () => {
      observer.disconnect()
    }
  }, [])

  useEffect(() => {
    updateScrollAnimation()
  }, [text])

  return (
    <Box
      component="div"
      sx={{
        ...sx,
        overflow: "hidden",
        display: "flex",
        flexDirection: "row",
      }}
      ref={containerRef}
    >
      <Typography
        ref={firstTextRef}
        color={color}
        variant={variant}
        sx={{
          whiteSpace: "nowrap",
          "@keyframes marquee": {
            "0%": { transform: "translateX(0%)" },
            "100%": { transform: `translateX(calc(-100% - 80px))` },
          },
          ...typographySx,
        }}
      >
        {text}
      </Typography>

      <Typography
        ref={secondTextRef}
        color={color}
        variant={variant}
        sx={{
          whiteSpace: "nowrap",
          ml: 10,
          "@keyframes marquee": {
            "0%": { transform: "translateX(0%)" },
            "100%": { transform: `translateX(calc(-100% - 80px))` },
          },
          ...typographySx,
        }}
      >
        {text}
      </Typography>
    </Box>
  )
}
