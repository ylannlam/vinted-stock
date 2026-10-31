import { safeUrl } from '../src/lib/fulfillment.js'

export class AppError extends Error {
  constructor(message, status = 400) { super(message); this.status = status }
}
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
export const isId = value => typeof value === 'string' && uuid.test(value)
const str = (value, max = 500) => typeof value === 'string' ? value.slice(0, max) : null
const date = value => typeof value === 'string' && Number.isFinite(Date.parse(value)) ? new Date(value).toISOString() : null

export function normalizeOrders(data, now = new Date().toISOString()) {
  if (!Array.isArray(data)) throw new AppError('Réponse Dotb inattendue. Aucune page importée.', 502)
  const orders = [], lines = [], orderIds = new Set(), lineIds = new Set()
  for (const order of data) {
    if (!isId(order.id) || !Array.isArray(order.items) || orderIds.has(order.id)) throw new AppError('Commande Dotb incomplète. Import interrompu sans avancer la synchronisation.', 502)
    orderIds.add(order.id)
    orders.push({ id: order.id, account_id: str(order.account?.id), account_login: str(order.account?.login),
      status: str(order.normalized_status), order_date: date(order.order_date), deadline: date(order.shipping_deadline_date),
      currency: /^[A-Z]{3}$/.test(order.currency ?? '') ? order.currency : null,
      label_url: safeUrl(order.shipping_label_url), tracking_code: str(order.tracking_code),
      transaction_id: order.vinted_transaction_id == null ? null : String(order.vinted_transaction_id), synced_at: now })
    for (const item of order.items) {
      const id = `${order.id}:${item.id}`
      if (!isId(item.id) || lineIds.has(id)) throw new AppError('Article Dotb invalide ou dupliqué. Import interrompu.', 502)
      lineIds.add(id)
      // Only necessary product metadata is retained; no buyer address/email or raw response.
      lines.push({ id, order_id: order.id, dotb_item_id: item.id, source: {
        title: str(item.title), sku: str(item.sku, 200), supplier_link: safeUrl(item.supplier_link),
        dotb_listing_id: isId(item.vinted_item_id) ? item.vinted_item_id : null,
        thumbnail_url: safeUrl(item.thumbnail_url), selling_price: decimal(item.selling_price),
        purchase_price: decimal(item.purchase_price), location: str(item.location, 100),
      } })
    }
  }
  return { orders, lines }
}
function decimal(value) {
  if (value == null || value === '') return null
  const number = Number(value)
  return Number.isFinite(number) && number >= 0 ? number.toFixed(2) : null
}

export async function readDotbPage(cursor, fetcher = fetch, token = process.env.DOTB_API_TOKEN, from = null) {
  if (!token) throw new AppError('La connexion Dotb reste à activer par l’administrateur.', 503)
  const url = new URL('https://dotb.io/api/public/v1/orders')
  url.search = new URLSearchParams({ include: 'items,account', limit: '100', sort: 'order_date', ...(from ? {from} : {}), ...(cursor ? { cursor } : {}) })
  let response
  try { response = await fetcher(url, { headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' }, signal: AbortSignal.timeout(12000), redirect: 'error' }) }
  catch { throw new AppError('Dotb ne répond pas. Réessayez ; la progression est conservée.', 504) }
  if (!response.ok) {
    const errors = { 401: 'La clé Dotb doit être vérifiée dans les réglages du serveur.', 402: 'Dotb demande une offre donnant accès à l’API.', 403: 'La clé Dotb ne permet pas de lire les commandes.', 429: 'Limite Dotb atteinte. Réessayez plus tard ; la progression est conservée.' }
    throw new AppError(errors[response.status] || 'Dotb est indisponible. La progression est conservée.', response.status === 429 ? 429 : 502)
  }
  const result = await response.json().catch(() => null)
  if (!result || !Array.isArray(result.data) || typeof result.has_more !== 'boolean' ||
    (result.has_more && (typeof result.next_cursor !== 'string' || !result.next_cursor || result.next_cursor === cursor || !result.data.length))) {
    throw new AppError('Pagination Dotb inattendue. Import arrêté pour éviter les doublons.', 502)
  }
  return result
}

export function validateEdit(body) {
  if (!body || typeof body !== 'object' || typeof body.id !== 'string' || body.id.length > 80 || !date(body.updated_at)) throw new AppError('Article ou version manquante.')
  const text = (value, max, label) => {
    if (value == null) return null
    if (typeof value !== 'string' || value.length > max) throw new AppError(`${label} invalide.`)
    return value.trim() || null
  }
  const edit = {
    sku_override: text(body.sku, 200, 'SKU'), supplier_order_ref: text(body.supplier_order_ref, 200, 'Référence de commande'),
    supplier_tracking: text(body.supplier_tracking, 200, 'Suivi fournisseur'), location: text(body.location, 100, 'Emplacement'),
    notes: text(body.notes, 1000, 'Note'), actual_cost: null,
  }
  if (body.actual_cost != null && body.actual_cost !== '') {
    if (!/^(\d{1,7})(\.\d{1,2})?$/.test(String(body.actual_cost))) throw new AppError('Le coût doit être positif, avec deux décimales maximum.')
    edit.actual_cost = String(body.actual_cost)
  }
  const supplier = text(body.supplier_url, 2000, 'Lien fournisseur')
  if (supplier && !safeUrl(supplier)) throw new AppError('Le lien fournisseur doit être une adresse HTTPS valide.')
  if (supplier && !edit.sku_override) throw new AppError('Ajoutez un SKU pour enregistrer la référence fournisseur.')
  return { edit, product: supplier ? { sku: edit.sku_override, supplier_url: safeUrl(supplier), variant: text(body.variant, 200, 'Variante') } : null }
}
