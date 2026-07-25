import { GooglePickerResult } from "./google-drive-client"

// The trigger_onepick picker runs as a top-level navigation to Google, so every
// piece of in-flight state has to survive leaving the page and coming back.
//
// localStorage rather than sessionStorage on purpose: on iOS a PWA can hand the
// redirect back to a different browsing context, which would drop sessionStorage
// and silently lose the user's selection. A TTL keeps stale sessions from
// resurrecting days later.
const DB_KEY_PICK_SESSION = "googleDrive.pickSession"
const SESSION_TTL_MS = 10 * 60 * 1000

/**
 * `files`   - the user is choosing tracks.
 * `folders` - the user is granting access to the parent folders of those tracks,
 *             which is what lets us show a real folder name instead of a placeholder.
 */
export type PickStep = "files" | "folders"

export type PickOutcome = { ids: string[] } | { cancelled: true }

export interface PickSession {
  step: PickStep
  startedAt: number
  /** Where to send the user once the round trip finishes. */
  returnHref: string
  /** Tracks picked in the `files` step, carried across the `folders` round trip. */
  files: GooglePickerResult[]
  /** Entries of a Map<driveFolderId, folderName>; arrays survive JSON. */
  folderNames: [string, string][]
  /** Parent folders still missing access when the `folders` step started. */
  pendingFolderIds: string[]
  /** Written by the redirect page once Google hands control back. */
  outcome?: PickOutcome
}

export function savePickSession(session: PickSession) {
  localStorage.setItem(DB_KEY_PICK_SESSION, JSON.stringify(session))
}

export function loadPickSession(): PickSession | undefined {
  const raw = localStorage.getItem(DB_KEY_PICK_SESSION)
  if (!raw) return undefined

  let session: PickSession
  try {
    session = JSON.parse(raw)
  } catch {
    clearPickSession()
    return undefined
  }

  if (!session.startedAt || Date.now() - session.startedAt > SESSION_TTL_MS) {
    clearPickSession()
    return undefined
  }
  return session
}

export function clearPickSession() {
  localStorage.removeItem(DB_KEY_PICK_SESSION)
}

// Folders the user chose to skip granting. Kept so the file list can offer
// "get folder names" later instead of stranding them on placeholder names.
const DB_KEY_PENDING_FOLDER_NAMES = "googleDrive.pendingFolderNameIds"

export function loadPendingFolderNameIds(): string[] {
  const raw = localStorage.getItem(DB_KEY_PENDING_FOLDER_NAMES)
  if (!raw) return []
  try {
    const ids = JSON.parse(raw)
    return Array.isArray(ids) ? ids : []
  } catch {
    return []
  }
}

export function addPendingFolderNameIds(ids: string[]) {
  if (ids.length === 0) return
  const merged = Array.from(new Set([...loadPendingFolderNameIds(), ...ids]))
  localStorage.setItem(DB_KEY_PENDING_FOLDER_NAMES, JSON.stringify(merged))
}

export function removePendingFolderNameIds(ids: string[]) {
  const remaining = loadPendingFolderNameIds().filter(id => !ids.includes(id))
  if (remaining.length === 0) {
    localStorage.removeItem(DB_KEY_PENDING_FOLDER_NAMES)
    return
  }
  localStorage.setItem(DB_KEY_PENDING_FOLDER_NAMES, JSON.stringify(remaining))
}
