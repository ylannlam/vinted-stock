// Réception du jour : articles attendus, réception d'un article, colis emballé.
import {AppError,isId} from './dotb.js'
import {attachParcels} from './parcels.js'
import {dotbRequest} from './sales-automation.js'

const fail=e=>{if(e)throw e}
const FIELDS='id,order_id,stage,effective_stage,resolved_sku,sku_override,supplier_size,supplier_color,location,deadline_at,sale_date,account_login,listing_photo_url,source,order,updated_at,received_at,shipped_at,is_blocked'
const ORDER=['to_order','ordered','in_transit','received','prepared','shipped']

export async function readReception(db,{now=Date.now()}={}){
  const since=new Date(now-2*86400000).toISOString()
  const [open,shipped]=await Promise.all([
    db.from('workspace_sales').select(FIELDS).eq('source_active',true).eq('is_blocked',false).in('effective_stage',['ordered','in_transit','received','prepared']).order('deadline_at',{ascending:true}).limit(400),
    db.from('workspace_sales').select(FIELDS).eq('source_active',true).eq('effective_stage','shipped').gte('shipped_at',since).limit(200),
  ])
  fail(open.error);fail(shipped.error)
  const lines=[...open.data,...shipped.data]
  const skus=[...new Set(lines.map(l=>l.resolved_sku).filter(Boolean))]
  const catalog=skus.length?await db.from('sales_supplier_details').select('sku,photo_url,photos,color,variant').in('sku',skus):{data:[]}
  fail(catalog.error)
  return {lines:await attachParcels(db,lines).catch(()=>lines),catalog:catalog.data||[]}
}

async function lineById(db,id){
  const {data,error}=await db.from('workspace_sales').select(FIELDS).eq('id',id).maybeSingle();fail(error)
  if(!data)throw new AppError('Cette vente n’est plus disponible.',404)
  return data
}
async function advance(db,user,line,stage){
  const {error}=await db.rpc('save_sales_line',{p_id:line.id,p_version:line.updated_at,p_edit:null,p_product:null,p_stage:stage,p_user:user})
  if(error){
    if(/stale_version/.test(error.message||''))throw new AppError('Cette vente vient d’être modifiée. Actualise puis réessaie.',409)
    if(/order_blocked/.test(error.message||''))throw new AppError('Cette vente est annulée, suspendue ou déjà expédiée.',409)
    throw error
  }
}

// Article sorti du colis : la vente passe à « Reçu ». Pour un lot incomplet, l'article est rangé à une place du bac d'attente.
export async function receiveLine(db,user,body){
  if(typeof body?.id!=='string'||!body.id||body.id.length>80)throw new AppError('Vente invalide.')
  if(body.location!=null&&!/^[A-Z]\d{1,3}$/.test(body.location))throw new AppError('Place invalide.')
  let line=await lineById(db,body.id)
  if(body.updated_at&&line.updated_at!==body.updated_at&&!['ordered','in_transit'].includes(line.stage))throw new AppError('Cet article a déjà été reçu. Actualise la liste.',409)
  if(!['ordered','in_transit'].includes(line.stage))throw new AppError('Cette vente n’attend plus d’article.',409)
  while(ORDER.indexOf(line.stage)<ORDER.indexOf('received')){
    await advance(db,user,line,ORDER[ORDER.indexOf(line.stage)+1])
    line=await lineById(db,line.id)
  }
  if(body.location){const r=await db.from('sales_lines').update({location:body.location}).eq('id',line.id);fail(r.error)}
  return {received:true,line:await lineById(db,line.id)}
}

// Colis emballé : toutes les lignes de la commande passent à « À déposer », la place d'attente est libérée,
// et Dotb est prévenu quand son bordereau est prêt (étape « packed »).
export async function packOrder(db,user,body,{dotb=dotbRequest}={}){
  if(!isId(body?.order_id))throw new AppError('Commande invalide.')
  const {data:lines,error}=await db.from('workspace_sales').select(FIELDS).eq('order_id',body.order_id).eq('source_active',true);fail(error)
  if(!lines?.length)throw new AppError('Commande introuvable.',404)
  const missing=lines.filter(l=>['to_order','ordered','in_transit'].includes(l.stage))
  if(missing.length)throw new AppError(`Il manque encore ${missing.length} article${missing.length>1?'s':''} de ce lot.`,409)
  for(const line of lines.filter(l=>l.stage==='received'))await advance(db,user,line,'prepared')
  const freed=lines.filter(l=>/^A\d+$/i.test(l.location||'')).map(l=>l.id)
  if(freed.length){const r=await db.from('sales_lines').update({location:null}).in('id',freed);fail(r.error)}
  let dotbPacked=false
  if(lines[0].order?.status==='label_sent'){try{await dotb(`orders/${body.order_id}/pack`,{method:'POST'});dotbPacked=true}catch{/* L'étape Dotb reste facultative. */}}
  return {packed:true,dotb_packed:dotbPacked}
}
