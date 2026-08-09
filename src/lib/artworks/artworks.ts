/**
 * Content-addressed artwork storage (CAS) primitives.
 *
 * Artwork images are stored once in the `artworks` object store, keyed by the
 * SHA-256 of the ORIGINAL embedded picture bytes. Hashing the source bytes —
 * never a re-encoded derivative — keeps the key identical across devices, which
 * is what makes export/import deduplication work (canvas encoders are not
 * deterministic across browsers).
 */

export interface ArtworkRecord {
  /** Original embedded picture bytes, untouched (mime lives in blob.type). */
  blob: Blob
  /**
   * Theme source color extracted from this image, cached on first use so a
   * track change never recomputes the color for an image it has already seen.
   */
  themeSourceColor?: number
  width?: number
  height?: number
  // Future escape hatch: smallBlob?: Blob (downscaled variant) if decoded
  // full-size bitmaps ever prove too heavy on low-memory devices.
}

/** SHA-256 of the given bytes as lowercase hex. */
export async function sha256Hex(
  data: Uint8Array | ArrayBuffer
): Promise<string> {
  const buffer = data instanceof Uint8Array ? data : new Uint8Array(data)
  const digest = await crypto.subtle.digest("SHA-256", buffer)
  const bytes = new Uint8Array(digest)
  let hex = ""
  for (let i = 0; i < bytes.length; i++) {
    hex += bytes[i].toString(16).padStart(2, "0")
  }
  return hex
}
