import {AppError,isId} from './dotb.js'

export const DESKTOP_KINDS=['scan_wardrobe','scan_likes','sync_inbox','like_message','reply_message']
export const desktopDriver=key=>key?.desktop_account_id?'desktop':'extension'
const check=r=>{if(r.error)throw r.error;return r.data}

// A desktop key is bound to one account. The PC never receives the admin session.
export async function authorizeDesktop(db,key,body){
  if(!key.desktop_account_id)return
  if(!['agent_poll','agent_result'].includes(body?.action))throw new AppError('Cette connexion est réservée à l’assistant de ce compte.',403)
  if(body.profile_id!==key.desktop_profile_id)throw new AppError('Cette connexion appartient à un autre profil AdsPower.',403)
  const account=check(await db.from('publication_accounts').select('id,vinted_id,ylavint_unlinked_at').eq('id',key.desktop_account_id).maybeSingle())
  if(!account||account.ylavint_unlinked_at||String(account.vinted_id)!==String(body.member_id))throw new AppError('Le compte ouvert ne correspond pas au compte relié.',403)
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
