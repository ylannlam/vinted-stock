import {createHmac,timingSafeEqual,randomUUID} from 'node:crypto'
import {remote,remoteId,ScalencyError} from './scalency-api.js'

const url='https://vinted-stock.vercel.app/api/dotb-webhook?provider=scalency'
const checked=r=>{if(r.error)throw r.error;return r.data}
export async function enableWebhook(db){
  const nonce=randomUUID(),pending={pending:true,nonce,started:Date.now()}
  const result=await db.from('scalency_settings').insert({id:'webhook',value:pending})
  let previousUrl
  if(result.error?.code==='23505'){
    const row=checked(await db.from('scalency_settings').select('value').eq('id','webhook').single())
    if(row.value?.secret)return {active:true}
    if(row.value.started>Date.now()-180000)throw new ScalencyError('Connexion des notifications en cours.',409)
    const changed=checked(await db.from('scalency_settings').update({value:pending}).eq('id','webhook').eq('value',JSON.stringify(row.value)).select('id').maybeSingle())
    if(!changed)throw new ScalencyError('Connexion des notifications en cours.',409)
    previousUrl=row.value.nonce?url+'&slot='+row.value.nonce:url
  }else checked(result)
  try{
    const response=await remote('webhooks',{method:'POST',timeoutMs:100000,body:{url:url+'&slot='+nonce,events:['sale.created','job.done','job.failed','job.skipped','job.published','message.new']}})
    const hook=response.webhook||response
    if(!hook.secret)throw new Error('missing_signature')
    checked(await db.from('scalency_settings').update({value:{secret:hook.secret,id:hook.id}}).eq('id','webhook'))
    if(previousUrl){
      const hooks=await remote('webhooks')
      const orphan=hooks.data?.find(h=>h.url===previousUrl&&String(h.id)!==String(hook.id))
      if(orphan)await remote('webhooks/'+remoteId(orphan.id),{method:'DELETE'})
    }
    return {active:true}
  }catch(e){
    if(e.status&&e.status<500)checked(await db.from('scalency_settings').delete().eq('id','webhook').eq('value->>nonce',nonce))
    throw e
  }
}
export async function receiveScalency(req,db){
  const chunks=[];let size=0
  for await(const chunk of req){size+=Buffer.byteLength(chunk);if(size>262144)throw new ScalencyError('Événement trop grand.',413);chunks.push(Buffer.from(chunk))}
  const body=Buffer.concat(chunks)
  const row=checked(await db.from('scalency_settings').select('value').eq('id','webhook').maybeSingle())
  const signature=req.headers['x-scalency-signature']||'', stamp=Number(req.headers['x-scalency-timestamp'])
  if(!row?.value?.secret||!/^sha256=[a-f0-9]{64}$/.test(signature)||!stamp||Math.abs(Date.now()/1000-stamp)>300)throw new ScalencyError('Signature invalide.',401)
  const expected=createHmac('sha256',row.value.secret).update(body).digest()
  if(!timingSafeEqual(expected,Buffer.from(signature.slice(7),'hex')))throw new ScalencyError('Signature invalide.',401)
  const {saveRecords,syncPage}=await import('./scalency-workspace.js')
  const event=JSON.parse(body)
  if(Number(event.timestamp)!==stamp)throw new ScalencyError('Date invalide.',401)
  const data=event.data||{}
  if(event.type==='sale.created'&&data.sale?.order_id){
    const order=await remote('orders/'+remoteId(data.sale.order_id))
    await saveRecords(db,'orders',[order])
    const ids=[...new Set((order.items||[]).map(i=>i.vinted_id).filter(Boolean))]
    for(const id of ids){const item=await remote('items/'+remoteId(id),{query:{account_id:data.sale.account_id}});await saveRecords(db,'items',[item])}
  }else if(event.type.startsWith('job.')){
    const id=data.job?.id||data.job_id||data.id
    if(id)await saveRecords(db,'jobs',[await remote('jobs/'+remoteId(id))])
    else await syncPage(db,'jobs',{force:true})
  }else if(event.type==='message.new'){await syncPage(db,'conversations',{force:true})}
  return {received:true}
}
