export const STAGES = [
  { id: 'to_order', label: 'À commander', action: 'Commande passée' },
  { id: 'ordered', label: 'Commandé', action: 'Colis en transit' },
  { id: 'in_transit', label: 'En transit', action: 'Article reçu' },
  { id: 'received', label: 'Reçu', action: 'Colis préparé' },
  { id: 'prepared', label: 'À expédier', action: 'Colis déposé' },
  { id: 'shipped', label: 'Expédié' },
]
export const BLOCKED = ['cancelled', 'returning', 'suspended']
export const REMOTE_SHIPPED = ['shipped', 'ready_for_pickup', 'delivered', 'completed']
export const ORDER_LABELS = { payment_received: 'Payé', label_ordering: 'Bordereau en cours', label_failed: 'Bordereau en erreur', label_sent: 'Bordereau prêt', packed: 'Préparé sur Dotb', shipped: 'Expédié sur Vinted', ready_for_pickup: 'Au point relais', delivered: 'Livré', completed: 'Terminé', cancelled: 'Annulé', returning: 'Retour', suspended: 'Suspendu' }
export function safeUrl(value) {
  if (typeof value !== 'string' || !value.trim()) return null
  try { const url = new URL(value); return url.protocol === 'https:' && !url.username && !url.password ? url.href : null } catch { return null }
}
export function money(value, currency = 'EUR') {
  if (value == null || value === '' || !Number.isFinite(Number(value))) return '—'
  try { return new Intl.NumberFormat('fr-FR', { style: 'currency', currency }).format(Number(value)) } catch { return `${Number(value).toFixed(2)} ${currency || ''}` }
}
export function skuOf(line) { return (line.sku_override ?? line.source?.sku ?? '').trim() }
export function productOf(line, catalog = []) { return catalog.find(p => p.sku === skuOf(line)) }
export function supplierOf(line, catalog = []) { return safeUrl(productOf(line, catalog)?.supplier_url || line.source?.supplier_link) }
export function stageOf(line) { return REMOTE_SHIPPED.includes(line.order?.status) ? 'shipped' : line.stage }
export function blocked(line) { return BLOCKED.includes(line.order?.status) || !line.order?.status }
export function needsReference(line, catalog) { return !skuOf(line) || !supplierOf(line, catalog) }
export function nextStage(line) { return STAGES[STAGES.findIndex(s => s.id === stageOf(line)) + 1]?.id }
export function deadline(line, now = Date.now()) {
  if (blocked(line) || stageOf(line) === 'shipped' || !line.order?.deadline) return null
  const at = Date.parse(line.order.deadline)
  if (!Number.isFinite(at)) return null
  const hours = (at - now) / 3600000
  return { urgent: hours < 48, overdue: hours < 0, text: hours < 0 ? 'Échéance dépassée' : hours < 24 ? `Dans ${Math.max(1, Math.ceil(hours))} h` : `Dans ${Math.ceil(hours / 24)} j` }
}
export function bestSellers(lines) {
  const groups = new Map()
  for (const line of lines) {
    const sku = skuOf(line), currency = line.order?.currency
    if (!sku || blocked(line) || !currency) continue
    const key = `${sku}\u0000${currency}`
    const group = groups.get(key) || { sku, currency, title: line.source?.title || sku, quantity: 0, revenue: 0, knownPrices: 0 }
    group.quantity++
    const price = line.source?.selling_price
    if (price != null && price !== '' && Number.isFinite(Number(price))) { group.revenue += Number(price); group.knownPrices++ }
    groups.set(key, group)
  }
  return [...groups.values()].sort((a, b) => b.quantity - a.quantity || a.sku.localeCompare(b.sku))
}
