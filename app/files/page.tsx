"use client"

import { getDriveConfig } from "@/src/drive-clients/base-drive-client"
import OneDrivePage from "./onedrive-page"
import GoogleDrivePage from "./google-drive-page"

export default function Page() {
  const driveConfig = getDriveConfig()

  if (driveConfig?.type === "google-drive") {
    return <GoogleDrivePage />
  }

  return <OneDrivePage />
}
