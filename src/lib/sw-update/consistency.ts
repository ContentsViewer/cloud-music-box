// Build-consistency negotiation between the page and its controlling service
// worker — production logic of the update flow. The diagnostics modules
// (src/lib/sw-diag) record what this reports; the dependency never points the
// other way, and no timing heuristics are involved in the decision.
//
// Why this exists: all of this app's requests are version-neutral (a Next.js
// static export has no vocabulary to address a specific build), so whoever
// answers a document navigation decides which build runs. Browser cold-start
// optimizations can commit the network's — freshly deployed — document while
// an older service worker keeps controlling the client, yielding a mixed
// session (page build ≠ SW build; every route change degrades to an MPA
// navigation). The mixed state is detected deterministically by comparing
// per-deploy build ids: next.config.mjs stamps the same nanoid into the page
// bundle (APP_BUILD_ID) and into the SW precache manifest (revision).

export interface SwBuildInfo {
  appVersion?: string
  manifestRevision?: string
}

export type BuildConsistency =
  | { state: "consistent"; sw: SwBuildInfo }
  | { state: "mixed"; sw: SwBuildInfo }
  | { state: "no-controller" }
  /** handshake unanswered — treated as consistent (never cry wolf on a guess) */
  | { state: "unknown" }

const HANDSHAKE_TIMEOUT_MS = 3000

/** Ask any service worker (controller or waiting) which build it carries. */
export const requestBuildInfo = (
  worker: ServiceWorker
): Promise<SwBuildInfo | "timeout"> =>
  new Promise(resolve => {
    const channel = new MessageChannel()
    const timer = setTimeout(() => resolve("timeout"), HANDSHAKE_TIMEOUT_MS)
    channel.port1.onmessage = e => {
      clearTimeout(timer)
      resolve(e.data as SwBuildInfo)
    }
    try {
      worker.postMessage({ type: "GET_BUILD_INFO" }, [channel.port2])
    } catch {
      clearTimeout(timer)
      resolve("timeout")
    }
  })

/** Convenience wrapper for views (Settings diagnostics). */
export const getControllerBuildInfo = async (): Promise<
  SwBuildInfo | "timeout" | "no-controller"
> => {
  if (typeof window === "undefined" || !("serviceWorker" in navigator)) {
    return "no-controller"
  }
  const controller = navigator.serviceWorker.controller
  if (!controller) return "no-controller"
  return requestBuildInfo(controller)
}

export const checkBuildConsistency = async (): Promise<BuildConsistency> => {
  const info = await getControllerBuildInfo()
  if (info === "no-controller") return { state: "no-controller" }
  if (info === "timeout") return { state: "unknown" }

  const pageBuildId = process.env.APP_BUILD_ID
  if (pageBuildId && info.manifestRevision) {
    return info.manifestRevision === pageBuildId
      ? { state: "consistent", sw: info }
      : { state: "mixed", sw: info }
  }
  // Transition fallback: SW generations predating APP_BUILD_ID only report a
  // package version, which distinguishes deploys only when it was bumped.
  if (info.appVersion !== undefined && process.env.APP_VERSION) {
    return info.appVersion === process.env.APP_VERSION
      ? { state: "consistent", sw: info }
      : { state: "mixed", sw: info }
  }
  return { state: "unknown" }
}

const LAST_RUN_VERSION_KEY = "lastRunAppVersion"

/**
 * Version-change notice bookkeeping. Call on non-mixed boots only: the mixed
 * boot deliberately neither reports nor stores, so the "Updated to version"
 * notice fires exactly once — on the first consistent boot after an update,
 * whichever path (manual reload, lifecycle activation, mixed-state recovery)
 * applied it. Returns the new version when it changed.
 */
export const consumeVersionChange = (): string | undefined => {
  try {
    const current = process.env.APP_VERSION
    if (!current) return undefined
    const last = localStorage.getItem(LAST_RUN_VERSION_KEY)
    localStorage.setItem(LAST_RUN_VERSION_KEY, current)
    return last !== null && last !== current ? current : undefined
  } catch {
    return undefined
  }
}
