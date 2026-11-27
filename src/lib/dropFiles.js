// Photos déposées ou collées sur la page : fichiers de l'ordinateur, image glissée depuis une autre page web,
// ou image copiée (clic droit › Copier l'image) puis collée avec Ctrl+V. Rien n'est à télécharger avant.

import {MAX_LISTING_PHOTO_BYTES} from './listingStudio.js'

const IMAGE_TYPES = ['image/jpeg', 'image/png', 'image/webp']
const EXTENSIONS = {'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp'}
const imageAddress = /^(?:https?:\/\/|blob:|data:image\/)/i

// Lecture synchrone : le navigateur vide le DataTransfer dès que l'évènement est terminé.
export function readTransfer(transfer) {
  const files = Array.from(transfer?.files || []).filter(isImage)
  if (!files.length) for (const item of Array.from(transfer?.items || [])) {
    if (item.kind === 'file') { const file = item.getAsFile?.(); if (isImage(file)) files.push(file) }
  }
  if (files.length) return {files, urls: []}
  const get = type => String(transfer?.getData?.(type) || '').trim()
  const list = get('text/uri-list').split(/\r?\n/).map(s => s.trim()).filter(s => imageAddress.test(s))
  const images = Array.from(get('text/html').matchAll(/<img\b[^>]*?\ssrc=["']([^"']+)["']/gi),
    m => m[1].replace(/&amp;/g, '&')).filter(s => imageAddress.test(s))
  const download = get('DownloadURL').match(/^image\/[^:]+:[^:]*:((?:https?:\/\/|blob:|data:image\/).+)$/i)?.[1]
  const plain = get('text/plain')
  const candidates = [...list, ...images, download, /^(?:blob:|data:image\/)/i.test(plain) && plain].filter(Boolean)
  let urls
  if (images.length > 1) urls = images
  else if (list.length > 1) urls = list
  else {
    const direct = s => s && !/^blob:/i.test(s)
    // A linked image may carry the page address in uri-list as well as the actual image in HTML.
    const samePath = images[0] && list[0]?.split(/[?#]/)[0] === images[0].split(/[?#]/)[0]
    const embedded = candidates.find(s => /^data:image\//i.test(s))
    const best = [embedded, download, samePath && list[0], images[0], ...candidates].find(direct) || candidates[0]
    urls = best ? [best] : []
  }
  return {files, urls: [...new Set(urls)]}
}

export const isImage = file => !!file && String(file.type).startsWith('image/')
export const hasTransferImage = transfer => {
  const types = Array.from(transfer?.types || [])
  return types.includes('Files') || types.includes('text/uri-list')
}

export function fileName(url, type) {
  let base = 'photo'
  if (!/^data:/i.test(url)) try { base = decodeURIComponent(new URL(url).pathname.split('/').filter(Boolean).pop() || 'photo') } catch { /* adresse illisible */ }
  base = base.replace(/[^\w.-]+/g, '-').replace(/\.[a-z0-9]{2,5}$/i, '').slice(0, 60) || 'photo'
  return `${base}.${EXTENSIONS[type] || 'jpg'}`
}

// Récupère l'image d'une adresse web (une image glissée depuis un autre site). Certains sites l'interdisent.
export async function fetchImage(url, fetcher = fetch, signal) {
  const controller = new AbortController()
  const abort = () => controller.abort()
  if (signal?.aborted) abort()
  signal?.addEventListener('abort', abort, {once:true})
  const timer = setTimeout(abort, 15000)
  const tooLarge = 'Cette photo dépasse 8 Mo. Choisis une version plus légère.'
  try {
    if (/^blob:/i.test(url) && globalThis.location && new URL(url).origin !== location.origin) throw Error(BLOCKED_MESSAGE)
    if (/^data:image\/[^,]+;base64,/i.test(url) && url.length > Math.ceil(MAX_LISTING_PHOTO_BYTES / 3) * 4 + 128) throw Error(tooLarge)
    const response = await fetcher(url, {signal:controller.signal})
    if (!response.ok) throw Error(BLOCKED_MESSAGE)
    if (Number(response.headers?.get('content-length')) > MAX_LISTING_PHOTO_BYTES) throw Error(tooLarge)
    const type = response.headers?.get('content-type')?.split(';')[0].trim().toLowerCase()
    if (type && !IMAGE_TYPES.includes(type)) throw Error(BLOCKED_MESSAGE)
    let blob
    if (response.body?.getReader) {
      const reader = response.body.getReader(), parts = []
      let size = 0
      while (true) {
        const {value,done} = await reader.read()
        if (done) break
        size += value.byteLength
        if (size > MAX_LISTING_PHOTO_BYTES) throw Error(tooLarge)
        parts.push(value)
      }
      blob = new Blob(parts, {type})
    } else blob = await response.blob()
    if (blob.size > MAX_LISTING_PHOTO_BYTES) throw Error(tooLarge)
    if (!blob.size || !IMAGE_TYPES.includes(blob.type)) throw Error(BLOCKED_MESSAGE)
    return new File([blob], fileName(url, blob.type), {type:blob.type})
  } catch (error) {
    if (controller.signal.aborted) throw Error('Import interrompu. Tu peux réessayer ou coller l’image avec Ctrl+V.')
    throw Error(error.message === tooLarge ? tooLarge : BLOCKED_MESSAGE)
  } finally {
    clearTimeout(timer)
    signal?.removeEventListener('abort', abort)
    abort()
  }
}

export const BLOCKED_MESSAGE = 'Ce site ne laisse pas récupérer l’image en la glissant. Fais un clic droit sur l’image › Copier l’image, puis colle-la ici avec Ctrl+V.'

// Tout ce qui est déposé, en fichiers prêts à envoyer. Erreur claire quand l'image ne peut pas être récupérée.
export async function filesFromTransfer(transfer, fetcher = fetch) {
  const {files, urls} = readTransfer(transfer)
  return resolveTransfer({files, urls}, fetcher)
}
export async function resolveTransfer({files, urls}, fetcher = fetch) {
  if (files.length) return files
  if (!urls.length) throw new Error('Aucune photo reconnue. Glisse des photos JPG, PNG ou WebP.')
  const photos = []
  for (const url of urls) photos.push(await fetchImage(url, fetcher))
  return photos
}

// Images d'un collage (Ctrl+V). Vide si le presse-papiers ne contient pas d'image.
export function filesFromClipboard(clipboard) {
  const files = Array.from(clipboard?.files || [])
  if (!files.length) for (const item of Array.from(clipboard?.items || [])) {
    if (item.kind === 'file' && String(item.type).startsWith('image/')) { const file = item.getAsFile?.(); if (file) files.push(file) }
  }
  return files.filter(isImage).map((file, i) => file.name && file.name !== 'image.png' ? file : new File([file], `collage-${Date.now()}-${i + 1}.${EXTENSIONS[file.type] || 'png'}`, {type: file.type}))
}
