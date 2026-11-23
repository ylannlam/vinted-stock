const base = 'https://app.scalencyai.com/api/pub/public_api/v1/'
export const collections = ['accounts','items','orders','jobs','conversations']
export class ScalencyError extends Error {
  constructor(message, status = 400) { super(message); this.status = status }
}
export function remoteId(value) {
  const id = String(value ?? '')
  if (!/^[A-Za-z0-9_-]{1,150}$/.test(id)) throw new ScalencyError('Identifiant invalide.')
  return id
}
export async function remote(path, {method='GET', body, query={}, pdf=false, fetcher=fetch,timeoutMs=20000}={}) {
  const key = process.env.SCALENCY_API_KEY
  if (!key) throw new ScalencyError('Ajoute SCALENCY_API_KEY dans Vercel pour connecter Scalency.', 503)
  const url = new URL(base + path)
  for (const [name,value] of Object.entries(query)) if (value != null && value !== '') url.searchParams.set(name,value)
  const response = await fetcher(url, {method, redirect:'error', signal:AbortSignal.timeout(timeoutMs),
    headers:{Authorization:'Bearer '+key, Accept:pdf?'application/pdf':'application/json',...(body?{'Content-Type':'application/json'}:{})},
    ...(body?{body:JSON.stringify(body)}:{})})
  if (pdf && response.ok && response.headers.get('content-type')?.includes('application/pdf')) return Buffer.from(await response.arrayBuffer())
  const data = await response.json().catch(()=>null)
  if (!response.ok || !data || pdf) {
    const message = data?.error?.message || (response.status===429?'Limite Scalency atteinte. Réessaie après une minute.':'Scalency n’a pas confirmé la demande.')
    const error = new ScalencyError(message,response.ok?502:response.status)
    if (response.status===429) {
      const seconds = Number(response.headers.get('Retry-After'))
      error.retryAfterSeconds = Number.isFinite(seconds) && seconds>0 ? Math.ceil(seconds) : 60
    }
    throw error
  }
  return data
}
const select = (row,fields) => Object.fromEntries(fields.filter(k=>row[k]!==undefined).map(k=>[k,row[k]]))
const fields = {
  items:'id account_id title price status sold sku location supplier_link photo_url updated_at replaced_by views favourites sale',
  accounts:'id login country linked agent',
  orders:'id account title order_date normalized_status status_fr state deadline subtotal currency packed_at has_label carrier vinted_transaction_id note',
  jobs:'id account_id status status_label type type_label reason title item_id new_item_id not_before updated_at created_at',
  conversations:'id account_id login buyer title price cur thumb preview at unread todo sold offer'
}
export function snapshot(kind,row,seenAt=new Date().toISOString()) {
  const payload = select(row,fields[kind].split(' '))
  if (kind==='orders') payload.items=(row.items||[]).map(i=>select(i,'id title thumbnail sku selling_price purchase_price supplier_link location vinted_id state'.split(' ')))
  return {kind,account:String(row.account_id||row.account||''),remote_id:remoteId(row.id),payload,
    seen_at:seenAt,sort_at:row.order_date||row.updated_at||row.at||row.created_at||null}
}
export function shippable(row) {
  return !row.packed_at && ['ready','to_pack','to_order','waiting','to_prepare','preparing','partial','to_ship'].includes(row.state)
    && !/cancel|return|refund|deliver|shipped|suspend|annul|rembours/i.test(row.normalized_status||'')
}
export function draftPayload(draft, photos, account, scheduledAt) {
  const f=draft.fields
  if (!f.title?.trim() || !f.description?.trim() || !(Number(f.price)>0) || !f.catalog_id || !f.status_id || !photos.length)
    throw new ScalencyError('Complète le titre, la description, le prix, la catégorie, l’état et les photos.')
  return {account_id:remoteId(account),title:f.title,description:f.description,price:Number(f.price),photos,
    catalog_id:f.catalog_id,status_id:f.status_id,...(f.sku?{sku:f.sku}:{}),
    ...(f.size_id?{size_id:f.size_id}:{}),...(f.package_size_id?{package_size_id:f.package_size_id}:{}),
    ...(f.brand_id?{brand_id:f.brand_id}:f.brand_title?{brand:f.brand_title}:{}),
    ...(f.color_ids?.length?{color_ids:f.color_ids}:{}),...(f.item_attributes?.length?{item_attributes:f.item_attributes}:{}),
    ...(scheduledAt?{scheduled_at:scheduledAt}:{})}
}
