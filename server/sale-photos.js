import {randomUUID} from 'node:crypto'
import {AppError,isId,vintedId} from './dotb.js'
import {safeUrl} from '../src/lib/fulfillment.js'

const check=error=>{if(error)throw error}

// Only exact order-line IDs and the owning account can supply a sale's photo.
// Never match a title or SKU: different listings can share both.
export async function collectSalePhotos(job,{fetcher=fetch,token=process.env.DOTB_API_TOKEN,readPhotos=async()=>[],now=Date.now}={}) {
  const items=structuredClone(job.items||{}),started=now()
  let requests=0,stopped=false
  const get=async path=>{
    if(!token||stopped||requests>=5||now()-started>=18000)return null
    requests++
    try{
      const r=await fetcher(`https://dotb.io/api/public/v1/${path}`,{headers:{Authorization:`Bearer ${token}`,Accept:'application/json'},redirect:'error',signal:AbortSignal.timeout(Math.max(1,Math.min(6000,18000-(now()-started))))})
      if([401,402,403,429].includes(r.status))stopped=true
      return r.ok?await r.json():null
    }catch{return null}
  }
  const lines=job.lines.map(l=>({...l,vinted_id:vintedId(l.vinted_id)||vintedId(items[l.id]?.vinted_id)}))
  if(lines.some(l=>!l.vinted_id)){
    const order=await get(`orders/${job.order_id}?include=items,account`)
    if(order?.id===job.order_id&&order.account?.id===job.account_id&&Array.isArray(order.items)){
      for(const line of lines){
        const matches=order.items.filter(i=>i.id===line.id)
        if(matches.length!==1)continue
        line.vinted_id=vintedId(matches[0].vinted_id)||line.vinted_id
        line.dotb_listing_id=isId(matches[0].vinted_item_id)?matches[0].vinted_item_id:line.dotb_listing_id
      }
    }
  }
  const cached=await readPhotos([...new Set(lines.map(l=>l.vinted_id).filter(Boolean))])
  for(const line of lines){
    const old=items[line.id]
    const same=old&&old.vinted_id===line.vinted_id
    const photo=cached.find(p=>p.account_id===job.account_id&&p.item_id===line.vinted_id)
    items[line.id]={vinted_id:line.vinted_id,photo_url:safeUrl(photo?.photo_url)||safeUrl(same?old.photo_url:null)}
  }
  // Saved Dotb listings retain their original photos even with the browser closed.
  for(const line of lines){
    if(items[line.id].photo_url||!isId(line.dotb_listing_id))continue
    const item=await get(`items/${line.dotb_listing_id}`)
    if(item?.id!==line.dotb_listing_id||item.vinted_account_id!==job.account_id)continue
    const id=vintedId(item.vinted_id)
    if(line.vinted_id&&id&&line.vinted_id!==id)continue
    items[line.id].vinted_id=line.vinted_id||id
    const photos=Array.isArray(item.photos)?[...item.photos].sort((a,b)=>(a.image_no??0)-(b.image_no??0)):[]
    items[line.id].photo_url=photos.map(p=>safeUrl(p.url)).find(Boolean)||null
  }
  // Unsaved listings can also be read from the exact live transaction. No messages
  // are read or sent, and no sale/fulfilment state is changed.
  if(job.bridge_connected&&vintedId(job.transaction_id)&&lines.some(l=>!items[l.id].photo_url)){
    const order=await get(`accounts/${job.account_id}/live-orders/${job.transaction_id}`)
    if(vintedId(order?.id)===String(job.transaction_id)&&order.side==='seller'&&(!order.order_id||order.order_id===job.order_id)&&Array.isArray(order.items)){
      for(const line of lines){
        const target=items[line.id]
        if(target.photo_url||!target.vinted_id)continue
        const matches=order.items.filter(i=>vintedId(i.id)===target.vinted_id)
        if(matches.length===1)target.photo_url=safeUrl(matches[0].photo_url)
      }
    }
  }
  return items
}

export async function refreshSalePhotos(db,ids,options={}){
  if(!Array.isArray(ids)||ids.length>50||ids.some(id=>typeof id!=='string'||id.length>80))throw new AppError('Ventes invalides.')
  const lease=randomUUID()
  const claimed=await db.rpc('claim_sale_photos',{p_ids:[...new Set(ids)],p_lease:lease});check(claimed.error)
  if(!claimed.data)return {updated:false}
  const job=claimed.data
  try{
    const items=await collectSalePhotos(job,{...options,readPhotos:async itemIds=>{
      if(!itemIds.length)return []
      const r=await db.from('publication_items').select('account_id,item_id,photo_url').eq('account_id',job.account_id).in('item_id',itemIds);check(r.error);return r.data
    }})
    const saved=await db.rpc('save_sale_photos',{p_order:job.order_id,p_lease:lease,p_items:items});check(saved.error)
    return {updated:saved.data===true}
  }catch(error){
    await db.rpc('save_sale_photos',{p_order:job.order_id,p_lease:lease,p_items:job.items||{}})
    throw error
  }
}
