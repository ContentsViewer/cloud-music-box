import { ExportIdentity } from "@/src/lib/export/build"
import { getDriveConfig } from "./base-drive-client"
import { DB_KEY_USER_INFO } from "./google-drive-client"
import { DB_KEY_ACCOUNT_INFO } from "./onedrive-client"

/**
 * The identity an export file is stamped with and an import is matched
 * against: provider + a per-account stable key (OneDrive homeAccountId /
 * Google OIDC sub). Read straight from localStorage so it works offline and
 * before the drive client connects. Returns null when nothing is signed in.
 */
export function getStoredAccountIdentity(): ExportIdentity | null {
  const config = getDriveConfig()
  if (!config) return null

  if (config.type === "onedrive") {
    const raw = localStorage.getItem(DB_KEY_ACCOUNT_INFO)
    if (!raw) return null
    try {
      const info = JSON.parse(raw) as {
        homeAccountId?: string
        username?: string
      }
      if (!info.homeAccountId) return null
      return {
        provider: "onedrive",
        accountKey: info.homeAccountId,
        accountLabel: info.username,
      }
    } catch {
      return null
    }
  }

  // Google identity is only the OIDC `sub` claim (drive.file scope has no
  // email), so there is no human-readable label to offer.
  const sub = localStorage.getItem(DB_KEY_USER_INFO)
  if (!sub) return null
  return { provider: "google-drive", accountKey: sub }
}
