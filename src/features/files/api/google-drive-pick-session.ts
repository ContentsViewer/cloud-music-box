import { GooglePickerResult } from "./google-drive-client"

// The trigger_onepick picker runs as a top-level navigation to Google, so every
// piece of in-flight state has to survive leaving the page and coming back.
//
// localStorage rather than sessionStorage on purpose: on iOS a PWA can hand the
// redirect back to a different browsing context, which would drop sessionStorage
// and silently lose the user's selection. A TTL keeps stale flows from
// resurrecting days later.
//
// The record is a phase-based state machine written by three roles:
//   - the OWNER (the document that started the pick) writes `leaving` and
//     `at-google`, and holds PICK_OWNER_LOCK for the whole round trip;
//   - the COURIER (the redirect page) writes `returned` — nothing else;
//   - the EXECUTOR (whichever app document runs the continuation, serialized
//     under PICK_RESUME_LOCK) advances `returned` to `awaiting-user` or clears
//     the record when the work is committed.
// Illegal combinations (an outcome outside `returned`, a folder-grant wait in
// the files step) are unrepresentable in the type and rejected on load.
const DB_KEY_PICK_FLOW = "googleDrive.pickSession"
const FLOW_TTL_MS = 10 * 60 * 1000

/**
 * Web Lock held by the pick-starting document for the lifetime of the round
 * trip. Lock liveness IS the ownership signal: it survives backgrounding and
 * freezing, and the browser releases it the moment the document dies — which
 * is exactly what the redirect page needs to know to decide between
 * "the origin is alive, stay out of its way" and "boot the app here".
 */
export const PICK_OWNER_LOCK = "cmb.gdrive-pick.owner"
/** Serializes continuation execution across documents (two tabs, PWA + tab). */
export const PICK_RESUME_LOCK = "cmb.gdrive-pick.resume"
/** Fast-path notifications; localStorage stays the source of truth. */
export const PICK_CHANNEL = "cmb.gdrive-pick"

export type PickChannelMessage =
  /** Posted by the courier after writing a `returned` record. */
  | { type: "outcome-written" }
  /** Posted by the executor after the continuation committed. */
  | { type: "pick-resumed" }

export type PickStep = "files" | "folders"

export type PickOutcome = { ids: string[] } | { cancelled: true }

interface PickFlowBase {
  v: 2
  /**
   * `files`   - the user is choosing tracks.
   * `folders` - the user is granting access to the parent folders of those
   *             tracks, which is what lets us show real folder names.
   */
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
}

export type PickFlowRecord = PickFlowBase &
  (
    /** Owner wrote the record and is about to set location.href. */
    | { phase: "leaving" }
    /** The hand-off visibly departed (owner saw visibilitychange -> hidden). */
    | { phase: "at-google" }
    /** The picker came back; only the courier writes this. */
    | { phase: "returned"; outcome: PickOutcome }
    /** Folder-grant dialog is (or should be) showing. `folders` step only. */
    | { phase: "awaiting-user" }
  )

export function savePickFlow(record: PickFlowRecord) {
  localStorage.setItem(DB_KEY_PICK_FLOW, JSON.stringify(record))
}

export function loadPickFlow(): PickFlowRecord | undefined {
  const raw = localStorage.getItem(DB_KEY_PICK_FLOW)
  if (!raw) return undefined

  let parsed: any
  try {
    parsed = JSON.parse(raw)
  } catch {
    clearPickFlow()
    return undefined
  }

  const record = parsed?.v === 2 ? parsed : migrateV1(parsed)
  if (!record || !isWellFormed(record)) {
    clearPickFlow()
    return undefined
  }

  if (!record.startedAt || Date.now() - record.startedAt > FLOW_TTL_MS) {
    clearPickFlow()
    return undefined
  }
  return record
}

export function clearPickFlow() {
  localStorage.removeItem(DB_KEY_PICK_FLOW)
}

/**
 * The courier's one write. Guarded: an outcome may only land on a flow that
 * actually left for Google. `startedAt` is refreshed so a user stranded in a
 * browser tab gets the full TTL window to switch back to the app.
 */
export function recordPickOutcome(
  record: PickFlowRecord,
  outcome: PickOutcome
): PickFlowRecord | undefined {
  if (record.phase !== "leaving" && record.phase !== "at-google") {
    return undefined
  }
  const next: PickFlowRecord = {
    ...record,
    phase: "returned",
    outcome,
    startedAt: Date.now(),
  }
  savePickFlow(next)
  return next
}

function isWellFormed(record: PickFlowRecord): boolean {
  switch (record.phase) {
    case "leaving":
    case "at-google":
      return true
    case "returned":
      return record.outcome !== undefined
    case "awaiting-user":
      return record.step === "folders"
    default:
      return false
  }
}

// Pre-phase records (v1: `step` + optional `outcome`) may be in flight across
// a deploy; the mapping is total so nothing is dropped mid-pick.
function migrateV1(v1: any): PickFlowRecord | undefined {
  if (!v1 || typeof v1 !== "object" || !v1.step) return undefined
  const base: PickFlowBase = {
    v: 2,
    step: v1.step,
    startedAt: v1.startedAt,
    returnHref: v1.returnHref,
    files: v1.files ?? [],
    folderNames: v1.folderNames ?? [],
    pendingFolderIds: v1.pendingFolderIds ?? [],
  }
  if (v1.outcome) return { ...base, phase: "returned", outcome: v1.outcome }
  if (v1.step === "folders") return { ...base, phase: "awaiting-user" }
  return { ...base, phase: "at-google" }
}

/**
 * Courier-side liveness probe: is the pick-starting document still alive?
 * `ifAvailable` never waits - if the lock is held somewhere (`lock === null`
 * in the callback), the owner lives; if we got it, the owner is gone and the
 * momentary hold is released by returning. Without Web Locks the answer is
 * "gone", which degrades to the pre-lock behavior (navigate and boot here).
 */
export async function probePickOwnerAlive(): Promise<boolean> {
  if (!("locks" in navigator)) return false
  return navigator.locks.request(
    PICK_OWNER_LOCK,
    { ifAvailable: true },
    async lock => lock === null
  )
}

/** Courier-side wake-up call after `recordPickOutcome`. */
export function announcePickOutcome() {
  if (!("BroadcastChannel" in window)) return
  const channel = new BroadcastChannel(PICK_CHANNEL)
  const message: PickChannelMessage = { type: "outcome-written" }
  channel.postMessage(message)
  // Parked page; close lazily rather than racing the delivery.
  setTimeout(() => channel.close(), 1000)
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
