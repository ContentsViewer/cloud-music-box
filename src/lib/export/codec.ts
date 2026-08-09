/**
 * Byte-level encoding for the export file: base64 codecs (vectors are Float32
 * little-endian for a bit-exact round trip), whole-file gzip via
 * CompressionStream (with an uncompressed fallback), magic-byte sniffing on
 * read, and chunked JSON serialization that never builds one giant string on
 * the main thread.
 */

import { ExportEnvelope } from "./schema"

export function bytesToBase64(bytes: Uint8Array): string {
  let binary = ""
  const CHUNK = 0x8000
  for (let i = 0; i < bytes.length; i += CHUNK) {
    const slice = bytes.subarray(i, i + CHUNK)
    binary += String.fromCharCode.apply(
      null,
      slice as unknown as number[]
    )
  }
  return btoa(binary)
}

export function base64ToBytes(b64: string): Uint8Array {
  const binary = atob(b64)
  const bytes = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i)
  return bytes
}

/** Little-endian explicitly — the codec, not the platform, owns endianness. */
export function float32ToBase64(vector: Float32Array): string {
  const buf = new ArrayBuffer(vector.length * 4)
  const view = new DataView(buf)
  for (let i = 0; i < vector.length; i++) view.setFloat32(i * 4, vector[i], true)
  return bytesToBase64(new Uint8Array(buf))
}

export function base64ToFloat32(b64: string): Float32Array {
  const bytes = base64ToBytes(b64)
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  const out = new Float32Array(Math.floor(bytes.byteLength / 4))
  for (let i = 0; i < out.length; i++) out[i] = view.getFloat32(i * 4, true)
  return out
}

/** Uses FileReader's native base64 encoder instead of a JS binary string. */
export function blobToBase64(blob: Blob): Promise<string> {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => {
      const dataUrl = reader.result as string
      resolve(dataUrl.slice(dataUrl.indexOf(",") + 1))
    }
    reader.onerror = () => reject(reader.error)
    reader.readAsDataURL(blob)
  })
}

export function base64ToBlob(b64: string, mime: string): Blob {
  return new Blob([base64ToBytes(b64)], { type: mime })
}

const yieldToUi = () => new Promise<void>(resolve => setTimeout(resolve, 0))

/**
 * Serializes the envelope into a Blob from many small JSON parts. A single
 * JSON.stringify of a tens-of-MB document blocks the main thread for hundreds
 * of ms; stringifying a few hundred records at a time and letting the Blob
 * constructor assemble the parts keeps every synchronous slice small.
 */
export async function envelopeToJsonBlob(
  envelope: ExportEnvelope
): Promise<Blob> {
  const CHUNK = 200
  const parts: string[] = []

  const { files, albums, playlists, trackFeatures, artworks, ...header } =
    envelope
  const headerJson = JSON.stringify(header)
  parts.push(headerJson.slice(0, -1)) // keep the object open: "{...header"

  const sections: Array<[string, unknown[]]> = [
    ["files", files],
    ["albums", albums],
    ["playlists", playlists],
    ["trackFeatures", trackFeatures],
    ["artworks", artworks],
  ]
  for (const [key, arr] of sections) {
    parts.push(`,${JSON.stringify(key)}:[`)
    for (let i = 0; i < arr.length; i += CHUNK) {
      const slice = arr
        .slice(i, i + CHUNK)
        .map(item => JSON.stringify(item))
        .join(",")
      parts.push(i === 0 ? slice : "," + slice)
      await yieldToUi()
    }
    parts.push("]")
  }
  parts.push("}")

  return new Blob(parts, { type: "application/json" })
}

/** Whole-file gzip; falls back to the uncompressed blob on old browsers. */
export async function compressJsonBlob(
  blob: Blob
): Promise<{ blob: Blob; gzipped: boolean }> {
  if (typeof CompressionStream === "undefined") {
    return { blob, gzipped: false }
  }
  const stream = blob.stream().pipeThrough(new CompressionStream("gzip"))
  const gz = await new Response(stream).blob()
  return { blob: new Blob([gz], { type: "application/gzip" }), gzipped: true }
}

/**
 * Reads an export file back to JSON text. Accepts both gzipped and plain
 * files by sniffing the gzip magic bytes (0x1f 0x8b) — the extension is
 * irrelevant.
 */
export async function readExportFile(file: Blob): Promise<string> {
  const head = new Uint8Array(await file.slice(0, 2).arrayBuffer())
  if (head[0] === 0x1f && head[1] === 0x8b) {
    if (typeof DecompressionStream === "undefined") {
      throw new Error(
        "This browser cannot decompress the file. Try a current browser version."
      )
    }
    const stream = file.stream().pipeThrough(new DecompressionStream("gzip"))
    return new Response(stream).text()
  }
  return new Response(file).text()
}

export function triggerDownload(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob)
  const a = document.createElement("a")
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  a.remove()
  // Grace period: the click starts the save asynchronously (slower on mobile)
  setTimeout(() => URL.revokeObjectURL(url), 30_000)
}
