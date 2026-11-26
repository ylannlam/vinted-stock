import {ASSET_BUCKET, MAX_ASSET_BYTES, ownedAsset} from './resources.js'
import {makeThumbnail} from './resource-thumbnails.js'

const previewPath = path => 'listing-thumbs/v1/' + path + '.webp'
const cache = new Map()
const creating = new Map()

function remember(path, entry) {
  cache.delete(path)
  cache.set(path, entry)
  if (cache.size > 1500) cache.delete(cache.keys().next().value)
}

async function createPreview(bucket, path) {
  const file = await bucket.download(path)
  if (file.error || !file.data || file.data.size > MAX_ASSET_BYTES) return
  const bytes = await makeThumbnail(await file.data.arrayBuffer(), 384)
  const key = previewPath(path)
  const upload = await bucket.upload(key, bytes, {contentType:'image/webp', cacheControl:'31536000', upsert:false})
  if (upload.error && !/exist|duplicate/i.test(upload.error.message || '') && String(upload.error.statusCode) !== '409') return
  const signed = await bucket.createSignedUrl(key, 1800)
  return signed.data?.signedUrl
}

// Source paths are immutable and owner-scoped. Reuse signed URLs across polling reads.
export async function listingCovers(db, owner, paths) {
  const unique = [...new Set(paths.filter(path => ownedAsset(path, owner)))]
  const result = new Map()
  if (!unique.length) return result
  const now = Date.now()
  const bucket = db.storage.from(ASSET_BUCKET)
  const missing = []
  for (const path of unique) {
    const entry = cache.get(path)
    if (entry?.expires > now) result.set(path, entry)
    else missing.push(path)
  }
  for (let start = 0; start < missing.length; start += 64) {
    const paths = missing.slice(start, start + 64)
    const signed = await bucket.createSignedUrls([...paths, ...paths.map(previewPath)], 1800)
    if (signed.error) throw signed.error
    const links = new Map((signed.data || []).map(row => [row.path, row.signedUrl]))
    for (const path of paths) {
      const original = links.get(path)
      if (!original) continue
      const entry = {original, preview:links.get(previewPath(path)), expires:now + 20 * 60000}
      result.set(path, entry)
      remember(path, entry)
    }
  }
  // Progressively fill older listings without decoding an entire account on first visit.
  const pending = [...result].filter(([, entry]) => !entry.preview && !(entry.retryAfter > now)).slice(0, 2)
  await Promise.all(pending.map(async ([path, entry]) => {
    if (!creating.has(path)) {
      creating.set(path, createPreview(bucket, path).catch(() => null).finally(() => creating.delete(path)))
    }
    entry.preview = await creating.get(path)
    if (!entry.preview) entry.retryAfter = Date.now() + 60000
  }))
  return result
}
