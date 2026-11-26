// Check PNG headers before decoding. An animated image must keep all its frames.
async function canEncode(file) {
  const head = new DataView(await file.slice(0, 33).arrayBuffer())
  if (head.byteLength < 33 || head.getUint32(0) !== 0x89504e47 ||
      head.getUint32(4) !== 0x0d0a1a0a || head.getUint32(12) !== 0x49484452) return false
  const pixels = head.getUint32(16) * head.getUint32(20)
  if (!pixels || pixels > 16000000) return false

  let offset = 33
  // Skip over metadata, including large provenance chunks, without reading their contents.
  for (let chunks = 0; chunks < 100 && offset + 12 <= file.size; chunks++) {
    const header = new DataView(await file.slice(offset, offset + 8).arrayBuffer())
    const type = header.getUint32(4)
    if (type === 0x6163544c) return false // acTL
    if (type === 0x49444154) return true // IDAT
    offset += 12 + header.getUint32(0)
  }
  return false
}

let pending = Promise.resolve()
async function encode(file) {
  let bitmap, canvas
  try {
    if (!await canEncode(file)) return file
    bitmap = await createImageBitmap(file)
    canvas = document.createElement('canvas')
    canvas.width = bitmap.width
    canvas.height = bitmap.height
    canvas.getContext('2d').drawImage(bitmap, 0, 0)
    const result = await new Promise(resolve => canvas.toBlob(resolve, 'image/webp', 0.94))
    return result?.type === 'image/webp' && result.size > 0 && result.size <= file.size * 0.8 ? result : file
  } catch {
    return file
  } finally {
    bitmap?.close()
    if (canvas) { canvas.width = 0; canvas.height = 0 }
  }
}

export function prepareListingPhoto(file) {
  if (file.type !== 'image/png' || file.size < 512 * 1024 || typeof createImageBitmap !== 'function') return Promise.resolve(file)
  // Bound decoded memory when several listings are queued. Uploads still run in parallel.
  const next = pending.then(() => encode(file))
  pending = next.then(() => {}, () => {})
  return next
}
