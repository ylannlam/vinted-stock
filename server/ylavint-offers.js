import {priorityResponses,responseTiming} from '../src/lib/responsePriority.js'
import {check,vid,money,enqueue} from './vinted-agent.js'
import {inHistory} from './ylavint-history.js'
import {acceptableOffer} from './vinted-agent-config.js'
import {isDesktop} from '../src/lib/ylavintExecution.js'

export function parseOffers(raw){
  if(!Array.isArray(raw))return []
  return raw.slice(0,10).flatMap(o=>{
    if(o?.desktop===true){
      if(!/^ui:[a-f0-9]{48}$/.test(o.id||'')||!vid(o.buyer_id)||!vid(o.item_id)||o.pending!==true||o.is_bundle!==false||o.currency!=='EUR')return []
      return [{id:o.id,desktop:true,pending:true,buyer_id:vid(o.buyer_id),item_id:vid(o.item_id),price:money(o.price),original_price:money(o.original_price),currency:'EUR',is_bundle:false,created_at:o.created_at||null}]
    }
    const id=vid(o?.id),transaction_id=vid(o?.transaction_id),buyer_id=vid(o?.buyer_id)
    if(!id||!transaction_id||!buyer_id||typeof o.is_bundle!=='boolean'||o.currency!=='EUR')return []
    return [{id,transaction_id,buyer_id,price:money(o.price),original_price:money(o.original_price),currency:'EUR',is_bundle:o.is_bundle,created_at:o.created_at||null}]
  })
}
export async function planOffers(db,account,conversations,settings,{now=Date.now()}={}){
  const config=settings?.messaging?.offers
  if(!config?.enabled)return 0
  let queued=0
  for(const c of conversations)for(const offer of c.offers||[]){
    if(isDesktop(settings)?offer.desktop!==true||offer.item_id!==c.item_id:offer.desktop===true||offer.transaction_id!==c.transaction_id||!c.allow_reply)continue
    if(offer.buyer_id!==c.other_id||!acceptableOffer(offer,config)||!inHistory(offer.created_at,config.history_since))continue
    const key=`offer:${account}:${offer.desktop?c.id:offer.transaction_id}:${offer.id}`
    const prior=check(await db.from('vinted_agent_tasks').select('id').eq('dedupe_key',key).limit(1))
    if(prior.length)continue // Même un résultat inconnu ne doit pas être rejoué automatiquement.
    const recent=await db.from('vinted_agent_tasks').select('id',{count:'exact',head:true}).eq('account_id',account).eq('kind','accept_offer')
      .eq('payload->offer->>buyer_id',offer.buyer_id).neq('state','cancelled').gte('created_at',new Date(now-config.period_days*864e5).toISOString())
    check(recent)
    if((recent.count||0)>=config.max_per_buyer)continue
    queued+=await enqueue(db,[{account_id:account,kind:'accept_offer',priority:6,dedupe_key:key,...(priorityResponses(settings)?responseTiming(offer.created_at,now):{}),
      payload:{conversation_id:c.id,offer,...(offer.desktop?{desktop_offer:true,item_id:c.item_id,title:c.item_title||''}:{})},not_before:new Date(now).toISOString()}])
  }
  return queued
}

export function acceptedOfferText(config,payload){
 return String(config?.message||'').replace(/\{prix\}/g,Number(payload.offer.price).toFixed(2).replace('.',',')+' €').replace(/\{article\}/g,payload.title||'cet article').trim()
}

export async function recordAcceptedOffer(db,task,result,now=Date.now()){
 const p=task.payload,at=new Date(now).toISOString(),filter=q=>q.eq('account_id',task.account_id).eq('conversation_id',p.conversation_id)
 if(result.conversation_id!==p.conversation_id||result.accepted!==true||result.offer_id!==p.offer.id)throw Error('Acceptation non confirmée pour cette conversation.')
 if(result.message_id&&typeof result.message==='string'&&result.message.trim()){
  check(await db.from('ylavint_messages').upsert({account_id:task.account_id,conversation_id:p.conversation_id,message_id:String(result.message_id),from_me:true,body:result.message,kind:'message',source:'flow',state:'sent',sent_at:at,task_id:task.id},{onConflict:'account_id,conversation_id,message_id',ignoreDuplicates:true}))
 }
 check(await filter(db.from('ylavint_conversations').update({needs_human:!!result.message_error,ai_state:result.message_error?'human':'none',ai_reason:result.message_error||'Offre acceptée selon les réglages.',...(result.message_id?{last_from_me:true,last_message:result.message,last_message_at:at}:{}),updated_at:at})))
}
