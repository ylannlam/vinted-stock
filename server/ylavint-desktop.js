import {AppError,isId} from './dotb.js'
import {effectiveSettings} from './vinted-agent-config.js'

export {DESKTOP_KINDS} from '../src/lib/ylavintExecution.js'
export const desktopDriver=key=>key?.desktop_account_id?'desktop':'extension'
const check=r=>{if(r.error)throw r.error;return r.data}

// A desktop key is bound to one account. The PC never receives the admin session.
export async function authorizeDesktop(db,key,body){
  if(!key.desktop_account_id)return
  if(!['agent_poll','agent_result','agent_guard','agent_status','agent_preview','agent_context','agent_progress'].includes(body?.action))throw new AppError('Cette connexion est réservée à l’assistant de ce compte.',403)
  if(body.profile_id!==key.desktop_profile_id)throw new AppError('Cette connexion appartient à un autre profil AdsPower.',403)
  const account=check(await db.from('publication_accounts').select('id,vinted_id,ylavint_unlinked_at').eq('id',key.desktop_account_id).maybeSingle())
  if(!account||account.ylavint_unlinked_at||String(account.vinted_id)!==String(body.member_id))throw new AppError('Le compte ouvert ne correspond pas au compte relié.',403)
}

export async function previewDesktop(db,key){
 if(!key.desktop_account_id)throw new AppError('Aperçu réservé à l’assistant PC.',403)
 return (await import('./ylavint-actions.js')).upcomingActions(db,key.desktop_account_id)
}
export async function refreshDesktop(db,key,body){
 if(!key.desktop_account_id)throw new AppError('Lecture réservée à l’assistant PC.',403)
 const row=check(await db.from('vinted_agent_settings').select('*').eq('account_id',key.desktop_account_id).maybeSingle())
 if(!row?.enabled||row.paused||row.messaging?.executor!=='desktop')throw new AppError('Ce compte est arrêté ou en pause.',409)
 return (await import('./ylavint.js')).applyInbox(db,{account_id:key.desktop_account_id},body.result,{settings:effectiveSettings(row)})
}

export function desktopWindow(limits,now=Date.now(),pace={}){
 if(pace.absent_until&&Date.parse(pace.absent_until)>now)return false
 const day={Mon:1,Tue:2,Wed:3,Thu:4,Fri:5,Sat:6,Sun:7}[new Intl.DateTimeFormat('en-GB',{weekday:'short',timeZone:'Europe/Paris'}).format(now)]
 const hour=Number(new Intl.DateTimeFormat('fr-FR',{hour:'2-digit',hourCycle:'h23',timeZone:'Europe/Paris'}).formatToParts(now).find(p=>p.type==='hour').value),{from_hour:from,to_hour:to}=limits
 // After midnight, an overnight session still belongs to its starting day.
 const scheduleDay=from>to&&hour<to?(day===1?7:day-1):day
 if(Array.isArray(pace.active_days)&&!pace.active_days.includes(scheduleDay))return false
 return from===to||(from<to?hour>=from&&hour<to:hour>=from||hour<to)
}
export async function statusDesktop(db,key,now=Date.now()){
 if(!key.desktop_account_id)throw new AppError('Contrôle réservé à l’assistant PC.',403)
 const row=check(await db.from('vinted_agent_settings').select('enabled,paused,messaging,limits,version').eq('account_id',key.desktop_account_id).maybeSingle())
 if(!row)return {allowed:false,in_window:false}
 const settings=effectiveSettings(row)
 return {allowed:!!row.enabled&&!row.paused&&row.messaging?.executor==='desktop',in_window:desktopWindow(settings.limits,now,settings.messaging.desktop),pace:settings.messaging.desktop,version:row.version}
}

// Recheck site controls immediately before a visible message or offer is submitted.
export async function guardDesktop(db,key,body,now=Date.now()){
  if(!key.desktop_account_id)throw new AppError('Contrôle réservé à l’assistant PC.',403)
  if(!isId(body.task_id)||!isId(body.lease))throw new AppError('Tâche invalide.')
  const task=check(await db.from('vinted_agent_tasks').select('id,account_id,kind,state,lease,lease_until,payload,created_by').eq('id',body.task_id).eq('account_id',key.desktop_account_id).eq('lease',body.lease).maybeSingle())
  if(!task||task.state!=='running'||Date.parse(task.lease_until)<=now||!Number.isFinite(Date.parse(task.lease_until))||!['like_message','reply_message','publish_item'].includes(task.kind))throw new AppError('Cette action a expiré ou a été annulée sur le site.',409)
  const settings=check(await db.from('vinted_agent_settings').select('enabled,paused,messaging,limits,version,features').eq('account_id',key.desktop_account_id).maybeSingle())
  if(!settings?.enabled||settings.paused||settings.messaging?.executor!=='desktop')throw new AppError('L’assistant a été arrêté, mis en pause ou confié à l’extension sur le site.',409)
  if(settings.version!==body.settings_version)throw new AppError('Les réglages ont changé pendant cette action. Vérifie le compte avant de reprendre.',409)
  const effective=effectiveSettings(settings)
  if(!desktopWindow(effective.limits,now,effective.messaging.desktop))throw new AppError('Le compte est en dehors de son planning ou en absence.',409)
  if(task.kind==='publish_item'){
   if(!effective.features.publish||task.payload?.listing?.execution!=='desktop')throw new AppError('Publication non autorisée pour cet assistant.',409)
   const draft=check(await db.from('listing_drafts').select('id,owner_id,publication_task_id,state,fields,payload').eq('id',task.payload.draft_id).maybeSingle())
   if(!draft||draft.owner_id!==task.created_by||draft.publication_task_id!==task.id||draft.state!=='preparing'||draft.fields.account_id!==task.account_id||JSON.stringify(draft.payload)!==JSON.stringify(task.payload.listing))throw new AppError('La fiche ne correspond plus à la demande de publication.',409)
  }
  return {allowed:true}
}

export async function pairDesktop(db,user,body,newToken){
  if(!isId(body.account_id)||typeof body.profile_id!=='string'||!/^[-a-zA-Z0-9_]{1,100}$/.test(body.profile_id))throw new AppError('Choisis un compte et son profil AdsPower.')
  const account=check(await db.from('publication_accounts').select('id,login,vinted_id,ylavint_unlinked_at').eq('id',body.account_id).maybeSingle())
  if(!account||account.ylavint_unlinked_at||!/^\d{1,18}$/.test(String(account.vinted_id)))throw new AppError('Ce compte doit d’abord être identifié dans Vinted Stock.')
  const settings=check(await db.from('vinted_agent_settings').select('messaging,enabled').eq('account_id',account.id).maybeSingle())
  if(settings?.messaging?.executor!=='desktop')throw new AppError('Choisis « Assistant PC » dans les réglages de ce compte.',409)
  const t=newToken()
  check(await db.from('vinted_watch_keys').insert({id:t.id,token_hash:t.token_hash,created_by:user.id,desktop_account_id:account.id,desktop_profile_id:body.profile_id}))
  return {token:t.token,account_id:account.id,member_id:String(account.vinted_id),login:account.login,profile_id:body.profile_id}
}
