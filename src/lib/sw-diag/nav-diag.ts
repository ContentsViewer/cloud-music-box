// Page-side launch forensics for the update-window leak investigation.
//
// Chromium (and, by reports, WebKit) can silently hand individual requests to
// the network when the controlling service worker cannot be reached at that
// instant — the fetch handler never runs, so no SW-side diagnostic can see
// it. These detectors observe the leak from the page instead:
//
//  - navigation record: was this document served through the SW at all
//    (workerStart > 0), was the client controlled, what nav type was it
//  - build handshake: ask the controller which build it carries; a mismatch
//    with the page's own version is a cross-build state — the user-visible
//    leak — regardless of which browser path caused it
//  - resource watch: same-origin app-shell requests (RSC .txt, chunks) whose
//    timing shows they went to the network without the SW
//    (workerStart === 0 with real transfer) while the page is controlled
//
// Everything is observation only: no request is altered or retried, and
// nothing in the production update flow reads these records — the build
// consistency verdict is produced by src/lib/sw-update/consistency.ts and
// merely handed in here for the log. Records go to a localStorage ring
// buffer so they survive the session and can be inspected on-device
// (Settings -> Diagnostics), which matters on iOS where no debugger is
// available.

import type { BuildConsistency, SwBuildInfo } from "../sw-update/consistency"

export type { SwBuildInfo }

export interface BypassedRequest {
  url: string
  /** ms since navigation start */
  startTime: number
}

export interface NavDiagEntry {
  t: number
  path: string
  appVersion?: string
  controlled: boolean
  hasRegistration: boolean
  navType?: string
  workerStart?: number
  fetchStart?: number
  responseStart?: number
  transferSize?: number
  /** handshake result; "timeout" = controller did not answer (pre-handshake SW) */
  swBuild?: SwBuildInfo | "timeout" | "no-controller"
  /** page and controller carry different builds — the leak, mechanism-agnostic */
  crossBuild?: boolean
  /** registered but this navigation did not engage the SW (also true on hard reloads) */
  bypassSuspect?: boolean
  /**
   * Controlled, the SW was engaged (workerStart > 0), yet the document body
   * arrived over the network (transferSize > 0 — SW cache responses report 0).
   * The confirmed leak signature: dispatch failed and the browser committed
   * the parallel (AutoPreload) network response, keeping the client
   * controlled.
   */
  networkCommit?: boolean
  bypassedRequests?: BypassedRequest[]
}

const STORAGE_KEY = "swNavDiag"
const MAX_ENTRIES = 30
const MAX_BYPASSED_PER_ENTRY = 20
const RESOURCE_WATCH_MS = 30000

const readAll = (): NavDiagEntry[] => {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    return raw ? (JSON.parse(raw) as NavDiagEntry[]) : []
  } catch {
    return []
  }
}

const persist = (entries: NavDiagEntry[]) => {
  try {
    localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify(entries.slice(-MAX_ENTRIES))
    )
  } catch {
    // Diagnostics must never break the app.
  }
}

export const readNavDiag = (): NavDiagEntry[] => readAll()

const round1 = (n: number) => Math.round(n * 10) / 10

const toRecordedBuild = (
  consistency: BuildConsistency
): NavDiagEntry["swBuild"] => {
  switch (consistency.state) {
    case "consistent":
    case "mixed":
      return consistency.sw
    case "no-controller":
      return "no-controller"
    case "unknown":
      return "timeout"
  }
}

// Watch app-shell subresources for the first RESOURCE_WATCH_MS of the
// session: a same-origin .txt / _next/static entry with workerStart === 0
// AND a real transfer went to the network without the SW — the silent
// per-request fallback caught in the act. (transferSize > 0 excludes
// memory-cache replays, which also report workerStart === 0.)
// Re-persist an already-stored entry after late-arriving data (handshake
// result, bypassed requests) lands on it.
const updateStored = (entry: NavDiagEntry) => {
  const entries = readAll()
  const i = entries.findIndex(e => e.t === entry.t)
  if (i >= 0) {
    entries[i] = entry
    persist(entries)
  }
}

const watchBypassedResources = (entry: NavDiagEntry) => {
  if (typeof PerformanceObserver === "undefined") return
  const bypassed: BypassedRequest[] = []
  const flush = () => {
    if (bypassed.length === 0) return
    entry.bypassedRequests = bypassed.slice(0, MAX_BYPASSED_PER_ENTRY)
    updateStored(entry)
  }
  try {
    const observer = new PerformanceObserver(list => {
      for (const e of list.getEntries() as PerformanceResourceTiming[]) {
        if (e.workerStart !== 0 || e.transferSize === 0) continue
        let url: URL
        try {
          url = new URL(e.name)
        } catch {
          continue
        }
        if (url.origin !== location.origin) continue
        if (
          !url.pathname.endsWith(".txt") &&
          !url.pathname.includes("/_next/static/")
        ) {
          continue
        }
        bypassed.push({
          url: url.pathname + url.search,
          startTime: Math.round(e.startTime),
        })
        console.warn(
          "[nav-diag] request bypassed the service worker (workerStart=0):",
          e.name
        )
        flush()
      }
    })
    observer.observe({ type: "resource", buffered: true })
    setTimeout(() => {
      observer.disconnect()
      flush()
    }, RESOURCE_WATCH_MS)
  } catch {
    // Observation only.
  }
}

/**
 * Capture one launch record. Call once per page load, BEFORE the service
 * worker registration call, so the controller state reflects what this
 * navigation actually committed with. The consistency verdict comes from the
 * production check (sw-update/consistency) as a promise: the record is
 * persisted immediately — a leaked document is often replaced by an MPA
 * navigation within a second — and patched when the verdict resolves.
 */
export const captureNavDiag = async (
  consistency: Promise<BuildConsistency>
): Promise<void> => {
  if (typeof window === "undefined" || !("serviceWorker" in navigator)) return
  try {
    const controller = navigator.serviceWorker.controller
    const nav = performance.getEntriesByType("navigation")[0] as
      | PerformanceNavigationTiming
      | undefined

    const entry: NavDiagEntry = {
      t: Date.now(),
      path: location.pathname,
      appVersion: process.env.APP_VERSION,
      controlled: !!controller,
      hasRegistration: false,
      navType: nav?.type,
      workerStart: nav ? round1(nav.workerStart) : undefined,
      fetchStart: nav ? round1(nav.fetchStart) : undefined,
      responseStart: nav ? round1(nav.responseStart) : undefined,
      transferSize: nav?.transferSize,
    }

    try {
      entry.hasRegistration =
        (await navigator.serviceWorker.getRegistration()) !== undefined
    } catch {
      // leave false
    }

    entry.bypassSuspect =
      entry.hasRegistration &&
      (!entry.controlled || (nav !== undefined && nav.workerStart === 0))
    entry.networkCommit =
      entry.controlled &&
      nav !== undefined &&
      nav.workerStart > 0 &&
      nav.transferSize > 0

    const entries = readAll()
    entries.push(entry)
    persist(entries)
    const log =
      entry.bypassSuspect || entry.networkCommit ? console.warn : console.info
    log("[nav-diag]", entry)

    if (entry.controlled) watchBypassedResources(entry)

    const verdict = await consistency
    entry.swBuild = toRecordedBuild(verdict)
    entry.crossBuild = verdict.state === "mixed"
    updateStored(entry)
    if (entry.crossBuild) {
      console.warn("[nav-diag] cross-build state detected:", entry)
    }
  } catch {
    // Diagnostics must never break startup.
  }
}
