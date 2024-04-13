"use client"

import { Box, Typography, SxProps, Theme } from "@mui/material"
import { Variant } from "@mui/material/styles/createTypography"
import { useEffect, useRef, useState } from "react"

interface MarqueeTextProps {
  text: string
  variant?: Variant
  color?: string
  sx?: SxProps<Theme>
}

export const MarqueeText = ({ text, variant, color, sx }: MarqueeTextProps) => {
  const textRef = useRef<HTMLSpanElement>(null)
  const [scrollAmount, setScrollAmount] = useState(0)
  const updateScrollAmount = () => {
    const offsetWidth = textRef.current?.offsetWidth
    const scrollWidth = textRef.current?.scrollWidth
    if (offsetWidth && scrollWidth) {
      setScrollAmount(offsetWidth - scrollWidth)
    }
  }
  useEffect(() => {
    const observer = new ResizeObserver(entries => {
      for (let entry of entries) {
        if (entry.target === textRef.current) {
          updateScrollAmount()
        }
      }
    })

    if (textRef.current) {
      observer.observe(textRef.current)
    }

    return () => {
      observer.disconnect()
    }
  }, [])

  useEffect(() => {
    updateScrollAmount()
  }, [text])

  useEffect(() => {
    const style = textRef.current?.style
    if (!style) return
    style.left = `${scrollAmount}px`
    style.animation = `marquee 10s ease-in-out infinite alternate`
  }, [scrollAmount])

  return (
    <Box sx={{ ...sx, overflow: "hidden" }}>
      <Typography
        ref={textRef}
        color={color}
        variant={variant}
        sx={{
          position: "relative",
          // position: "absolute",
          whiteSpace: "nowrap",
          // overflow: "hidden",
          // textOverflow: "ellipsis",
          // animation: `marquee 10s ease-in-out infinite alternate`,
          "@keyframes marquee": {
            // "0%": { left: "0" },
            from: { left: "0" },
            // "0%": { transform: "translateX(0)" },
            // "100%": { transform: `translateX(${scrollAmount}px)` },
          },
        }}
      >
        {text}
      </Typography>
    </Box>
  )
}
