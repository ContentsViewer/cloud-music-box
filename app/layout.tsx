import "./globals.css"

import { AppRouterCacheProvider } from "@mui/material-nextjs/v13-appRouter"
import { CssBaseline } from "@mui/material"
import { AppLayout } from "./app-layout"
import { ThemeStoreProvider } from "@/src/stores/theme-store"
import type { Viewport, Metadata } from "next"

export const viewport: Viewport = {
  viewportFit: "cover",
}

export const metadata: Metadata = {
  title: "Cloud Music Box",
  description: "A pwa music player that plays music from your cloud storage.",
  openGraph: {
    title: "Cloud Music Box",
    description: "A pwa music player that plays music from your cloud storage.",
  },
}

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode
}>) {
  return (
    <html lang="en">
      <head>
        <link rel="manifest" href="manifest.json" />
      </head>
      <body>
        <AppRouterCacheProvider>
          <ThemeStoreProvider>
            <CssBaseline />
            <AppLayout>{children}</AppLayout>
          </ThemeStoreProvider>
        </AppRouterCacheProvider>
      </body>
    </html>
  )
}

export const dynamic = "force-static"
