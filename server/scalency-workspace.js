import {cadenceReport,capacityResult,setCadence} from './scalency-cadence.js'
import {readAccountHealth,requireWorkspaceAccount} from './scalency-account-health.js'
import {isId} from './dotb.js'
import {createHash} from 'node:crypto'
import {collections,remote,remoteId,ScalencyError,snapshot,shippable,draftPayload} from './scalency-api.js'
import {verifiedPhotos,listingFields,listingAiToken,generateListingText} from './listing-studio-core.js'
import {ASSET_BUCKET} from './resources.js'
import {readListingSettings} from './listing-settings.js'
import {prepareQuickDraft,quickProfiles,saveQuickBrand,saveQuickSize,verifyQuickFields} from './scalency-quick.js'
import {bioCondition,conditionForCatalog,withBioCondition} from '../src/lib/scalencyQuick.js'
import {listingFacts} from '../src/lib/library.js'
import {catalogChoices,matchingSize} from '../src/lib/listingStudio.js'
import {listingCatalogs,readCategoryOptions} from './scalency-catalogs.js'
import {updateSeoDetails} from '../src/lib/vintedSeo.js'
import {nextHistoryPage} from './scalency-history.js'
import {managePublication} from './scalency-publication-actions.js'
import {reschedulePublications} from './scalency-reschedule.js'
import {activePublicationCounts,publicationTracking} from './scalency-publications.js'
import {batchDrafts,batchImages,checkBatchSubmission,reviewEditedDraft,reviewMetadata} from './scalency-batch.js'
import {acceptPublicationLot,publicationLots,retryLotEntry,reviewDuplicates} from './scalency-lots.js'
import {catalogProduct,connectedRecords,draftSource} from './scalency-relations.js'
import {skuFeed,skuReferences,linkSku} from './scalency-sku.js'
import {parisDay,validDay} from '../src/lib/publications.js'
import {readShopBoard} from './shop-board.js'
import {refreshShopPage,saveListingSku} from './shop-refresh.js'
import {salesStart,restrictOrderPage} from '../src/lib/shopPeriod.js'
const fail=(message,status)=>{throw new ScalencyError(message,status)}
const checked=r=>{if(r.error)throw r.error;return r.data}
const pageSize=36
const value=(q,key)=>String(q[key]||'').slice(0,180)
const table='scalency_records'
const now=()=>new Date().toISOString()

export async function saveRecords(db,kind,rows,stamp=now()){
  if(rows.length) checked(await db.from(table).upsert(rows.map(r=>snapshot(kind,r,stamp)),{onConflict:'kind,account,remote_id'}))
  if(rows.length&&(['items','orders'].includes(kind))){
    if(rows.some(r=>r.supplier_link||r.items?.some(i=>i.supplier_link)))checked(await db.rpc('scalency_import_references'))
    if(kind==='items')checked(await db.rpc('scalency_connect_pieces'))
  }
  if(kind==='jobs'){
    const terminal=rows.filter(r=>r.type==='publish'&&['done','failed','skipped','cancelled'].includes(r.status))
    if(terminal.length){
      const drafts=checked(await db.from('listing_drafts').select('id,payload').eq('state','scheduled').in('payload->>scalency_job_id',terminal.map(r=>String(r.id))))
      for(const draft of drafts){
        const job=terminal.find(r=>String(r.id)===String(draft.payload.scalency_job_id))
        const live=job.status==='done'&&!!job.new_item_id
        const patch=live?{state:'published',published_at:job.done_at||job.updated_at||stamp,vinted_id:String(job.new_item_id),message:'En ligne sur Vinted'}:{state:'attention',message:job.reason||'Vérifie cette demande dans Scalency.'}
        checked(await db.from('listing_drafts').update(patch).eq('id',draft.id).eq('state','scheduled'))
      }
    }
  }
}
export async function syncPage(db,kind,{older=false,force=false}={}){
  if(!collections.includes(kind))fail('Collection inconnue.')
  if(older)return nextHistoryPage(db,kind)
  const state=checked(await db.from('scalency_sync').select('*').eq('kind',kind).maybeSingle())
  if(older&&state?.complete)return state
  if(!older&&!force&&state&&Date.now()-Date.parse(state.updated_at)<60000)return state
  const stamp=now()
  const options={limit:100,cursor:older?state?.cursor_value:null}
  if(kind==='orders')Object.assign(options,{state:'all',sort:'order_date'})
  const page=await remote(kind,{query:options})
  const result=kind==='orders'?restrictOrderPage(page):page
  await saveRecords(db,kind,result.data||[],stamp)
  const next={kind,updated_at:stamp,...(!state||older?{cursor_value:result.next_cursor||null,complete:!result.has_more}:{})}
  if(!state)checked(await db.from('scalency_sync').upsert(next,{onConflict:'kind',ignoreDuplicates:true}))
  else {
    let update=db.from('scalency_sync').update(next).eq('kind',kind)
    if(older)update=update.eq('updated_at',state.updated_at)
    checked(await update)
  }
  return next
}
async function list(db,kind,q){
  const page=Math.max(0,Math.min(100000,parseInt(q.page,10)||0))
  let read=db.from(kind==='items'?'scalency_catalog_inventory':table).select('*',{count:'exact'}).eq('kind',kind)
  if(kind==='orders')read=read.gte('sort_at',salesStart)
  const term=value(q,'search').replace(/[%_\\]/g,' ')
  if(term)read=read.ilike(kind==='accounts'?'payload->>login':'payload->>title','%'+term+'%')
  if(q.account)read=read.eq('account',value(q,'account'))
  if(q.focus)read=read.eq('remote_id',remoteId(q.focus))
  if(kind==='items'&&q.filter==='unlinked')read=read.is('item_id',null)
  if(kind==='items'&&q.filter==='withdraw')read=read.eq('linked_sale',true).eq('payload->>status','active').eq('payload->>sold','false')
  if(kind==='accounts')read=read.order('payload->>linked',{ascending:false}).order('payload->>login')
  if(kind==='jobs'&&q.filter==='failed')read=read.in('payload->>status',['failed','error','attention','needs_review'])
  if(kind==='conversations'&&q.filter==='unread')read=read.eq('payload->>unread','true')
  if(kind==='orders'&&q.filter==='prepare')read=read.is('payload->>packed_at',null).in('payload->>state',['ready','to_pack','to_order','waiting','to_prepare','preparing','partial','to_ship'])
  const r=await read.order('sort_at',{ascending:false,nullsFirst:false}).order('remote_id').order('account').range(page*pageSize,(page+1)*pageSize-1)
  checked(r)
  const sync=checked(await db.from('scalency_sync').select('*').eq('kind',kind).maybeSingle())
  return {rows:r.data,total:r.count,page,pageSize,sync,connected:!!process.env.SCALENCY_API_KEY}
}
async function orderDetails(db,id,account){
  let read=db.from(table).select('payload,account').eq('kind','orders').eq('remote_id',id)
  if(account)read=read.eq('account',account)
  const stored=checked(await read.maybeSingle()),order=stored?.payload
  if(!order)fail('Commande introuvable.',404)
  const [entryRows,costRows]=await Promise.all([
    db.from('scalency_order_products').select('*').eq('order_id',id).eq('login',stored.account),
    db.from('scalency_sale_costs').select('*').eq('order_id',id)])
  const entries=checked(entryRows),local=checked(costRows)
  const archiveIds=entries.map(e=>e.archive_line).filter(Boolean)
  const oldLines=archiveIds.length?checked(await db.from('sales_lines').select('id,actual_cost,location,notes,fees_amount,refund_amount,finance_confirmed').in('id',archiveIds)):[]
  const items=await Promise.all((order.items||[]).map(async item=>{
    const line=entries.find(e=>e.line_id===String(item.id))
    const saved=local.find(e=>e.line_id===String(item.id)),old=oldLines.find(e=>e.id===line?.archive_line)
    const ad=line?.listing&&line.account_id?checked(await db.from('scalency_inventory').select('size,emplacement').eq('remote_id',line.listing).eq('account',line.account_id).maybeSingle()):null
    return {...item,location:ad?.emplacement||old?.location||item.location,size:ad?.size||line?.size_text,sku:line?.sku||item.sku,notes:saved?.notes??old?.notes,actual_cost:saved?saved.actual_cost:old?.actual_cost,fees:saved?.fees_amount??old?.fees_amount,refund:saved?.refund_amount??old?.refund_amount,confirmed:saved?saved.finance_confirmed:old?.finance_confirmed}
  }))
  return {...order,items}
}
async function once(db,user,action,key,run){
  const request_id=action+'-'+createHash('sha256').update(key).digest('hex')
  const put=await db.from('scalency_commands').insert({request_id,owner_id:user.id,action})
  if(put.error?.code==='23505'){
    const old=checked(await db.from('scalency_commands').select('result').eq('request_id',request_id).single())
    if(old.result)return old.result
    fail('Cette demande est déjà partie. Vérifie la file Scalency avant toute nouvelle tentative.',409)
  }
  checked(put)
  try{
    const result=await run()
    checked(await db.from('scalency_commands').update({result}).eq('request_id',request_id))
    return result
  }catch(error){
    if(error instanceof ScalencyError&&error.status>=400&&error.status<500)checked(await db.from('scalency_commands').delete().eq('request_id',request_id))
    throw error
  }
}
const draftCols='id,version,state,fields,photos,owner_id,published_at,updated_at,stock_item_id,catalog_product_id'
async function photosFor(db,photos,seconds){
  if(!photos.length)return []
  return checked(await db.storage.from(ASSET_BUCKET).createSignedUrls(photos.map(p=>p.path),seconds)).map(x=>{if(!x.signedUrl)fail('Une photo est indisponible.',409);return x.signedUrl})
}
async function catalogConditions(fields){
  return fields.catalog_id?readCategoryOptions(fields.catalog_id):null
}
function applyCondition(fields,options){
  const next={...withBioCondition(fields),status_id:conditionForCatalog(options)}
  if(next.description.length>2000)fail('Raccourcis la bio pour conserver la ligne d’état dans les 2 000 caractères.')
  return next
}
export async function prepareScalencyPublication(db,row,{quick=false,schedule=null}={}){
  await requireWorkspaceAccount(db,row.fields.account_id)
  const options=await catalogConditions(row.fields)
  row.fields=applyCondition(row.fields,options)
  if(!row.fields.status_id)fail('Très bon état indisponible pour cette catégorie.',409)
  if(quick)await verifyQuickFields(db,row.fields,options)
  const at=schedule?new Date(schedule):null
  if(at&&(!Number.isFinite(at.getTime())||at<=new Date()||at.getTime()-Date.now()>30*86400000))fail('Choisis une date future dans les 30 prochains jours.')
  const payload=draftPayload(row,await photosFor(db,row.photos,35*86400),row.fields.account_id,at?.toISOString())
  const source=await draftSource(db,row.stock_item_id,row.catalog_product_id,row.fields.sku)
  if(source.stock?.emplacement)payload.location=source.stock.emplacement
  const supplier=source.stock?.shein_url||source.product?.supplier_url
  if(supplier&&/^https?:\/\//i.test(supplier))payload.supplier_link=supplier
  async function validatePayload(){
    const preview=await remote('items',{method:'POST',body:{...payload,dry_run:true}})
    if(preview.dry_run!==true||preview.would_queue!==true)fail(preview.reason||'Scalency ne peut pas accepter cette annonce.',409)
    await requireWorkspaceAccount(db,row.fields.account_id)
    return preview
  }
  return {payload,preview:await validatePayload(),at}
}
async function getDraft(db,user,id){
  const row=checked(await db.from('listing_drafts').select(draftCols+',payload').eq('id',remoteId(id)).eq('owner_id',user.id).maybeSingle())
  if(!row)fail('Brouillon introuvable.',404)
  return row
}
async function drafts(db,user,q){
  const page=Math.max(0,parseInt(q.page,10)||0)
  const r=await db.from('listing_drafts').select('id,version,state,fields,updated_at',{count:'exact'}).eq('owner_id',user.id).eq('state','draft').order('updated_at',{ascending:false}).range(page*pageSize,(page+1)*pageSize-1)
  checked(r);return {rows:r.data,total:r.count,page,pageSize}
}
export async function scalencyHandler(req,res,{db,user,role}){
  const q=req.query, b=req.body||{}, action=req.method==='GET'?q.view:b.action
  if(role!=='admin'&&!['shop-board','shop-refresh','home','orders','items','order','label','pack','stock','link','relations','product'].includes(action)&&!(action==='sync'&&['orders','items'].includes(b.kind)))fail('Réservé à l’administrateur.',403)
  if(req.method==='GET'){
    if(action==='shop-board')return res.json(await readShopBoard(db,user,role==='admin'))
    if(action==='shop-refresh')return res.json(await refreshShopPage(db,q.source,q.cursor||'',q.force==='1'))
    if(action==='daily-publications'){
      if(!validDay(q.day))fail('Choisis un jour valide.',400)
      res.setHeader('Cache-Control','private, no-store')
      let syncDelayed=false
      if(q.reconcile==='1'&&q.day===parisDay()){
        try{await syncPage(db,'jobs')}catch{syncDelayed=true}
      }
      const report=checked(await db.rpc('scalency_publications_on_day',{p_day:q.day}))
      return res.json({...report,syncDelayed})
    }
    if(action==='sku-feed'||action==='sku-references'){
      res.setHeader('Cache-Control','private, no-store')
      return res.json(action==='sku-feed'?await skuFeed(q.feed,q.cursor||''):await skuReferences(db,user))
    }
    if(action==='cadence'){
      res.setHeader('Cache-Control','private, no-store')
      await syncPage(db,'jobs')
      const [rows,counts]=await Promise.all([cadenceReport(db),activePublicationCounts()])
      return res.json(rows.map(row=>({...row,queued:counts?(counts.get(row.account)??0):null})))
    }
    if(action==='publication-planning'){
      if(!validDay(q.day)||!['planned','added'].includes(q.filter))fail('Choisis une date et un filtre valides.',400)
      res.setHeader('Cache-Control','private, no-store')
      let syncDelayed=false
      try{await syncPage(db,'jobs')}catch{syncDelayed=true}
      const [result,counts]=await Promise.all([
        db.rpc('scalency_publication_planning',{p_owner:user.id,p_day:q.day,p_filter:q.filter,
          p_account:q.account?remoteId(q.account):null,p_page:Math.min(100000,Math.max(0,parseInt(q.page,10)||0))}),
        activePublicationCounts()
      ])
      const report=checked(result)
      const accounts=report.accounts.map(row=>({...row,queued:counts?(counts.get(row.account)??0):null}))
      return res.json({...report,accounts,syncDelayed:syncDelayed||!counts})
    }
    if(action==='lot-capacity'){
      if(!validDay(q.day))fail('Choisis un jour valide.',400)
      res.setHeader('Cache-Control','private, no-store')
      return res.json(capacityResult(await db.rpc('scalency_daily_capacity',{p_account:remoteId(q.account),p_day:q.day})))
    }
    if(action==='batch-drafts')return res.json(await batchDrafts(db,user,q))
    if(action==='publication-lots')return res.json(await publicationLots(db,user,q,saveRecords))
    if(action==='publication-tracking')return res.json(await publicationTracking(db,user,q))
    if(action==='account-health'){
      res.setHeader('Cache-Control','private, no-store')
      if(q.account)return res.json(await requireWorkspaceAccount(db,q.account))
      return res.json(await readAccountHealth(db))
    }
    if(action==='quick-profiles')return res.json(await quickProfiles(db,user))
    if(action==='relations')return res.json(await connectedRecords(db,user,role,q))
    if(action==='product')return res.json(await catalogProduct(db,q.id))
    if(action==='draft-source')return res.json(await draftSource(db,q.piece,q.product,q.sku))
    if(action==='orders'&&q.filter==='archive'){
      const page=Math.max(0,parseInt(q.page)||0)
      let read=db.from('workspace_sales').select('id,source,account_login,actual_cost,notes,location,sale_date,order_status,listing_photo_url',{count:'exact'}).gte('sale_date',salesStart)
      if(q.focus)read=read.eq('id',value(q,'focus'))
      const result=await read.order('sale_date',{ascending:false}).order('id').range(page*pageSize,(page+1)*pageSize-1)
      checked(result)
      return res.json({page,pageSize,total:result.count,rows:result.data.map(x=>({remote_id:x.id,account:x.account_login,payload:{archive:true,id:x.id,title:x.source?.title,account:x.account_login,status_fr:x.order_status,photo_url:x.listing_photo_url,actual_cost:x.actual_cost,notes:x.notes,location:x.location,date:x.sale_date}}))})
    }
    if(collections.includes(action))return res.json(await list(db,action,q))
    if(action==='home'){
      const groups=role==='admin'?['orders','items','jobs','accounts']:['orders','items']
      const results=await Promise.all(groups.map(k=>list(db,k,{filter:({orders:'prepare',items:'withdraw',jobs:'failed'})[k]})))
      return res.json({connected:!!process.env.SCALENCY_API_KEY,groups:Object.fromEntries(groups.map((k,i)=>[k,{total:results[i].total,rows:results[i].rows.slice(0,5),sync:results[i].sync}]))})
    }
    if(action==='stock'){
      const page=Math.max(0,parseInt(q.page,10)||0)
      let read=db.from('items').select('id,category,size,photo_url,emplacement,status,shein_url',{count:'exact'}).is('deleted_at',null).eq('status','en_stock')
      if(q.search)read=read.ilike('emplacement','%'+value(q,'search')+'%')
      const r=await read.order('emplacement').order('id').range(page*pageSize,(page+1)*pageSize-1);checked(r)
      return res.json({rows:r.data,total:r.count,page,pageSize})
    }
    if(action==='order')return res.json(await orderDetails(db,remoteId(q.id),q.account))
    if(action==='label'){const pdf=await remote('orders/'+remoteId(q.id)+'/label',{pdf:true});res.setHeader('Content-Type','application/pdf');res.setHeader('Content-Disposition','attachment; filename="bordereau.pdf"');return res.send(pdf)}
    if(action==='thread'){
      const id=remoteId(q.id),account=remoteId(q.account)
      const thread=await remote('conversations/'+id,{query:{account_id:account}})
      const listing=thread.item?.vinted_id||thread.item?.id||thread.item_id
      if(listing&&(!thread.account_id||String(thread.account_id)===account))
        checked(await db.from('scalency_thread_items').upsert({account,thread:id,listing:remoteId(listing)}))
      return res.json(thread)
    }
    if(action==='drafts')return res.json(await drafts(db,user,q))
    if(action==='draft'){
      const {payload,...row}=await getDraft(db,user,q.id)
      return res.json({...row,urls:await photosFor(db,row.photos,3600)})
    }
    if(action==='catalogs')return res.json(await remote('catalogs',{query:{limit:100,cursor:q.cursor}}))
    if(action==='catalog-tree')return res.json({data:await listingCatalogs(db)})
    if(action==='catalog-choices')return res.json({data:catalogChoices(await listingCatalogs(db))})
    if(action==='category')return res.json(await readCategoryOptions(q.id))
    if(action==='connection')return res.json({configured:!!process.env.SCALENCY_API_KEY,webhook:!!checked(await db.from('scalency_settings').select('id').eq('id','webhook').not('value->>id','is',null).maybeSingle())})
    fail('Vue inconnue.',404)
  }
  if(req.method!=='POST')fail('Méthode invalide.',405)
  if(action==='listing-sku')return res.json(await saveListingSku(db,b))
  if(action==='sku-link')return res.json(await linkSku(db,b))
  if(action==='cadence-save')return res.json(await setCadence(db,b))
  if(action==='manage-publication')return res.json(await managePublication(db,user,b,saveRecords))
  if(action==='move-publications')return res.json(await reschedulePublications(db,user,b,saveRecords))
  if(action==='accept-lot')return res.json(await acceptPublicationLot(db,user,b))
  if(action==='retry-lot-entry')return res.json(await retryLotEntry(db,user,b))
  if(action==='lot-duplicates')return res.json(await reviewDuplicates(db,user,b))
  if(action==='lot-review-edit'){
    const row=await getDraft(db,user,b.id)
    checkBatchSubmission(row,b.account)
    if(row.state!=='draft'||row.version!==b.version)fail('La fiche a changé. Actualise le récapitulatif.',409)
    await requireWorkspaceAccount(db,row.fields.account_id)
    const price=String(b.price??'').trim().replace(',','.'),size=String(b.size??'').trim()
    if(!/^\d{1,5}(?:\.\d{1,2})?$/.test(price)||Number(price)<=0||!size||size.length>60)fail('Vérifie le prix et la taille.')
    const options=await catalogConditions(row.fields),fields={...row.fields,price}
    if(size!==fields.size_text){
      const sizeId=matchingSize(size,options)
      if(!sizeId)fail('Choisis une taille proposée pour cette catégorie dans le formulaire détaillé.')
      Object.assign(fields,updateSeoDetails(fields,{size}),{size_text:size,size_id:sizeId})
    }
    await verifyQuickFields(db,fields,options)
    const saved=checked(await db.from('listing_drafts').update({version:row.version+1,fields,updated_at:now()})
      .eq('id',row.id).eq('owner_id',user.id).eq('state','draft').eq('version',row.version).select('id,version,fields').maybeSingle())
    if(!saved)fail('La fiche a changé. Actualise le récapitulatif.',409)
    return res.json(saved)
  }
  if(action==='cost'){
    const id=remoteId(b.id), line=remoteId(b.line),order=await orderDetails(db,id,b.account)
    if(!order.items.some(i=>String(i.id)===line))fail('Article introuvable.',404)
    const cost=b.cost===''?null:Number(b.cost)
    if(cost!==null&&(!Number.isFinite(cost)||cost<0||cost>99999999)||typeof b.notes!=='string'||b.notes.length>2000)fail('Coût ou note invalide.')
    const patch={order_id:id,line_id:line,actual_cost:cost,notes:b.notes}
    for(const [field,property] of [['fees','fees_amount'],['refund','refund_amount']]){
      if(!Object.hasOwn(b,field))continue
      const amount=b[field]===''?null:Number(b[field])
      if(amount!==null&&(!Number.isFinite(amount)||amount<0||amount>99999999))fail('Montant invalide.')
      patch[property]=amount
    }
    if(b.confirmed===true&&(cost===null||patch.fees_amount==null||patch.refund_amount==null))fail('Renseigne le coût, les frais et les remboursements, y compris les montants à zéro.')
    patch.finance_confirmed=b.confirmed===true
    checked(await db.from('scalency_sale_costs').upsert(patch))
    return res.json({saved:true})
  }
  if(action==='sync'){
    return res.json(await syncPage(db,b.kind,{older:b.older===true,force:b.force===true}))
  }
  if(action==='link'){
    const result=await db.rpc('scalency_set_piece',{p_account:remoteId(b.account),p_listing:remoteId(b.id),p_item:b.item===null?null:remoteId(b.item),p_previous:b.previous?remoteId(b.previous):null})
    if(result.error?.message==='link_changed')fail('L’association a changé. Actualise la fiche.',409)
    checked(result)
    return res.json({saved:true})
  }
  if(action==='pack'){
    const id=remoteId(b.id), order=await remote('orders/'+id)
    if(!order.packed_at&&(!Array.isArray(order.items)||!order.items.length||!order.items.every(i=>b.checks?.[i.id]==='visual')))fail('Vérifie chaque pièce avant de confirmer.')
    if(!order.packed_at)await remote('orders/'+id+'/pack',{method:'POST',body:{checks:Object.fromEntries(order.items.map(i=>[i.id,'visual']))}})
    await saveRecords(db,'orders',[await remote('orders/'+id)])
    return res.json({packed:true})
  }
  if(action==='webhook'){
    const {enableWebhook}=await import('./scalency-webhook.js')
    return res.json(await enableWebhook(db))
  }
  if(action==='batch-discard'){
    const drafts=b.drafts,account=remoteId(b.account)
    if(!Array.isArray(drafts)||!drafts.length||drafts.some(d=>!d||!isId(d.id)||!Number.isSafeInteger(d.version)||d.version<1)
      ||new Set(drafts.map(d=>d.id)).size!==drafts.length)fail('Sélection de brouillons invalide.',400)
    const result=await db.rpc('scalency_discard_ready_drafts',{p_owner:user.id,p_account:account,p_drafts:drafts.map(({id,version})=>({id,version}))})
    if(result.error?.code==='P0001'&&result.error.message==='ready_draft_changed')fail('La sélection a changé. Actualise la liste avant de supprimer les annonces.',409)
    return res.json({removed:checked(result)})
  }
  if(action==='quick-size')return res.json(await saveQuickSize(db,b.account,b.size))
  if(action==='quick-brand')return res.json(await saveQuickBrand(db,b.account,b.name))
  if(action==='save'||action==='save-review'||action==='batch-create'){
    if(action==='batch-create'&&(b.owner!==user.id||b.version!=null))fail('Session différente. Rouvre l’atelier avec le compte d’origine.',409)
    const id=remoteId(b.id), input=listingFields(b.fields,{scalency:true})
    if(input.account_id||action==='batch-create')await requireWorkspaceAccount(db,input.account_id)
    const [options,photos]=await Promise.all([catalogConditions(input),verifiedPhotos(db,user.id,b.photos)])
    const fields=applyCondition(input,options)
    if(action==='batch-create'){
      if(!isId(id))fail('Identifiant de brouillon invalide.',400)
      const saved=checked(await db.rpc('scalency_create_batch_draft',{p_id:id,p_owner:user.id,p_fields:fields,p_photos:photos}).select(draftCols+',payload').maybeSingle())
      if(!saved)return res.json({id,state:'discarded',batch:null})
      const {payload,...draft}=saved
      return res.json({...draft,batch:payload?.batch||null})
    }
    const row={fields,photos,updated_at:now()}
    const previous=b.version==null?null:await getDraft(db,user,id)
    if(action==='save-review'||previous?.payload?.batch){
      const batch=action==='save-review'?await reviewEditedDraft(db,fields,photos,options):null
      row.payload={...previous?.payload,scalency_source:'stock-vinted',batch}
    }
    if(Object.hasOwn(b,'piece')||Object.hasOwn(b,'product')){
      const source=await draftSource(db,b.piece,b.product,fields.sku)
      row.stock_item_id=source.stock?.id||null
      row.catalog_product_id=source.product?.id||null
    }
    let result=b.version==null?await db.from('listing_drafts').insert({payload:{scalency_source:'stock-vinted'},...row,id,owner_id:user.id}).select(draftCols).single():
      await db.from('listing_drafts').update({...row,version:b.version+1}).eq('id',id).eq('owner_id',user.id).eq('state','draft').eq('version',b.version).select(draftCols).maybeSingle()
    if(!checked(result))fail('Ce brouillon a changé. Rouvre-le avant de continuer.',409)
    return res.json({...result.data,batch:row.payload?.batch})
  }
  if(['generate','autofill','autopost','validate','publish','quick-publish','batch-generate','batch-submit'].includes(action)){
    let row=await getDraft(db,user,b.id)
    if(row.version!==b.version||row.state!=='draft')fail('Ce brouillon a changé. Actualise avant de continuer.',409)
    if(['generate','autofill','autopost','batch-generate'].includes(action))await requireWorkspaceAccount(db,row.fields.account_id)
    if(action==='batch-generate'){
      const started=now(),version=row.version+1
      const payload={...row.payload,scalency_source:'stock-vinted',batch:{...row.payload?.batch,status:'running',started}}
      if(row.payload?.batch?.status==='running'&&Date.now()-Date.parse(row.payload.batch.started)<600000)fail('Cette annonce est déjà en cours de remplissage.',409)
      const locked=checked(await db.from('listing_drafts').update({payload,version,updated_at:started}).eq('owner_id',user.id).eq('id',row.id).eq('state','draft').eq('version',row.version).select('id').maybeSingle())
      if(!locked)fail('Le brouillon a changé. Actualise la liste.',409)
      try{return res.json(await prepareQuickDraft(db,user,req,{...row,payload,version},(db,photos)=>batchImages(db,user.id,photos),reviewMetadata))}
      catch(error){
        const batch={...payload.batch,status:'error',missing:[error.message||'Le remplissage a été interrompu.']}
        checked(await db.from('listing_drafts').update({payload:{...payload,batch},version:version+1,updated_at:now()}).eq('owner_id',user.id).eq('id',row.id).eq('state','draft').eq('version',version))
        throw error
      }
    }
    if(action==='batch-submit')checkBatchSubmission(row,b.account)
    if(action==='autofill')return res.json(await prepareQuickDraft(db,user,req,row,photosFor))
    if(action==='autopost'){
      const prepared=await prepareQuickDraft(db,user,req,row,photosFor)
      if(prepared.missing.length)return res.json(prepared)
      row={...row,...prepared}
    }
    if(action==='generate'){
      const urls=await photosFor(db,row.photos.slice(0,3),300)
      if(!urls.length)fail('Ajoute une photo du vêtement.')
      const presets=await readListingSettings(db,row.fields.account_id||null)
      const source=await draftSource(db,null,row.catalog_product_id,row.fields.sku)
      const facts=listingFacts(source.product,row.fields.size_text||'')
      const result=await generateListingText({...row,fields:{...row.fields,seo_condition:bioCondition}},urls,[],[],{token:listingAiToken(req),settings:presets.effective,quick:true,shein:facts})
      return res.json({title:result.title,description:result.description})
    }
    const {payload,preview,at}=await prepareScalencyPublication(db,row,{quick:['quick-publish','autopost','batch-submit'].includes(action),schedule:b.schedule})
    if(action==='validate')return res.json(preview)
    const result=await once(db,user,'publish',row.id,async()=>{
      const locked=capacityResult(await db.rpc('scalency_reserve_single',{p_account:row.fields.account_id,p_owner:user.id,
        p_draft:row.id,p_version:row.version,p_fields:row.fields,p_due:at?.toISOString()||null}))
      if(!locked)fail('Le brouillon a changé. Rouvre-le.',409)
      try{
        const queued=await remote('items',{method:'POST',body:payload})
        if(!queued.job?.id)throw new ScalencyError('Scalency doit confirmer la mise en file.',502)
        return queued
      }catch(error){
        const rejected=error instanceof ScalencyError&&error.status>=400&&error.status<500
        checked(await db.from('listing_drafts').update({state:rejected?'draft':'attention',message:rejected?'Envoi refusé par Scalency':'Vérifie la file Scalency avant de réessayer.'}).eq('id',row.id).eq('state','preparing'))
        throw error
      }
    })
    checked(await db.from('listing_drafts').update({state:'scheduled',message:'En file Scalency',payload:{scalency_job_id:result.job?.id},scheduled_at:at?.toISOString()||now(),version:row.version+1}).eq('id',row.id).eq('version',row.version))
    if(result.job)await saveRecords(db,'jobs',[result.job])
    return res.json(result)
  }
  if(action==='reply'||action==='offer'){
    const id=remoteId(b.id),account=remoteId(b.account), thread=await remote('conversations/'+id,{query:{account_id:account}})
    const itemId=thread.item?.vinted_id||thread.item?.id||thread.item_id
    if(!itemId)fail('Disponibilité de l’article inconnue. Ouvre la conversation dans Scalency.',409)
    const item=await remote('items/'+remoteId(itemId),{query:{account_id:account}})
    if(item.status!=='active'||item.sold!==false)fail('Cet article est indisponible.',409)
    const data=action==='reply'?{text:String(b.text||'').trim()}:{price:Number(b.price)}
    if(action==='reply'&&(!data.text||data.text.length>2000)||action==='offer'&&!(data.price>0))fail('Vérifie le contenu de la réponse.')
    const result=await once(db,user,action,[account,id,remoteId(b.request)].join('/'),()=>remote('conversations/'+id+'/'+action,{method:'POST',body:{...data,account_id:account}}))
    return res.json(result)
  }
  fail('Action inconnue.',404)
}
