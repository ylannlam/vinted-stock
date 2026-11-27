import {remote,ScalencyError} from './scalency-api.js'
import {listingMetadata} from './listing-studio-core.js'
const cacheId='listing-catalogs-fr'
const check=r=>{if(r.error)throw r.error;return r.data}
// The paginated Scalency index can end at a department, even when its leaf
// categories and their listing options are available by ID.
const verifiedLeaves=[
  {id:1835,parent_id:12,title:'Bodies'},
  {id:1774,parent_id:10,title:'Pour occasions'},
  {id:1777,parent_id:1774,title:"Robes de bal de fin d'année"},
  {id:1778,parent_id:1774,title:'Robes de soirée'}
]
export function mergeListingCatalogs(primary,extra=[]){
  const categories=new Map()
  for(const row of [...verifiedLeaves,...extra,...primary]){
    if(Number.isSafeInteger(row?.id)&&typeof row.title==='string'&&row.title.trim())
      categories.set(row.id,{id:row.id,title:row.title,parent_id:row.parent_id??null})
  }
  return [...categories.values()]
}
export async function refreshListingCatalogs(db){
  const old=check(await db.from('scalency_settings').select('value').eq('id',cacheId).maybeSingle())?.value
  const fresh=old?.rows?.length&&Date.now()-Date.parse(old.at)<7*86400000
  if(fresh&&old.depth===6)return old.rows.length
  const rows=fresh?[...old.rows]:[],seen=new Set()
  let cursor
  if(!fresh)do{
    const page=await remote('catalogs',{query:{country:'FR',limit:100,cursor}})
    rows.push(...page.data.map(({id,title,parent_id})=>({id,title,parent_id})))
    if(!page.has_more)break
    if(!page.next_cursor||seen.has(page.next_cursor))throw Error('Pagination Scalency interrompue.')
    cursor=page.next_cursor;seen.add(cursor)
    await new Promise(resolve=>setTimeout(resolve,1050))
  }while(true)
  if(!rows.length)throw Error('Catalogue Scalency vide.')
  let supplement=[],depth=null
  try{
    const tree=await listingMetadata('catalogs?country=FR&depth=6')
    if(Array.isArray(tree.data)&&tree.data.some(r=>r.parent_id===12)){
      supplement=tree.data
      depth=6
    }
  }catch{/* The primary index and the last detailed tree remain usable. */}
  const merged=mergeListingCatalogs(rows,depth?supplement:old?.rows||[])
  check(await db.from('scalency_settings').upsert({id:cacheId,value:{at:fresh?old.at:new Date().toISOString(),depth,rows:merged}}))
  return merged.length
}
export async function listingCatalogs(db){
  const data=check(await db.from('scalency_settings').select('value').eq('id',cacheId).maybeSingle())
  if(!data?.value?.rows?.length)throw new ScalencyError('Le catalogue des catégories est en cours de synchronisation.',503)
  return mergeListingCatalogs(data.value.rows)
}
