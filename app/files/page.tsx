"use client"

import { getDriveConfig } from "@/src/drive-clients/base-drive-client"
import OneDrivePage from "./OneDrivePage"
import GoogleDrivePage from "./GoogleDrivePage"

export default function Page() {
  const driveConfig = getDriveConfig()

  if (driveConfig?.type === "google-drive") {
    return <GoogleDrivePage />
  }

  return <OneDrivePage />
}
