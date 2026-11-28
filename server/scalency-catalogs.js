import {remote,remoteId,ScalencyError} from './scalency-api.js'
import {listingMetadata} from './listing-studio-core.js'
import {womensClothingCatalog} from './womens-clothing-catalog.js'
const cacheId='listing-catalogs-fr'
const check=r=>{if(r.error)throw r.error;return r.data}

const temporaryReferenceError=error=>[425,429,502,503,504].includes(error?.status)
  ||['TimeoutError','AbortError'].includes(error?.name)
  ||/référentiel Vinted se charge/i.test(error?.message)

export class CatalogTemporarilyUnavailable extends ScalencyError {
  constructor(){super('Les options Vinted de cette catégorie sont temporairement indisponibles.',503)}
}

function confirmedOptionsWhileLoading(id,error){
  // French Bodies listings with Vinted receipts on Nov 5 (M) and Nov 27 (XL), 2026.
  // Only these choices were validated together. Publication still requires a live Scalency dry run.
  if(id==='1835'&&/référentiel Vinted se charge/i.test(error?.message)){
    return {catalog:{id:1835,title:'Bodies'},source:'confirmed-listings',
      conditions:[{id:2,title:'Très bon état'}],package_sizes:[{id:1,title:'Petit'}],
      size_groups:[{sizes:[{id:1739,title:'M'},{id:1741,title:'XL'}]}],attributes:[]}
  }
  throw new CatalogTemporarilyUnavailable()
}

export async function readCategoryOptions(category,read=remote,secondary=listingMetadata,wait=ms=>new Promise(r=>setTimeout(r,ms))){
  const id=remoteId(category),path='catalogs/'+id
  try{return await read(path)}
  catch(error){
    if(!temporaryReferenceError(error))throw error
    // Both sources describe the same French Vinted category. Never reuse another category's options.
    try{
      const options=await secondary(path+'/options?country=FR&locale=fr')
      if(options?.catalog?.id===Number(id)&&!options.offline&&Array.isArray(options.conditions)
        &&Array.isArray(options.package_sizes)&&Array.isArray(options.size_groups))return options
    }catch{/* Scalency may finish loading its reference data before the second read. */}
    if(error.status===429)return confirmedOptionsWhileLoading(id,error)
    await wait(2000)
    try{return await read(path)}
    catch(retryError){
      if(!temporaryReferenceError(retryError))throw retryError
      return confirmedOptionsWhileLoading(id,retryError)
    }
  }
}
// The paginated Scalency index can end at a department, even when its leaf
// categories and their listing options are available by ID.
export function mergeListingCatalogs(primary,extra=[]){
  const categories=new Map()
  for(const row of [...womensClothingCatalog,...extra,...primary]){
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
  return mergeListingCatalogs(data?.value?.rows||[])
}
