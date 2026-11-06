import test from 'node:test'
import assert from 'node:assert/strict'
import { createHmac } from 'node:crypto'
import { verifyDotbWebhook,receiveOrderEvent,enableSalesAutomation,WEBHOOK_URL } from './sales-automation.js'
import webhook from '../api/dotb-webhook.js'

const eventId='11111111-1111-4111-8111-111111111111',orderId='22222222-2222-4222-8222-222222222222',itemId='33333333-3333-4333-8333-333333333333'
const secret=`whsec_${Buffer.from('test-only-key-with-32-characters!').toString('base64')}`
const event={id:eventId,type:'order.created',api_version:'v1',created_at:'2026-11-01T10:00:00Z',data:{order_id:orderId}}
const raw=Buffer.from(JSON.stringify(event)),now=Date.parse(event.created_at),timestamp=String(now/1000)
const signature=createHmac('sha256',Buffer.from(secret.slice(6),'base64')).update(`delivery-1.${timestamp}.`).update(raw).digest('base64')
const headers={'webhook-id':'delivery-1','webhook-timestamp':timestamp,'webhook-signature':`v1,${signature}`}

test('only a fresh signature over the exact raw body authorizes a sale event',()=>{
  assert.equal(verifyDotbWebhook(raw,headers,secret,now).order_id,orderId)
  for(const [body,h,time] of [[Buffer.from(raw+' '),headers,now],[raw,{...headers,'webhook-id':'other'},now],[raw,headers,now+301000],[raw,{...headers,'webhook-signature':'v1,abc'},now]]){
    assert.throws(()=>verifyDotbWebhook(body,h,secret,time),{status:401})
  }
  assert.equal(verifyDotbWebhook(raw,{...headers,'webhook-signature':`v1,bad v1,${signature}`},secret,now).id,eventId)
})

function eventDb({duplicate=false,dbError=null}={}){
  const calls=[]
  return {calls,from(){const q={select(){return q},eq(){return q},async maybeSingle(){return {data:duplicate?{id:eventId}:null}}};return q},async rpc(name,args){calls.push({name,args});return {data:true,error:dbError}}}
}
test('a notification fetches current Dotb state and commits sale and supplier retrieval together, without buyer details',async()=>{
  const db=eventDb();let url
  const fetcher=async(u)=>{url=u;return {ok:true,json:async()=>({id:orderId,order_date:event.created_at,normalized_status:'label_sent',account:{id:'test',login:'démo'},currency:'EUR',shipping_address:{name:'must not be stored'},items:[{id:itemId,sku:'szTEST',title:'Robe',supplier_link:'https://fr.shein.com/Robe-p-123.html?tracking=1'}]})}}
  assert.deepEqual(await receiveOrderEvent(db,{...event,order_id:orderId},{fetcher,token:'test'}),{received:true,duplicate:false})
  assert.match(url,/orders\/22222222.*include=items,account$/)
  assert.equal(db.calls[0].name,'receive_dotb_order_event')
  assert.equal(db.calls[0].args.p_lines[0].source.shein_url,'https://fr.shein.com/Robe-p-123.html')
  assert.ok(!JSON.stringify(db.calls).includes('must not be stored'))
})
test('duplicates do not reimport; upstream or database errors stay retryable',async()=>{
  const duplicate=eventDb({duplicate:true})
  await receiveOrderEvent(duplicate,event,{fetcher:()=>{throw Error('must not fetch')}})
  assert.equal(duplicate.calls.length,0)
  const failing=eventDb()
  await assert.rejects(()=>receiveOrderEvent(failing,{...event,order_id:orderId},{token:'test',fetcher:async()=>({ok:false,status:429})}),{status:429})
  assert.equal(failing.calls.length,0)
  await assert.rejects(()=>receiveOrderEvent(eventDb({dbError:Error('database down')}),{...event,order_id:null}),/database down/)
})
test('test notifications acknowledge without fetching or fabricating a sale',async()=>{
  const db=eventDb()
  await receiveOrderEvent(db,{id:eventId,type:'webhook.test',created_at:event.created_at,order_id:null})
  assert.deepEqual(db.calls[0].args.p_orders,[])
})
test('public webhook endpoint rejects unsigned calls before database access',async()=>{
  const res={code:200,setHeader(){},status(n){this.code=n;return this},json(body){this.body=body;return this},end(){}}
  await webhook({method:'POST',headers:{}},res)
  assert.equal(res.code,401)
})
test('setup saves signing material only on the server and subscribes to orders and account alerts',async()=>{
  const patches=[],requests=[]
  const db={from(){let patch;const q={update(p){patch=p;patches.push(p);return q},eq(){return q},lt(){return q},select(){return q},async maybeSingle(){return {data:{}}},async single(){return {data:{id:true}}},then(resolve){return Promise.resolve({error:null}).then(resolve)}};return q}}
  const fetcher=async(url,options)=>{requests.push({url,options});return {ok:true,json:async()=>options.method==='POST'?{id:orderId,secret}:{data:[]}}}
  assert.deepEqual(await enableSalesAutomation(db,{fetcher,token:'test'}),{enabled:true})
  assert.equal(JSON.parse(requests[1].options.body).url,WEBHOOK_URL)
  assert.deepEqual(JSON.parse(requests[1].options.body).event_types,['order.created','order.status_changed','order.claim_opened','notification.created'])
  assert.equal(patches.find(p=>p.enabled)?.signing_secret,secret);assert.equal(patches.find(p=>p.enabled)?.events_version,2)
})
test('a key that cannot read notifications keeps the order events only',async()=>{
  const patches=[],requests=[]
  const db={from(){let patch;const q={update(p){patch=p;patches.push(p);return q},eq(){return q},lt(){return q},select(){return q},async maybeSingle(){return {data:{}}},async single(){return {data:{id:true}}},then(resolve){return Promise.resolve({error:null}).then(resolve)}};return q}}
  const fetcher=async(url,options)=>{requests.push({url,options});if(options.method==='POST'&&JSON.parse(options.body).event_types.includes('notification.created'))return {ok:false,status:422};return {ok:true,json:async()=>options.method==='POST'?{id:orderId,secret}:{data:[]}}}
  assert.deepEqual(await enableSalesAutomation(db,{fetcher,token:'test'}),{enabled:true})
  assert.deepEqual(JSON.parse(requests.at(-1).options.body).event_types,['order.created','order.status_changed','order.claim_opened'])
  assert.equal(patches.find(p=>p.enabled)?.events_version,1)
})
test('a signed account alert is accepted by the webhook and passed on as is',()=>{
  const event={id:orderId,type:'notification.created',api_version:'v1',created_at:new Date().toISOString(),data:{id:orderId,group:'vinted',title:'Votre compte est restreint'}}
  const raw=Buffer.from(JSON.stringify(event)),stamp=String(Math.floor(Date.now()/1000))
  const signature='v1,'+createHmac('sha256',Buffer.from(secret.slice(6),'base64')).update(`${orderId}.${stamp}.`).update(raw).digest('base64')
  const parsed=verifyDotbWebhook(raw,{'webhook-id':orderId,'webhook-timestamp':stamp,'webhook-signature':signature},secret)
  assert.equal(parsed.type,'notification.created');assert.equal(parsed.notification.title,'Votre compte est restreint')
})
