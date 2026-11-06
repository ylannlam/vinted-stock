import {randomUUID} from 'node:crypto'
import {AppError,isId} from './dotb.js'
import {readDotbItems,normalizeDotbItems} from './catalog.js'
import {CATEGORIES,validatePricing} from '../src/lib/library.js'
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
