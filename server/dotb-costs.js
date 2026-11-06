// Recopie dans Dotb le prix d'achat Shein de chaque article vendu (PATCH orders/{order}/items/{item}, purchase_price).
// Dotb recalcule alors le bénéfice de la commande. Portée requise sur la clé : orders_write.
import {AppError} from './dotb.js'

const BASE = 'https://dotb.io/api/public/v1'
const check = error => { if (error) throw new AppError('Lecture des prix d’achat impossible. Réessaie.', 500) }

export const COST_MESSAGES = {
  scope: 'Ta clé API Dotb ne permet pas de modifier les commandes. Dans Dotb, ajoute la permission « orders_write » à la clé utilisée par le site.',
  auth: 'La clé API Dotb du site n’est plus valide.',
  plan: 'Ton offre Dotb ne donne pas accès à l’API.',
  limit: 'Limite Dotb atteinte : la suite des prix d’achat partira dans une minute.',
  offline: 'Dotb ne répond pas : les prix d’achat seront renvoyés plus tard.',
  setup: 'La mise à jour de la base pour les prix d’achat Dotb n’est pas encore appliquée.',
}

export async function patchPurchasePrice({order_id, dotb_item_id, cost}, {fetcher = fetch, token = process.env.DOTB_API_TOKEN} = {}) {
  if (!token) return {stop: 'auth'}
  let response
  try {
    response = await fetcher(`${BASE}/orders/${encodeURIComponent(order_id)}/items/${encodeURIComponent(dotb_item_id)}`, {
      method: 'PATCH', redirect: 'error', signal: AbortSignal.timeout(8000),
      headers: {Authorization: `Bearer ${token}`, Accept: 'application/json', 'Content-Type': 'application/json'},
      body: JSON.stringify({purchase_price: cost}),
    })
  } catch { return {stop: 'offline'} }
  if (response.ok) return {ok: true}
  if (response.status === 403) return {stop: 'scope'}
  if (response.status === 401) return {stop: 'auth'}
  if (response.status === 402) return {stop: 'plan'}
  if (response.status === 429) return {stop: 'limit'}
  if (response.status >= 500) return {stop: 'offline'}
  if (response.status === 404) return {error: 'Article introuvable dans la commande Dotb.'}
  return {error: `Dotb a refusé le prix (${response.status}).`}
}

// Envoie au plus `limit` prix. S'arrête net sur un problème de clé, de limite ou de connexion.
export async function syncDotbCosts(db, {limit = 15, fetcher = fetch, token = process.env.DOTB_API_TOKEN} = {}) {
  const {data, error} = await db.rpc('pending_dotb_costs', {p_limit: limit})
  if (error && (error.code === 'PGRST202' || error.code === '42883')) return {sent: 0, failed: 0, pending: 0, errors: 0, stop: 'setup', message: COST_MESSAGES.setup}
  check(error)
  let sent = 0, failed = 0, stop = null
  for (const row of data || []) {
    const result = await patchPurchasePrice(row, {fetcher, token})
    if (result.stop) { stop = result.stop; break }
    const saved = await db.rpc('record_dotb_cost', {p_id: row.id, p_cost: row.cost, p_error: result.ok ? null : result.error}); check(saved.error)
    if (result.ok) sent++; else failed++
  }
  const {data: counts, error: countError} = await db.rpc('count_pending_dotb_costs'); check(countError)
  const pending = counts?.[0]?.pending ?? 0
  return {sent, failed, pending, errors: counts?.[0]?.failed ?? 0, stop, message: stop ? COST_MESSAGES[stop] : null}
}
