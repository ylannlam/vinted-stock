import {remote,ScalencyError} from './scalency-api.js'
import {readBoardRows} from './team-board.js'
import {createHash} from 'node:crypto'

// The dashboard only needs product references. Never send customer or shipping details.
const feeds={
  comptes:['accounts',{}], annonces:['items',{}], supprimees:['items',{status:'deleted'}],
  publications:['jobs',{type:'publish',scope:'closed'}], republications:['jobs',{type:'relist',scope:'closed'}],
  commandes:['orders',{state:'all'}]
}
export function skuSourceRows(kind,rows){
  if(kind==='accounts')return rows.map(r=>({id:String(r.id),login:r.login}))
  if(kind==='items')return rows.map(r=>({id:String(r.id),account:String(r.account_id),title:r.title,sku:r.sku,
    status:r.status,sold:r.sold,replaced:r.replaced_by,transaction:r.sale?.transaction_id,saleState:r.sale?.state,soldAt:r.sale?.sold_at}))
  if(kind==='jobs')return rows.filter(r=>['publish','relist'].includes(r.type)&&r.status==='done'&&r.new_item_id).map(r=>({
    id:String(r.new_item_id),account:String(r.account_id),title:r.title,sku:r.refs?.sku,
    previous:r.type==='relist'?r.item_id:null
  }))
  return rows.map(r=>({id:String(r.id),account:r.account,transaction:r.vinted_transaction_id,
    title:r.title,date:r.order_date,updated:r.status_updated_at,status:r.normalized_status,state:r.state,lines:(r.items||[]).map(i=>({
      id:i.id,listing:i.vinted_id,title:i.title,sku:i.sku,quantity:i.quantity??1,
      productSku:i.link_method==='sku'&&i.product?.skus?.length===1&&typeof i.product.skus[0]==='string'?i.product.skus[0]:null
    }))}))
}
export async function skuFeed(feed,cursor,request=remote){
  if(!Object.hasOwn(feeds,feed)||typeof cursor!=='string'||cursor.length>1500)throw new ScalencyError('Source ou page invalide.')
  const [kind,filters]=feeds[feed]
  const page=await request(kind,{query:{...filters,limit:100,cursor:cursor||null}})
  if(!Array.isArray(page.data)||(page.has_more&&(!page.next_cursor||page.next_cursor===cursor)))throw new ScalencyError('Historique Scalency incomplet. Réessaie.',502)
  return {rows:skuSourceRows(kind,page.data),next:page.has_more?page.next_cursor:null}
}
export async function skuReferences(db,user){
  const all=(table,cols,scope,keys)=>readBoardRows(()=>{
    let q=scope(db.from(table).select(cols,{count:'exact'}))
    for(const key of keys)q=q.order(key)
    return q
  })
  const [ads,lines,drafts,products,links]=await Promise.all([
    all('scalency_catalog_inventory','account,remote_id,resolved_sku,product_id',q=>q,['account','remote_id']),
    all('scalency_order_products','order_id,login,line_id,listing,sku,product_id',q=>q,['login','order_id','line_id']),
    all('listing_drafts','vinted_id,account:fields->>account_id,sku:fields->>sku,title:fields->>title',q=>q.eq('owner_id',user.id).not('vinted_id','is',null),['id']),
    all('catalog_products','id,supplier_sku',q=>q.not('supplier_sku','is',null),['id']),
    all('scalency_settings','id,value',q=>q.like('id','sku-link:%'),['id'])
  ])
  const sku=new Map(products.map(p=>[p.id,p.supplier_sku]))
  return {ads:ads.map(r=>({account:r.account,id:r.remote_id,sku:r.resolved_sku||sku.get(r.product_id)})).filter(r=>r.sku),
    lines:lines.map(r=>({account:r.login,order:r.order_id,id:r.line_id,listing:r.listing,sku:r.sku||sku.get(r.product_id)})).filter(r=>r.id&&(r.sku||r.listing)),
    drafts:drafts.map(r=>({account:r.account,id:r.vinted_id,sku:r.sku,title:r.title})).filter(r=>r.account),manual:links.map(r=>r.value)}
}

export async function linkSku(db,body){
  const {kind}=body,account=String(body.account||'').trim().toLowerCase(),id=String(body.id||'').trim()
  const line=kind==='sale'?String(body.line||'').trim():'',sku=String(body.sku||'').trim()
  if(!['listing','sale'].includes(kind)||!account||account.length>180||!id||id.length>180||
     (kind==='sale'&&(!line||line.length>180))||!sku||sku.length>150)throw new ScalencyError('Référence ou article invalide.')
  const hash=createHash('sha256').update(JSON.stringify([kind,account,id,line])).digest('hex')
  const value={kind,account,id,line,sku}
  const result=await db.from('scalency_settings').insert({id:'sku-link:'+hash,value})
  if(result.error?.code==='23505'){
    const current=await db.from('scalency_settings').select('value').eq('id','sku-link:'+hash).single()
    if(current.error)throw current.error
    if(current.data.value.sku!==sku)throw new ScalencyError('Cette référence a déjà été renseignée. Actualise le suivi.',409)
  }else if(result.error)throw result.error
  return value
}
