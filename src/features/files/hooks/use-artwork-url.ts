"use client"

import { useEffect, useState } from "react"
import { useFileStore } from "../stores/file-store"
import type { ArtworkRecord } from "@/src/lib/artworks/artworks"

// One object URL per unique image for the whole session. The browser's
// decoded-bitmap cache is keyed by URL, so handing every consumer the same URL
// is what collapses N list rows showing the same cover into a single decode.
// URLs are deduplicated per unique image, so the pinned blobs stay bounded by
// the number of distinct covers seen this session.
//
// Added invariant (verify-on-subscribe): a URL handed to a subscriber has been
// verified readable at (or after) subscription time. iOS jettisons WebKit's
// network process under memory pressure, which silently drops every blob URL
// registration while the page lives on (the artwork bytes in IndexedDB are
// unaffected) — see WebKit bug 188880 for the process/registry coupling. Each
// subscription therefore probes the cached URL with a header-only fetch and,
// when the registry entry is gone, re-mints the URL from IndexedDB and wakes
// every subscriber of that hash. Detection, re-issue and distribution all live
// in this module; consumers stay unchanged.
const urlByHash = new Map<string, string>()
const inflightByHash = new Map<string, Promise<string | undefined>>()
const listenersByHash = new Map<string, Set<() => void>>()
// Probe bookkeeping: concurrent mounts share one probe, and a hash is not
// re-probed within the TTL (a list remount probes each unique hash once).
const verifiedAtByHash = new Map<string, number>()
const verifyInflightByHash = new Map<string, Promise<void>>()
const VERIFY_TTL_MS = 10_000
// A hash whose record cannot be re-read would loop probe→re-mint→probe; give
// up after a few re-mints and leave the placeholder (same look as before).
const remintsByHash = new Map<string, number>()
const MAX_REMINTS = 3

export type ArtworkLoader = () => Promise<ArtworkRecord | undefined>

/** One re-issue event, kept in a small localStorage ring for Settings → Diagnostics. */
export interface ArtworkUrlDiagEntry {
  t: number
  hash: string
  attempt: number
}

const DIAG_KEY = "artworkUrlDiag"
const DIAG_MAX = 30

/** Re-issue events (oldest first). Diagnostics display only. */
export function readArtworkUrlDiag(): ArtworkUrlDiagEntry[] {
  try {
    const raw = window.localStorage.getItem(DIAG_KEY)
    return raw ? (JSON.parse(raw) as ArtworkUrlDiagEntry[]) : []
  } catch {
    return []
  }
}

function recordReissue(hash: string, attempt: number) {
  try {
    const list = readArtworkUrlDiag()
    list.push({ t: Date.now(), hash: hash.slice(0, 8), attempt })
    while (list.length > DIAG_MAX) list.shift()
    window.localStorage.setItem(DIAG_KEY, JSON.stringify(list))
  } catch {
    // diagnostics must never break the app
  }
}

function wakeListeners(hash: string) {
  const listeners = listenersByHash.get(hash)
  if (!listeners) return
  const snapshot: Array<() => void> = []
  listeners.forEach(listener => snapshot.push(listener))
  snapshot.forEach(listener => listener())
}

/**
 * The cached URL failed a probe: drop it, re-mint from IndexedDB (the source
 * of truth — unaffected by the registry loss) and wake the subscribers.
 */
async function remintUrl(
  hash: string,
  brokenUrl: string,
  loadArtwork: ArtworkLoader
): Promise<void> {
  if (urlByHash.get(hash) !== brokenUrl) return // already re-minted
  const attempt = (remintsByHash.get(hash) ?? 0) + 1
  if (attempt > MAX_REMINTS) return
  remintsByHash.set(hash, attempt)
  urlByHash.delete(hash)
  URL.revokeObjectURL(brokenUrl) // clean up the dead registration
  try {
    const artwork = await loadArtwork()
    if (artwork) {
      urlByHash.set(hash, URL.createObjectURL(artwork.blob))
      verifiedAtByHash.set(hash, performance.now())
    }
  } catch {
    // leave the cache empty; the woken subscribers retry the normal miss path
  }
  recordReissue(hash, attempt)
  wakeListeners(hash)
}

/**
 * Header-only liveness probe of a cached URL. blob: fetches resolve their
 * headers from the registry without streaming the body, so cancelling the body
 * makes this a registry lookup, not an image read.
 */
function verifyCachedUrl(
  hash: string,
  url: string,
  loadArtwork: ArtworkLoader
): Promise<void> {
  const verifiedAt = verifiedAtByHash.get(hash)
  if (
    verifiedAt !== undefined &&
    performance.now() - verifiedAt < VERIFY_TTL_MS
  ) {
    return Promise.resolve()
  }
  const inflight = verifyInflightByHash.get(hash)
  if (inflight) return inflight
  const probe = (async () => {
    try {
      const res = await fetch(url)
      res.body?.cancel().catch(() => {})
      if (res.ok) {
        verifiedAtByHash.set(hash, performance.now())
        return
      }
    } catch {
      // dead registration — fall through to re-mint
    }
    await remintUrl(hash, url, loadArtwork)
  })().finally(() => {
    verifyInflightByHash.delete(hash)
  })
  verifyInflightByHash.set(hash, probe)
  return probe
}

/**
 * One-shot imperative variant of useArtworkUrl, for consumers outside React's
 * render cycle (Media Session). Same shared per-image cache; a cached URL is
 * verified live (and re-minted if the registry lost it) BEFORE being returned,
 * so a dead URL is never handed to the OS. Never rejects: any failure resolves
 * to undefined — for the caller that means "definitively no artwork".
 */
export async function resolveArtworkUrl(
  hash: string | undefined,
  loadArtwork: ArtworkLoader
): Promise<string | undefined> {
  if (!hash) return undefined
  const cached = urlByHash.get(hash)
  if (cached) {
    await verifyCachedUrl(hash, cached, loadArtwork)
    return urlByHash.get(hash) // re-minted URL, or undefined if re-mint failed
  }
  let promise = inflightByHash.get(hash)
  if (!promise) {
    promise = loadArtwork()
      .then(artwork => {
        if (!artwork) return undefined
        const created = URL.createObjectURL(artwork.blob)
        urlByHash.set(hash, created)
        verifiedAtByHash.set(hash, performance.now())
        return created
      })
      .finally(() => {
        inflightByHash.delete(hash)
      })
    inflightByHash.set(hash, promise)
  }
  return promise.catch(() => undefined)
}

/**
 * Resolves an artwork hash to the shared object URL for that image.
 * Returns undefined while loading, when `hash` is undefined, or when the hash
 * is not present in the `artworks` store.
 */
export function useArtworkUrl(hash: string | undefined): string | undefined {
  const [fileStoreState, fileStoreActions] = useFileStore()

  const [url, setUrl] = useState<string | undefined>(() =>
    hash ? urlByHash.get(hash) : undefined
  )
  // Bumped when this hash's URL is re-minted; re-runs the effect to pick up
  // the fresh cache entry.
  const [gen, setGen] = useState(0)

  useEffect(() => {
    if (!hash || !fileStoreState.configured) {
      setUrl(undefined)
      return
    }
    // Subscribe to re-mints of this hash for the mounted lifetime.
    let listeners = listenersByHash.get(hash)
    if (!listeners) {
      listeners = new Set()
      listenersByHash.set(hash, listeners)
    }
    const wake = () => setGen(g => g + 1)
    listeners.add(wake)

    let canceled = false
    const loadArtwork: ArtworkLoader = () => fileStoreActions.getArtwork(hash)

    const cached = urlByHash.get(hash)
    if (cached) {
      setUrl(cached)
      verifyCachedUrl(hash, cached, loadArtwork)
    } else {
      resolveArtworkUrl(hash, loadArtwork).then(resolved => {
        if (!canceled) setUrl(resolved)
      })
    }
    return () => {
      canceled = true
      listeners.delete(wake)
      if (listeners.size === 0) listenersByHash.delete(hash)
    }
  }, [hash, fileStoreState.configured, gen, fileStoreActions])

  return url
}
