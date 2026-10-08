/**
 * Screenshot ingestion: any raster the OS hands us (paste or drag) is redrawn
 * through a canvas and re-encoded as PNG, so the bytes we send to the main
 * process are always a real PNG. Pictures arrive by paste or drag only.
 */

const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]

/** The eight-byte PNG magic number — the guard that backs "never write a broken shot". */
export function bufferLooksLikePng(bytes: Uint8Array): boolean {
  if (bytes.length < PNG_SIGNATURE.length) return false
  return PNG_SIGNATURE.every((b, i) => bytes[i] === b)
}

/**
 * Redraw a raster blob onto a canvas and return base64 PNG bytes (no `data:`
 * prefix), or null when the blob is not a decodable image. The canvas path
 * needs a DOM, so it is verified live rather than in vitest.
 */
export async function blobToPngBase64(blob: Blob): Promise<string | null> {
  try {
    const bitmap = await createImageBitmap(blob)
    if (bitmap.width === 0 || bitmap.height === 0) return null
    const canvas = document.createElement('canvas')
    canvas.width = bitmap.width
    canvas.height = bitmap.height
    const ctx = canvas.getContext('2d')
    if (!ctx) return null
    ctx.drawImage(bitmap, 0, 0)
    bitmap.close?.()
    const dataUrl = canvas.toDataURL('image/png')
    const comma = dataUrl.indexOf(',')
    if (comma < 0) return null
    const base64 = dataUrl.slice(comma + 1)
    const head = Uint8Array.from(atob(base64.slice(0, 12)), (c) => c.charCodeAt(0))
    return bufferLooksLikePng(head) ? base64 : null
  } catch {
    return null
  }
}

/** Pull the first image blob out of a paste/drag data transfer, if any. */
export function firstImageFile(items: DataTransferItemList | null): File | null {
  if (!items) return null
  for (const item of Array.from(items)) {
    if (item.kind === 'file' && item.type.startsWith('image/')) {
      const file = item.getAsFile()
      if (file) return file
    }
  }
  return null
}
