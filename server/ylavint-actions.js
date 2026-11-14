// Read-only previews share the send-time formatter. Viewing a plan never claims work.
import {AppError,isId} from './dotb.js'
import {check,effectiveSettings,agentLog} from './vinted-agent.js'
import {likePayload} from './ylavint-flows.js'
import {isDesktop} from '../src/lib/ylavintExecution.js'
import {desktopWindow} from './ylavint-desktop.js'

export async function upcomingActions(db,accountId=null,{now=Date.now()}={}){
 let query=db.from('vinted_agent_tasks').select('id,account_id,kind,state,not_before,created_at,payload').in('state',['queued','running']).in('kind',['reply_message','like_message']).order('not_before',{ascending:true}).limit(100)
 if(accountId)query=query.eq('account_id',accountId)
 const tasks=check(await query)
 if(!tasks.length)return {actions:[]}
 const ids=[...new Set(tasks.map(t=>t.account_id))]
 const [rows,accounts,conversations]=await Promise.all([
  db.from('vinted_agent_settings').select('*').in('account_id',ids).then(check),
  db.from('publication_accounts').select('id,login').in('id',ids).then(check),
  db.from('ylavint_conversations').select('account_id,conversation_id,other_login,item_title').in('account_id',ids).in('conversation_id',tasks.map(t=>t.payload?.conversation_id).filter(Boolean)).then(check),
 ])
 const settings=new Map(rows.map(r=>[r.account_id,r])),names=new Map(accounts.map(r=>[r.id,r.login]))
 return {actions:await Promise.all(tasks.map(async t=>{
  const row=settings.get(t.account_id),s=effectiveSettings(row),p=t.kind==='like_message'?await likePayload(db,t,s):t.payload||{}
  const c=conversations.find(c=>c.account_id===t.account_id&&c.conversation_id===p.conversation_id)
  const stale=isDesktop(s)&&t.kind==='reply_message'&&now-Date.parse(t.created_at)>s.messaging.desktop.reply_max_age_hours*3600000
  const blocked=p.skip||(!row?.enabled?'Compte non activé.':row.paused?'Compte en pause.':isDesktop(s)&&!desktopWindow(s.limits,now,s.messaging.desktop)?'En dehors du planning ou en absence.':stale?'Réponse ancienne : relecture et validation nécessaires.':null)
  return {id:t.id,account_id:t.account_id,login:names.get(t.account_id)||'Compte Vinted',kind:t.kind,state:t.state,not_before:t.not_before,created_at:t.created_at,
   conversation_id:p.conversation_id||null,item_id:p.item_id||null,recipient:p.login||c?.other_login||'Membre à confirmer sur Vinted',item_title:p.title||c?.item_title||null,
   body:p.message??p.body??'',offer_price:p.offer_price??null,offer_requested:!!p.offer_requested,
   reason:t.kind==='reply_message'?(p.source==='ai'?'Réponse IA aux derniers messages reçus.':'Réponse validée depuis la messagerie.') : p.followup?'Rappel après un favori, uniquement sans réponse de l’acheteur.':'Premier contact après un favori.',
   source_message_id:p.source_message_id||p.context_message_id||null,executor:isDesktop(s)?'desktop':'extension',blocked_reason:blocked}
 }))}
}

export async function cancelPlannedAction(db,taskId,{now=Date.now()}={}){
 if(!isId(taskId))throw new AppError('Action invalide.')
 const task=check(await db.from('vinted_agent_tasks').select('id,account_id,kind,payload,state').eq('id',taskId).maybeSingle())
 if(!task||!['like_message','reply_message'].includes(task.kind))throw new AppError('Action introuvable.',404)
 const saved=check(await db.from('vinted_agent_tasks').update({state:'cancelled',finished_at:new Date(now).toISOString(),error:'Annulée depuis les prochaines actions.'}).eq('id',taskId).eq('state','queued').select('id'))
 if(!saved.length)throw new AppError('Cette action est déjà prise en charge. Reprends la main dans Assistant PC.',409)
 const p=task.payload||{}
 if(task.kind==='reply_message'){
  check(await db.from('ylavint_messages').update({state:'cancelled',error:'Annulé depuis les prochaines actions.'}).eq('account_id',task.account_id).eq('task_id',taskId).eq('state','queued'))
  if(p.source==='ai')check(await db.from('ylavint_conversations').update({ai_state:'skipped',ai_draft:null,ai_reason:'Réponse annulée par le vendeur.'}).eq('account_id',task.account_id).eq('conversation_id',p.conversation_id))
 }else check(await db.from('vinted_agent_contacts').update(p.followup?{followup_state:'skipped'}:{state:'skipped'}).eq('account_id',task.account_id).eq('item_id',p.item_id).eq('user_id',p.user_id))
 await agentLog(db,{account_id:task.account_id,task_id:taskId,event:'manual_cancel',message:'Action annulée avant sa prise en charge.'})
 return {cancelled:1}
}
