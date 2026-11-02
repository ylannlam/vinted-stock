import {isId} from './dotb.js'
import {sizeFromLabel} from '../src/lib/soldSize.js'

// Enrichment is bounded and optional: a missing listing or rate limit must
// never prevent a sale from appearing. Normalization already supplies the
// explicit title size as a fallback.
export async function enrichSoldSizes(normalized,{fetcher=fetch,token=process.env.DOTB_API_TOKEN,maxRequests=16,budgetMs=10000,now=Date.now}={}) {
  if(!token)return normalized
  const started=now(),items=new Map(),options=new Map()
  let requests=0,stopped=false
  const get=async path=>{
    if(stopped||requests>=maxRequests||now()-started>=budgetMs)return null
    requests++
    try{
      const r=await fetcher(`https://dotb.io/api/public/v1/${path}`,{headers:{Authorization:`Bearer ${token}`,Accept:'application/json'},redirect:'error',signal:AbortSignal.timeout(Math.max(1,Math.min(3000,budgetMs-(now()-started))))})
      if([401,402,403,429].includes(r.status))stopped=true
      if(!r.ok)return null
      return await r.json()
    }catch{return null}
  }
  for(const line of normalized.lines){
    const id=line.source.dotb_listing_id
    if(!isId(id))continue
    if(!items.has(id))items.set(id,await get(`items/${id}`))
    const item=items.get(id),order=normalized.orders.find(o=>o.id===line.order_id)
    if(item?.id!==id||item.vinted_account_id!==order?.account_id||!Number.isSafeInteger(item.size_id)||!Number.isSafeInteger(item.catalog_id))continue
    const country=line.source.country_code
    if(!/^[A-Z]{2}$/.test(country||''))continue
    const key=`${item.catalog_id}:${country}`
    if(!options.has(key))options.set(key,await get(`catalogs/${item.catalog_id}/options?country=${country}&locale=fr`))
    const groups=options.get(key)?.size_groups
    if(!Array.isArray(groups))continue
    const matches=groups.flatMap(g=>Array.isArray(g.sizes)?g.sizes:[]).filter(s=>s.id===item.size_id)
    const labels=[...new Set(matches.map(s=>s.title).filter(v=>typeof v==='string'))]
    if(labels.length!==1)continue
    const size=sizeFromLabel(labels[0]);if(!size)continue
    Object.assign(line.source,{size,size_label:labels[0],size_origin:'dotb',size_id:item.size_id,catalog_id:item.catalog_id})
  }
  return normalized
}
