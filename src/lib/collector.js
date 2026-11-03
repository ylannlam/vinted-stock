import { supplierLink, sheinSearchUrl } from './catalog.js'

export const extensionVersion='0.7.1'
export function extensionNeedsUpdate(version) {
  if(!/^\d+\.\d+\.\d+$/.test(version||''))return true
  const installed=version.split('.').map(Number),current=extensionVersion.split('.').map(Number)
  for(let i=0;i<3;i++){if(installed[i]!==current[i])return installed[i]<current[i]}
  return false
}

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
  const seen=Date.parse(device.last_seen_at)
  return !device.revoked_at && Date.parse(device.expires_at) > now && Number.isFinite(seen) && now-seen>=-60000 && now-seen<120000
}

export function collectorConnectionState(browser,devices=[],now=Date.now()) {
  const remote=devices.some(d=>d.enabled&&collectorOnline(d,now))
  if(!browser?.connected)return {label:remote?'PC de récupération joignable':browser?'Connecter ce navigateur':'En attente du PC de récupération',active:remote}
  if(browser.phase==='blocked')return {label:'Intervention nécessaire sur Shein',active:false}
  if(!browser.enabled)return {label:'Import en pause',active:false}
  if(browser.retryAt)return {label:'Connexion interrompue · nouvelle tentative automatique',active:false}
  const seen=typeof browser.lastContactAt==='number'?browser.lastContactAt:Date.parse(browser.lastContactAt)
  if(!Number.isFinite(seen)||now-seen>=120000||seen-now>60000)return {label:'Connexion au serveur à vérifier',active:false}
  return {label:browser.job?'Récupération Shein en cours':'Connecté · en attente de ventes à traiter',active:true}
}

export function collectionProgress(progress,browser,devices=[],error='',now=Date.now()) {
  const connection=collectorConnectionState(browser,devices,now)
  if(error)return {percent:null,label:'Connexion à vérifier',detail:'Clique pour voir les détails',tone:'warning',working:false}
  if(!progress)return {percent:null,label:'Connexion à l’extension…',detail:'Lecture de l’avancement',tone:'idle',working:false}
  const {total=0,completed=0,queued=0,running=0,review=0}=progress,pending=queued+running
  const percent=total?completed===total?100:Math.min(99,Math.floor(completed/total*100)):0
  const working=connection.active&&!!(running||browser?.job)&&browser?.phase!=='blocked'
  let label='En attente de ventes',tone='idle'
  if(browser?.phase==='blocked'){label='Vérification Shein requise';tone='warning'}
  else if(pending&&!connection.active){label=browser?.connected&&!browser.enabled?'Extension en pause':'Extension hors ligne';tone='warning'}
  else if(working){label='Récupération en cours';tone='active'}
  else if(pending){label='Préparation des fiches';tone='active'}
  else if(review){label='Fiches à vérifier';tone='warning'}
  else if(total){label='Tout est récupéré';tone='done'}
  const detail=total?`${completed} / ${total} fiches récupérées${review?' · '+review+' à vérifier':''}`:connection.active?'Prête pour tes prochaines ventes':'Connecte ton navigateur Shein'
  return {percent,label,detail,tone,working}
}
