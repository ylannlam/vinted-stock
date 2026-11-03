import {selectedListingAccounts,requireSelectedAccount} from './adspower-selection.js'
import {randomUUID} from 'node:crypto'
import {AppError,isId} from './dotb.js'
import {ASSET_BUCKET,uploadTarget,ensureAssetBucket} from './resources.js'
import {validateListingPhoto} from '../src/lib/listingStudio.js'
import {check,listingFields,verifiedPhotos,dotbListingRequest,listingMetadata,listingAccounts,listingPayload,validateRemoteItem,scheduleResult,generateListingText,listingAiToken} from './listing-studio-core.js'

const TABLE='listing_drafts',now=()=>new Date().toISOString()
const pending=row=>row.lease&&Date.parse(row.lease_until)>Date.now()
export async function updateListing(db,row,patch){
 const value=check(await db.from(TABLE).update({...patch,version:row.version+1,updated_at:now()}).eq('id',row.id).eq('owner_id',row.owner_id).eq('version',row.version).select().maybeSingle())
 if(!value)throw new AppError('Cette fiche a changé dans un autre onglet. Rouvre le brouillon avant de continuer.',409)
 return value
}
async function expose(db,row){
 const paths=row.photos.map(p=>p.path),signed=paths.length?check(await db.storage.from(ASSET_BUCKET).createSignedUrls(paths,3600)):[]
 const urls=new Map(signed.map(x=>[x.path,x.signedUrl]))
 return {id:row.id,version:row.version,state:row.state,fields:row.fields,photos:row.photos.map(p=>({...p,url:urls.get(p.path)||null})),uploaded:row.uploaded,dotb_item_id:row.dotb_item_id,message:row.message,last_error:row.last_error,created_at:row.created_at,updated_at:row.updated_at,ai_updated_at:row.ai_updated_at,published_at:row.published_at,checked_at:row.checked_at,busy:!!pending(row),url:row.state==='published'&&/^\d{1,18}$/.test(row.vinted_id||'')?`https://www.vinted.fr/items/${row.vinted_id}`:null}
}
async function findSchedule(read,row){
 let cursor=''
 for(let page=0;page<5;page++){
  const result=await read(`scheduled-publishes?limit=100${cursor?`&cursor=${encodeURIComponent(cursor)}`:''}`)
  if(!Array.isArray(result.data))throw new AppError('Le suivi Dotb est indisponible.',502)
  const job=result.data.find(j=>j.item_id===row.dotb_item_id&&j.vinted_account_id?.toLowerCase()===row.fields.account_id)
  if(job)return job
  if(!result.has_more||!result.next_cursor)return null
  cursor=result.next_cursor
 }
 return null
}
async function inspectPublish(db,row,read){
 const job=await findSchedule(read,row)
 const patch=job&&scheduleResult(job,row)
 return updateListing(db,row,{...(patch||{...(row.state==='preparing'?{state:'attention'}:{}),message:'La publication n’est pas encore confirmée. Vérifie le suivi Dotb ; aucun nouvel envoi n’a été créé.'}),checked_at:now(),lease:null,lease_until:null,inflight:null,last_error:null})
}
export async function listingStep(db,row,{read=dotbListingRequest}={}){
 if(row.state!=='preparing'||pending(row))return row
 // Claim the version before inspecting or sending anything. Every path releases it,
 // except abrupt termination, whose inflight marker is reconciled on the next call.
 let current=await updateListing(db,row,{lease:randomUUID(),lease_until:new Date(Date.now()+90000).toISOString(),last_error:null})
 try{
  if(current.inflight==='create')return updateListing(db,current,{state:'attention',message:'La création Dotb n’a pas été confirmée. Vérifie le dressing Dotb avant de recréer cette annonce pour éviter un doublon.',lease:null,lease_until:null})
  if(current.inflight==='schedule')return inspectPublish(db,current,read)
  if(current.dotb_item_id){
   const item=validateRemoteItem(await read(`items/${current.dotb_item_id}`),current)
   if(item.scheduled_publish_at||item.vinted_id)return inspectPublish(db,current,read)
   if(item.status!=='pending')throw new AppError('Cette annonce ne peut plus être modifiée dans Dotb.',409)
   if(current.inflight==='photo'){
    if(item.photos.length===current.uploaded+1)current=await updateListing(db,current,{uploaded:current.uploaded+1,inflight:null})
    else if(item.photos.length===current.uploaded)current=await updateListing(db,current,{inflight:null})
    else return updateListing(db,current,{state:'attention',message:'Les photos ont changé dans Dotb. Vérifie la fiche avant de poursuivre.',lease:null,lease_until:null})
   }
   if(item.photos.length!==current.uploaded)return updateListing(db,current,{state:'attention',message:'Les photos de Dotb ne correspondent plus à cet envoi.',lease:null,lease_until:null})
  }
  if(!current.dotb_item_id){
   current=await updateListing(db,current,{inflight:'create',message:'Création de la fiche sur le compte choisi…'})
   const item=validateRemoteItem(await read('items',{method:'POST',body:current.payload}),current)
   return updateListing(db,current,{dotb_item_id:item.id,uploaded:item.photos.length,inflight:null,lease:null,lease_until:null,message:'Fiche créée. Envoi des photos…'})
  }
  if(current.inflight==='update'){
   validateRemoteItem(await read(`items/${current.dotb_item_id}`,{method:'PATCH',body:current.payload}),current)
   return updateListing(db,current,{inflight:null,lease:null,lease_until:null,message:'Fiche mise à jour. Préparation des photos…'})
  }
  if(current.uploaded<current.photos.length){
   const photo=current.photos[current.uploaded]
   const blob=check(await db.storage.from(ASSET_BUCKET).download(photo.path))
   try{validateListingPhoto({type:blob.type,size:blob.size})}catch(e){throw new AppError(e.message)}
   const form=new FormData();form.append('file',blob,`photo-${current.uploaded+1}.${photo.path.split('.').pop()}`)
   current=await updateListing(db,current,{inflight:'photo',message:`Envoi de la photo ${current.uploaded+1} sur ${current.photos.length}…`})
   await read(`items/${current.dotb_item_id}/photos`,{method:'POST',body:form})
   return updateListing(db,current,{uploaded:current.uploaded+1,inflight:null,lease:null,lease_until:null})
  }
  const account=await requireSelectedAccount(db,current.owner_id,current.fields.account_id,listingAccounts(await read('accounts')))
  if(!account?.connected)throw new AppError('Ouvre ce compte dans AdsPower et active le Bridge Dotb, puis reprends l’envoi.',409)
  current=await updateListing(db,current,{inflight:'schedule',message:'Demande de publication sur Vinted…'})
  const result=await read(`items/${current.dotb_item_id}/schedule`,{method:'POST',body:{scheduled_at:now(),publish:true}})
  if(result.item_id!==current.dotb_item_id||result.vinted_account_id?.toLowerCase()!==current.fields.account_id||result.status!=='scheduled'||result.publish!==true){const e=new AppError('Dotb n’a pas confirmé la publication de cette fiche.',502);e.uncertain=true;throw e}
  return updateListing(db,current,{state:'scheduled',scheduled_at:now(),inflight:null,lease:null,lease_until:null,message:'Annonce transmise. Garde le profil et le Bridge Dotb ouverts.'})
 }catch(error){
  // Unknown outcomes keep their marker; a later read reconciles the result.
  // Never repeat a creation or schedule solely because a network call failed.
  const uncertain=error.uncertain===true||!(error instanceof AppError)
  const needsReview=uncertain&&current.inflight==='create'
  const editable=!uncertain&&[400,422].includes(error.upstreamStatus)
  const message=error instanceof AppError?error.message:'L’envoi a été interrompu. L’avancement est conservé.'
  const patch={state:needsReview?'attention':editable?'draft':'preparing',lease:null,lease_until:uncertain?new Date(Date.now()+90000).toISOString():null,message,last_error:message,...(!uncertain?{inflight:current.inflight==='update'?'update':null}:{})}
  // Keep a real lease on uncertain writes until the original request cannot still run.
  if(uncertain&&!needsReview)patch.lease=current.lease
  return updateListing(db,current,patch)
 }
}
export async function handleListingStudio(req,{db,user},{read=dotbListingRequest,generate=generateListingText}={}){
 const action=req.query?.action||req.body?.action||'list',body=req.body||{}
 if(req.method==='GET'){
  if(action==='metadata'){
   const [accounts,catalogs,colors]=await Promise.all([read('accounts'),listingMetadata('catalogs?country=FR&depth=6',read),listingMetadata('colors?country=FR',read)])
   if(!Array.isArray(catalogs.data)||!Array.isArray(colors.data))throw new AppError('Les catégories Vinted sont indisponibles.',502)
   const selected=await selectedListingAccounts(db,user.id,listingAccounts(accounts))
   return {accounts:selected.accounts,selected_profiles:selected.selection?.profiles||[],selection_configured:!!selected.selection,catalogs:catalogs.data,colors:colors.data,ai_ready:!!listingAiToken(req)}
  }
  if(action==='options'){
   const id=Number(req.query.catalog_id);if(!Number.isSafeInteger(id)||id<1)throw new AppError('Catégorie invalide.')
   return listingMetadata(`catalogs/${id}/options?country=FR&locale=fr`,read)
  }
  if(action==='brands'){
   const q=req.query.q;if(typeof q!=='string'||!q.trim()||q.length>120)throw new AppError('Renseigne le nom de la marque.')
   return listingMetadata(`brands?q=${encodeURIComponent(q.trim())}&limit=25`,read)
  }
  if(action==='list'){
   const page=Number(req.query.page||0);if(!Number.isSafeInteger(page)||page<0||page>1000)throw new AppError('Page invalide.')
   const result=await db.from(TABLE).select('*',{count:'exact'}).eq('owner_id',user.id).order('updated_at',{ascending:false}).order('id').range(page*20,page*20+19)
   return {drafts:await Promise.all(check(result).map(r=>expose(db,r))),count:result.count,page}
  }
  if(action==='draft'){
   if(!isId(req.query.id))throw new AppError('Brouillon invalide.')
   const row=check(await db.from(TABLE).select('*').eq('owner_id',user.id).eq('id',req.query.id).maybeSingle())
   if(!row)throw new AppError('Brouillon introuvable.',404)
   return {draft:await expose(db,row)}
  }
  throw new AppError('Demande inconnue.')
 }
 if(req.method!=='POST')throw new AppError('Méthode indisponible.',405)
 if(action==='upload'){
  try{validateListingPhoto(body)}catch(e){throw new AppError(e.message)}
  const path=uploadTarget(user.id,body);await ensureAssetBucket(db)
  const ticket=check(await db.storage.from(ASSET_BUCKET).createSignedUploadUrl(path))
  return {path,token:ticket.token}
 }
 if(!isId(body.id))throw new AppError('Brouillon invalide.')
 let row=check(await db.from(TABLE).select('*').eq('owner_id',user.id).eq('id',body.id).maybeSingle())
 if(action==='create'){
  if(row)return {draft:await expose(db,row)}
  if(body.account_id)await requireSelectedAccount(db,user.id,body.account_id,listingAccounts(await read('accounts')))
  row=check(await db.from(TABLE).insert({id:body.id,owner_id:user.id,fields:listingFields({account_id:body.account_id||''})}).select().single())
  return {draft:await expose(db,row)}
 }
 if(!row)throw new AppError('Brouillon introuvable.',404)
 if(action==='step')return {draft:await expose(db,await listingStep(db,row,{read}))}
 if(action==='refresh'){
  if(!row.dotb_item_id||pending(row)||row.checked_at&&Date.parse(row.checked_at)>Date.now()-10000)return {draft:await expose(db,row)}
  if(['scheduled','attention'].includes(row.state))row=await inspectPublish(db,row,read)
  return {draft:await expose(db,row)}
 }
 if(action==='publish'&&row.state!=='draft')return {draft:await expose(db,row)}
 if(body.version!==row.version||pending(row))throw new AppError('Cette fiche est en cours de traitement ou a changé. Rouvre le brouillon.',409)
 if(row.state!=='draft')throw new AppError('Cette annonce a déjà été transmise. Consulte son suivi.',409)
 if(action==='save'){
  const fields=listingFields(body.fields),photos=await verifiedPhotos(db,user.id,body.photos)
  if(row.dotb_item_id&&(fields.account_id!==row.fields.account_id||JSON.stringify(photos)!==JSON.stringify(row.photos)))throw new AppError('La fiche existe déjà dans Dotb : le compte et les photos sont conservés.',409)
  row=await updateListing(db,row,{fields,photos,message:null,last_error:null,inflight:null,lease:null,lease_until:null})
 }else if(action==='generate'){
  if(!row.photos.length||!row.fields.sku||!row.fields.size_text||!row.fields.price)throw new AppError('Ajoute les photos, le SKU, la taille et le prix pour préparer l’annonce.')
  if(row.ai_count>=10)throw new AppError('Ce brouillon a déjà été rédigé dix fois. Tu peux modifier le texte directement.',429)
  if(row.ai_updated_at&&Date.parse(row.ai_updated_at)>Date.now()-30000)throw new AppError('Patiente quelques secondes avant de refaire le texte.',429)
  row=await updateListing(db,row,{lease:randomUUID(),lease_until:new Date(Date.now()+60000).toISOString(),inflight:'generate',ai_count:row.ai_count+1,ai_updated_at:now()})
  try{
   const [catalogs,colors,signed]=await Promise.all([listingMetadata('catalogs?country=FR&depth=6',read),listingMetadata('colors?country=FR',read),db.storage.from(ASSET_BUCKET).createSignedUrls(row.photos.slice(0,4).map(p=>p.path),180)])
   const urls=check(signed).map(x=>x.signedUrl);if(urls.some(u=>!u))throw new AppError('Une photo est indisponible. Ajoute-la à nouveau.')
   const result=await generate(row,urls,catalogs.data,colors.data,{token:listingAiToken(req)})
   row=await updateListing(db,row,{fields:{...row.fields,title:result.title,description:result.description,catalog_id:result.catalog_id,color_ids:result.color_ids,size_id:null,status_id:null,package_size_id:null,item_attributes:[]},message:result.review_notes||null,last_error:null,inflight:null,lease:null,lease_until:null})
  }catch(error){const message=error instanceof AppError?error.message:'Le texte n’a pas pu être préparé.';row=await updateListing(db,row,{message,last_error:message,inflight:null,lease:null,lease_until:null})}
 }else if(action==='publish'){
  if(body.confirmation_account_id!==row.fields.account_id)throw new AppError('Vérifie le compte ciblé avant de publier.')
  const accounts=listingAccounts(await read('accounts')),account=await requireSelectedAccount(db,user.id,row.fields.account_id,accounts)
  if(!account?.connected)throw new AppError('Ouvre ce compte dans AdsPower et active son Bridge Dotb avant de publier.',409)
  const [options,colors,photos]=await Promise.all([listingMetadata(`catalogs/${row.fields.catalog_id}/options?country=FR&locale=fr`,read),listingMetadata('colors?country=FR',read),verifiedPhotos(db,user.id,row.photos)])
  const payload=listingPayload(row.fields,photos,options,colors.data,account)
  if(row.fields.brand_id!==1){const brands=await listingMetadata(`brands?q=${encodeURIComponent(row.fields.brand_title)}&limit=25`,read);if(!brands.data?.some(b=>b.id===row.fields.brand_id))throw new AppError('Sélectionne à nouveau la marque dans les résultats.')}
  if(row.dotb_item_id){const item=validateRemoteItem(await read(`items/${row.dotb_item_id}`),row);if(item.status!=='pending'||item.vinted_id||item.scheduled_publish_at)throw new AppError('Cette annonce est déjà en cours de publication. Consulte Dotb.',409)}
  row=await updateListing(db,row,{state:'preparing',payload,inflight:row.dotb_item_id?'update':null,lease:null,lease_until:null,last_error:null,message:'Préparation de l’envoi vers le compte choisi…'})
 }else throw new AppError('Action inconnue.')
 return {draft:await expose(db,row)}
}
