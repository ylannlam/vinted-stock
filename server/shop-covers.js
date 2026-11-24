import {remoteId} from './scalency-api.js'

const check = result => { if (result.error) throw result.error; return result.data || [] }
const prefix = 'dressing-cover:'
const image = value => typeof value === 'string' && /^https:\/\//i.test(value) ? value : null
const coverOf = item => image(item.photo_url) || image(item.photos?.[0])
export const coverKey = item => prefix + [item.account_id, item.id].map(encodeURIComponent).join(':')

// The public index sometimes returns only basic listing fields. Keep a confirmed
// photo per account and listing so a later lightweight read cannot erase it.
export async function preserveShopCovers(db, items, request, at) {
  if (!items.length) return items
  const keys = items.map(coverKey), previous = new Map()
  for (let start = 0; start < keys.length; start += 40) {
    const rows = check(await db.from('scalency_settings').select('id,value').in('id', keys.slice(start, start + 40)))
    for (const row of rows) previous.set(row.id, row.value)
  }
  const covers = [], misses = []
  let lookups = 2
  for (const item of items) {
    const key = coverKey(item), old = previous.get(key)
    let photo = coverOf(item)
    let sale = item.sale
    const needsPhoto = !photo && !old?.photo && !(Date.parse(at)-Date.parse(old?.checkedAt)<86400000)
    const needsSale = item.status==='inactive' && sale===undefined && !(Date.parse(at)-Date.parse(old?.saleCheckedAt||old?.checkedAt)<86400000)
    let saleLookup = false
    if ((needsPhoto || needsSale) && lookups > 0) {
      lookups--
      try {
        const response = await request('items/' + remoteId(item.id), {query:{account_id:item.account_id}})
        const detail = response.data?.id ? response.data : response
        if (String(detail.id)===String(item.id) && String(detail.account_id)===String(item.account_id)) {
          photo=photo||coverOf(detail)
          if (needsSale) {sale=detail.sale;saleLookup=true}
        }
        if (needsPhoto && !photo) misses.push({id:key,value:{id:String(item.id),account:String(item.account_id),checkedAt:at}})
      } catch (error) {
        if (error.status===429) lookups=0
        if (error.status===404) {
          if(needsSale)saleLookup=true
          if(needsPhoto)misses.push({id:key,value:{id:String(item.id),account:String(item.account_id),checkedAt:at}})
        }
      }
    }
    let deletedAt=old?.deletedAt || null
    if (item.status==='deleted' && item.deleted_at) deletedAt=item.deleted_at
    if (item.status==='active' && Date.parse(item.updated_at)>Date.parse(deletedAt)) deletedAt=null
    if (sale===undefined && item.sold===true && !old?.sale) sale={state:'vendue',transaction_id:null,sold_at:null}
    const saleChanged=sale!==undefined && (old?.sale===undefined || Boolean(sale)!==Boolean(old.sale) ||
      ['state','transaction_id','sold_at'].some(field=>sale?.[field]!==old?.sale?.[field]))
    if ((photo && old?.photo !== photo) || deletedAt !== (old?.deletedAt || null) || saleChanged || saleLookup) {
      const value={...old,id:String(item.id),account:String(item.account_id),photo:photo||old?.photo||null,deletedAt,checkedAt:at}
      if (sale!==undefined) value.sale=sale
      if (saleLookup) value.saleCheckedAt=at
      covers.push({id:key,value})
    }
    if (sale!==undefined) item.sale=sale
    if (!item.photo_url && (photo || old?.photo)) item.photo_url=photo || old.photo
  }
  if (misses.length) check(await db.from('scalency_settings').upsert(misses,{onConflict:'id',ignoreDuplicates:true}))
  if (covers.length) check(await db.from('scalency_settings').upsert(covers,{onConflict:'id'}))
  return items
}
