import {remote,ScalencyError} from './scalency-api.js'
const cacheId='listing-catalogs-fr'
const check=r=>{if(r.error)throw r.error;return r.data}
export async function refreshListingCatalogs(db){
  const old=check(await db.from('scalency_settings').select('value').eq('id',cacheId).maybeSingle())?.value
  if(old?.rows?.length&&Date.now()-Date.parse(old.at)<7*86400000)return old.rows.length
  const rows=[],seen=new Set()
  let cursor
  do{
    const page=await remote('catalogs',{query:{country:'FR',limit:100,cursor}})
    rows.push(...page.data.map(({id,title,parent_id})=>({id,title,parent_id})))
    if(!page.has_more)break
    if(!page.next_cursor||seen.has(page.next_cursor))throw Error('Pagination Scalency interrompue.')
    cursor=page.next_cursor;seen.add(cursor)
    await new Promise(resolve=>setTimeout(resolve,1050))
  }while(true)
  if(!rows.length)throw Error('Catalogue Scalency vide.')
  check(await db.from('scalency_settings').upsert({id:cacheId,value:{at:new Date().toISOString(),rows}}))
  return rows.length
}
export async function listingCatalogs(db){
  const data=check(await db.from('scalency_settings').select('value').eq('id',cacheId).maybeSingle())
  if(!data?.value?.rows?.length)throw new ScalencyError('Le catalogue des catégories est en cours de synchronisation.',503)
  return data.value.rows
}
