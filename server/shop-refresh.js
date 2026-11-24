import {remote,snapshot,ScalencyError} from './scalency-api.js'
import {restrictOrderPage} from '../src/lib/shopPeriod.js'

export const shopSources={ventes:['orders',{state:'all',sort:'order_date'}],articles:['items',{}],retraits:['items',{status:'deleted'}],publications:['jobs',{scope:'closed'}],references:['item-refs',{}]}
const check=r=>{if(r.error)throw r.error;return r.data}

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
    const refs=new Map()
    for(const item of page.data){
      for(const [type,id] of [['listing',item.vinted_id],['line',item.item_id],['job',item.pending_job_id]]){
        if(!id)continue
        const value={type,id:String(id),account:String(item.account_id||''),sku:item.sku||null}
        const key='dressing-ref:'+JSON.stringify([type,value.account,value.id])
        if(!refs.has(key))refs.set(key,{id:key,value})
      }
    }
    if(refs.size)check(await db.from('scalency_settings').upsert([...refs.values()]))
  }else{
    const rows=page.data.filter(r=>kind!=='jobs'||['publish','relist','hide','unhide'].includes(r.type)).map(r=>snapshot(kind,r,at))
    if(rows.length)check(await db.from('scalency_records').upsert(rows,{onConflict:'kind,account,remote_id'}))
  }
  if(!page.has_more)check(await db.from('scalency_settings').upsert({id:key,value:{at}}))
  return {next:page.has_more?page.next_cursor:null}
}
