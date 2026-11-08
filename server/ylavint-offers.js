import {check,vid,money,enqueue} from './vinted-agent.js'
import {acceptableOffer} from './vinted-agent-config.js'

export function parseOffers(raw){
  if(!Array.isArray(raw))return []
  return raw.slice(0,10).flatMap(o=>{
    const id=vid(o?.id),transaction_id=vid(o?.transaction_id),buyer_id=vid(o?.buyer_id)
    if(!id||!transaction_id||!buyer_id||typeof o.is_bundle!=='boolean'||o.currency!=='EUR')return []
    return [{id,transaction_id,buyer_id,price:money(o.price),original_price:money(o.original_price),currency:'EUR',is_bundle:o.is_bundle}]
  })
}
export async function planOffers(db,account,conversations,settings,{now=Date.now()}={}){
  const config=settings?.messaging?.offers
  if(!config?.enabled)return 0
  let queued=0
  for(const c of conversations)for(const offer of c.offers||[]){
    if(offer.buyer_id!==c.other_id||offer.transaction_id!==c.transaction_id||!c.allow_reply||!acceptableOffer(offer,config))continue
    const key=`offer:${account}:${offer.transaction_id}:${offer.id}`
    const prior=check(await db.from('vinted_agent_tasks').select('id').eq('dedupe_key',key).limit(1))
    if(prior.length)continue // Même un résultat inconnu ne doit pas être rejoué automatiquement.
    const recent=await db.from('vinted_agent_tasks').select('id',{count:'exact',head:true}).eq('account_id',account).eq('kind','accept_offer')
      .eq('payload->offer->>buyer_id',offer.buyer_id).neq('state','cancelled').gte('created_at',new Date(now-config.period_days*864e5).toISOString())
    check(recent)
    if((recent.count||0)>=config.max_per_buyer)continue
    queued+=await enqueue(db,[{account_id:account,kind:'accept_offer',priority:6,dedupe_key:key,
      payload:{conversation_id:c.id,offer},not_before:new Date(now).toISOString()}])
  }
  return queued
}
