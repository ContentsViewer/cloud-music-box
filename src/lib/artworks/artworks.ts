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
   * @deprecated Read-only legacy field (pre-v4 records). The color now lives
   * in the `artworks-meta` store so that `artworks` records stay write-once
   * after creation — rewriting a record that carries a displayed blob may
   * orphan the blob file backing a live object URL (the pre-v3 "covers vanish
   * during downloads" bug class). Never write this field.
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
