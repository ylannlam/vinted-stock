import { AppError, isId } from './dotb.js'
import { sheinProduct, parsePrice, supplierLink } from '../src/lib/catalog.js'
import { safeUrl } from '../src/lib/fulfillment.js'

const text = (value, max, label) => {
  if (value == null) return ''
  if (typeof value !== 'string' || value.length > max) throw new AppError(`${label} invalide.`)
  return value.trim()
}
export function validateObservation(body, now = Date.now()) {
  if (!body || typeof body !== 'object' || body.confirmed !== true) throw new AppError('Vérifiez le prix et la variante avant d’enregistrer.')
  const product = sheinProduct(body.supplier_url)
  if (!product) throw new AppError('Ouvrez une fiche produit sur fr.shein.com ou www.shein.com, puis copiez son lien complet.')
  const title = text(body.title, 500, 'Nom du produit')
  if (!title) throw new AppError('Ajoutez le nom du produit.')
  if (!isId(body.capture_id)) throw new AppError('Le relevé a expiré. Rouvrez le formulaire.')
  const price = parsePrice(body.price)
  if (Number.isNaN(price)) throw new AppError('Saisissez un prix supérieur à zéro, avec deux décimales maximum, ou laissez-le vide.')
  if (body.currency !== 'EUR') throw new AppError('Cette première version suit les prix en euros. Vérifiez la devise sur Shein.')
  if (!['unknown','available','unavailable'].includes(body.availability)) throw new AppError('Disponibilité invalide.')
  const size = text(body.size, 80, 'Taille'), color = text(body.color, 100, 'Couleur')
  if (body.availability !== 'unknown' && (!size || !color)) throw new AppError('Précisez la taille et la couleur pour confirmer leur disponibilité.')
  const photo = text(body.photo_url, 2000, 'Photo')
  if (photo && !safeUrl(photo)) throw new AppError('La photo doit utiliser une adresse HTTPS.')
  const at = Date.parse(body.observed_at)
  if (!Number.isFinite(at) || at > now + 60000 || at < now - 86400000) throw new AppError('Ce relevé a plus de 24 heures. Vérifiez à nouveau la fiche Shein.')
  return {
    product: { ...product, title, supplier_sku: text(body.supplier_sku, 200, 'Référence Shein') || null, photo_url: photo || null },
    observation: { id: body.capture_id, price, currency: 'EUR', size, color, availability: body.availability,
      source: body.source === 'extension_reviewed' ? 'extension_reviewed' : 'manual',
      observed_at: new Date(at).toISOString(), note: text(body.note, 500, 'Note') || null },
  }
}

export function normalizeDotbItems(data, now = new Date().toISOString()) {
  if (!Array.isArray(data)) throw new AppError('Réponse Dotb inattendue.', 502)
  const ids = new Set()
  return data.map(item => {
    if (!isId(item.id) || ids.has(item.id)) throw new AppError('Article Dotb incomplet ou dupliqué.', 502)
    ids.add(item.id)
    const trim = (value, max) => typeof value === 'string' ? value.slice(0, max) : null
    const link=supplierLink(item.supplier_link),supplier=link.product
    if (typeof item.sku==='string' && item.sku.trim().length>200) throw new AppError('Un SKU Dotb dépasse 200 caractères.',502)
    return { id: item.id, sku: typeof item.sku==='string' ? item.sku.trim() || null : null, title: trim(item.title, 500),
      account_id: isId(item.vinted_account_id) ? item.vinted_account_id : null,
      status: trim(item.status, 50), supplier_url: link.url, supplier_link_status:link.status,
      supplier_id: supplier?.supplier_id || null, supplier_canonical_url: supplier?.supplier_url || null,
      price: item.price != null && String(item.price).trim() && Number.isFinite(Number(item.price)) && Number(item.price) >= 0 && Number(item.price)<1e10 ? String(item.price) : null,
      currency: /^[A-Z]{3}$/.test(item.currency || '') ? item.currency : null,
      photo_url: safeUrl(item.photos?.[0]?.url), synced_at: now }
  })
}

export function validateSupplierAssociation(body) {
  if(typeof body.sku!=='string'||!body.sku.trim()||body.sku.trim().length>200||
    (body.updated_at!==null && !Number.isFinite(Date.parse(body.updated_at))))throw new AppError('SKU ou association invalide.')
  const product=supplierLink(body.supplier_url).product
  if(!product)throw new AppError('Collez le lien complet d’une fiche produit Shein, après avoir ouvert le résultat de recherche.')
  return {...product,sku:body.sku.trim()}
}

// A list entry may omit the supplier field. Consult the item's detail before giving up.
// Bounded lookups keep the page inside the sync lease and Dotb's request allowance.
export async function recoverDotbSupplierLinks(data,{fetcher=fetch,token=process.env.DOTB_API_TOKEN,sleep=ms=>new Promise(r=>setTimeout(r,ms))}={}) {
  const result=data.map(item=>({...item}));let checked=0
  for(const item of result) {
    if(!isId(item.id)||typeof item.sku!=='string'||!item.sku.trim()||supplierLink(item.supplier_link).url||checked>=5)continue
    checked++;await sleep(1100)
    try {
      const response=await fetcher(`https://dotb.io/api/public/v1/items/${item.id}`,{headers:{Authorization:`Bearer ${token}`,Accept:'application/json'},signal:AbortSignal.timeout(3000),redirect:'error'})
      if([401,402,429].includes(response.status))break
      if(!response.ok)continue
      const detail=await response.json()
      if(detail?.id!==item.id || (detail.sku||'').trim()!==item.sku.trim())continue
      if(supplierLink(detail.supplier_link).url)item.supplier_link=detail.supplier_link
    } catch { /* Preserve the list entry; missing links remain visible and repairable. */ }
  }
  return result
}

export async function readDotbItems(cursor, fetcher = fetch, token = process.env.DOTB_API_TOKEN) {
  if (!token) throw new AppError('La connexion Dotb reste à configurer.', 503)
  const url = new URL('https://dotb.io/api/public/v1/items')
  url.search = new URLSearchParams({ status: 'all', limit: '100', ...(cursor ? { cursor } : {}) })
  let response
  try { response = await fetcher(url, { headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' }, signal: AbortSignal.timeout(15000), redirect: 'error' }) }
  catch { throw new AppError('Dotb ne répond pas. La progression est conservée.', 504) }
  if (!response.ok) throw new AppError(response.status === 429 ? 'Limite Dotb atteinte. Reprenez l’import plus tard.' : 'Dotb a refusé la lecture des articles. Vérifiez l’accès de votre clé aux articles.', response.status === 429 ? 429 : 502)
  const page = await response.json().catch(() => null)
  if (!page || !Array.isArray(page.data) || typeof page.has_more !== 'boolean' ||
      (page.has_more && (!page.data.length || typeof page.next_cursor !== 'string' || !page.next_cursor || page.next_cursor === cursor))) throw new AppError('Pagination Dotb inattendue. Import interrompu.', 502)
  return page
}
