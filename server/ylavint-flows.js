// YlaVint : likes façon Dotb (rotation de 3 messages, offre, relance, filtres) et flux de commande
// (confirmation, demande de délai, annulation, retrait, évaluation, message de fin, suppression de l'article vendu).
// Toutes les actions passent par la file de tâches : plafonds du compte, plage horaire et recettes apprises.
import {check,vid,text,iso,jitter,enqueue,KINDS} from './vinted-agent.js'
import {fillTemplate,offerPrice,OPTIONAL} from './vinted-agent-config.js'

const DAY=86400000,HOUR=3600000
const nowIso=t=>new Date(t).toISOString()

// ---------- Likes ----------
// Nouveaux likes → contacts. Écartés : membres ignorés, déjà contactés pendant la période choisie, limite par article.
export async function planLikes(db,task,likes,settings,{now=Date.now(),rand=Math.random,can}){
  const L=settings.likes
  if(!settings.features.likes||!likes.length||!KINDS.like_message.needs.every(k=>can.has(k)))return {likes:likes.length,queued:0,message:`${likes.length} like(s) lu(s).`}
  const account=task.account_id
  const known=new Set(check(await db.from('vinted_agent_contacts').select('item_id,user_id').eq('account_id',account).in('item_id',[...new Set(likes.map(l=>l.item_id))])).map(c=>`${c.item_id}:${c.user_id}`))
  const fresh=likes.filter(l=>!known.has(`${l.item_id}:${l.user_id}`))
  if(!fresh.length)return {likes:likes.length,queued:0,message:`${likes.length} like(s) lu(s), aucun nouveau.`}
  const users=[...new Set(fresh.map(l=>l.user_id))],items=[...new Set(fresh.map(l=>l.item_id))]
  const history=check(await db.from('vinted_agent_contacts').select('item_id,user_id,state,created_at,sent_at').eq('account_id',account).in('user_id',users).in('state',['queued','sent']))
  const perItem=L.per_item.enabled?check(await db.from('vinted_agent_contacts').select('item_id').eq('account_id',account).in('item_id',items).in('state',['queued','sent'])):[]
  const byUser=new Map(),byItem=new Map()
  for(const h of history){const u=byUser.get(h.user_id)||{count:0,last:0};u.count++;u.last=Math.max(u.last,Date.parse(h.sent_at||h.created_at)||0);byUser.set(h.user_id,u)}
  for(const c of perItem)byItem.set(c.item_id,(byItem.get(c.item_id)||0)+1)
  const ignored=new Set(L.ignored),rows=[],tasks=[]
  for(const l of fresh){
    const u=byUser.get(l.user_id)||{count:0,last:0}
    let skip=null
    if(l.login&&ignored.has(l.login.toLowerCase()))skip='ignored'
    else if(u.last&&u.last>now-L.cooldown_days*DAY)skip='cooldown'
    else if(L.per_item.enabled&&(byItem.get(l.item_id)||0)>=L.per_item.max)skip='per_item'
    const step=Math.min(u.count,L.messages.length-1)
    rows.push({account_id:account,item_id:l.item_id,user_id:l.user_id,login:l.login||null,state:skip?'skipped':'queued',step:skip?null:step})
    if(skip)continue
    byUser.set(l.user_id,{count:u.count+1,last:now});byItem.set(l.item_id,(byItem.get(l.item_id)||0)+1)
    tasks.push({account_id:account,kind:'like_message',dedupe_key:`like:${account}:${l.item_id}:${l.user_id}`,
      not_before:nowIso(now+L.wait_minutes*60000+jitter(0,L.wait_minutes?20:3,rand)),payload:{item_id:l.item_id,user_id:l.user_id,login:l.login||null,step}})
  }
  if(rows.length)check(await db.from('vinted_agent_contacts').upsert(rows,{onConflict:'account_id,item_id,user_id',ignoreDuplicates:true}))
  const queued=await enqueue(db,tasks),skipped=rows.filter(r=>r.state==='skipped').length
  return {likes:likes.length,queued,skipped,message:`${likes.length} like(s) lu(s), ${queued} message(s) prévu(s)${skipped?`, ${skipped} écarté(s) par tes filtres`:''}.`}
}

// Contenu d'un envoi après un like (ou de sa relance), calculé au moment de l'envoi avec le prix du moment.
export async function likePayload(db,task,settings){
  const p=task.payload,L=settings.likes,step=L.messages[Math.min(Number(p.step)||0,L.messages.length-1)]
  const listing=check(await db.from('vinted_agent_listings').select('title,price,state').eq('account_id',task.account_id).eq('item_id',p.item_id).maybeSingle())
  const part=p.followup?step.followup:step
  const vars={login:p.login,title:listing?.title,price:listing?.price}
  return {...p,message:fillTemplate(part.message,vars)||'',offer_price:offerPrice(listing?.price,part.discount),
    skip:listing?.state==='sold'||listing?.state==='draft'?'L’article n’est plus en vente.':null,
    filters:{min_rating:L.min_rating.enabled?L.min_rating.value:null,skip_unrated:L.skip_unrated,ignored:L.ignored}}
}
export const optionalRecipes=kind=>OPTIONAL[kind]||[]

// Après l'envoi : contact à jour, relance programmée si elle est prévue pour ce message.
export async function likeDone(db,task,result,settings,{now=Date.now(),rand=Math.random}={}){
  const p=task.payload,at=nowIso(now),skipped=typeof result?.skipped==='string'?text(result.skipped,120):null
  const where=q=>q.eq('account_id',task.account_id).eq('item_id',p.item_id).eq('user_id',p.user_id)
  if(p.followup){
    check(await where(db.from('vinted_agent_contacts').update({followup_state:skipped?'skipped':'sent'})))
    return {message:skipped?`Relance non envoyée : ${skipped}`:'Relance envoyée après un like.',skipped}
  }
  const conversation=vid(result?.conversation_id)
  check(await where(db.from('vinted_agent_contacts').update({state:skipped?'skipped':'sent',sent_at:skipped?null:at,conversation_id:conversation,...(result?.login?{login:text(result.login,40)}:{})})))
  if(skipped)return {message:`Like écarté : ${skipped}`,skipped}
  const step=settings.likes.messages[Math.min(Number(p.step)||0,settings.likes.messages.length-1)]
  if(step?.followup?.enabled&&conversation){
    const added=await enqueue(db,[{account_id:task.account_id,kind:'like_message',dedupe_key:`likefu:${task.account_id}:${p.item_id}:${p.user_id}`,
      not_before:nowIso(now+step.followup.delay_hours*HOUR+jitter(0,30,rand)),payload:{...p,followup:true,conversation_id:conversation}}])
    if(added)check(await where(db.from('vinted_agent_contacts').update({followup_state:'queued'})))
  }
  return {message:`Message ${(Number(p.step)||0)+1} envoyé après un like${result?.offer?' avec une offre':''}.`}
}

// ---------- Flux de commande ----------
// Étape d'une vente, d'après le statut affiché par Vinted (français ou anglais).
export function orderStage(status){
  const s=String(status||'').toLowerCase()
  if(!s)return 'other'
  if(/annul|cancel|rembours|refund/.test(s))return 'cancelled'
  if(/termin|complete|finalis|finished/.test(s))return 'completed'
  if(/point relais|point de retrait|à retirer|a retirer|disponible|ready (for|to) (pick|collect)|available for (pick|collect)/.test(s))return 'pickup'
  if(/(exp[ée]die|envoie) (le|ton|votre)|à expédier|a expedier|to ship|ship (it|the)|send (it|the)/.test(s))return 'paid'
  if(/exp[ée]di|envoy|en route|transit|shipped|en cours de livraison|livr|deliver/.test(s))return 'shipped'
  if(/paiement|payment|paid|pay[ée]|bordereau|label/.test(s))return 'paid'
  return 'other'
}
const mark=(flow,step,state,now,extra={})=>({...flow,[step]:{state,at:nowIso(now),...extra}})
const FLOW_KINDS=new Set(['order_message','order_extension','order_cancel','order_review','item_delete'])
export const isFlowTask=kind=>FLOW_KINDS.has(kind)

// Après chaque lecture des ventes : étape à jour, puis les actions dues du flux, chacune une seule fois par vente.
export async function planFlow(db,accountId,orders,settings,{now=Date.now(),rand=Math.random,can}){
  if(!orders.length)return {queued:0}
  const F=settings.order_flow
  const rows=check(await db.from('vinted_agent_orders').select('transaction_id,account_id,stage,stage_at,ship_deadline,order_date,conversation_id,item_ids,flow').in('transaction_id',orders.map(o=>o.transaction_id)))
  const byId=new Map(rows.filter(r=>r.account_id===accountId).map(r=>[r.transaction_id,r]))
  const tasks=[],cancelKeys=[],reschedule=[]
  for(const o of orders){
    const row=byId.get(o.transaction_id);if(!row)continue
    const before=row.stage,stage=orderStage(o.status),moved=before!==stage
    const stageAt=moved||!row.stage_at?now:Date.parse(row.stage_at)
    let flow={...(row.flow||{})}
    if(o.buyer_login)flow.login=text(o.buyer_login,40)
    const conv=row.conversation_id,tid=o.transaction_id,deadline=Date.parse(row.ship_deadline||'')||null,ordered=Date.parse(row.order_date||'')||null
    const vars={login:flow.login,title:o.title}
    const add=(step,kind,at,payload)=>{
      if(flow[step])return
      tasks.push({account_id:accountId,kind,dedupe_key:`flow:${step}:${tid}`,not_before:nowIso(Math.max(now,at)+jitter(1,8,rand)),payload:{transaction_id:tid,conversation_id:conv,step,...payload}})
      flow=mark(flow,step,'queued',now)
    }
    // Plus « à expédier » : la demande de délai, ses relances et l'annulation n'ont plus lieu d'être.
    if(moved&&before==='paid')cancelKeys.push(...['ext','ext1','ext2','cancel'].map(s=>`flow:${s}:${tid}`))
    if(moved&&before==='pickup')cancelKeys.push(`flow:pickup1:${tid}`,`flow:pickup2:${tid}`)
    // Une vente découverte déjà avancée (première lecture) ne déclenche rien : seules les étapes vues en direct comptent.
    const live=before!=null||stage==='paid'&&ordered&&ordered>now-3*DAY
    if(live&&stage==='paid'){
      if(F.confirm.enabled&&conv&&ordered&&ordered>now-2*DAY)add('confirm','order_message',now,{body:fillTemplate(F.confirm.message,vars)})
      if(F.extension.enabled&&ordered&&can.has('shipping_extension')){
        const due=ordered+F.extension.after_days*DAY
        if(due>now-DAY&&(!deadline||due<deadline))add('ext','order_extension',due,{message:fillTemplate(F.extension.message,vars)})
      }
      const ext=flow.ext
      if(ext?.state==='done'&&conv){
        // Délai accepté (date limite repoussée) : pas de relance.
        const extended=deadline&&ext.deadline&&deadline>Date.parse(ext.deadline)+HOUR
        const done=Date.parse(ext.at)
        if(!extended&&F.extension.relance1)add('ext1','order_message',done+DAY,{body:fillTemplate(F.extension.relance1,vars)})
        if(!extended&&F.extension.relance2)add('ext2','order_message',done+2*DAY,{body:fillTemplate(F.extension.relance2,vars)})
      }
      if(F.cancel.enabled&&deadline&&can.has('order_cancel')){
        const at=deadline-F.cancel.minutes_before*60000
        if(!flow.cancel&&at>now)add('cancel','order_cancel',at,{})
        else if(flow.cancel?.state==='queued'&&flow.cancel.deadline!==row.ship_deadline)reschedule.push({key:`flow:cancel:${tid}`,at:nowIso(Math.max(now,at))})
        if(flow.cancel)flow.cancel={...flow.cancel,deadline:row.ship_deadline}
      }
    }
    if(live&&before!=null&&stage==='pickup'&&F.pickup.enabled&&conv){
      add('pickup1','order_message',stageAt+F.pickup.first_days*DAY,{body:fillTemplate(F.pickup.first,vars)})
      if(F.pickup.second)add('pickup2','order_message',stageAt+F.pickup.second_days*DAY,{body:fillTemplate(F.pickup.second,vars)})
    }
    if(before!=null&&stage==='completed'){
      const at=stageAt+F.review.after_days*DAY
      if(F.review.enabled&&can.has('feedback_send'))add('review','order_review',at,{text:fillTemplate(F.review.text,vars)})
      if(F.review.enabled&&F.review.end_message&&conv)add('end','order_message',at,{body:fillTemplate(F.review.end_message,vars)})
      if(F.delete_sold&&can.has('item_delete'))for(const item of (row.item_ids||[]).slice(0,10))add(`del_${item}`,'item_delete',at+HOUR,{item_id:item})
    }
    const changed=moved||!row.stage_at||JSON.stringify(flow)!==JSON.stringify(row.flow||{})
    if(changed)check(await db.from('vinted_agent_orders').update({stage,stage_at:nowIso(stageAt),flow}).eq('transaction_id',tid))
  }
  if(cancelKeys.length)check(await db.from('vinted_agent_tasks').update({state:'cancelled',error:'Étape de la vente dépassée.',finished_at:nowIso(now)}).in('dedupe_key',cancelKeys).eq('state','queued'))
  for(const r of reschedule)check(await db.from('vinted_agent_tasks').update({not_before:r.at}).eq('dedupe_key',r.key).eq('state','queued'))
  return {queued:await enqueue(db,tasks)}
}

// Fin d'une action du flux : l'étape est marquée faite (ou en échec) sur la vente.
export async function flowDone(db,task,{ok,result=null,error=null},{now=Date.now()}={}){
  const tid=vid(task.payload?.transaction_id),step=String(task.payload?.step||'').slice(0,40)
  if(!tid||!step)return {}
  const row=check(await db.from('vinted_agent_orders').select('flow,ship_deadline').eq('transaction_id',tid).eq('account_id',task.account_id).maybeSingle())
  if(!row)return {}
  const extra=step==='ext'?{deadline:row.ship_deadline}:{}
  const skipped=ok&&typeof result?.skipped==='string'?text(result.skipped,120):null
  const flow=mark(row.flow||{},step,ok?(skipped?'skipped':'done'):'failed',now,{...extra,...(error?{error:text(error,200)}:{}),...(skipped?{reason:skipped}:{})})
  check(await db.from('vinted_agent_orders').update({flow}).eq('transaction_id',tid))
  if(ok&&task.kind==='order_message'&&task.payload.conversation_id&&!skipped)await recordFlowMessage(db,task,result,now).catch(()=>null)
  const label={confirm:'Confirmation de commande',ext:'Demande de délai',ext1:'Relance de délai (+1 j)',ext2:'Relance de délai (+2 j)',cancel:'Annulation',pickup1:'Message de retrait 1',pickup2:'Message de retrait 2',review:'Évaluation',end:'Message de fin'}[step]||(step.startsWith('del_')?'Suppression de l’article vendu':step)
  return {message:skipped?`${label} : ${skipped}`:`${label} : fait.`}
}
async function recordFlowMessage(db,task,result,now){
  const at=nowIso(now),conv=vid(task.payload.conversation_id)
  check(await db.from('ylavint_messages').upsert({account_id:task.account_id,conversation_id:conv,message_id:vid(result?.message_id)||`local:flow:${task.id}`,from_me:true,body:task.payload.body,state:'sent',source:'flow',sent_at:at},{onConflict:'account_id,conversation_id,message_id',ignoreDuplicates:true}))
  await db.from('ylavint_conversations').update({last_message:task.payload.body,last_message_at:at,last_from_me:true,updated_at:at}).eq('account_id',task.account_id).eq('conversation_id',conv)
}
// Bordereaux : transporteurs à ignorer (nom exact, sans tenir compte des majuscules).
export const carrierIgnored=(settings,carrier)=>!!carrier&&settings.order_flow.labels.ignore_carriers.some(c=>String(carrier).toLowerCase().includes(c))
export {iso}
