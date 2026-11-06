// Colis Shein relevés par l'extension (page commande + page « Suivre ») rattachés aux ventes.
const fail = error => { if (error) throw error }
const low = value => String(value || '').toLowerCase()

export function parcelSummary(p, ref) {
  if (!p) return null
  const steps = Array.isArray(p.steps) ? p.steps : []
  const last = Array.isArray(p.events) ? p.events[0] : null
  return {tracking_number: p.tracking_number, carrier: p.carrier || '', status_text: p.status_text || '', delivered: p.delivered === true,
    eta: p.eta || '', track_url: p.track_url || null, order_ref: ref, observed_at: p.observed_at || null,
    steps_done: steps.filter(s => s.done).length, steps_total: steps.length,
    last_event: last ? {at: last.at, place: last.place || '', text: last.text} : null}
}

// Le colis d'un article : celui qui liste son SKU, ou le seul colis de la commande quand Shein ne détaille pas.
export function parcelFor(order, sku) {
  const parcels = Array.isArray(order?.shipment_observations) ? order.shipment_observations : []
  const exact = parcels.filter(p => (p.skus || []).some(s => low(s) === low(sku)))
  if (exact.length === 1) return exact[0]
  if (exact.length > 1) return [...exact].sort((a, b) => String(b.last_event_at || b.observed_at || '').localeCompare(String(a.last_event_at || a.observed_at || '')))[0]
  return parcels.length === 1 && !(parcels[0].skus || []).length ? parcels[0] : null
}

export async function attachParcels(db, lines) {
  const ids = (lines || []).map(l => l.id).filter(Boolean)
  if (!ids.length) return lines
  const links = await db.from('shein_order_links').select('line_id,item_id').in('line_id', ids); fail(links.error)
  const itemIds = [...new Set((links.data || []).map(l => l.item_id))]
  const items = itemIds.length ? await db.from('shein_order_items').select('id,order_ref,sku').in('id', itemIds) : {data: []}; fail(items.error)
  const refs = [...new Set([...(items.data || []).map(i => i.order_ref), ...lines.map(l => l.supplier_order_ref).filter(r => /^G[A-Z0-9]{7,39}$/.test(r || ''))])]
  const orders = refs.length ? await db.from('shein_orders').select('ref,shipment_observations').in('ref', refs) : {data: []}; fail(orders.error)
  const byRef = new Map((orders.data || []).map(o => [o.ref, o])), itemById = new Map((items.data || []).map(i => [i.id, i]))
  const linkByLine = new Map((links.data || []).map(l => [l.line_id, itemById.get(l.item_id)]))
  return lines.map(line => {
    const item = linkByLine.get(line.id)
    const ref = item?.order_ref || line.supplier_order_ref, sku = item?.sku || line.resolved_sku || line.sku_override || line.source?.sku
    const parcel = ref && sku ? parcelFor(byRef.get(ref), sku) : null
    return parcel ? {...line, parcel: parcelSummary(parcel, ref)} : line
  })
}

// Tableau des colis : commandes récentes avec un numéro de suivi, leurs articles et les ventes qu'ils servent.
export async function readParcelBoard(db, {days = 60, now = Date.now()} = {}) {
  const since = new Date(now - days * 86400000).toISOString().slice(0, 10)
  const orders = await db.from('shein_orders').select('ref,order_date,shipment_observations,shein_order_items(id,sku,title,size,color,photo,status,quantity,present)')
    .gte('order_date', since).neq('shipment_observations', '[]').order('order_date', {ascending: false}).limit(200); fail(orders.error)
  const itemIds = (orders.data || []).flatMap(o => o.shein_order_items.map(i => i.id))
  const links = itemIds.length ? await db.from('shein_order_links').select('line_id,item_id').in('item_id', itemIds) : {data: []}; fail(links.error)
  const lineIds = [...new Set((links.data || []).map(l => l.line_id))]
  const sales = lineIds.length ? await db.from('workspace_sales').select('id,stage,order,source,supplier_size').in('id', lineIds) : {data: []}; fail(sales.error)
  const saleById = new Map((sales.data || []).map(s => [s.id, {id: s.id, stage: s.stage, account: s.order?.account_login || '', title: s.source?.title || '', status: s.order?.status || ''}]))
  const parcels = []
  for (const order of orders.data || []) {
    const items = order.shein_order_items.filter(i => i.present)
    for (const p of order.shipment_observations || []) {
      const mine = items.filter(i => parcelFor({shipment_observations: order.shipment_observations}, i.sku) === p)
      parcels.push({...parcelSummary(p, order.ref), order_date: order.order_date, steps: Array.isArray(p.steps) ? p.steps : [], events: Array.isArray(p.events) ? p.events.slice(0, 40) : [],
        last_event_at: p.last_event_at || null,
        items: mine.map(i => ({id: i.id, sku: i.sku, title: i.title, size: i.size, color: i.color, photo: i.photo, quantity: i.quantity, status: i.status,
          sales: (links.data || []).filter(l => l.item_id === i.id).map(l => saleById.get(l.line_id)).filter(Boolean)}))})
    }
  }
  const rank = p => p.delivered ? 2 : /livraison/i.test(p.status_text) ? 0 : 1
  parcels.sort((a, b) => rank(a) - rank(b) || String(b.last_event_at || b.observed_at || '').localeCompare(String(a.last_event_at || a.observed_at || '')))
  return {parcels, since}
}
