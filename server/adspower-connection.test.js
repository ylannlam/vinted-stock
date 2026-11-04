import test from 'node:test'
import assert from 'node:assert/strict'
import {createAdsPowerRequest,isMobileDevice,readAdsPowerConnection} from '../src/lib/adspowerConnection.js'

const response=(status,data)=>({status,ok:status>=200&&status<300,json:async()=>data})
const options=extra=>({getSession:async()=>({user:{id:'one'}}),issueTicket:async()=>({ticket:'ticket',expires_at:100000}),device:()=>({userAgent:'Windows',onLine:true}),now:()=>1000,...extra})

test('phones and tablets are distinct from narrow or touch-enabled desktop windows',()=>{
  for(const device of [{userAgent:'iPhone'},{userAgent:'Android'},{userAgentData:{mobile:true}},{userAgent:'Macintosh',platform:'MacIntel',maxTouchPoints:5}])assert.equal(isMobileDevice(device),true)
  for(const device of [undefined,{userAgent:'Windows',maxTouchPoints:5},{userAgent:'Macintosh',platform:'MacIntel',maxTouchPoints:0}])assert.equal(isMobileDevice(device),false)
})

test('mobile and offline devices do not request a ticket or contact the loopback service',async()=>{
  let calls=0
  for(const [device,code] of [[{userAgent:'iPhone'},'mobile'],[{userAgent:'Windows',onLine:false},'offline']]){
    const request=createAdsPowerRequest(options({device:()=>device,getSession:async()=>{calls++},issueTicket:async()=>{calls++},fetcher:async()=>{calls++}}))
    await assert.rejects(request('/launch',{ids:['x']}),e=>e.code===code)
  }
  assert.equal(calls,0)
})

test('concurrent reads share authorization; only an explicit 401 renews it once',async()=>{
  let issued=0,fetches=0
  const request=createAdsPowerRequest(options({issueTicket:async()=>({ticket:`ticket-${++issued}`,expires_at:100000}),fetcher:async(url,init)=>{fetches++;return response(init.headers.Authorization==='Bearer ticket-1'?401:200,{configured:true})}}))
  const results=await Promise.all([request(),request()])
  assert.equal(issued,2);assert.equal(fetches,4);assert.ok(results.every(v=>v.configured))
  await request();assert.equal(issued,2)
})

test('an authorization rejection cannot create an unlimited retry loop',async()=>{
  let issued=0,calls=0
  const request=createAdsPowerRequest(options({issueTicket:async()=>({ticket:`ticket-${++issued}`,expires_at:100000}),fetcher:async()=>{calls++;return response(401,{error:'Autorisation refusée'})}}))
  await assert.rejects(request(),e=>e.code==='authorization')
  assert.equal(issued,2);assert.equal(calls,2)
})

test('temporary verification failures do not discard tickets or replay launches',async()=>{
  let issued=0,calls=0,unavailable=true
  const request=createAdsPowerRequest(options({issueTicket:async()=>({ticket:`ticket-${++issued}`,expires_at:100000}),fetcher:async()=>{calls++;return unavailable?response(503,{code:'verification_unavailable',error:'Site momentanément indisponible'}):response(200,{configured:true})}}))
  await assert.rejects(request('/launch',{ids:['x']}),e=>e.code==='site')
  assert.equal(issued,1);assert.equal(calls,1)
  unavailable=false;assert.equal((await request()).configured,true)
  assert.equal(issued,1);assert.equal(calls,2)
})

test('a timed-out launch is not silently replayed and is not reported as a closed connector',async()=>{
  let calls=0
  const request=createAdsPowerRequest(options({fetcher:async()=>{calls++;throw Object.assign(Error('timeout'),{name:'TimeoutError'})}}))
  await assert.rejects(request('/launch',{ids:['x'],requestId:'same-request'}),e=>e.code==='timeout'&&!e.message.includes('Connecteur fermé'))
  assert.equal(calls,1)
})

test('permission denials, network errors and site failures have distinct explanations',async()=>{
  const fetcher=async()=>{throw TypeError('Failed to fetch')}
  const denied=createAdsPowerRequest(options({fetcher,device:()=>({permissions:{query:async()=>({state:'denied'})}})}))
  await assert.rejects(denied(),/accès au réseau local est refusé/)
  await assert.rejects(createAdsPowerRequest(options({fetcher}))(),/Impossible de joindre/)
  await assert.rejects(createAdsPowerRequest(options({issueTicket:async()=>{throw Error('Site indisponible')}}))(),e=>e.code==='site'&&e.message==='Site indisponible')
})

test('switching accounts while authorization is pending never sends the previous account ticket',async()=>{
  let user='one',resolveFirst;const sent=[]
  const request=createAdsPowerRequest(options({getSession:async()=>({user:{id:user}}),issueTicket:()=>user==='one'?new Promise(resolve=>{resolveFirst=resolve}):Promise.resolve({ticket:'two',expires_at:100000}),fetcher:async(url,init)=>{sent.push(init.headers.Authorization);return response(200,{configured:true})}}))
  const first=request();const rejected=assert.rejects(first,e=>e.code==='session')
  await new Promise(resolve=>setImmediate(resolve));user='two';await request()
  resolveFirst({ticket:'one',expires_at:100000});await rejected
  assert.deepEqual(sent,['Bearer two'])
})

test('a failed profile read preserves the reachable connector; a later read recovers',async()=>{
  let fail=true;const state={configured:true,jobs:[]},observed=[]
  const request=async path=>{if(path==='/state')return state;if(fail)throw Error('AdsPower demande une pause');return {profiles:[{id:'one'}]}}
  const first=await readAdsPowerConnection(request,{loadProfiles:true,onState:value=>observed.push(value)})
  assert.equal(first.state,state);assert.match(first.profilesError.message,/pause/);assert.equal(first.profiles,undefined);assert.deepEqual(observed,[state])
  fail=false;assert.deepEqual((await readAdsPowerConnection(request,{loadProfiles:true})).profiles,[{id:'one'}])
  await assert.rejects(readAdsPowerConnection(async()=>{throw Error('Connection refused')}),/Connection refused/)
})

test('an unconfigured connector is reachable and does not try to read profiles',async()=>{
  const calls=[]
  assert.deepEqual(await readAdsPowerConnection(async path=>{calls.push(path);return {configured:false}},{loadProfiles:true}),{state:{configured:false}})
  assert.deepEqual(calls,['/state'])
})
