import { supplierLink, sheinSearchUrl } from './catalog.js'

export const collectionLabels = { queued: 'En attente de récupération', running: 'Récupération en cours', completed: 'Ajouté à la bibliothèque', blocked: 'À vérifier dans l’extension', failed: 'À réessayer' }

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
