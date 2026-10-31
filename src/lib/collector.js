import { supplierLink, sheinSearchUrl } from './catalog.js'

export const collectionLabels = { queued: 'En attente', running: 'Import en cours', completed: 'Ajouté', blocked: 'À vérifier', failed: 'À réessayer' }

// Display the latest outcome, not an old failure for a product imported successfully later.
export function latestCollections(jobs) {
  const idsBySku=new Map()
  for(const j of jobs){const id=supplierLink(j.input).product?.supplier_id;if(id&&j.expected_sku)idsBySku.set(j.expected_sku.toLowerCase(),id)}
  const seen=new Set()
  return [...jobs].sort((a,b)=>Date.parse(b.created_at)-Date.parse(a.created_at)).filter(j=>{
    const sku=j.expected_sku?.toLowerCase(),product=supplierLink(j.input).product?.supplier_id||idsBySku.get(sku)
    const key=product?`product:${product}`:sku?`sku:${sku}`:j.reference_key||j.input
    if(seen.has(key))return false
    seen.add(key);return true
  })
}

export function collectionReferences(value) {
  if (typeof value !== 'string' || value.length > 30000) throw Error('Colle au maximum 50 SKU ou liens, un par ligne.')
  const lines = value.split(/\r?\n/).map(s => s.trim()).filter(Boolean)
  if (!lines.length || lines.length > 50) throw Error('Colle entre 1 et 50 SKU ou liens, un par ligne.')
  const refs = new Map()
  for (const line of lines) {
    const product = supplierLink(line).product
    if (product) refs.set(`product:${product.supplier_id}`, { reference_key: `product:${product.supplier_id}`, input: product.supplier_url, expected_supplier_id: product.supplier_id, expected_sku: null })
    else if (sheinSearchUrl(line)) refs.set(`sku:${line}`, { reference_key: `sku:${line}`, input: line, expected_sku: line, expected_supplier_id: null })
    else throw Error(`Cette ligne n’est pas un SKU ou un lien produit Shein complet : ${line.slice(0,100)}`)
  }
  return [...refs.values()]
}

export function collectorOnline(device, now = Date.now()) {
  return !device.revoked_at && Date.parse(device.expires_at) > now && !!device.last_seen_at && now - Date.parse(device.last_seen_at) < 120000
}
