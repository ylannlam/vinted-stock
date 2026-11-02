import {AppError} from './dotb.js'
import {STAGES} from '../src/lib/fulfillment.js'

const dateValue=value=>{
  if(!value)return ''
  if(typeof value!=='string'||!/^\d{4}-\d{2}-\d{2}$/.test(value)||!Number.isFinite(Date.parse(value))||new Date(value).toISOString().slice(0,10)!==value)throw new AppError('Date invalide.')
  return value
}
export function salesFilters(query={}) {
  const page=Number(query.page||0), stage=query.stage||'all'
  if(!Number.isSafeInteger(page)||page<0||page>20000)throw new AppError('Page invalide.')
  if(!['all','review','missing_sku',...STAGES.map(s=>s.id)].includes(stage))throw new AppError('Étape invalide.')
  for(const key of ['search','account'])if(query[key]!=null&&(typeof query[key]!=='string'||query[key].length>200))throw new AppError('Filtre invalide.')
  const from=dateValue(query.from),to=dateValue(query.to)
  if(from&&to&&from>to)throw new AppError('La date de fin doit suivre la date de début.')
  return {page,stage,search:(query.search||'').trim(),account:query.account||'',from,to,urgent:query.urgent==='true'}
}
export function financeValues(body) {
  const amount=(v,label)=>{
    if(v===''||v==null)return 0
    if(!/^\d{1,7}(\.\d{1,2})?$/.test(String(v))||Number(v)>1000000)throw new AppError(`${label} : saisis un montant positif avec deux décimales maximum.`)
    return Number(v)
  }
  if(body.finance_confirmed!=null&&typeof body.finance_confirmed!=='boolean')throw new AppError('Confirmation des coûts invalide.')
  if(body.finance_confirmed&&(body.actual_cost==null||body.actual_cost===''))throw new AppError('Renseigne le coût payé avant de confirmer la marge.')
  return {fees:amount(body.fees_amount,'Frais'),refund:amount(body.refund_amount,'Remboursement'),confirmed:body.finance_confirmed===true}
}
export function saleVariant(body) {
  const text=value=>{
    if(value==null)return null
    if(typeof value!=='string'||value.length>80)throw new AppError('Taille ou couleur invalide (80 caractères maximum).')
    return value.trim()||null
  }
  return {size:text(body.supplier_size),color:text(body.supplier_color)}
}
export function batchValues(body) {
  if(!Array.isArray(body.lines)||!body.lines.length||body.lines.length>100)throw new AppError('Sélectionne entre 1 et 100 ventes.')
  const ids=new Set()
  const lines=body.lines.map(l=>{
    if(!l||typeof l.id!=='string'||!l.id||l.id.length>80||typeof l.updated_at!=='string'||!Number.isFinite(Date.parse(l.updated_at))||ids.has(l.id))throw new AppError('Sélection invalide ou périmée. Actualise la liste.')
    ids.add(l.id);return {id:l.id,updated_at:l.updated_at}
  })
  if(!['order_ref','advance'].includes(body.operation))throw new AppError('Action groupée invalide.')
  if(typeof body.value!=='string'||!body.value.trim()||body.value.length>200)throw new AppError('Renseigne une valeur valide.')
  if(body.operation==='advance'&&!STAGES.some(s=>s.id===body.value))throw new AppError('Étape invalide.')
  return {lines,operation:body.operation,value:body.value.trim()}
}
export const workspaceErrors={restore_parent_first:'Restaure d’abord la commande qui contient cet article.',slot_occupied:'Un emplacement est déjà occupé. Vérifie les emplacements puis réessaie.',order_changed:'Cette commande a changé. Actualise avant de réessayer.',cost_required:'Renseigne le coût payé avant de confirmer la marge.',not_found:'Cet élément n’est plus disponible.'}
