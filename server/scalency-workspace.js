import {createHash} from 'node:crypto'
import {collections,remote,remoteId,ScalencyError,snapshot,shippable,draftPayload} from './scalency-api.js'
import {verifiedPhotos,listingFields,listingAiToken,generateListingText} from './listing-studio-core.js'
import {ASSET_BUCKET} from './resources.js'
import {readListingSettings} from './listing-settings.js'
import {prepareQuickDraft,quickProfiles,saveQuickBrand,verifyQuickFields} from './scalency-quick.js'
import {listingFacts} from '../src/lib/library.js'
import {nextHistoryPage} from './scalency-history.js'
import {catalogProduct,connectedRecords,draftSource} from './scalency-relations.js'
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
  const result=await remote(kind,{query:{limit:100,cursor:older?state?.cursor_value:null}})
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
async function getDraft(db,user,id){
  const row=checked(await db.from('listing_drafts').select(draftCols).eq('id',remoteId(id)).eq('owner_id',user.id).maybeSingle())
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
  if(role!=='admin'&&!['home','orders','items','order','label','pack','stock','link','relations','product'].includes(action)&&!(action==='sync'&&['orders','items'].includes(b.kind)))fail('Réservé à l’administrateur.',403)
  if(req.method==='GET'){
    if(action==='quick-profiles')return res.json(await quickProfiles(db,user))
    if(action==='relations')return res.json(await connectedRecords(db,user,role,q))
    if(action==='product')return res.json(await catalogProduct(db,q.id))
    if(action==='draft-source')return res.json(await draftSource(db,q.piece,q.product,q.sku))
    if(action==='orders'&&q.filter==='archive'){
      const page=Math.max(0,parseInt(q.page)||0)
      let read=db.from('workspace_sales').select('id,source,account_login,actual_cost,notes,location,sale_date,order_status,listing_photo_url',{count:'exact'})
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
      const row=await getDraft(db,user,q.id)
      return res.json({...row,urls:await photosFor(db,row.photos,3600)})
    }
    if(action==='catalogs')return res.json(await remote('catalogs',{query:{limit:100,cursor:q.cursor}}))
    if(action==='category')return res.json(await remote('catalogs/'+remoteId(q.id)))
    if(action==='connection')return res.json({configured:!!process.env.SCALENCY_API_KEY,webhook:!!checked(await db.from('scalency_settings').select('id').eq('id','webhook').not('value->>id','is',null).maybeSingle())})
    fail('Vue inconnue.',404)
  }
  if(req.method!=='POST')fail('Méthode invalide.',405)
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
  if(action==='quick-brand')return res.json(await saveQuickBrand(db,b.account,b.name))
  if(action==='save'){
    const id=remoteId(b.id), fields=listingFields(b.fields),photos=await verifiedPhotos(db,user.id,b.photos)
    const row={fields,photos,updated_at:now()}
    if(Object.hasOwn(b,'piece')||Object.hasOwn(b,'product')){
      const source=await draftSource(db,b.piece,b.product,fields.sku)
      row.stock_item_id=source.stock?.id||null
      row.catalog_product_id=source.product?.id||null
    }
    let result=b.version==null?await db.from('listing_drafts').insert({...row,id,owner_id:user.id}).select(draftCols).single():
      await db.from('listing_drafts').update({...row,version:b.version+1}).eq('id',id).eq('owner_id',user.id).eq('state','draft').eq('version',b.version).select(draftCols).maybeSingle()
    if(!checked(result))fail('Ce brouillon a changé. Rouvre-le avant de continuer.',409)
    return res.json(result.data)
  }
  if(['generate','autofill','autopost','validate','publish','quick-publish'].includes(action)){
    let row=await getDraft(db,user,b.id)
    if(row.version!==b.version||row.state!=='draft')fail('Ce brouillon a changé. Actualise avant de continuer.',409)
    if(action==='autofill')return res.json(await prepareQuickDraft(db,user,req,row,photosFor))
    if(action==='autopost'){
      const prepared=await prepareQuickDraft(db,user,req,row,photosFor)
      if(prepared.missing.length)return res.json(prepared)
      row={...row,...prepared}
    }
    if(action==='quick-publish'||action==='autopost')await verifyQuickFields(db,row.fields)
    if(action==='generate'){
      const urls=await photosFor(db,row.photos.slice(0,3),300)
      if(!urls.length)fail('Ajoute une photo du vêtement.')
      const presets=await readListingSettings(db,row.fields.account_id||null)
      const source=await draftSource(db,null,row.catalog_product_id,row.fields.sku)
      const facts=listingFacts(source.product,row.fields.size_text||'')
      const result=await generateListingText(row,urls,[],[],{token:listingAiToken(req),settings:presets.effective,quick:true,shein:facts})
      return res.json({title:result.title,description:result.description})
    }
    const at=b.schedule?new Date(b.schedule):null
    if(at&&(!Number.isFinite(at.getTime())||at<=new Date()||at.getTime()-Date.now()>30*86400000))fail('Choisis une date future dans les 30 prochains jours.')
    const payload=draftPayload(row,await photosFor(db,row.photos,35*86400),row.fields.account_id,at?.toISOString())
    const source=await draftSource(db,row.stock_item_id,row.catalog_product_id,row.fields.sku)
    if(source.stock?.emplacement)payload.location=source.stock.emplacement
    const supplier=source.stock?.shein_url||source.product?.supplier_url
    if(supplier&&/^https?:\/\//i.test(supplier))payload.supplier_link=supplier
    async function validatePayload(){
      const preview=await remote('items',{method:'POST',body:{...payload,dry_run:true}})
      if(preview.dry_run!==true||preview.would_queue!==true)fail(preview.reason||'Scalency ne peut pas accepter cette annonce.',409)
      return preview
    }
    const preview=await validatePayload()
    if(action==='validate')return res.json(preview)
    const result=await once(db,user,'publish',row.id,async()=>{
      const locked=checked(await db.from('listing_drafts').update({state:'preparing',message:'Transmission à Scalency'}).eq('id',row.id).eq('state','draft').eq('version',row.version).select('id').maybeSingle())
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
