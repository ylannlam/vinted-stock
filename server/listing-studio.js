import {selectedListingAccounts,requireSelectedAccount} from './adspower-selection.js'
import {randomUUID} from 'node:crypto'
import {AppError,isId} from './dotb.js'
import {ASSET_BUCKET,uploadTarget,ensureAssetBucket} from './resources.js'
import {validateListingPhoto} from '../src/lib/listingStudio.js'
import {readTeamBoard,readBoardRows,markPublished,vintedItemId} from './team-board.js'
import {readListingPicker} from './listing-picker.js'
import {readPlanner,planListings} from './publication-planner.js'
import {readAiUsage,saveAiPrice} from './ai-usage.js'
import {lookupListingSku,sheinListingFacts} from './library.js'
import {readListingSettings,dotbAccounts,saveListingSettings,listingTitleExamples,reserveListingSlot} from './listing-settings.js'
import {applyListingPresets,LISTING_AI_MODELS} from '../src/lib/listingSettings.js'
import {catalogRoots,check,listingFields,verifiedPhotos,dotbListingRequest,listingMetadata,listingAccounts,listingPayload,validateRemoteItem,scheduleResult,generateListingText,listingAiToken} from './listing-studio-core.js'

const TABLE='listing_drafts',now=()=>new Date().toISOString()
export const manualPublishingMessage='L’envoi par Dotb est temporairement désactivé. Recharge l’atelier et utilise la publication manuelle après la fin du blocage Vinted.'
export const manualRestoredMessage='L’envoi par Dotb est coupé et rien n’avait été transmis : la fiche est revenue en brouillon. Tu peux télécharger le dossier d’annonce.'
export const accountManualMessage='L’envoi par Dotb n’est pas activé pour ce compte. Active-le dans les réglages du compte, ou publie l’annonce à la main.'
export const manualSentMessage='L’envoi par Dotb est coupé, mais cette fiche a peut-être déjà été transmise à Dotb. Vérifie-la dans Dotb avant de la publier à la main, pour éviter un doublon.'
export const dotbPublishingEnabled=(env=process.env)=>env.LISTING_DOTB_PUBLISH_ENABLED==='true'
const pending=row=>row.lease&&Date.parse(row.lease_until)>Date.now()
const parisTime=at=>new Date(at).toLocaleString('fr-FR',{timeZone:'Europe/Paris',weekday:'short',hour:'2-digit',minute:'2-digit'})
export async function updateListing(db,row,patch){
 const value=check(await db.from(TABLE).update({...patch,version:row.version+1,updated_at:now()}).eq('id',row.id).eq('owner_id',row.owner_id).eq('version',row.version).select().maybeSingle())
 if(!value)throw new AppError('Cette fiche a changé dans un autre onglet. Rouvre le brouillon avant de continuer.',409)
 return value
}
async function expose(db,row){
 const paths=row.photos.map(p=>p.path),signed=paths.length?check(await db.storage.from(ASSET_BUCKET).createSignedUrls(paths,3600)):[]
 const urls=new Map(signed.map(x=>[x.path,x.signedUrl]))
 return {id:row.id,version:row.version,state:row.state,fields:row.fields,photos:row.photos.map(p=>({...p,url:urls.get(p.path)||null})),uploaded:row.uploaded,dotb_item_id:row.dotb_item_id,dotb_publish:row.dotb_publish!==false,message:row.message,last_error:row.last_error,created_at:row.created_at,updated_at:row.updated_at,ai_updated_at:row.ai_updated_at,published_at:row.published_at,checked_at:row.checked_at,planned_at:row.planned_at||null,scheduled_at:row.scheduled_at||null,busy:!!pending(row),manual_recoverable:row.state==='preparing'&&!row.dotb_item_id&&!row.inflight,url:row.state==='published'&&/^\d{1,18}$/.test(row.vinted_id||'')?`https://www.vinted.fr/items/${row.vinted_id}`:null}
}
async function findSchedule(read,row){
 let cursor=''
 for(let page=0;page<5;page++){
  const result=await read(`scheduled-publishes?limit=100${cursor?`&cursor=${encodeURIComponent(cursor)}`:''}`)
  if(!Array.isArray(result.data))throw new AppError('Le suivi Dotb est indisponible.',502)
  const job=result.data.find(j=>j.item_id===row.dotb_item_id&&j.vinted_account_id?.toLowerCase()===row.fields.account_id&&j.publish===(row.dotb_publish!==false))
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
export async function listingStep(db,row,{read=dotbListingRequest,allowDotb=dotbPublishingEnabled()}={}){
 if(row.state!=='preparing'||pending(row))return row
 if(!allowDotb){
  // Nothing was ever sent: no Dotb item and no request whose outcome is unknown.
  // Such a listing safely returns to an editable draft, ready for the manual export.
  if(!row.dotb_item_id&&!row.inflight)return updateListing(db,row,{state:'draft',payload:null,lease:null,lease_until:null,last_error:null,message:manualRestoredMessage})
  return row.last_error===manualSentMessage?row:updateListing(db,row,{last_error:manualSentMessage,message:manualSentMessage})
 }
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
  // Espacement choisi dans les réglages du compte : Dotb publie à l'heure prévue (ou tout de suite si elle est passée).
  const planned=Date.parse(current.planned_at)>Date.now()?new Date(current.planned_at).toISOString():now()
  const live=current.dotb_publish!==false
  const result=await read(`items/${current.dotb_item_id}/schedule`,{method:'POST',body:{scheduled_at:planned,publish:live}})
  if(result.item_id!==current.dotb_item_id||result.vinted_account_id?.toLowerCase()!==current.fields.account_id||result.status!=='scheduled'||result.publish!==live){const e=new AppError('Dotb n’a pas confirmé la publication de cette fiche.',502);e.uncertain=true;throw e}
  const at=Date.parse(result.scheduled_at)||Date.parse(planned),later=at>Date.now()+60000
  return updateListing(db,current,{state:'scheduled',scheduled_at:new Date(at).toISOString(),inflight:null,lease:null,lease_until:null,message:!live?(later?`Brouillon prévu : Dotb le créera sur Vinted vers ${parisTime(at)}. Le Bridge du compte devra être ouvert à ce moment-là, sinon Dotb attendra.`:'Brouillon transmis à Dotb. Garde le profil et le Bridge Dotb ouverts.'):later?`Annonce planifiée : Dotb la publiera vers ${parisTime(at)}. Le Bridge du compte devra être ouvert à ce moment-là, sinon Dotb attendra.`:'Annonce transmise. Garde le profil et le Bridge Dotb ouverts.'})
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
// Catégories des articles déjà vendus (toute la boutique), relues au plus toutes les 10 minutes.
let soldCache={at:0,ids:[]}
export async function soldCatalogIds(db,now=Date.now()){
 if(now>=soldCache.at&&now-soldCache.at<600000)return soldCache.ids
 let ids=[]
 try{const rows=check(await db.from('sales_lines').select('catalog_id:source->>catalog_id').not('source->>catalog_id','is',null).order('updated_at',{ascending:false}).limit(400))||[];ids=[...new Set(rows.map(r=>Number(r.catalog_id)).filter(n=>Number.isSafeInteger(n)&&n>0))]}catch{}
 soldCache={at:now,ids};return ids
}
// Dépenses IA : jetons de chaque rédaction. Un échec d'enregistrement ne bloque jamais l'annonce.
export async function recordAiUsage(db,usage,{listing=null,account=null,user=null}={}){
 if(!usage?.model)return
 const tokens=v=>Math.min(10000000,Math.max(0,Math.round(Number(v)||0)))
 try{await db.from('ai_usage').insert({feature:'listing_text',model:String(usage.model).slice(0,100),input_tokens:tokens(usage.input_tokens),output_tokens:tokens(usage.output_tokens),listing_id:isId(listing)?listing:null,account_id:isId(account)?account:null,user_id:isId(user)?user:null})}catch{}
}

// Validation complète puis réservation du créneau : envoi immédiat (Annonces) ou heure choisie (Publication).
async function queueListing(db,user,row,{mode,notBefore=null,read,settings,accounts=null,requireBridge=false}){
 if(!['live','draft',undefined].includes(mode))throw new AppError('Choisis « en ligne » ou « brouillon Vinted ».')
 const list=accounts||listingAccounts(await read('accounts')),account=await requireSelectedAccount(db,user.id,row.fields.account_id,list)
 if(requireBridge&&!account?.connected)throw new AppError('Ouvre ce compte dans AdsPower et active son Bridge Dotb avant de publier.',409)
 const [options,colors,photos]=await Promise.all([listingMetadata(`catalogs/${row.fields.catalog_id}/options?country=FR&locale=fr`,read),listingMetadata('colors?country=FR',read),verifiedPhotos(db,user.id,row.photos)])
 const payload=listingPayload(row.fields,photos,options,colors.data,account)
 if(row.fields.brand_id!==1){const brands=await listingMetadata(`brands?q=${encodeURIComponent(row.fields.brand_title)}&limit=25`,read);if(!brands.data?.some(b=>b.id===row.fields.brand_id))throw new AppError('Sélectionne à nouveau la marque dans les résultats.')}
 if(row.dotb_item_id){const item=validateRemoteItem(await read(`items/${row.dotb_item_id}`),row);if(item.status!=='pending'||item.vinted_id||item.scheduled_publish_at)throw new AppError('Cette annonce est déjà en cours de publication. Consulte Dotb.',409)}
 // Choix fait au moment de l'envoi : en ligne directement (par défaut) ou brouillon Vinted.
 if((mode!=='draft')!==(row.dotb_publish!==false))row=await updateListing(db,row,{dotb_publish:mode!=='draft'})
 return reserveListingSlot(db,row,payload,(await settings(db,row.fields.account_id)).effective.spacing_minutes,notBefore)
}

// Annule une programmation encore à venir : la fiche reste dans Dotb et redevient modifiable ici.
async function unscheduleListing(db,row,read){
 if(row.state!=='scheduled'||!row.dotb_item_id)throw new AppError('Cette annonce n’est pas programmée.',409)
 if(Date.parse(row.scheduled_at||row.planned_at)<Date.now()+120000)throw new AppError('La publication commence dans moins de 2 minutes : elle ne peut plus être annulée ici.',409)
 try{await read(`items/${row.dotb_item_id}/schedule`,{method:'DELETE'})}
 catch(e){if(e.upstreamStatus===404)return inspectPublish(db,row,read);throw e}
 return updateListing(db,row,{state:'draft',planned_at:null,scheduled_at:null,inflight:null,lease:null,lease_until:null,last_error:null,message:'Programmation annulée. La fiche reste prête : tu peux la reprogrammer.'})
}

export async function handleListingStudio(req,{db,user},{read=dotbListingRequest,generate=generateListingText,allowDotb=dotbPublishingEnabled(),settings=readListingSettings,examples=listingTitleExamples,soldCatalogs=soldCatalogIds}={}){
 const action=req.query?.action||req.body?.action||'list',body=req.body||{}
 // Dotb publie seulement si le serveur l'autorise ET si l'interrupteur du compte est allumé.
 const dotbFor=async accountId=>allowDotb&&(await settings(db,accountId)).effective.dotb===true
 if(req.method==='GET'){
  if(action==='accounts'){
   const selected=await selectedListingAccounts(db,user.id,listingAccounts(await read('accounts')))
   return {accounts:selected.accounts,selected_profiles:selected.selection?.profiles||[],selection_configured:!!selected.selection}
  }
  if(action==='metadata'){
   const [accounts,catalogs,colors]=await Promise.all([read('accounts'),listingMetadata('catalogs?country=FR&depth=6',read),listingMetadata('colors?country=FR',read)])
   if(!Array.isArray(catalogs.data)||!Array.isArray(colors.data))throw new AppError('Les catégories Vinted sont indisponibles.',502)
   const [selected,dotb]=await Promise.all([selectedListingAccounts(db,user.id,listingAccounts(accounts)),allowDotb?dotbAccounts(db):new Set()])
   return {accounts:selected.accounts.map(a=>({...a,dotb:dotb.has(a.id)})),selected_profiles:selected.selection?.profiles||[],selection_configured:!!selected.selection,catalogs:catalogs.data,colors:colors.data,ai_ready:!!listingAiToken(req),ai_models:LISTING_AI_MODELS,dotb_publish_enabled:allowDotb}
  }
  if(action==='options'){
   const id=Number(req.query.catalog_id);if(!Number.isSafeInteger(id)||id<1)throw new AppError('Catégorie invalide.')
   return listingMetadata(`catalogs/${id}/options?country=FR&locale=fr`,read)
  }
  if(action==='brands'){
   const q=req.query.q;if(typeof q!=='string'||!q.trim()||q.length>120)throw new AppError('Renseigne le nom de la marque.')
   return listingMetadata(`brands?q=${encodeURIComponent(q.trim())}&limit=25`,read)
  }
  // Onglet « Alicia » : une ligne par compte, sans appel à Dotb.
  if(action==='board')return readTeamBoard(db,user)
  // Choix du compte : fond, publications du jour, articles en cours, état connu.
  if(action==='picker')return readListingPicker(db,user)
  // Session de publication : toutes mes fiches de ce compte encore en cours, plus celles publiées depuis 24 h.
  if(action==='session'){
   if(!isId(req.query.account_id))throw new AppError('Compte invalide.')
   const accountId=req.query.account_id.toLowerCase(),since=Date.now()-86400000
   const cutoff=new Date(since).toISOString()
   const [presets,rows]=await Promise.all([settings(db,accountId),readBoardRows(()=>db.from(TABLE).select('*',{count:'exact'}).eq('owner_id',user.id).eq('fields->>account_id',accountId).or(`state.neq.published,published_at.gt.${cutoff},and(published_at.is.null,updated_at.gt.${cutoff})`).order('created_at',{ascending:false}).order('id'))])
   return {account_id:accountId,settings:presets,dotb_publish_enabled:allowDotb,dotb:allowDotb&&presets.effective.dotb===true,drafts:await Promise.all(rows.map(r=>expose(db,r)))}
  }
  if(action==='settings')return settings(db,req.query.account_id)
  // Onglet Publication : fiches prêtes, comptes, annonces déjà prévues.
  if(action==='planner')return readPlanner(db,user,{read,allowDotb})
  if(action==='ai_usage')return readAiUsage(db,req.query)
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
 if(action==='settings'){await saveListingSettings(db,user,body);return settings(db,body.scope==='default'?null:body.scope)}
 if(action==='upload'){
  try{validateListingPhoto(body)}catch(e){throw new AppError(e.message)}
  const path=uploadTarget(user.id,body);await ensureAssetBucket(db)
  const ticket=check(await db.storage.from(ASSET_BUCKET).createSignedUploadUrl(path))
  return {path,token:ticket.token}
 }
 // Fiche Shein du SKU saisi : mesures et prix conseillé depuis la bibliothèque, sinon recherche par le PC.
 if(action==='shein')return lookupListingSku(db,user,{sku:body.sku,size:body.size,queue:body.queue===true?true:body.queue==='auto'?'auto':false})
 if(action==='ai_price')return {price:await saveAiPrice(db,body)}
 if(action==='plan'){
  if(!allowDotb)throw new AppError(manualPublishingMessage,409)
  return planListings(db,user,body,{read,queue:async(row,options)=>{
   if(!await dotbFor(row.fields.account_id))throw new AppError('La publication via Dotb est coupée pour ce compte (réglages des annonces).',409)
   return queueListing(db,user,row,{...options,read,settings})
  }})
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
 if(action==='unschedule'){
  if(body.version!==row.version||pending(row))throw new AppError('Cette annonce a changé. Actualise la liste.',409)
  return {draft:await expose(db,await unscheduleListing(db,row,read))}
 }
 if(action==='step')return {draft:await expose(db,await listingStep(db,row,{read,allowDotb:row.state==='preparing'?await dotbFor(row.fields.account_id):allowDotb}))}
 if(action==='refresh'){
  if(!row.dotb_item_id||pending(row)||row.checked_at&&Date.parse(row.checked_at)>Date.now()-10000)return {draft:await expose(db,row)}
  if(['scheduled','attention'].includes(row.state))row=await inspectPublish(db,row,read)
  return {draft:await expose(db,row)}
 }
 // A retry after a lost reply returns the same recorded publication, without a second write.
 if(action==='mark_published'&&row.state==='published'&&(!row.dotb_item_id||row.dotb_publish===false)&&vintedItemId(body.url)===row.vinted_id)return {draft:await expose(db,row)}
 // Brouillon Vinted créé par Dotb puis publié à la main : on note le lien de l'annonce en ligne.
 if(action==='mark_published'&&row.state==='vinted_draft'){
  if(body.version!==row.version||pending(row))throw new AppError('Cette fiche a changé. Actualise la session.',409)
  return {draft:await expose(db,await markPublished(db,row,body.url,updateListing))}
 }
 if(action==='publish'&&!allowDotb)throw new AppError(manualPublishingMessage,409)
 if(action==='publish'&&row.state==='draft'&&!await dotbFor(row.fields.account_id))throw new AppError(accountManualMessage,409)
 if(action==='publish'&&row.state!=='draft')return {draft:await expose(db,row)}
 if(body.version!==row.version||pending(row))throw new AppError('Cette fiche est en cours de traitement ou a changé. Rouvre le brouillon.',409)
 if(row.state!=='draft')throw new AppError('Cette annonce a déjà été transmise. Consulte son suivi.',409)
 if(action==='discard'){
  // Retirer un article de la session : seulement une fiche jamais transmise à Dotb ni publiée.
  if(row.dotb_item_id||row.inflight||row.vinted_id)throw new AppError('Cette fiche a déjà été transmise : elle ne peut pas être retirée.',409)
  const removed=check(await db.from(TABLE).delete().eq('id',row.id).eq('owner_id',user.id).eq('version',row.version).eq('state','draft').select('id').maybeSingle())
  if(!removed)throw new AppError('Cette fiche a changé. Actualise la session avant de la retirer.',409)
  return {removed:row.id}
 }
 if(action==='save'){
  const fields=listingFields(body.fields),photos=await verifiedPhotos(db,user.id,body.photos)
  if(row.dotb_item_id&&(fields.account_id!==row.fields.account_id||JSON.stringify(photos)!==JSON.stringify(row.photos)))throw new AppError('La fiche existe déjà dans Dotb : le compte et les photos sont conservés.',409)
  row=await updateListing(db,row,{fields,photos,message:null,last_error:null,inflight:null,lease:null,lease_until:null})
 }else if(action==='generate'){
  // L'IA n'a besoin que des photos et de la taille ; le SKU et le prix restent obligatoires pour publier.
  if(!row.photos.length||!row.fields.size_text)throw new AppError('Ajoute les photos et la taille pour préparer l’annonce.')
  if(row.ai_count>=10)throw new AppError('Ce brouillon a déjà été rédigé dix fois. Tu peux modifier le texte directement.',429)
  if(row.ai_updated_at&&Date.parse(row.ai_updated_at)>Date.now()-30000)throw new AppError('Patiente quelques secondes avant de refaire le texte.',429)
  row=await updateListing(db,row,{lease:randomUUID(),lease_until:new Date(Date.now()+60000).toISOString(),inflight:'generate',ai_count:row.ai_count+1,ai_updated_at:now()})
  try{
   // Tout ce qui précède la rédaction est lu en même temps ; 3 photos suffisent à décrire l'article.
   const [catalogs,colors,signed,presets,titles,sold,shein]=await Promise.all([listingMetadata('catalogs?country=FR&depth=6',read),listingMetadata('colors?country=FR',read),db.storage.from(ASSET_BUCKET).createSignedUrls(row.photos.slice(0,3).map(p=>p.path),180),settings(db,row.fields.account_id),examples(db,row.fields.account_id),soldCatalogs(db),row.fields.sku?sheinListingFacts(db,row.fields.sku,row.fields.size_text).catch(()=>null):null])
   const urls=check(signed).map(x=>x.signedUrl);if(urls.some(u=>!u))throw new AppError('Une photo est indisponible. Ajoute-la à nouveau.')
   const roots=catalogRoots(catalogs.data,[...sold,...(row.fields.catalog_id?[row.fields.catalog_id]:[])])
   const result=await generate(row,urls,catalogs.data,colors.data,{token:listingAiToken(req),settings:presets.effective,examples:titles,roots,shein})
   await recordAiUsage(db,result.usage,{listing:row.id,account:row.fields.account_id,user:user.id})
   // Les réglages complètent la fiche (marque, état, colis, taille Vinted) ; un choix encore valide est gardé.
   const options=result.catalog_id?await listingMetadata(`catalogs/${result.catalog_id}/options?country=FR&locale=fr`,read).catch(()=>null):null
   const sameCatalog=result.catalog_id===row.fields.catalog_id
   const next={...row.fields,title:result.title,description:result.description,catalog_id:result.catalog_id,color_ids:result.color_ids,...(sameCatalog?{}:{size_id:null,package_size_id:null,item_attributes:[]})}
   row=await updateListing(db,row,{fields:applyListingPresets(next,options,presets.effective),message:result.review_notes||null,last_error:null,inflight:null,lease:null,lease_until:null})
  }catch(error){const message=error instanceof AppError?error.message:'Le texte n’a pas pu être préparé.';row=await updateListing(db,row,{message,last_error:message,inflight:null,lease:null,lease_until:null})}
 }else if(action==='mark_published'){
  row=await markPublished(db,row,body.url,updateListing)
 }else if(action==='publish'){
  if(body.confirmation_account_id!==row.fields.account_id)throw new AppError('Vérifie le compte ciblé avant de publier.')
  row=await queueListing(db,user,row,{mode:body.mode,read,settings,requireBridge:true})
 }else throw new AppError('Action inconnue.')
 return {draft:await expose(db,row)}
}
