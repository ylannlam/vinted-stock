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
    if (!photo && !old?.photo && lookups > 0 && !(Date.parse(at)-Date.parse(old?.checkedAt)<86400000)) {
      lookups--
      try {
        const response = await request('items/' + remoteId(item.id), {query:{account_id:item.account_id}})
        const detail = response.data?.id ? response.data : response
        if (String(detail.id)===String(item.id) && String(detail.account_id)===String(item.account_id)) photo=coverOf(detail)
        if (!photo) misses.push({id:key,value:{id:String(item.id),account:String(item.account_id),checkedAt:at}})
      } catch (error) {
        if (error.status===429) lookups=0
        if (error.status===404) misses.push({id:key,value:{id:String(item.id),account:String(item.account_id),checkedAt:at}})
      }
    }
    if (photo && old?.photo !== photo) {
      covers.push({id:key,value:{...old,id:String(item.id),account:String(item.account_id),photo,checkedAt:at}})
    }
    if (!item.photo_url && (photo || old?.photo)) item.photo_url=photo || old.photo
  }
  if (misses.length) check(await db.from('scalency_settings').upsert(misses,{onConflict:'id',ignoreDuplicates:true}))
  if (covers.length) check(await db.from('scalency_settings').upsert(covers,{onConflict:'id'}))
  return items
}
