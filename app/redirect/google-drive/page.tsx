"use client"

// Bundle-isolation exception: importing via the features/files index would drag in
// the OneDrive side (MSAL etc., +220 kB), so import the needed api modules directly
import {
  saveAccessToken,
  saveUserInfo,
} from "@/src/features/files/api/google-drive-client"
import {
  announcePickOutcome,
  loadPickFlow,
  probePickOwnerAlive,
  recordPickOutcome,
} from "@/src/features/files/api/google-drive-pick-session"
import { useRouter } from "@/src/stores/router"
import {
  Backdrop,
  Button,
  CircularProgress,
  Collapse,
  Typography,
} from "@mui/material"
import { CheckCircleRounded, UndoRounded } from "@mui/icons-material"
import { useEffect, useRef, useState } from "react"

// Small helper that parses a JWT (ID token)
function parseJWT(token: string) {
  const base64Url = token.split(".")[1]
  const base64 = base64Url.replace(/-/g, "+").replace(/_/g, "/")
  const jsonPayload = decodeURIComponent(
    atob(base64)
      .split("")
      .map(c => "%" + ("00" + c.charCodeAt(0).toString(16)).slice(-2))
      .join("")
  )
  return JSON.parse(jsonPayload)
}

interface TerminalState {
  kind: "received" | "cancelled"
  returnHref: string
}

export default function Page() {
  const [routerState, routerActions] = useRouter()

  // The stranded-tab ending: the pick-starting document is still alive
  // somewhere else, so this page parks instead of booting a second app.
  const [terminal, setTerminal] = useState<TerminalState | null>(null)
  const [whyOpen, setWhyOpen] = useState(false)

  const refProcessed = useRef(false)
  useEffect(() => {
    const handleGoogleRedirect = async () => {
      if (refProcessed.current) return
      refProcessed.current = true

      // Two different flows land here, and they never collide because they use
      // different parts of the URL:
      //   - the implicit login returns its token in the fragment
      //   - the Google Picker (trigger_onepick) returns its result in the query
      //
      // For the picker this page is the COURIER of the round trip: it records
      // the outcome and asks exactly one question - is the document that
      // started the pick still alive (= still holding PICK_OWNER_LOCK)?
      //   - alive: stay out of its way. Navigating would boot a second copy of
      //     the app next to a living one (the Android stranded-tab case); the
      //     owner resumes the work itself when it comes back to the front.
      //   - gone (iOS / desktop / killed app): navigate as before and let this
      //     document become the app.
      const query = new URLSearchParams(location.search)
      const pickedFileIds = query.get("picked_file_ids")
      const pickerError = query.get("error")
      if (pickedFileIds !== null || pickerError !== null) {
        const flow = loadPickFlow()
        const outcome = pickedFileIds
          ? { ids: pickedFileIds.split(",").filter(Boolean) }
          : { cancelled: true as const }
        const recorded = flow ? recordPickOutcome(flow, outcome) : undefined
        if (!recorded) {
          // The flow expired, was cleared, or was superseded while the user
          // was away; there is nothing to resume, so just put them back
          // somewhere sensible.
          console.warn("Picker returned but no matching pick flow was found")
          if (!routerActions.goLastHref()) {
            routerActions.goHome()
          }
          return
        }

        announcePickOutcome()
        if (await probePickOwnerAlive()) {
          setTerminal({
            kind: "cancelled" in outcome ? "cancelled" : "received",
            returnHref: recorded.returnHref,
          })
          return
        }
        routerActions.go(recorded.returnHref)
        return
      }

      // Extract the authorization code from the URL parameters
      const hash = new URLSearchParams(location.hash.substring(1))
      const accessToken = hash.get("access_token")
      if (accessToken === null) {
        console.error("Access token not found in URL")
        return
      }
      console.log(accessToken)
      saveAccessToken(accessToken)

      // Store the token expiry
      const expiresIn = hash.get("expires_in")
      if (expiresIn) {
        const expiresInSeconds = parseInt(expiresIn)
        const expiresAt = Date.now() + expiresInSeconds * 1000
        localStorage.setItem("googleDrive.tokenExpires", expiresAt.toString())
        console.log(`Token expires in ${expiresInSeconds} seconds (at ${new Date(expiresAt).toISOString()})`)
      }

      const idToken = hash.get("id_token")
      if (idToken !== null) {
        const data = parseJWT(idToken)
        console.log("ID Token Data:", data)
        saveUserInfo(data.sub)
      }

      const lastHref = routerActions.goLastHref()
      if (!lastHref) {
        routerActions.goHome()
      }
    }
    handleGoogleRedirect()
  }, [])

  return (
    <div>
      <Backdrop
        open={true}
        sx={{
          zIndex: theme => theme.zIndex.drawer + 1,
          display: "flex",
          flexDirection: "column",
          gap: 2,
          px: 4,
          textAlign: "center",
        }}
      >
        {terminal === null ? (
          <CircularProgress />
        ) : (
          <>
            {terminal.kind === "received" ? (
              <CheckCircleRounded fontSize="large" />
            ) : (
              <UndoRounded fontSize="large" />
            )}
            <Typography variant="h6">
              {terminal.kind === "received"
                ? "Selection received"
                : "Pick cancelled"}
            </Typography>
            <Typography sx={{ maxWidth: "36em" }}>
              {terminal.kind === "received"
                ? "Return to Cloud Music Box to finish — open it from your recent apps or your home screen. Your selection is saved and will be added there."
                : "Return to Cloud Music Box — nothing was changed."}
            </Typography>
            <Button size="small" onClick={() => setWhyOpen(open => !open)}>
              Why did this open in the browser?
            </Button>
            <Collapse in={whyOpen}>
              <Typography
                variant="body2"
                sx={{ maxWidth: "36em", opacity: 0.8 }}
              >
                The Google Drive app takes over these links. To come straight
                back to Cloud Music Box next time, turn off &ldquo;Open
                supported links&rdquo; for the Drive app in Android settings
                (Settings → Apps → Drive → Open by default).
              </Typography>
            </Collapse>
            <Button
              size="small"
              sx={{ mt: 2 }}
              onClick={() => routerActions.go(terminal.returnHref)}
            >
              Continue here instead
            </Button>
          </>
        )}
      </Backdrop>
    </div>
  )
}
