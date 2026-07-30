"use client"

import { useState } from "react"
import {
  Button,
  Card,
  Dialog,
  DialogActions,
  DialogContent,
  DialogContentText,
  DialogTitle,
  Typography,
  alpha,
} from "@mui/material"
import { InstallMobileRounded } from "@mui/icons-material"
import { css } from "@emotion/react"
import { useThemeStore } from "@/src/stores/theme-store"
import {
  MaterialDynamicColors,
  hexFromArgb,
} from "@material/material-color-utilities"
import { useInstallPrompt } from "@/src/hooks/use-install-prompt"

const DISMISSED_KEY = "installPrompt.dismissed"

// Manual install steps for platforms without beforeinstallprompt (iOS). The
// data note differs by state: before sign-in it is a tip (install first),
// after sign-in an honest warning - on iOS a home-screen app has storage
// fully separate from the browser tab, so nothing set up here carries over.
export function HowToInstallDialog({
  open,
  signedIn,
  onClose,
}: {
  open: boolean
  signedIn: boolean
  onClose: () => void
}) {
  return (
    <Dialog open={open} onClose={onClose}>
      <DialogTitle>Install app</DialogTitle>
      <DialogContent>
        <DialogContentText>
          Add this app to your home screen:
        </DialogContentText>
        <DialogContentText component="ol">
          <li>Tap the Share button in your browser.</li>
          <li>Choose &quot;Add to Home Screen&quot;.</li>
          <li>Open Cloud Music Box from the home screen.</li>
        </DialogContentText>
        <DialogContentText variant="body2">
          {signedIn
            ? "The installed app starts fresh: you'll need to sign in to " +
              "your cloud storage again, and music will be downloaded again."
            : "Tip: install first - sign-in and downloads made in a browser " +
              "tab don't carry over to the installed app."}
        </DialogContentText>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>Close</Button>
      </DialogActions>
    </Dialog>
  )
}

// Install promotion card shown on the home page. Renders nothing unless this
// window is a plain browser tab with an install path available (native prompt
// or manual home-screen steps) and the user hasn't dismissed it. Dismissal is
// permanent for the card; Settings > App > "Install app" remains the way back.
export function InstallPromoCard({
  signedIn,
  ...props
}: {
  signedIn: boolean
} & React.HTMLAttributes<HTMLDivElement>) {
  const { canPrompt, canManualInstall, inBrowserTab, promptInstall } =
    useInstallPrompt()
  const [dismissed, setDismissed] = useState(
    () =>
      typeof window !== "undefined" &&
      localStorage.getItem(DISMISSED_KEY) === "1"
  )
  const [howToOpen, setHowToOpen] = useState(false)
  const [themeStoreState] = useThemeStore()

  if (!inBrowserTab || dismissed || (!canPrompt && !canManualInstall)) {
    return null
  }

  const colorSurfaceContainerHighest = hexFromArgb(
    MaterialDynamicColors.surfaceContainerHighest.getArgb(
      themeStoreState.scheme
    )
  )
  const colorOnSurfaceVariant = hexFromArgb(
    MaterialDynamicColors.onSurfaceVariant.getArgb(themeStoreState.scheme)
  )

  return (
    <Card
      sx={{
        background: alpha(colorSurfaceContainerHighest, 0.5),
        borderRadius: "12px",
      }}
      {...props}
    >
      {/* Material banner form: one message line, then the dismissive and
          confirming text actions; narrow widths wrap into the canonical
          message row + right-aligned action row. */}
      <div
        css={css({
          display: "flex",
          alignItems: "center",
          flexWrap: "wrap",
          gap: "0 12px",
          padding: "6px 8px 6px 16px",
        })}
      >
        <InstallMobileRounded fontSize="small" />
        <Typography
          variant="body2"
          sx={{ flex: "1 1 240px", padding: "6px 0" }}
        >
          <span css={css({ fontWeight: 600 })}>Install Cloud Music Box</span>
          <span css={css({ color: colorOnSurfaceVariant })}>
            {" - works offline and keeps playing in the background."}
          </span>
        </Typography>
        <div
          css={css({
            display: "flex",
            alignItems: "center",
            marginLeft: "auto",
          })}
        >
          <Button
            onClick={() => {
              localStorage.setItem(DISMISSED_KEY, "1")
              setDismissed(true)
            }}
          >
            Not now
          </Button>
          {canPrompt ? (
            <Button
              onClick={() => {
                promptInstall()
              }}
            >
              Install
            </Button>
          ) : (
            <Button onClick={() => setHowToOpen(true)}>How to install</Button>
          )}
        </div>
      </div>
      <HowToInstallDialog
        open={howToOpen}
        signedIn={signedIn}
        onClose={() => setHowToOpen(false)}
      />
    </Card>
  )
}
