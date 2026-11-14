// Publication de l'atelier par le profil Vinted choisi. Dotb reste une voie séparée.
import {AppError,isId} from './dotb.js'
import {effectiveSettings} from './vinted-agent-config.js'
import {check,listingAccounts,listingMetadata,listingPayload,verifiedPhotos,dotbListingRequest} from './listing-studio-core.js'
import {requireSelectedAccount} from './adspower-selection.js'
import {ASSET_BUCKET} from './resources.js'
import {isDesktop} from '../src/lib/ylavintExecution.js'

export const publicationVersion=v=>/^\d+\.\d+\.\d+$/.test(v||'')&&(Number(v.split('.')[0])>3||Number(v.split('.')[0])===3&&Number(v.split('.')[1])>=8)
export const desktopPublicationVersion=v=>/^pc-1\.(?:[5-9]|[1-9]\d)\.\d+$/.test(v||'')
export async function publicationStatus(db,accountId){
 if(!isId(accountId))return {ready:false,reason:'Choisis un compte.'}
 const s=check(await db.from('vinted_agent_settings').select('*').eq('account_id',accountId).maybeSingle())
 return statusOf(s)
}
export async function publicationStatuses(db,ids){
 const rows=ids.length?check(await db.from('vinted_agent_settings').select('*').in('account_id',ids)):[]
 const byId=new Map(rows.map(s=>[s.account_id,s]))
 return new Map(ids.map(id=>[id,statusOf(byId.get(id))]))
}
function statusOf(s){
 const cfg=effectiveSettings(s),online=!!s?.last_seen_at&&Date.parse(s.last_seen_at)>Date.now()-120000
 if(isDesktop(cfg)){
  const reason=s?.paused?`Compte en pause : ${s.pause_reason||'vérifie Vinted.'}`:!s?.enabled?'Active YlaVint sur ce compte.':!cfg.features.publish?'Active « Publication » dans les réglages YlaVint du compte.':!desktopPublicationVersion(s?.extension_version)?'Installe le connecteur 1.5 puis démarre cet Assistant PC avant de préparer une annonce.':null
  return {executor:'desktop',ready:!reason,online,paused:!!s?.paused,reason,waiting:reason||(!online?'En attente de l’Assistant PC sur ce compte.':null),limit:cfg.limits.publish_item_per_day,from_hour:cfg.limits.from_hour,to_hour:cfg.limits.to_hour}
 }
 const reason=s?.paused?`Compte en pause : ${s.pause_reason||'vérifie son état sur Vinted.'}`:!s?.enabled?'Active YlaVint sur ce compte.':!cfg.features.publish?'Active « Publication » dans les réglages YlaVint du compte.':!publicationVersion(s?.extension_version)?'Installe YlaVint 3.8.0 pour préparer le formulaire dans ce profil AdsPower.':null
 return {ready:!reason,online,paused:!!s?.paused,reason,waiting:reason|| (s?.paused?`En pause : ${s.pause_reason||'relance YlaVint dans ce profil.'}`:!online?'En attente du profil AdsPower : ouvre Vinted et allume le Bridge YlaVint.':null),limit:cfg.limits.publish_item_per_day,from_hour:cfg.limits.from_hour,to_hour:cfg.limits.to_hour}
}

export async function queueYlavintListing(db,user,row,{mode='live',desktopSubmit=false,notBefore=null,read=dotbListingRequest,accounts=null}={}){
 if(notBefore)throw new AppError('Le formulaire YlaVint se prépare à ta demande. Termine la publication toi-même dans l’onglet Vinted ; la programmation automatique reste disponible avec Dotb.',409)
 if(!['live','draft'].includes(mode))throw new AppError('Choisis « en ligne » ou « brouillon Vinted ».')
 if(row.owner_id!==user.id||row.state!=='draft'||row.dotb_item_id||row.publication_task_id)throw new AppError('Cette fiche est déjà transmise ou doit être vérifiée. Aucun nouvel envoi.',409)
 const status=await publicationStatus(db,row.fields.account_id)
 if(!status.ready)throw new AppError(status.reason,409)
 const account=await requireSelectedAccount(db,user.id,row.fields.account_id,accounts||listingAccounts(await read('accounts')))
 const [options,colors,catalogs,photos]=await Promise.all([listingMetadata(`catalogs/${row.fields.catalog_id}/options?country=FR&locale=fr`,read),listingMetadata('colors?country=FR',read),listingMetadata('catalogs?country=FR&depth=6',read),verifiedPhotos(db,user.id,row.photos)])
 const validated=listingPayload(row.fields,photos,options,colors.data,account)
 if(row.fields.brand_id!==1){const brands=await listingMetadata(`brands?q=${encodeURIComponent(row.fields.brand_title)}&limit=25`,read);if(!brands.data?.some(b=>b.id===row.fields.brand_id))throw new AppError('Sélectionne à nouveau la marque dans les résultats.')}
 const title=(rows,id)=>rows?.find(r=>r.id===id)?.title||'',path=[],visited=new Set();let cat=catalogs.data?.find(c=>c.id===row.fields.catalog_id)
 while(cat&&!visited.has(cat.id)){visited.add(cat.id);path.unshift({id:cat.id,title:cat.title});cat=catalogs.data.find(c=>c.id===cat.parent_id)}
 const labels={category_path:path,size:title(options.size_groups?.flatMap(g=>g.sizes||[]),row.fields.size_id),condition:title(options.conditions,row.fields.status_id),package:title(options.package_sizes,row.fields.package_size_id),colors:row.fields.color_ids.map(id=>title(colors.data,id)),attributes:(options.attributes||[]).map(a=>({code:a.code,title:a.title,ids:row.fields.item_attributes?.find(v=>v.code===a.code)?.ids||[]})).filter(a=>a.ids.length).map(a=>({...a,titles:a.ids.map(id=>title(options.attributes.find(v=>v.code===a.code).options,id))}))}
 if(desktopSubmit===true&&(status.executor!=='desktop'||mode!=='live'))throw new AppError('La publication par l’Assistant PC nécessite le mode en ligne.',409)
 const payload={assisted:true,...(status.executor==='desktop'?{execution:'desktop',submit:desktopSubmit===true}:{}),fields:{...row.fields,price:validated.price},photos,labels}
 const result=check(await db.rpc('queue_ylavint_listing',{p_id:row.id,p_owner:user.id,p_version:row.version,p_payload:payload,p_spacing:0,p_not_before:null,p_live:mode==='live'}))
 const saved=Array.isArray(result)?result[0]:result
 if(!saved)throw new AppError('Cette fiche vient de changer ou est déjà envoyée. Actualise son suivi.',409)
 return saved
}

export async function cancelYlavintListing(db,row){
 if(row.publish_provider!=='ylavint'||row.state!=='scheduled'||!row.publication_task_id)throw new AppError('Seul un envoi YlaVint qui n’a pas commencé peut être annulé. Vérifie le résultat sur Vinted.',409)
 const data=check(await db.rpc('cancel_ylavint_listing',{p_id:row.id,p_owner:row.owner_id,p_version:row.version}))
 const saved=Array.isArray(data)?data[0]:data
 if(!saved)throw new AppError('L’envoi a commencé ou la fiche a changé : actualise le suivi. Aucun nouvel envoi.',409)
 return saved
}

export async function publicationBundle(db,task){
 const d=check(await db.from('listing_drafts').select('*').eq('id',task.payload.draft_id).maybeSingle())
 if(!d||d.owner_id!==task.created_by||d.fields.account_id!==task.account_id||d.publication_task_id!==task.id||d.publish_provider!=='ylavint'||!['scheduled','preparing'].includes(d.state)||d.dotb_item_id)throw new AppError('Cette tâche ne correspond plus à la fiche ou au compte choisi.',409)
 const snap=task.payload.listing
 if(snap?.assisted!==true)throw new AppError('L’ancien envoi direct est désactivé. Aucun nouvel essai automatique.',409)
 if(snap.fields?.account_id!==task.account_id||!Array.isArray(snap.photos)||!snap.photos.length)throw new AppError('Les données de cet envoi sont incomplètes.',409)
 const paths=snap.photos.map(p=>p.path)
 const signed=check(await db.storage.from(ASSET_BUCKET).createSignedUrls(paths,3600))
 const urls=new Map(signed.map(p=>[p.path,p.signedUrl]))
 if(paths.some(p=>!urls.get(p)))throw new AppError('Une photo est inaccessible. L’annonce n’a pas été envoyée.',409)
 return {assisted:true,execution:snap.execution||'extension',submit:snap.execution==='desktop'&&snap.submit===true,fields:snap.fields,labels:snap.labels,photos:snap.photos.map(p=>({url:urls.get(p.path),type:p.type})),deadline:task.lease_until}
}

export function publicationResult(task,result){
 if(task.payload.listing?.execution==='desktop'&&task.payload.listing.submit===true){
  if(result?.confirmed!==true||!/^\d{1,18}$/.test(result.vinted_id||'')||result.prepared)throw new AppError('La mise en ligne n’est pas confirmée. Vérifie le dressing avant de reprendre.',409)
  return {confirmed:true,vinted_id:String(result.vinted_id),message:'Annonce publiée et retrouvée sur sa page Vinted.'}
 }
 if(task.payload.listing?.assisted!==true||result?.prepared!==true||result.vinted_id||!Array.isArray(result.missing)||result.missing.length>30||result.missing.some(x=>typeof x!=='string'||x.length>100))throw new AppError('La préparation du formulaire n’a pas été confirmée. Vérifie l’onglet Vinted ; aucun nouvel essai automatique.',409)
 const missing=[...new Set(result.missing)]
 return {prepared:true,missing,message:missing.length?`Formulaire ouvert. À compléter : ${missing.join(', ')}. Vérifie les photos et publie toi-même sur Vinted.`:'Formulaire rempli. Vérifie les photos et les champs, puis publie toi-même sur Vinted.'}
}
