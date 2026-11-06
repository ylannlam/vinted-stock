import {randomUUID} from 'node:crypto'
import {AppError,isId} from './dotb.js'
import {readDotbItems,normalizeDotbItems} from './catalog.js'
import {CATEGORIES,validatePricing,listingFacts,salePriceOf,productCategory} from '../src/lib/library.js'
import {collectionReferences} from '../src/lib/collector.js'

const check=r=>{if(r.error)throw r.error;return r.data}
export const missingRelation=e=>['42P01','42883','PGRST202','PGRST205'].includes(e?.code)

// Relevé des articles Dotb (avec SKU) : pages de 100, reprise au même curseur si le temps manque.
export async function syncDotbLibrary(db,{read=readDotbItems,deadline=Date.now()+45000}={}) {
  const lease=randomUUID()
  const claim=await db.rpc('library_claim_dotb_sync',{p_lease:lease})
  if(claim.error?.message?.includes('sync_running'))throw new AppError('Un relevé Dotb est déjà en cours. Réessaie dans une minute.',409)
  let cursor=check(claim)?.cursor||null,pages=0,items=0
  try {
    do {
      const page=await read(cursor||undefined)
      const rows=normalizeDotbItems(page.data)
      const next=page.has_more?page.next_cursor:null
      const r=await db.rpc('library_import_dotb_page',{p_items:rows,p_cursor:next,p_lease:lease})
      if(r.error?.message?.includes('sync_lease_expired'))throw new AppError('Le relevé a pris trop de temps. Relance-le : il reprendra où il s’est arrêté.',409)
      check(r);cursor=next;pages++;items+=rows.length
    } while(cursor&&Date.now()<deadline)
  } catch(e) {
    await db.rpc('library_release_dotb_sync',{p_lease:lease})
    throw e
  }
  if(cursor)check(await db.rpc('library_release_dotb_sync',{p_lease:lease}))
  return {done:!cursor,pages,items}
}

export function validateMeta(body) {
  if(!isId(body?.product_id))throw new AppError('Produit invalide.')
  const category=body.category==null||body.category===''?null:body.category
  if(category!==null&&!CATEGORIES.some(([k])=>k===category))throw new AppError('Catégorie inconnue.')
  let sale_price=null
  if(body.sale_price!==null&&body.sale_price!==''&&body.sale_price!==undefined) {
    sale_price=Number(String(body.sale_price).replace(',','.'))
    if(!Number.isFinite(sale_price)||sale_price<=0||sale_price>=100000)throw new AppError('Prix de vente invalide.')
    sale_price=Math.round(sale_price*100)/100
  }
  return {product_id:body.product_id,category,sale_price}
}

// Actions de la bibliothèque (administrateur). Renvoie undefined si l'action n'est pas d'ici.
export async function handleLibraryAction(db,user,body,{sync=syncDotbLibrary}={}) {
  if(body.action==='library-add') {
    let refs;try{refs=collectionReferences(body.references)}catch(e){throw new AppError(e.message)}
    const source=body.source==='listing'?'listing':'manual'
    return {queued:check(await db.rpc('library_add_references',{p_refs:refs,p_source:source,p_user:user.id})),references:refs.length}
  }
  if(body.action==='library-sync')return sync(db)
  if(body.action==='product-meta') {
    const meta=validateMeta(body)
    if(meta.category===null&&meta.sale_price===null)check(await db.from('catalog_product_meta').delete().eq('product_id',meta.product_id))
    else check(await db.from('catalog_product_meta').upsert({...meta,updated_by:user.id,updated_at:new Date().toISOString()},{onConflict:'product_id'}))
    return {saved:true,...meta}
  }
  if(body.action==='pricing') {
    let pricing;try{pricing=validatePricing(body.pricing)}catch(e){throw new AppError(e.message)}
    check(await db.from('catalog_settings').update({pricing,updated_by:user.id,updated_at:new Date().toISOString()}).eq('id',true))
    return {saved:true,pricing}
  }
}

// Données en plus de la bibliothèque : articles postés, grille et état du relevé Dotb.
export async function readLibraryExtras(db,readPage,offset) {
  const [posted,settings,sync]=await Promise.all([
    readPage(head=>db.from('catalog_library_posted').select('*',{count:'exact',head}).order('sku').order('id'),offset),
    offset?{data:null}:db.from('catalog_settings').select('pricing,updated_at').eq('id',true).maybeSingle(),
    offset?{data:null}:db.from('catalog_sync_state').select('last_completed_at,locked_until,cursor').eq('id',true).maybeSingle(),
  ])
  if(settings.error)throw settings.error
  if(sync.error)throw sync.error
  return {posted:posted.data,posted_count:posted.count,pricing:settings.data?.pricing||null,
    dotb_sync:sync.data?{last_completed_at:sync.data.last_completed_at,running:Date.parse(sync.data.locked_until)>Date.now(),resumable:!!sync.data.cursor}:null}
}

// --- Création d'annonce : le SKU retrouve sa fiche Shein (bibliothèque), sinon le PC va la chercher.
const SKU=/^[A-Za-z0-9_-]{1,200}$/
const like=v=>v.replace(/[\\%_]/g,m=>'\\'+m)
export async function findSheinProduct(db,sku) {
  if(!SKU.test(sku||''))return null
  const link=check(await db.from('catalog_sku_links').select('product_id').ilike('sku',like(sku)).not('product_id','is',null).limit(1))
  let query=db.from('catalog_product_summary').select('*').limit(1)
  query=link?.[0]?.product_id?query.eq('id',link[0].product_id):query.ilike('supplier_sku',like(sku))
  return check(await query.order('updated_at',{ascending:false}))?.[0]||null
}
// Faits Shein pour la rédaction de l'annonce ; null si le SKU n'a pas (encore) de fiche.
export async function sheinListingFacts(db,sku,size) {
  const product=await findSheinProduct(db,String(sku||'').trim())
  return product?.collection_status==='completed'||product?.details?.length?listingFacts(product,size):null
}
async function optional(promise,fallback) {
  const r=await promise
  if(r.error){if(missingRelation(r.error))return fallback;throw r.error}
  return r.data??fallback
}
export async function lookupListingSku(db,user,{sku,size,queue=false}) {
  sku=String(sku||'').trim()
  if(!SKU.test(sku))throw new AppError('SKU invalide : lettres, chiffres, - et _ uniquement.')
  const [product,job,collectors]=await Promise.all([
    findSheinProduct(db,sku),
    db.from('catalog_collection_jobs').select('status,message,created_at').ilike('expected_sku',like(sku)).order('created_at',{ascending:false}).limit(1).then(check),
    db.from('catalog_collectors').select('last_seen_at,enabled').is('revoked_at',null).then(check),
  ])
  const online=(collectors||[]).some(c=>c.enabled&&Date.now()-Date.parse(c.last_seen_at)<120000)
  const latest=job?.[0]||null
  if(product&&(product.collection_status==='completed'||product.details?.length)) {
    const [meta,settings]=await Promise.all([
      optional(db.from('catalog_product_meta').select('category,sale_price').eq('product_id',product.id).maybeSingle(),null),
      optional(db.from('catalog_settings').select('pricing').eq('id',true).maybeSingle(),null),
    ])
    const full={...product,...(meta||{})},facts=listingFacts(full,size)
    return {status:'found',collector_online:online,refreshing:['queued','running'].includes(latest?.status),
      product:{id:product.id,title:product.title,supplier_url:product.supplier_url,photo_url:product.photo_url,price:product.price,observed_at:product.observed_at,category:productCategory(full),sizes:product.sizes||[]},
      sale_price:salePriceOf(full,settings?.pricing)?.price??null,measures:facts.measures,details:facts.details.length}
  }
  if(['queued','running'].includes(latest?.status))return {status:'pending',collector_online:online}
  // Recherche automatique (saisie du SKU) : un échec n'est pas relancé tout seul.
  if(!queue||queue==='auto'&&['failed','blocked'].includes(latest?.status))return {status:latest&&['failed','blocked'].includes(latest.status)?'failed':'unknown',message:latest?.message||null,collector_online:online}
  const refs=[{reference_key:`sku:${sku.toLowerCase()}`,input:sku,expected_sku:sku,expected_supplier_id:null}]
  const r=await db.rpc('library_add_references',{p_refs:refs,p_source:'listing',p_user:user.id})
  if(r.error){if(missingRelation(r.error))return {status:'unavailable',collector_online:online,message:'Active la bibliothèque (migration Supabase) pour chercher un nouveau SKU sur Shein.'};throw r.error}
  return {status:'pending',queued:r.data,collector_online:online}
}
