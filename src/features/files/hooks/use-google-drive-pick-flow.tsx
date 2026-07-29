"use client"

// The engine for the Google Drive picker round trip.
//
// The picker is a top-level navigation, so this is a resumable flow built
// around three roles (see docs/architecture.md, "Google Drive picker round
// trip"):
//   - OWNER    - this document, while a hand-off is in flight. Holds
//                PICK_OWNER_LOCK; the lock's liveness is what tells the
//                redirect page whether to stay out of the way.
//   - COURIER  - the redirect page. Writes the outcome; never does the work.
//   - EXECUTOR - runs the continuation under PICK_RESUME_LOCK, triggered by
//                mount, visibility, bfcache restore, or a courier broadcast.
//
// The persisted PickFlowRecord is the single source of truth; locks carry no
// data and the channel is only a wake-up call. Everything degrades to the
// pre-lock behavior when navigator.locks / BroadcastChannel are missing.

import { enqueueSnackbar } from "notistack"
import { useCallback, useEffect, useRef, useState } from "react"
import { useFileStore } from "../stores/file-store"
import {
  GoogleDriveClient,
  GooglePickerResult,
} from "../api/google-drive-client"
import { getGooglePickerMode } from "../api/google-drive-picker-mode"
import {
  PICK_CHANNEL,
  PICK_OWNER_LOCK,
  PICK_RESUME_LOCK,
  PickChannelMessage,
  PickFlowRecord,
  addPendingFolderNameIds,
  clearPickFlow,
  loadPendingFolderNameIds,
  loadPickFlow,
  removePendingFolderNameIds,
  savePickFlow,
} from "../api/google-drive-pick-session"

export type PickHandoffState =
  | { phase: "idle" }
  /** Navigation to Google requested; nothing visible has happened yet. */
  | { phase: "leaving" }
  /** The navigation never departed (e.g. a broken Drive app intercepted it). */
  | { phase: "stuck" }
  /** The continuation is doing work; `message` names the step. */
  | { phase: "busy"; message: string }

// How long a requested navigation may stay visible before it is declared
// failed. The true failure (fact: a present-but-unconfigured Drive app) is an
// instant no-op, so this only needs enough headroom for slow commits; the
// stuck-recovery listener below repairs the rare false positive.
const WATCHDOG_MS = 4000
const STUCK_RECOVERY_MS = 30000
// How long the in-app (iframe) picker may go without reporting Action.LOADED
// before the user is offered a way out. The known cause is the iOS cookie
// wall, where the picker renders a dead-end dialog instead of loading.
const PICKER_LOAD_WARNING_MS = 10000

export interface InAppPickerState {
  /** Shown in the escape-hatch chrome above the picker. */
  label: string
  /** True once the load watchdog fired without Action.LOADED. */
  loadWarning: boolean
}

// --- Owner lock (module scope: it must survive React unmounts, because the
// --- document - the actual owner - does) ------------------------------------

let releaseOwnerLock: () => void = () => {}

async function acquireOwnerLock(): Promise<void> {
  if (!("locks" in navigator)) return
  releaseOwnerLock()
  await new Promise<void>(acquired => {
    navigator.locks
      .request(PICK_OWNER_LOCK, { steal: true }, () => {
        acquired()
        // Held until released; `steal` means a newer pick (any document)
        // takes over instead of queueing behind a stale holder.
        return new Promise<void>(release => {
          releaseOwnerLock = () => {
            releaseOwnerLock = () => {}
            release()
          }
        })
      })
      // AbortError when another acquire steals this hold; nothing to clean up.
      .catch(() => {})
  })
}

if (typeof window !== "undefined") {
  // A genuinely departing document (real unload or bfcache entry) must not
  // keep the lock: pagehide fires exactly then - and does NOT fire when
  // Android diverts the navigation and this document survives. That asymmetry
  // is what makes the lock an accurate liveness signal, so this listener is
  // load-bearing, not cleanup.
  window.addEventListener("pagehide", () => releaseOwnerLock())
}

/**
 * Pick work that a freshly booted app should route the user back to
 * (used by the home page to recover a flow after a cold relaunch).
 */
export function pendingPickWorkHref(): string | undefined {
  const record = loadPickFlow()
  if (!record) return undefined
  if (record.phase === "returned" || record.phase === "awaiting-user") {
    return record.returnHref
  }
  return undefined
}

interface UseGoogleDrivePickFlowOptions {
  /** Where the round trip should land the user (captures the current folder). */
  getReturnHref: () => string
  /** Drive folder the in-app picker should start in (undefined = Drive root). */
  getPickerParentId?: () => string | undefined
  /** Called after a continuation committed; the page refreshes its list. */
  onCommitted: () => void
}

export function useGoogleDrivePickFlow({
  getReturnHref,
  getPickerParentId,
  onCommitted,
}: UseGoogleDrivePickFlowOptions) {
  const [fileStoreState, fileStoreActions] = useFileStore()

  const [handoff, setHandoff] = useState<PickHandoffState>({ phase: "idle" })
  const [folderGrantPrompt, setFolderGrantPrompt] =
    useState<PickFlowRecord | null>(null)
  const [pendingFolderNameCount, setPendingFolderNameCount] = useState(0)
  // Non-null while an in-app (iframe) picker is on screen.
  const [inAppPicker, setInAppPicker] = useState<InAppPickerState | null>(null)

  // Fresh values for callbacks that outlive a render.
  const fileStoreRef = useRef({ state: fileStoreState, actions: fileStoreActions })
  fileStoreRef.current = { state: fileStoreState, actions: fileStoreActions }
  const getReturnHrefRef = useRef(getReturnHref)
  getReturnHrefRef.current = getReturnHref
  const getPickerParentIdRef = useRef(getPickerParentId)
  getPickerParentIdRef.current = getPickerParentId
  const onCommittedRef = useRef(onCommitted)
  onCommittedRef.current = onCommitted
  const pickerAbortRef = useRef<AbortController | null>(null)
  // Set when the user closes the picker through the escape hatch; a folder
  // grant loop checks it to stop instead of marching through the rest.
  const pickerCancelRequestedRef = useRef(false)

  const watchdogDisarmRef = useRef<() => void>(() => {})
  const stuckRecoveryDisarmRef = useRef<() => void>(() => {})
  const flowSnapshotRef = useRef<PickFlowRecord | undefined>(undefined)
  const lastLeaveRef = useRef<() => void>(() => {})
  const executorRunningRef = useRef(false)
  const channelRef = useRef<BroadcastChannel | undefined>(undefined)

  const getGoogleClient = (): GoogleDriveClient | undefined => {
    const driveClient = fileStoreRef.current.state.driveClient
    if (!driveClient || !(driveClient as GoogleDriveClient).startFilesPick) {
      enqueueSnackbar("Drive client not connected", { variant: "error" })
      return undefined
    }
    return driveClient as GoogleDriveClient
  }

  const setBusy = (message: string) => setHandoff({ phase: "busy", message })

  const postChannel = (message: PickChannelMessage) => {
    channelRef.current?.postMessage(message)
  }

  // --- Executor -------------------------------------------------------------

  /** Writes + snackbars once metadata is resolved. Idempotent (IDB upserts). */
  const commitPick = async (
    picked: GooglePickerResult[],
    folderNames: Map<string, string>,
    unresolvedFolderIds: string[]
  ) => {
    const { actions } = fileStoreRef.current
    if (picked.length > 0) {
      setBusy(`Adding ${picked.length} file${picked.length > 1 ? "s" : ""}…`)
      await actions.addPickerGroup(picked, folderNames)
    }
    // Folders saved earlier under a placeholder keep that name, so apply the
    // real names explicitly.
    await actions.updateFolderNames(folderNames)

    clearPickFlow()
    removePendingFolderNameIds(Array.from(folderNames.keys()))
    addPendingFolderNameIds(unresolvedFolderIds)
    setPendingFolderNameCount(loadPendingFolderNameIds().length)

    if (picked.length > 0) {
      enqueueSnackbar(`Added ${picked.length} file${picked.length > 1 ? "s" : ""}`)
    } else if (folderNames.size > 0) {
      enqueueSnackbar(
        `Updated ${folderNames.size} folder name${folderNames.size > 1 ? "s" : ""}`
      )
    }

    postChannel({ type: "pick-resumed" })
    onCommittedRef.current()
  }

  /**
   * The merge point of the two acquisition paths (redirect and in-app): from
   * picked tracks with metadata to either a commit or a persisted
   * `awaiting-user` record with the folder-grant dialog showing.
   */
  const continueWithPicked = async (
    client: GoogleDriveClient,
    picked: GooglePickerResult[],
    returnHref: string
  ) => {
    const parentIds = Array.from(
      new Set(
        picked
          .map(f => f.parentId)
          .filter((id): id is string => id !== undefined)
      )
    )

    setBusy("Checking folders…")
    const folderNames = new Map<string, string>()
    const needAccess: string[] = []
    for (const parentId of parentIds) {
      const { hasAccess, folderName } = await client.checkFolderAccess(parentId)
      if (hasAccess && folderName) {
        folderNames.set(parentId, folderName)
      } else {
        needAccess.push(parentId)
      }
    }

    if (needAccess.length > 0) {
      // drive.file grants never cascade from a folder to its contents, so
      // a folder the user did not pick is unreadable - including its name.
      // `awaiting-user` persists the dialog itself: if the app dies here,
      // the next boot re-shows it instead of losing the picked tracks.
      const next: PickFlowRecord = {
        v: 2,
        step: "folders",
        phase: "awaiting-user",
        startedAt: Date.now(),
        returnHref,
        files: picked,
        folderNames: Array.from(folderNames.entries()),
        pendingFolderIds: needAccess,
      }
      savePickFlow(next)
      setFolderGrantPrompt(next)
      return
    }

    await commitPick(picked, folderNames, [])
  }

  const runContinuation = async (
    record: PickFlowRecord & { phase: "returned" }
  ) => {
    const client = getGoogleClient()
    if (!client) {
      clearPickFlow()
      return
    }
    const outcome = record.outcome

    try {
      if (record.step === "files") {
        if ("cancelled" in outcome) {
          clearPickFlow()
          releaseOwnerLock()
          postChannel({ type: "pick-resumed" })
          enqueueSnackbar("Cancelled adding files")
          return
        }

        setBusy(
          `Reading ${outcome.ids.length} selected item${outcome.ids.length > 1 ? "s" : ""}…`
        )
        // The picker only returns ids, so rebuild what the old in-page picker
        // used to hand back directly.
        const picked = await client.getFilesMetadata(outcome.ids)
        if (picked.length === 0) {
          clearPickFlow()
          enqueueSnackbar("Could not read the selected files", {
            variant: "error",
          })
          return
        }

        await continueWithPicked(client, picked, record.returnHref)
        return
      }

      // step === "folders"
      const folderNames = new Map(record.folderNames)
      if ("cancelled" in outcome) {
        // Nothing here is worth losing the user's tracks over: save them with
        // placeholder names and leave the retry available.
        await commitPick(record.files, folderNames, record.pendingFolderIds)
        if (record.pendingFolderIds.length > 0) {
          enqueueSnackbar("Saved with temporary folder names")
        }
        return
      }

      setBusy("Reading folder names…")
      const granted = await client.getFilesMetadata(outcome.ids)
      granted.forEach(g => folderNames.set(g.id, g.name))
      const stillMissing = record.pendingFolderIds.filter(
        id => !folderNames.has(id)
      )
      await commitPick(record.files, folderNames, stillMissing)
    } catch (error) {
      console.error(error)
      enqueueSnackbar(`${error}`, { variant: "error" })
      clearPickFlow()
    } finally {
      releaseOwnerLock()
      setHandoff(current => (current.phase === "busy" ? { phase: "idle" } : current))
    }
  }

  /**
   * The single executor entry. Every trigger funnels here; PICK_RESUME_LOCK
   * serializes execution across documents, and re-loading the record inside
   * the lock means a concurrent executor's finished work turns this call into
   * a no-op. A crash mid-continuation leaves the record in `returned`, so the
   * next trigger simply retries (the writes are idempotent).
   */
  const triggerExecutor = useCallback(() => {
    if (executorRunningRef.current) return
    executorRunningRef.current = true

    const body = async () => {
      if (!fileStoreRef.current.state.configured) return
      const record = loadPickFlow()
      if (!record) return
      if (record.phase === "returned") {
        await runContinuation(record as PickFlowRecord & { phase: "returned" })
      } else if (record.phase === "awaiting-user") {
        setFolderGrantPrompt(record)
      }
    }

    const run = async () => {
      try {
        if ("locks" in navigator) {
          await navigator.locks.request(PICK_RESUME_LOCK, body)
        } else {
          await body()
        }
      } finally {
        executorRunningRef.current = false
      }
    }
    void run()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // --- In-app (iframe) picker path -----------------------------------------
  //
  // No lock, no PickFlowRecord, no watchdog: the document never leaves, so
  // the ownership contract has nothing to protect. The only persisted state
  // is the shared `awaiting-user` record written by continueWithPicked.

  /** Runs one picker with the escape-hatch state, abort wiring and load watchdog. */
  const withInAppPicker = async <T,>(
    label: string,
    run: (opts: { signal: AbortSignal; onLoaded: () => void }) => Promise<T>
  ): Promise<T> => {
    const abort = new AbortController()
    pickerAbortRef.current = abort
    setInAppPicker({ label, loadWarning: false })
    // The picker normally reports LOADED within a second or two; staying
    // silent this long means it is stuck (the iOS cookie wall renders a
    // dead-end dialog instead), so surface a way out.
    const loadTimer = window.setTimeout(() => {
      setInAppPicker(current =>
        current ? { ...current, loadWarning: true } : current
      )
    }, PICKER_LOAD_WARNING_MS)
    try {
      return await run({
        signal: abort.signal,
        onLoaded: () => window.clearTimeout(loadTimer),
      })
    } finally {
      window.clearTimeout(loadTimer)
      pickerAbortRef.current = null
      setInAppPicker(null)
    }
  }

  const beginInAppFilesPick = async () => {
    const client = getGoogleClient()
    if (!client) return
    pickerCancelRequestedRef.current = false
    try {
      const picked = await withInAppPicker("Add music from Google Drive", opts =>
        client.openFilesPicker(getPickerParentIdRef.current?.(), opts)
      )
      if (picked.length === 0) return // picker cancel or escape hatch
      await continueWithPicked(client, picked, getReturnHrefRef.current())
    } catch (error) {
      console.error(error)
      enqueueSnackbar(`${error}`, { variant: "error" })
      clearPickFlow()
    } finally {
      setHandoff(current =>
        current.phase === "busy" ? { phase: "idle" } : current
      )
    }
  }

  /**
   * Grants pending folders one picker at a time - the iframe picker has no
   * batch-grant mode (that is a redirect-flow exclusive via file_ids). A
   * cancelled or skipped folder simply stays on its placeholder name.
   */
  const runInAppFolderGrant = async (
    files: GooglePickerResult[],
    knownFolderNames: [string, string][],
    pendingFolderIds: string[]
  ) => {
    const client = getGoogleClient()
    if (!client) return
    pickerCancelRequestedRef.current = false
    const folderNames = new Map(knownFolderNames)
    const total = pendingFolderIds.length
    try {
      for (let i = 0; i < total; i++) {
        // Escape hatch pressed: keep the rest as placeholders instead of
        // marching the user through more pickers.
        if (pickerCancelRequestedRef.current) break
        const folderId = pendingFolderIds[i]
        const folder = await withInAppPicker(
          total > 1 ? `Folder ${i + 1} of ${total}` : "Allow the folder",
          opts => client.openFolderPicker(folderId, opts)
        )
        if (folder && folder.id === folderId) {
          folderNames.set(folderId, folder.name)
        }
      }
      const stillMissing = pendingFolderIds.filter(id => !folderNames.has(id))
      await commitPick(files, folderNames, stillMissing)
      if (stillMissing.length > 0) {
        enqueueSnackbar("Saved with temporary folder names")
      }
    } catch (error) {
      console.error(error)
      enqueueSnackbar(`${error}`, { variant: "error" })
      clearPickFlow()
    } finally {
      setHandoff(current =>
        current.phase === "busy" ? { phase: "idle" } : current
      )
    }
  }

  /** Escape hatch: dispose the current picker and stop the flow. */
  const cancelInAppPicker = useCallback(() => {
    pickerCancelRequestedRef.current = true
    pickerAbortRef.current?.abort()
  }, [])

  /** "Keep waiting" on the load warning - hides the dialog, picker stays. */
  const keepWaitingInAppPicker = useCallback(() => {
    setInAppPicker(current =>
      current ? { ...current, loadWarning: false } : current
    )
  }, [])

  // --- Owner: leaving for Google -------------------------------------------

  const armWatchdog = () => {
    watchdogDisarmRef.current()
    let done = false

    const disarm = () => {
      if (done) return
      done = true
      clearTimeout(timer)
      window.removeEventListener("pagehide", onDeparted)
      document.removeEventListener("visibilitychange", onVisibility)
      document.removeEventListener("freeze", onDeparted)
    }

    // The navigation demonstrably left (unload, bfcache, backgrounding, or a
    // page-lifecycle freeze). Advance the phase and drop the overlay so a
    // surviving Android document looks normal when the user peeks back.
    const onDeparted = () => {
      disarm()
      const record = loadPickFlow()
      if (record && record.phase === "leaving") {
        savePickFlow({ ...record, phase: "at-google" })
      }
      setHandoff({ phase: "idle" })
    }
    const onVisibility = () => {
      if (document.visibilityState === "hidden") onDeparted()
    }

    const timer = window.setTimeout(() => {
      if (done) return
      if (document.visibilityState !== "visible") {
        onDeparted()
        return
      }
      disarm()
      onStuck()
    }, WATCHDOG_MS)

    window.addEventListener("pagehide", onDeparted)
    document.addEventListener("visibilitychange", onVisibility)
    document.addEventListener("freeze", onDeparted)
    watchdogDisarmRef.current = disarm
  }

  const onStuck = () => {
    setHandoff({ phase: "stuck" })
    clearPickFlow()
    releaseOwnerLock()

    // False-positive repair: on a slow connection the navigation can commit
    // after the watchdog fired. If departure is detected late, restore the
    // flow so the round trip still completes.
    let done = false
    const disarm = () => {
      if (done) return
      done = true
      clearTimeout(timer)
      window.removeEventListener("pagehide", onLateDeparture)
      document.removeEventListener("visibilitychange", onLateVisibility)
    }
    const onLateDeparture = (event: Event) => {
      disarm()
      const record = flowSnapshotRef.current
      if (record) savePickFlow(record)
      if (event.type !== "pagehide") {
        // Hidden without pagehide: the document survives (Android divert), so
        // it is still the owner.
        void acquireOwnerLock()
      }
      setHandoff({ phase: "idle" })
    }
    const onLateVisibility = (event: Event) => {
      if (document.visibilityState === "hidden") onLateDeparture(event)
    }
    const timer = window.setTimeout(disarm, STUCK_RECOVERY_MS)
    window.addEventListener("pagehide", onLateDeparture)
    document.addEventListener("visibilitychange", onLateVisibility)
    stuckRecoveryDisarmRef.current = disarm
  }

  /** Shared hand-off: lock, persist, watchdog, then leave. */
  const departForGoogle = async (
    record: PickFlowRecord & { phase: "leaving" },
    start: (client: GoogleDriveClient) => void
  ) => {
    const client = getGoogleClient()
    if (!client) return

    setHandoff({ phase: "leaving" })
    try {
      // Acquired before location.href so the courier can never observe a
      // gap; held across the round trip, released on pagehide/terminal paths.
      await acquireOwnerLock()
      savePickFlow(record)
      flowSnapshotRef.current = record
      armWatchdog()
      start(client)
    } catch (error) {
      watchdogDisarmRef.current()
      releaseOwnerLock()
      clearPickFlow()
      setHandoff({ phase: "idle" })
      console.error(error)
      enqueueSnackbar(`${error}`, { variant: "error" })
    }
  }

  const beginFilesPick = useCallback(() => {
    if (getGooglePickerMode() === "in-app") {
      void beginInAppFilesPick()
      return
    }
    lastLeaveRef.current = beginFilesPick
    void departForGoogle(
      {
        v: 2,
        step: "files",
        phase: "leaving",
        startedAt: Date.now(),
        returnHref: getReturnHrefRef.current(),
        files: [],
        folderNames: [],
        pendingFolderIds: [],
      },
      client => client.startFilesPick()
    )
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  /** From the folder-grant dialog: grant the pending folders (mode decides how). */
  const beginFolderGrant = useCallback((record: PickFlowRecord) => {
    setFolderGrantPrompt(null)
    if (getGooglePickerMode() === "in-app") {
      void runInAppFolderGrant(
        record.files,
        record.folderNames,
        record.pendingFolderIds
      )
      return
    }
    lastLeaveRef.current = () => beginFolderGrant(record)
    void departForGoogle(
      {
        ...record,
        step: "folders",
        phase: "leaving",
        startedAt: Date.now(),
      },
      client => client.startFolderGrant(record.pendingFolderIds)
    )
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  /** From the folder-grant dialog: keep placeholder names, save everything. */
  const skipFolderGrant = useCallback(async (record: PickFlowRecord) => {
    setFolderGrantPrompt(null)
    setBusy("Saving…")
    try {
      await commitPick(
        record.files,
        new Map(record.folderNames),
        record.pendingFolderIds
      )
      enqueueSnackbar("Saved with temporary folder names")
    } catch (error) {
      console.error(error)
      enqueueSnackbar(`${error}`, { variant: "error" })
      clearPickFlow()
    } finally {
      releaseOwnerLock()
      setHandoff({ phase: "idle" })
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  /** From the menu: re-request names for folders skipped earlier. */
  const beginFolderNamesRetry = useCallback((folderIds: string[]) => {
    if (getGooglePickerMode() === "in-app") {
      void runInAppFolderGrant([], [], folderIds)
      return
    }
    lastLeaveRef.current = () => beginFolderNamesRetry(folderIds)
    void departForGoogle(
      {
        v: 2,
        step: "folders",
        phase: "leaving",
        startedAt: Date.now(),
        returnHref: getReturnHrefRef.current(),
        files: [],
        folderNames: [],
        pendingFolderIds: folderIds,
      },
      client => client.startFolderGrant(folderIds)
    )
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const dismissStuck = useCallback(() => {
    stuckRecoveryDisarmRef.current()
    setHandoff({ phase: "idle" })
  }, [])

  const retryStuck = useCallback(() => {
    stuckRecoveryDisarmRef.current()
    lastLeaveRef.current()
  }, [])

  // --- Triggers -------------------------------------------------------------

  useEffect(() => {
    if (!fileStoreState.configured) return
    triggerExecutor()
  }, [fileStoreState.configured, triggerExecutor])

  useEffect(() => {
    setPendingFolderNameCount(loadPendingFolderNameIds().length)

    if ("BroadcastChannel" in window) {
      const channel = new BroadcastChannel(PICK_CHANNEL)
      channelRef.current = channel
      channel.onmessage = (event: MessageEvent<PickChannelMessage>) => {
        if (event.data?.type === "outcome-written") {
          triggerExecutor()
        } else if (event.data?.type === "pick-resumed") {
          // Another document committed; reflect its result.
          setPendingFolderNameCount(loadPendingFolderNameIds().length)
          onCommittedRef.current()
        }
      }
    }

    // The guarantee path: a frozen document misses broadcasts, but always
    // sees visibility flip when the user returns.
    const onVisibility = () => {
      if (document.visibilityState === "visible") triggerExecutor()
    }
    // bfcache revival (back-button from Google): the hand-off is over.
    const onPageShow = (event: PageTransitionEvent) => {
      if (!event.persisted) return
      watchdogDisarmRef.current()
      releaseOwnerLock()
      setHandoff({ phase: "idle" })
      triggerExecutor()
    }
    document.addEventListener("visibilitychange", onVisibility)
    window.addEventListener("pageshow", onPageShow)

    return () => {
      document.removeEventListener("visibilitychange", onVisibility)
      window.removeEventListener("pageshow", onPageShow)
      channelRef.current?.close()
      channelRef.current = undefined
      watchdogDisarmRef.current()
      stuckRecoveryDisarmRef.current()
    }
  }, [triggerExecutor])

  return {
    handoff,
    folderGrantPrompt,
    pendingFolderNameCount,
    inAppPicker,
    beginFilesPick,
    beginFolderGrant,
    skipFolderGrant,
    beginFolderNamesRetry,
    dismissStuck,
    retryStuck,
    cancelInAppPicker,
    keepWaitingInAppPicker,
  }
}
