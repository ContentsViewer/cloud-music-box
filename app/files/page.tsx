"use client"

import { getDriveConfig } from "@/src/drive-clients/base-drive-client"
import OneDrivePage from "./onedrive-page"
import GoogleDrivePage from "./google-drive-page"
import { useEffect, useState } from "react"

export default function Page() {
  const [driveType, setDriveType] = useState<string | undefined>(undefined)

  useEffect(() => {
    // クライアントサイドでのみDrive設定を取得
    const driveConfig = getDriveConfig()
    setDriveType(driveConfig?.type)
  }, [])

  switch (driveType) {
    case "google-drive":
      return <GoogleDrivePage />
    case "onedrive":
      return <OneDrivePage />
    default:
      return null
  }
}
