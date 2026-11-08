// Publication de l'atelier par le profil Vinted choisi. Dotb reste une voie séparée.
import {AppError,isId} from './dotb.js'
import {effectiveSettings} from './vinted-agent-config.js'
import {check,listingAccounts,listingMetadata,listingPayload,verifiedPhotos,dotbListingRequest} from './listing-studio-core.js'
import {requireSelectedAccount} from './adspower-selection.js'
import {readListingSettings} from './listing-settings.js'
import {ASSET_BUCKET} from './resources.js'

export const publicationVersion=v=>/^\d+\.\d+\.\d+$/.test(v||'')&&(Number(v.split('.')[0])>3||Number(v.split('.')[0])===3&&Number(v.split('.')[1])>=7)
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
 const reason=!s?.enabled?'Active YlaVint sur ce compte.':!cfg.features.publish?'Active « Publication » dans les réglages YlaVint du compte.':!publicationVersion(s?.extension_version)?'Installe YlaVint 3.7.0 ou une version plus récente dans ce profil AdsPower.':null
 return {ready:!reason,online,paused:!!s?.paused,reason,waiting:reason|| (s?.paused?`En pause : ${s.pause_reason||'relance YlaVint dans ce profil.'}`:!online?'En attente du profil AdsPower : ouvre Vinted et allume le Bridge YlaVint.':null),limit:cfg.limits.publish_item_per_day,from_hour:cfg.limits.from_hour,to_hour:cfg.limits.to_hour}
}

export async function queueYlavintListing(db,user,row,{mode='live',notBefore=null,read=dotbListingRequest,settings=readListingSettings,accounts=null}={}){
 if(!['live','draft'].includes(mode))throw new AppError('Choisis « en ligne » ou « brouillon Vinted ».')
 if(row.owner_id!==user.id||row.state!=='draft'||row.dotb_item_id||row.publication_task_id)throw new AppError('Cette fiche est déjà transmise ou doit être vérifiée. Aucun nouvel envoi.',409)
 const status=await publicationStatus(db,row.fields.account_id)
 if(!status.ready)throw new AppError(status.reason,409)
 const account=await requireSelectedAccount(db,user.id,row.fields.account_id,accounts||listingAccounts(await read('accounts')))
 const [options,colors,photos]=await Promise.all([listingMetadata(`catalogs/${row.fields.catalog_id}/options?country=FR&locale=fr`,read),listingMetadata('colors?country=FR',read),verifiedPhotos(db,user.id,row.photos)])
 const validated=listingPayload(row.fields,photos,options,colors.data,account)
 if(row.fields.brand_id!==1){const brands=await listingMetadata(`brands?q=${encodeURIComponent(row.fields.brand_title)}&limit=25`,read);if(!brands.data?.some(b=>b.id===row.fields.brand_id))throw new AppError('Sélectionne à nouveau la marque dans les résultats.')}
 const payload={fields:{...row.fields,price:validated.price},photos}
 const result=check(await db.rpc('queue_ylavint_listing',{p_id:row.id,p_owner:user.id,p_version:row.version,p_payload:payload,p_spacing:(await settings(db,row.fields.account_id)).effective.spacing_minutes,p_not_before:notBefore,p_live:mode==='live'}))
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
 if(!snap||snap.fields?.account_id!==task.account_id||!Array.isArray(snap.photos)||!snap.photos.length)throw new AppError('Les données de cet envoi sont incomplètes.',409)
 const paths=snap.photos.map(p=>p.path)
 const signed=check(await db.storage.from(ASSET_BUCKET).createSignedUrls(paths,1800))
 const urls=new Map(signed.map(p=>[p.path,p.signedUrl]))
 if(paths.some(p=>!urls.get(p)))throw new AppError('Une photo est inaccessible. L’annonce n’a pas été envoyée.',409)
 return {fields:snap.fields,photos:snap.photos.map(p=>({url:urls.get(p.path),type:p.type})),live:task.payload.live===true,deadline:task.lease_until}
}

export function publicationResult(task,result){
 const id=String(result?.vinted_id||''),draft=task.payload.live===false
 if(!/^[1-9]\d{0,17}$/.test(id)||result?.draft!==draft||result?.confirmed!==true)throw new AppError('Vinted n’a pas confirmé le résultat attendu. Vérifie le dressing et les brouillons avant toute nouvelle publication.',409)
 return {vinted_id:id,draft,message:draft?`Brouillon ${id} créé sur Vinted par YlaVint.`:`Annonce ${id} créée sur Vinted par YlaVint. Sa visibilité reste soumise aux vérifications de Vinted.`}
}
