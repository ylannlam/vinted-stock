import {blocked, stageOf, skuOf, supplierOf, STAGES} from './fulfillment.js'
const normalized = value => String(value || '').trim().toLocaleLowerCase('fr-FR')

export function nextSaleAction(line, catalog=[]) {
  if(blocked(line))return {kind:'details',label:'Vérifier la vente'}
  const stage=stageOf(line)
  if(stage==='shipped')return null
  if(stage==='to_order') {
    if(!skuOf(line))return {kind:'sku',label:'Ajouter le SKU Shein'}
    if(!supplierOf(line,catalog))return {kind:'details',label:'Vérifier la fiche Shein'}
    if(!line.supplier_order_ref)return {kind:'order',label:'Commande passée'}
  }
  const current=STAGES.find(s=>s.id===stage)
  return current?.action?{kind:'advance',label:current.action}:null
}

export async function confirmPurchase(request,line,reference) {
  const value=reference.trim()
  if(!value)throw Error('Renseigne le numéro de commande Shein.')
  await request('PATCH',{action:'batch',operation:'order_ref',value,lines:[{id:line.id,updated_at:line.updated_at}]})
  try {
    const result=await request('GET',undefined,'?'+new URLSearchParams({view:'detail',id:line.id}))
    if(blocked(result.line)||stageOf(result.line)!=='to_order'||result.line.supplier_order_ref!==value)throw Error('La vente a changé.')
    await request('PATCH',{action:'advance',id:line.id,updated_at:result.line.updated_at,stage:'ordered'})
  } catch {
    throw Error('Le numéro de commande a été enregistré, mais le changement d’étape n’a pas pu être confirmé. Ferme cette fenêtre, actualise et vérifie la vente avant de continuer.')
  }
}

export function retrievalState(sku, product) {
  if (!sku) return {label:'SKU à renseigner', tone:'amber', retry:false}
  const status = product?.retrieval_status
  if (status === 'running') return {label:'Récupération en cours', tone:'blue', retry:false}
  if (status === 'queued') return {label:'En attente du navigateur Shein', tone:'blue', retry:false}
  if (status === 'blocked') return {label:product.retrieval_message || 'Intervention nécessaire sur Shein', tone:'amber', retry:true}
  if (status === 'failed') return {label:product.retrieval_message || 'Récupération à relancer', tone:'amber', retry:true}
  if (product?.price != null) return {label:'Dernier relevé disponible', tone:'teal', retry:true}
  return {label:'Fiche Shein à récupérer', tone:'amber', retry:true}
}

// A different colour or an absent size is unknown, never a presumed stockout.
export function variantAvailability(size, color, product, now = Date.now()) {
  if (!normalized(size) || !normalized(color)) return {tone:'amber',label:'Renseigne la taille et la couleur à acheter.'}
  if (!product || normalized(product.color) !== normalized(color)) return {tone:'amber',label:'Disponibilité de cette couleur non vérifiée.'}
  const at = Date.parse(product.observed_at)
  if (!Number.isFinite(at) || now-at > 86400000 || at > now+60000) return {tone:'amber',label:'Relevé ancien ou absent : vérifie la disponibilité sur Shein.'}
  const match = Array.isArray(product.sizes) && product.sizes.find(s=>normalized(s.size)===normalized(size))
  if (match?.availability === 'available') return {tone:'teal',label:'Taille disponible lors du dernier relevé.'}
  if (match?.availability === 'unavailable') return {tone:'red',label:'Taille indisponible lors du dernier relevé.'}
  return {tone:'amber',label:'Disponibilité de cette taille non vérifiée.'}
}

export function saleMargin(line) {
  const amounts = [line.source?.selling_price,line.actual_cost,line.fees_amount??0,line.refund_amount??0]
  if (amounts.some(v=>v==null || v==='' || !Number.isFinite(Number(v)) || Number(v)<0)) return null
  const [revenue,cost,fees,refund] = amounts.map(Number)
  return Math.round((revenue-cost-fees-refund)*100)/100
}

export const ACTIONS = [
  {id:'all',label:'Tout'}, {id:'missing_sku',label:'SKU manquants'},
  {id:'shein',label:'Fiches Shein'}, {id:'purchase',label:'À acheter'},
  {id:'receive',label:'À recevoir'}, {id:'prepare',label:'À préparer'},
  {id:'ship',label:'À déposer'}, {id:'review',label:'À vérifier'},
]

export function actionDescription(row) {
  if(row.action==='missing_sku')return 'Ajouter le SKU de l’article vendu'
  if(row.action==='shein')return retrievalState(row.sku,row).label
  return {purchase:'Vérifier la variante et passer la commande',receive:'Suivre le colis fournisseur',prepare:'Préparer le colis Vinted',ship:'Déposer le colis et confirmer l’envoi',review:'Vérifier le retour ou le statut de la vente'}[row.action]||'Ouvrir la vente'
}
