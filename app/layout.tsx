import "./globals.css"

import { AppRouterCacheProvider } from "@mui/material-nextjs/v13-appRouter"
import { CssBaseline } from "@mui/material"
import { AppLayout } from "./app-layout"
import { ThemeStoreProvider } from "@/src/stores/theme-store"
import type { Viewport, Metadata } from "next"
import { GA_MEASUREMENT_ID } from "@/src/gtag"
import { GoogleAnalytics } from "@next/third-parties/google"

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

// https://nextjs.org/docs/messages/next-script-for-ga
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
      <GoogleAnalytics gaId={GA_MEASUREMENT_ID} />
    </html>
  )
}

export const dynamic = "force-static"
