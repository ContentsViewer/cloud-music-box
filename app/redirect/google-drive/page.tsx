"use client"

import {
  createGoogleDriveClient,
  saveAccessToken,
  saveUserInfo,
} from "@/src/drive-clients/google-drive-client"
import { useRouter } from "@/src/router"
import { Backdrop, Box, CircularProgress, Grow } from "@mui/material"
import { useEffect, useRef, useState } from "react"

// JWT（ID Token）をパースする簡単な関数
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
      // URLパラメータからauthorization codeを取得
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
      // // Google Drive クライアントを作成
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
