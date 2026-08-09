"use client"

import { useEffect, useRef, useState } from "react"
import { useFileStore } from "../stores/file-store"

// One object URL per unique image for the whole session. The browser's
// decoded-bitmap cache is keyed by URL, so handing every consumer the same URL
// is what collapses N list rows showing the same cover into a single decode.
// URLs are never revoked: they are deduplicated per unique image, so the pinned
// blobs stay bounded by the number of distinct covers seen this session.
const urlByHash = new Map<string, string>()
const inflightByHash = new Map<string, Promise<string | undefined>>()

/**
 * Resolves an artwork hash to the shared object URL for that image.
 * Returns undefined while loading, when `hash` is undefined, or when the hash
 * is not present in the `artworks` store.
 */
export function useArtworkUrl(hash: string | undefined): string | undefined {
  const [fileStoreState, fileStoreActions] = useFileStore()
  const refActions = useRef(fileStoreActions)
  refActions.current = fileStoreActions

  const [url, setUrl] = useState<string | undefined>(() =>
    hash ? urlByHash.get(hash) : undefined
  )

  useEffect(() => {
    if (!hash || !fileStoreState.configured) {
      setUrl(undefined)
      return
    }
    const cached = urlByHash.get(hash)
    if (cached) {
      setUrl(cached)
      return
    }

    let canceled = false
    let promise = inflightByHash.get(hash)
    if (!promise) {
      promise = refActions.current
        .getArtwork(hash)
        .then(artwork => {
          if (!artwork) return undefined
          const created = URL.createObjectURL(artwork.blob)
          urlByHash.set(hash, created)
          return created
        })
        .finally(() => {
          inflightByHash.delete(hash)
        })
      inflightByHash.set(hash, promise)
    }
    promise
      .then(resolved => {
        if (!canceled) setUrl(resolved)
      })
      .catch(() => {
        if (!canceled) setUrl(undefined)
      })
    return () => {
      canceled = true
    }
  }, [hash, fileStoreState.configured])

  return url
}
