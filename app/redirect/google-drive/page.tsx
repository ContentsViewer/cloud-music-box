"use client"

// Bundle-isolation exception: importing via the features/files index would drag in
// the OneDrive side (MSAL etc., +220 kB), so import the needed api modules directly
import {
  saveAccessToken,
  saveUserInfo,
} from "@/src/features/files/api/google-drive-client"
import {
  announcePickOutcome,
  hasPickFlowRecord,
  loadPickFlow,
  PICK_CHANNEL,
  PICK_FLOW_STORAGE_KEY,
  PickChannelMessage,
  PickStep,
  probePickOwnerAlive,
  recordPickOutcome,
} from "@/src/features/files/api/google-drive-pick-session"
import { useRouter } from "@/src/stores/router"
import {
  Backdrop,
  Box,
  Button,
  CircularProgress,
  Collapse,
  Typography,
} from "@mui/material"
import {
  CheckCircleRounded,
  CheckRounded,
  UndoRounded,
} from "@mui/icons-material"
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
  /** Which hop came back - track pick or folder grant. Fixes the wording. */
  step: PickStep
  /** Number of picked items (0 for a cancel). */
  pickedCount: number
}

export default function Page() {
  const [routerState, routerActions] = useRouter()

  // The stranded-tab ending: the pick-starting document is still alive
  // somewhere else, so this page parks instead of booting a second app.
  const [terminal, setTerminal] = useState<TerminalState | null>(null)
  const [whyOpen, setWhyOpen] = useState(false)
  // window.close() is only permitted for script-opened tabs or tabs whose
  // session history holds a single entry. The latter is knowable up front, so
  // the close button is rendered only when pressing it is guaranteed to work -
  // a button that cannot close the tab is noise, not affordance.
  const [selfClosable, setSelfClosable] = useState(false)
  useEffect(() => {
    setSelfClosable(window.history.length === 1)
  }, [])
  // Flipped when the living app has finished the work, so the user knows this
  // tab is safe to close. Two signals, because the broadcast alone races a
  // fast continuation (a cancel can complete before this subscription exists):
  //   - the pick-resumed broadcast (instant when it lands), and
  //   - the flow record disappearing from localStorage - the executor clears
  //     it on completion, and the storage event plus one initial check make
  //     that impossible to miss.
  const [resumed, setResumed] = useState(false)

  useEffect(() => {
    if (terminal === null) return

    const checkRecordGone = () => {
      if (!hasPickFlowRecord()) setResumed(true)
    }
    checkRecordGone()
    const onStorage = (event: StorageEvent) => {
      if (event.key === PICK_FLOW_STORAGE_KEY || event.key === null) {
        checkRecordGone()
      }
    }
    window.addEventListener("storage", onStorage)

    let channel: BroadcastChannel | undefined
    if ("BroadcastChannel" in window) {
      channel = new BroadcastChannel(PICK_CHANNEL)
      channel.onmessage = (event: MessageEvent<PickChannelMessage>) => {
        if (event.data?.type === "pick-resumed") setResumed(true)
      }
    }
    return () => {
      window.removeEventListener("storage", onStorage)
      channel?.close()
    }
  }, [terminal])

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

        // Probe BEFORE announcing. The announcement wakes the owner, and a
        // no-network continuation (a cancel) can finish and release the owner
        // lock within milliseconds - probing afterwards would read "owner
        // gone" and wrongly boot a second app here. Observing liveness first
        // makes the decision race-free; the navigate branch needs no
        // announcement at all because the app booting there resumes on mount.
        if (await probePickOwnerAlive()) {
          announcePickOutcome()
          setTerminal({
            kind: "cancelled" in outcome ? "cancelled" : "received",
            returnHref: recorded.returnHref,
            step: recorded.step,
            pickedCount: outcome.ids?.length ?? 0,
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
          // One stable frame; nothing here is ever replaced wholesale. For a
          // pick, only the status row advances when the app finishes, so the
          // explanation below stays readable the whole time. A cancel is a
          // complete story by itself and ignores `resumed` entirely.
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
              {terminal.kind === "cancelled"
                ? "Nothing was changed in Cloud Music Box."
                : terminal.step === "folders"
                  ? "Folder access granted."
                  : `Your ${terminal.pickedCount} track${terminal.pickedCount === 1 ? " is" : "s are"} saved.`}
            </Typography>

            {/* Status row - the only part that progresses. */}
            {terminal.kind === "cancelled" ? (
              <Typography sx={{ maxWidth: "36em", opacity: 0.8 }}>
                {selfClosable
                  ? "Return to the app from your recent apps."
                  : "You can close this tab, or return to the app from your recent apps."}
              </Typography>
            ) : resumed ? (
              <Box
                component="div"
                sx={{ display: "flex", alignItems: "center", gap: 1 }}
              >
                <CheckRounded fontSize="small" />
                <Typography sx={{ maxWidth: "34em" }}>
                  {terminal.step === "folders"
                    ? "Folder names updated — you can close this tab."
                    : "Added in Cloud Music Box — you can close this tab."}
                </Typography>
              </Box>
            ) : (
              <Box
                component="div"
                sx={{ display: "flex", alignItems: "center", gap: 1.5 }}
              >
                <CircularProgress size={18} />
                <Typography sx={{ maxWidth: "34em" }}>
                  Return to Cloud Music Box to finish — open it from your
                  recent apps or your home screen.
                </Typography>
              </Box>
            )}

            {selfClosable && (terminal.kind === "cancelled" || resumed) ? (
              <Button variant="contained" onClick={() => window.close()}>
                Close this tab
              </Button>
            ) : null}

            {/* The escape hatch for a mistaken "owner alive" probe. Only while
                waiting: once the app has finished, continuing here would boot
                a second copy of it next to a living one. */}
            {terminal.kind === "received" && !resumed ? (
              <Button
                size="small"
                onClick={() => routerActions.go(terminal.returnHref)}
              >
                Continue here instead
              </Button>
            ) : null}

            {/* Always present: the one thing worth learning from this detour. */}
            <Typography
              variant="body2"
              sx={{ maxWidth: "36em", opacity: 0.7, mt: 3 }}
            >
              The Google Drive app takes over these links, which is why this
              opened in the browser.
            </Typography>
            <Button size="small" onClick={() => setWhyOpen(open => !open)}>
              How to prevent this
            </Button>
            <Collapse in={whyOpen}>
              <Typography
                variant="body2"
                sx={{ maxWidth: "36em", opacity: 0.8 }}
              >
                Turn off &ldquo;Open supported links&rdquo; for the Drive app
                in Android settings (Settings → Apps → Drive → Open by
                default). The Drive app itself keeps working normally.
              </Typography>
            </Collapse>
          </>
        )}
      </Backdrop>
    </div>
  )
}
