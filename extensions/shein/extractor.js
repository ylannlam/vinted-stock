/* Executed only after a click on the extension. No cookies or account data are read. */
function extractSheinProduct(doc, address) {
  if(/vérifi(?:er|cation).{0,40}(?:humain|sécurité)|je (?:ne )?suis (?:pas )?(?:un robot|humain)|verify (that )?you are human|security verification|not a robot|captcha|access denied/i.test((doc.body?.innerText||'')+' '+(doc.title||'')))throw Error('La vérification Shein est encore affichée. Termine-la toi-même avant de relever le produit.')
  const url = new URL(address)
  const id = url.pathname.match(/-p-(\d{1,20})\.html$/i)?.[1]
  if (url.protocol !== 'https:' || !['fr.shein.com', 'www.shein.com'].includes(url.hostname) || !id) {
    throw Error('Ouvrez une fiche produit sur fr.shein.com, terminez la vérification éventuelle, puis relancez l’extension.')
  }
  const meta = name => doc.querySelector(`meta[property="${name}"]`)?.content || ''
  const nodes = []
  const walk = value => {
    if (!value || typeof value !== 'object') return
    if (Array.isArray(value)) { value.forEach(walk); return }
    if ([value['@type']].flat().includes('Product')) nodes.push(value)
    if (value['@graph']) walk(value['@graph'])
    if (value.mainEntity) walk(value.mainEntity)
  }
  for (const script of doc.querySelectorAll('script[type="application/ld+json"]')) {
    try { walk(JSON.parse(script.textContent)) } catch { /* A broken structured block is not a usable source. */ }
  }
  const matching = nodes.filter(p => String(p.url || p['@id'] || '').match(/-p-(\d+)\.html/i)?.[1] === id)
  const product = matching.length === 1 ? matching[0] : nodes.length === 1 && !nodes[0].url && !nodes[0]['@id'] ? nodes[0] : null
  const offers = product ? [product.offers || []].flat() : []
  // Aggregate ranges, multiple offers and recommendations are deliberately left for manual review.
  const offer = offers.length === 1 && offers[0]['@type'] !== 'AggregateOffer' ? offers[0] : null
  const raw = offer?.price
  const priceNode = doc.querySelector('#productMainPriceId')
  const shown = (priceNode?.getAttribute('aria-label') || priceNode?.innerText || '').trim()
  const amount = shown.replace(/\s|\u00a0|\u202f/g,'').replace(/€|EUR/gi,'').replace(',','.')
  const price = priceNode ? (/€|EUR/i.test(shown)&&/^\d+(\.\d{1,2})?$/.test(amount)&&Number(amount)>0&&Number(amount)<100000 ? amount : '')
    : offer?.priceCurrency === 'EUR' && /^\d+(\.\d{1,2})?$/.test(String(raw)) && Number(raw) > 0 && Number(raw) < 100000 ? String(raw) : ''
  const skuButton = [...doc.querySelectorAll('button')].find(e=>/^Copy SKU /i.test(e.getAttribute('aria-label')||''))
  const visibleSku = skuButton?.getAttribute('aria-label')?.replace(/^Copy SKU /i,'').trim() || doc.body?.innerText?.match(/\bSKU:\s*([A-Za-z0-9_-]+)/)?.[1]
  const color = doc.querySelector('[role="radiogroup"][aria-label="Color options"] [aria-checked="true"]')?.getAttribute('aria-label') || ''
  const sizeNode = doc.querySelector('[role="radiogroup"][aria-label="Taille"] [aria-checked="true"]') || doc.querySelector('[role="radiogroup"][aria-label="Size"] [aria-checked="true"]')
  const size = sizeNode?.getAttribute('aria-label') || sizeNode?.innerText?.trim() || ''
  const pic = Array.isArray(product?.image) ? product.image[0] : product?.image
  const photo = typeof pic === 'string' ? pic : pic?.url || meta('og:image')
  const title = String(product?.name || meta('og:title') || doc.querySelector('h1')?.textContent || '').trim().slice(0, 500)
  return {
    supplier_url: `https://${url.hostname}${url.pathname}`, title,
    supplier_sku: String(visibleSku || product?.sku || '').slice(0, 200),
    photo_url: /^https:\/\//.test(photo || '') ? photo.slice(0, 2000) : '',
    price, currency: 'EUR', size: size.slice(0,80), color: color.slice(0,100), availability: 'unknown',
    observed_at: new Date().toISOString(), source: 'extension_reviewed',
    note: price ? 'Prix issu de la fiche, vérifié manuellement avant enregistrement.' : '',
  }
}
if (typeof document !== 'undefined') extractSheinProduct(document, location.href)
