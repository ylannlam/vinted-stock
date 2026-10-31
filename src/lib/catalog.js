export function sheinProduct(value) {
  if (typeof value !== 'string' || value.length > 2000) return null
  try {
    const url = new URL(value.trim())
    if (url.protocol !== 'https:' || url.username || url.password || url.port || !['fr.shein.com','www.shein.com'].includes(url.hostname)) return null
    const id = url.pathname.match(/-p-(\d{1,20})\.html$/i)?.[1]
    if (!id) return null
    // Keep the real product path; strip referral, cart and tracking parameters.
    return { supplier_id: id, supplier_url: `https://${url.hostname}${url.pathname}` }
  } catch { return null }
}

export function supplierLink(value) {
  if (typeof value!=='string' || !value.trim()) return {url:null,product:null,status:'missing'}
  if(value.length>6000)return {url:null,product:null,status:'invalid'}
  let candidate=value.trim()
  const markdown=candidate.match(/^\[[^\]]*\]\((https?:\/\/\S+)\)$/i)
  if(markdown)candidate=markdown[1]
  if(/^<https?:\/\/[^<>]+>$/i.test(candidate))candidate=candidate.slice(1,-1)
  if(/^(fr|www)\.shein\.com\//i.test(candidate))candidate=`https://${candidate}`
  try {
    const url=new URL(candidate)
    if(url.protocol==='http:' && ['fr.shein.com','www.shein.com'].includes(url.hostname))url.protocol='https:'
    if(url.protocol!=='https:'||url.username||url.password||url.port||url.href.length>2000)throw Error('Invalid URL')
    const product=sheinProduct(url.href)
    return {url:url.href,product,status:product?'recognized':'unrecognized'}
  } catch {return {url:null,product:null,status:'invalid'}}
}

export function sheinSearchUrl(sku) {
  return typeof sku==='string' && /^[a-z0-9_-]{1,200}$/i.test(sku) ? `https://fr.shein.com/pdsearch/${encodeURIComponent(sku)}/` : null
}

export function parsePrice(value) {
  if (value === null || value === undefined || String(value).trim() === '') return null
  let s = String(value).trim().replace(/\s|\u00a0|\u202f/g, '').replace(/€|EUR/gi, '')
  if (/^\d{1,3}(\.\d{3})+,\d{1,2}$/.test(s)) s = s.replace(/\./g, '')
  if (/^\d{1,3}(,\d{3})+\.\d{1,2}$/.test(s)) s = s.replace(/,/g, '')
  s = s.replace(',', '.')
  if (!/^\d{1,5}(\.\d{1,2})?$/.test(s)) return NaN
  const n = Number(s)
  return n > 0 && n < 100000 ? n : NaN
}

export function observationChange(row) {
  if (row.price == null || row.previous_price == null || Number(row.previous_price) <= 0) return null
  const amount = Math.round((Number(row.price) - Number(row.previous_price)) * 100) / 100
  return { amount, percent: amount / Number(row.previous_price) * 100 }
}

export const availabilityLabels = { unknown: 'À vérifier', available: 'Disponible', unavailable: 'Indisponible' }
export const variantLabel = row => [row.size, row.color].filter(Boolean).join(' · ') || 'Variante non précisée'
export const isStale = (row, now = Date.now()) => !row.observed_at || now - Date.parse(row.observed_at) > 86400000

export function captureDraft() {
  const prefix = '#shein-import='
  if (window.location.hash.startsWith(prefix)) {
    try {
      const encoded = window.location.hash.slice(prefix.length)
      if (encoded.length > 24000) throw Error('Import trop volumineux')
      const parsed = JSON.parse(decodeURIComponent(encoded))
      if (!parsed || typeof parsed !== 'object' || !sheinProduct(parsed.supplier_url)) throw Error('Lien produit invalide')
      sessionStorage.setItem('shein-import-draft', JSON.stringify(parsed))
    } catch { sessionStorage.setItem('shein-import-error', 'Le lien d’import est invalide. Ouvrez une fiche produit Shein et réessayez.') }
    window.history.replaceState(null, '', window.location.pathname + window.location.search)
    return true
  }
  return !!sessionStorage.getItem('shein-import-draft') || !!sessionStorage.getItem('shein-import-error')
}
