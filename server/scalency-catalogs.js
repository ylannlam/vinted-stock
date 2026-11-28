import {remote,remoteId,ScalencyError} from './scalency-api.js'
import {listingMetadata} from './listing-studio-core.js'
import {womensClothingCatalog} from './womens-clothing-catalog.js'
const cacheId='listing-catalogs-fr'
const check=r=>{if(r.error)throw r.error;return r.data}

const temporaryReferenceError=error=>[425,429,500,502,503,504].includes(error?.status)
  ||['TimeoutError','AbortError'].includes(error?.name)
  ||/référentiel Vinted se charge/i.test(error?.message)

export class CatalogTemporarilyUnavailable extends ScalencyError {
  constructor(){super('Les options Vinted de cette catégorie sont temporairement indisponibles.',503)}
}

// Combinations recorded on published French listings, verified on 2026-11-28.
// Keep the size set specific to the category. Final submission still does a live dry run.
const publishedSizes=new Map([
  ['1777',[[1739,'M'],[1740,'L'],[1741,'XL']]],
  ['1778',[[1738,'S'],[1739,'M'],[1740,'L'],[1741,'XL']]],
  ['1835',[[1739,'M'],[1741,'XL']]]
])
function confirmedOptionsWhileLoading(id){
  const sizes=publishedSizes.get(id)
  if(!sizes)throw new CatalogTemporarilyUnavailable()
  const {title}=womensClothingCatalog.find(row=>row.id===Number(id))
  return {catalog:{id:Number(id),title},source:'confirmed-listings',conditions:[{id:2,title:'Très bon état'}],
    package_sizes:[{id:1,title:'Petit'}],size_groups:[{sizes:sizes.map(([id,title])=>({id,title}))}],attributes:[]}
}

export async function readCategoryOptions(category,read=remote,secondary=listingMetadata,wait=ms=>new Promise(r=>setTimeout(r,ms))){
  const id=remoteId(category),path='catalogs/'+id
  const primary=async()=>{
    const result=await read(path)
    if(result?.offline)throw new CatalogTemporarilyUnavailable()
    return result
  }
  try{return await primary()}
  catch(error){
    if(!temporaryReferenceError(error))throw error
    // Both sources describe the same French Vinted category. Never reuse another category's options.
    try{
      const options=await secondary(path+'/options?country=FR&locale=fr')
      if(options?.catalog?.id===Number(id)&&!options.offline&&Array.isArray(options.conditions)
        &&Array.isArray(options.package_sizes)&&Array.isArray(options.size_groups))return options
    }catch{/* Scalency may finish loading its reference data before the second read. */}
    if(error.status===429)return confirmedOptionsWhileLoading(id)
    await wait(2000)
    try{return await primary()}
    catch(retryError){
      if(!temporaryReferenceError(retryError))throw retryError
      return confirmedOptionsWhileLoading(id)
    }
  }
}
export async function workspaceCategoryOptions(db,category,read=readCategoryOptions){
  const id=remoteId(category),key='category-options-fr:'+id
  const usable=options=>options?.catalog?.id===Number(id)&&!options.offline&&options.conditions?.length>0
    &&options.package_sizes?.length>0&&Array.isArray(options.size_groups)&&Array.isArray(options.attributes)
  let saved
  try{
    saved=check(await db.from('scalency_settings').select('value').eq('id',key).maybeSingle())?.value
  }catch{/* Reference data is optional. Reading the live catalogue still works. */}
  const age=Date.now()-Date.parse(saved?.at)
  const cached=age>=0&&age<7*86400000&&usable(saved.options)?saved.options:null
  if(cached&&age<15*60000)return cached
  let options
  try{options=await read(id)}
  catch(error){
    if(error instanceof CatalogTemporarilyUnavailable&&cached)return cached
    throw error
  }
  if(options?.source==='confirmed-listings')return cached||options
  if(usable(options)){
    try{check(await db.from('scalency_settings').upsert({id:key,value:{at:new Date().toISOString(),options}}))}
    catch{/* The current options are usable even when the copy cannot be saved. */}
  }
  return options
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
