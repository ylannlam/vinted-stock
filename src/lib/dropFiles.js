// Photos déposées ou collées sur la page : fichiers de l'ordinateur, image glissée depuis une autre page web,
// ou image copiée (clic droit › Copier l'image) puis collée avec Ctrl+V. Rien n'est à télécharger avant.

const IMAGE_TYPES = ['image/jpeg', 'image/png', 'image/webp']
const EXTENSIONS = {'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp'}

// Lecture synchrone : le navigateur vide le DataTransfer dès que l'évènement est terminé.
export function readTransfer(transfer) {
  const files = Array.from(transfer?.files || [])
  if (!files.length) for (const item of Array.from(transfer?.items || [])) {
    if (item.kind === 'file') { const file = item.getAsFile?.(); if (file) files.push(file) }
  }
  const urls = []
  if (!files.length) {
    const list = String(transfer?.getData?.('text/uri-list') || '')
    for (const line of list.split(/\r?\n/)) if (/^(https?:|data:image\/)/i.test(line.trim())) urls.push(line.trim())
    const html = String(transfer?.getData?.('text/html') || '')
    for (const m of html.matchAll(/<img[^>]+src=["']([^"']+)["']/gi)) if (/^(https?:|data:image\/)/i.test(m[1])) urls.push(m[1].replace(/&amp;/g, '&'))
  }
  return {files: files.filter(isImage), urls: [...new Set(urls)].slice(0, 1)}
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
export async function fetchImage(url, fetcher = fetch) {
  const response = await fetcher(url)
  if (!response.ok) throw new Error(`HTTP ${response.status}`)
  const blob = await response.blob()
  const type = IMAGE_TYPES.includes(blob.type) ? blob.type : ''
  if (!type) throw new Error('Format non pris en charge')
  return new File([blob], fileName(url, type), {type})
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
  try { return [await fetchImage(urls[0], fetcher)] } catch { throw new Error(BLOCKED_MESSAGE) }
}

// Images d'un collage (Ctrl+V). Vide si le presse-papiers ne contient pas d'image.
export function filesFromClipboard(clipboard) {
  const files = Array.from(clipboard?.files || [])
  if (!files.length) for (const item of Array.from(clipboard?.items || [])) {
    if (item.kind === 'file' && String(item.type).startsWith('image/')) { const file = item.getAsFile?.(); if (file) files.push(file) }
  }
  return files.filter(isImage).map((file, i) => file.name && file.name !== 'image.png' ? file : new File([file], `collage-${Date.now()}-${i + 1}.${EXTENSIONS[file.type] || 'png'}`, {type: file.type}))
}
