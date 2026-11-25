import {remote,remoteId,snapshot,ScalencyError} from './scalency-api.js'
import {preserveShopCovers} from './shop-covers.js'
import {restrictOrderPage} from '../src/lib/shopPeriod.js'

export const shopSources={ventes:['orders',{state:'all',sort:'order_date'}],articles:['items',{}],retraits:['items',{status:'deleted'}],publications:['jobs',{scope:'closed'}],references:['item-refs',{}]}
const check=r=>{if(r.error)throw r.error;return r.data}

async function cacheItemRefs(db,items){
  const refs=new Map()
  for(const item of items){
    const stamp=Date.parse(item.updated_at)
    const updatedAt=Number.isFinite(stamp)?new Date(stamp).toISOString():null
    for(const [type,id] of [['listing',item.vinted_id],['line',item.item_id],['job',item.pending_job_id]]){
      if(!id)continue
      const value={type,id:String(id),account:String(item.account_id||''),sku:item.sku||null,updatedAt}
      const key='dressing-ref:'+JSON.stringify([type,value.account,value.id])
      if(!refs.has(key)||(updatedAt||'')>(refs.get(key).value.updatedAt||''))refs.set(key,{id:key,value})
    }
  }
  const rows=[...refs.values()]
  for(let offset=0;offset<rows.length;offset+=40){
    const batch=rows.slice(offset,offset+40)
    const previous=check(await db.from('scalency_settings').select('id,value').in('id',batch.map(row=>row.id)))
    const existing=new Map(previous.map(row=>[row.id,row.value]))
    const missing=batch.filter(row=>!existing.has(row.id))
    const inserted=new Set()
    if(missing.length){
      const created=check(await db.from('scalency_settings').upsert(missing,{onConflict:'id',ignoreDuplicates:true}).select('id'))
      for(const row of created)inserted.add(row.id)
    }
    // A background refresh can finish after the seller has saved a newer SKU.
    for(const {id,value} of batch){
      const prior=existing.get(id)
      if(inserted.has(id)||(prior?.updatedAt && prior.updatedAt>(value.updatedAt||''))||
         (prior && (prior.updatedAt||null)===value.updatedAt && prior.sku===value.sku))continue
      const update=db.from('scalency_settings').update({value}).eq('id',id)
      check(await (value.updatedAt?update.or('value->>updatedAt.is.null,value->>updatedAt.lte.'+value.updatedAt):update.is('value->>updatedAt',null)))
    }
  }
}

export async function saveListingSku(db,body,request=remote){
  const id=String(body.id??''),sku=typeof body.sku==='string'?body.sku.trim():''
  if(!/^\d{1,30}$/.test(id)||!sku||sku.length>200)throw new ScalencyError('Vérifie le numéro de l’annonce et le SKU (200 caractères maximum).')
  const account=body.accountId?remoteId(body.accountId):null
  const ref=await request('items/'+id,{method:'PATCH',body:{sku,...(account&&{account_id:account})}})
  if(String(ref?.vinted_id)!==id||ref.sku!==sku||(account&&String(ref.account_id)!==account)){
    throw new ScalencyError('Scalency n’a pas confirmé le SKU pour cette annonce. Actualise le dressing avant de réessayer.',502)
  }
  try{
    await cacheItemRefs(db,[ref])
  }catch{
    // The write was confirmed. The references feed will retry the local cache.
    return {sku,cachePending:true}
  }
  return {sku,cachePending:false}
}

export async function refreshShopPage(db,source,cursor='',force=false,request=remote){
  if(!Object.hasOwn(shopSources,source)||typeof cursor!=='string'||cursor.length>1500)throw new ScalencyError('Page de synchronisation invalide.')
  const key='dressing-read-v1:'+source
  if(!cursor&&!force){
    const marker=check(await db.from('scalency_settings').select('value').eq('id',key).maybeSingle())
    if(Date.now()-Date.parse(marker?.value?.at)<180000)return {next:null,skipped:true}
  }
  const [kind,filters]=shopSources[source]
  let page=await request(kind,{query:{...filters,limit:100,cursor}})
  if(!Array.isArray(page.data)||page.has_more&&(!page.next_cursor||page.next_cursor===cursor))throw new ScalencyError('Scalency a renvoyé une page incomplète.',502)
  if(kind==='orders')page=restrictOrderPage(page)
  const at=new Date().toISOString()
  if(kind==='item-refs'){
    await cacheItemRefs(db,page.data)
  }else{
    if(kind==='items')await preserveShopCovers(db,page.data,request,at)
    const rows=page.data.filter(r=>kind!=='jobs'||['publish','relist','hide','unhide'].includes(r.type)).map(r=>snapshot(kind,r,at))
    if(rows.length)check(await db.from('scalency_records').upsert(rows,{onConflict:'kind,account,remote_id'}))
  }
  if(!page.has_more)check(await db.from('scalency_settings').upsert({id:key,value:{at}}))
  return {next:page.has_more?page.next_cursor:null}
}
