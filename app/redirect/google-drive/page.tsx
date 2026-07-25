"use client"

// Bundle-isolation exception: importing via the features/files index would drag in
// the OneDrive side (MSAL etc., +220 kB), so import the needed api module directly
import {
  createGoogleDriveClient,
  saveAccessToken,
  saveUserInfo,
} from "@/src/features/files/api/google-drive-client"
import {
  loadPickSession,
  savePickSession,
} from "@/src/features/files/api/google-drive-pick-session"
import { useRouter } from "@/src/stores/router"
import { Backdrop, Box, CircularProgress, Grow } from "@mui/material"
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

export default function Page() {
  const [routerState, routerActions] = useRouter()

  const refProcessed = useRef(false)
  useEffect(() => {
    const handleGoogleRedirect = async () => {
      if (refProcessed.current) return
      refProcessed.current = true

      // Two different flows land here, and they never collide because they use
      // different parts of the URL:
      //   - the implicit login returns its token in the fragment
      //   - the Google Picker (trigger_onepick) returns its result in the query
      // The picker result is only recorded here; the file list page owns the
      // rest of the flow, so it can show progress and dialogs where the user is.
      const query = new URLSearchParams(location.search)
      const pickedFileIds = query.get("picked_file_ids")
      const pickerError = query.get("error")
      if (pickedFileIds !== null || pickerError !== null) {
        const session = loadPickSession()
        if (session) {
          savePickSession({
            ...session,
            outcome: pickedFileIds
              ? { ids: pickedFileIds.split(",").filter(Boolean) }
              : { cancelled: true },
          })
          routerActions.go(session.returnHref)
        } else {
          // The session expired or was cleared while the user was away; there is
          // nothing to resume, so just put them back somewhere sensible.
          console.warn("Picker returned but no pick session was found")
          if (!routerActions.goLastHref()) {
            routerActions.goHome()
          }
        }
        return
      }

      // Extract the authorization code from the URL parameters
      const hash = new URLSearchParams(location.hash.substring(1))
      const accessToken = hash.get("access_token")
      // const urlParams = new URLSearchParams(window.location.search)
      // console.log(urlParams)
      // const accessToken = urlParams.get("access_token")
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

      // const code = urlParams.get("code")
      // const error = urlParams.get("error")

      // console.log(error, code)
      // if (error) {
      //   console.error(error)
      //   return
      // }
      // if (!code) {
      //   console.error("Authorization code not found in URL")
      //   return
      // }

      // console.log("Google authorization code received:", code)
      // // Create the Google Drive client
      // const driveClient = await createGoogleDriveClient()
      // const accessToken = await driveClient.fetchAccessToken(code)
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
        }}
      >
        <CircularProgress />
      </Backdrop>
    </div>
  )
}
