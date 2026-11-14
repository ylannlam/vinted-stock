import {AppError,isId} from './dotb.js'
import {effectiveSettings} from './vinted-agent-config.js'

export {DESKTOP_KINDS} from '../src/lib/ylavintExecution.js'
export const desktopDriver=key=>key?.desktop_account_id?'desktop':'extension'
const check=r=>{if(r.error)throw r.error;return r.data}

// A desktop key is bound to one account. The PC never receives the admin session.
export async function authorizeDesktop(db,key,body){
  if(!key.desktop_account_id)return
  if(!['agent_poll','agent_result','agent_guard','agent_status'].includes(body?.action))throw new AppError('Cette connexion est réservée à l’assistant de ce compte.',403)
  if(body.profile_id!==key.desktop_profile_id)throw new AppError('Cette connexion appartient à un autre profil AdsPower.',403)
  const account=check(await db.from('publication_accounts').select('id,vinted_id,ylavint_unlinked_at').eq('id',key.desktop_account_id).maybeSingle())
  if(!account||account.ylavint_unlinked_at||String(account.vinted_id)!==String(body.member_id))throw new AppError('Le compte ouvert ne correspond pas au compte relié.',403)
}

export function desktopWindow(limits,now=Date.now()){
 const hour=Number(new Intl.DateTimeFormat('fr-FR',{hour:'2-digit',hourCycle:'h23',timeZone:'Europe/Paris'}).formatToParts(now).find(p=>p.type==='hour').value),{from_hour:from,to_hour:to}=limits
 return from===to||(from<to?hour>=from&&hour<to:hour>=from||hour<to)
}
export async function statusDesktop(db,key,now=Date.now()){
 if(!key.desktop_account_id)throw new AppError('Contrôle réservé à l’assistant PC.',403)
 const row=check(await db.from('vinted_agent_settings').select('enabled,paused,messaging,limits,version').eq('account_id',key.desktop_account_id).maybeSingle())
 if(!row)return {allowed:false,in_window:false}
 const settings=effectiveSettings(row)
 return {allowed:!!row.enabled&&!row.paused&&row.messaging?.executor==='desktop',in_window:desktopWindow(settings.limits,now),pace:settings.messaging.desktop,version:row.version}
}

// Recheck site controls immediately before a visible message or offer is submitted.
export async function guardDesktop(db,key,body,now=Date.now()){
  if(!key.desktop_account_id)throw new AppError('Contrôle réservé à l’assistant PC.',403)
  if(!isId(body.task_id)||!isId(body.lease))throw new AppError('Tâche invalide.')
  const task=check(await db.from('vinted_agent_tasks').select('id,account_id,kind,state,lease,lease_until').eq('id',body.task_id).eq('account_id',key.desktop_account_id).eq('lease',body.lease).maybeSingle())
  if(!task||task.state!=='running'||Date.parse(task.lease_until)<=now||!Number.isFinite(Date.parse(task.lease_until))||!['like_message','reply_message'].includes(task.kind))throw new AppError('Cette action a expiré ou a été annulée sur le site.',409)
  const settings=check(await db.from('vinted_agent_settings').select('enabled,paused,messaging,limits,version').eq('account_id',key.desktop_account_id).maybeSingle())
  if(!settings?.enabled||settings.paused||settings.messaging?.executor!=='desktop')throw new AppError('L’assistant a été arrêté, mis en pause ou confié à l’extension sur le site.',409)
  if(settings.version!==body.settings_version)throw new AppError('Les réglages ont changé pendant cette action. Vérifie le compte avant de reprendre.',409)
  if(!desktopWindow(effectiveSettings(settings).limits,now))throw new AppError('Le créneau horaire d’envoi est terminé.',409)
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
