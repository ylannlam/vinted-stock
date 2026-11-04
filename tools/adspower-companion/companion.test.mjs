import test from 'node:test'
import assert from 'node:assert/strict'
import {request as httpRequest} from 'node:http'
import {createCompanion,SITE} from './companion.mjs'
import {AdsPowerClient,debugAddress,LocalError} from './adspower.mjs'
import {LaunchQueue} from './queue.mjs'
import {controlState,isVinted} from './dotb.mjs'
import {readConfig,saveConfig} from './storage.mjs'
import {mkdtemp,readFile,rm} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import path from 'node:path'

test('the HTTP service preserves temporary verification errors without executing a launch',async t=>{
  let verified=0,started=0,unavailable=true
  const {server}=await createCompanion({load:async()=>null,runner:async()=>{started++},verify:async()=>{verified++;if(unavailable)throw new LocalError('Site indisponible',503,'verification_unavailable');return {user_id:'admin',expires_at:Date.now()+90000}}})
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));t.after(()=>server.close())
  const base=`http://127.0.0.1:${server.address().port}`,headers={Origin:SITE,Authorization:'Bearer test-admin','Content-Type':'application/json'}
  const failure=await fetch(base+'/launch',{method:'POST',headers,body:'{}'})
  assert.equal(failure.status,503);assert.equal((await failure.json()).code,'verification_unavailable');assert.equal(started,0)
  unavailable=false
  const states=await Promise.all([fetch(base+'/state',{headers}),fetch(base+'/state',{headers})])
  assert.ok(states.every(response=>response.status===200));assert.equal(verified,2);assert.equal(started,0)
  assert.equal((await states[0].json()).version,'1.0.5')
})

test('local connection survives encrypted Windows storage without plaintext on disk',async()=>{
  const dir=await mkdtemp(path.join(tmpdir(),'stock-vinted-storage-')),key='dummy-secret-for-storage-test'
  try{await saveConfig(dir,{apiKey:key,port:50325});assert.deepEqual(await readConfig(dir),{apiKey:key,port:50325});if(process.platform==='win32')assert.equal((await readFile(path.join(dir,'connection.json'),'utf8')).includes(key),false)}
  finally{const relative=path.relative(path.resolve(tmpdir()),path.resolve(dir));if(relative.startsWith('stock-vinted-storage-')&&!relative.includes(path.sep))await rm(dir,{recursive:true,force:true})}
})

test('a partly configured profile retains confirmed starts and reports attention',async()=>{
  const queue=new LaunchQueue({run:async(profile,update)=>{update({features:['agent','bridge']});throw new LocalError('2/4 démarrés. Configuration requise')}})
  queue.launch({ids:['a'],requestId:'00000000-0000-4000-8000-000000000002'},[{id:'a'}])
  await new Promise(resolve=>setImmediate(resolve))
  assert.equal(queue.jobs[0].state,'attention');assert.deepEqual(queue.jobs[0].features,['agent','bridge']);assert.equal(queue.running,0)
})

test('profile reads retain only display fields and reject repeated pages',async()=>{
  const api=new AdsPowerClient({apiKey:'secret',interval:0,wait:async()=>{},fetcher:async()=>({ok:true,json:async()=>({code:0,data:{list:[{user_id:'abc',serial_number:'3',name:'A',group_name:'G',password:'NEVER',ip:'NEVER'}]}})})})
  assert.deepEqual(await api.profiles(),[{id:'abc',number:'3',name:'A',group:'G'}])
  const p={user_id:'abc'};api.fetcher=async()=>({ok:true,json:async()=>({code:0,data:{list:[p,p]}})})
  await assert.rejects(api.profiles(),/incomplète/)
})
test('only AdsPower loopback debugging addresses can be opened',()=>{
  assert.equal(debugAddress('ws://127.0.0.1:1234/devtools/browser/a-b'),'ws://127.0.0.1:1234/devtools/browser/a-b')
  for(const url of ['ws://evil.test:1234/devtools/browser/a','http://localhost:1234/devtools/browser/a','ws://localhost:1234/?x=1','ws://u:p@localhost:1234/devtools/browser/a'])assert.throws(()=>debugAddress(url))
  assert.equal(isVinted('https://www.vinted.fr/'),true);assert.equal(isVinted('https://vinted.fr.evil.test/'),false)
})
test('an already open profile is reused and raw server errors never leak the key',async()=>{
  const calls=[],api=new AdsPowerClient({apiKey:'sensitive',interval:0,wait:async()=>{},fetcher:async(url)=>{calls.push(url);return {ok:true,json:async()=>({code:0,data:{status:'Active',ws:{puppeteer:'ws://127.0.0.1:1234/devtools/browser/a'}}})}}})
  assert.equal((await api.start('abc')).alreadyOpen,true);assert.equal(calls.length,1)
  api.fetcher=async()=>({ok:true,json:async()=>({code:-1,msg:'bad token sensitive'})})
  await assert.rejects(api.profiles(),e=>!e.message.includes('sensitive')&&e.status===401)
})
test('pause/resume and active controls are distinguished, unknown layouts never count as running',()=>{
  assert.equal(controlState(['Start']),'ready');assert.equal(controlState(['Resume','Stop']),'ready')
  assert.equal(controlState(['Pause','Stop']),'running');assert.equal(controlState(['Stop']),'running')
  assert.equal(controlState(['Start','Start']),'unknown');assert.equal(controlState(['Settings']),'unknown')
})
test('queue deduplicates clicks, limits concurrent launches, and cancellation leaves started profiles alone',async()=>{
  const pending=[],queue=new LaunchQueue({limit:2,run:()=>new Promise(resolve=>pending.push(resolve))})
  const profiles=['a','b','c'].map(id=>({id})),requestId='00000000-0000-4000-8000-000000000001'
  const first=queue.launch({ids:['a','b','c','a'],requestId},profiles)
  assert.deepEqual(queue.launch({ids:['a'],requestId},profiles),first)
  await new Promise(resolve=>setImmediate(resolve));assert.equal(pending.length,2);assert.equal(queue.running,2)
  queue.cancel();assert.equal(queue.jobs[2].state,'cancelled');assert.equal(queue.jobs[0].state,'opening')
  pending.forEach(resolve=>resolve({features:['likes','agent']}));await new Promise(resolve=>setImmediate(resolve))
  assert.equal(queue.running,0);assert.equal(queue.jobs[0].state,'started')
})
test('local service checks host, origin, admin ticket, JSON, and setup CSRF before any launch',async t=>{
  let saved=0,started=0
  const client={call:async()=>({list:[]}),profiles:async()=>[{id:'a',name:'A'}],opened:async()=>new Set(),openConnections:async()=>new Map()}
  const {server}=await createCompanion({monitorOptions:{interval:0},dataDir:'unused',load:async()=>({apiKey:'sensitive',port:50325}),save:async()=>{saved++},verify:async ticket=>{if(ticket!=='test-admin')throw new LocalError('Denied',401);return {user_id:'admin',expires_at:Date.now()+90000}},clientFactory:()=>client,runner:async()=>{started++;return {features:['likes','agent']}}})
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));t.after(()=>server.close())
  const base=`http://127.0.0.1:${server.address().port}`,headers={Origin:SITE,Authorization:'Bearer test-admin','Content-Type':'application/json'}
  assert.equal((await fetch(base+'/profiles',{headers:{Origin:'https://evil.test'}})).status,403)
  assert.equal((await fetch(base+'/profiles',{headers:{Origin:SITE}})).status,401)
  const forgedHost=await new Promise(resolve=>{const request=httpRequest(base+'/state',{headers:{...headers,Host:'evil.test'}},response=>{response.resume();resolve(response.statusCode)});request.end()});assert.equal(forgedHost,403)
  const state=await (await fetch(base+'/state',{headers})).text();assert.equal(state.includes('sensitive'),false)
  const preflight=await fetch(base+'/launch',{method:'OPTIONS',headers:{Origin:SITE}});assert.equal(preflight.status,204);assert.equal(preflight.headers.get('Access-Control-Allow-Origin'),SITE)
  assert.equal((await fetch(base+'/setup',{method:'POST',headers:{Origin:base,'Content-Type':'application/x-www-form-urlencoded'},body:'apiKey=secret123&port=50325&csrf=wrong'})).status,403)
  assert.equal(saved,0);assert.equal(started,0)
  const setup=await(await fetch(base+'/setup')).text(),csrf=setup.match(/name="csrf" value="([\w-]+)"/)[1]
  const set=await fetch(base+'/setup',{method:'POST',redirect:'manual',headers:{Origin:base,'Content-Type':'application/x-www-form-urlencoded'},body:new URLSearchParams({apiKey:'secret123',port:'50325',csrf})});assert.equal(set.status,303);assert.equal(saved,1);assert.equal(started,0)
  const launch=await fetch(base+'/launch',{method:'POST',headers,body:JSON.stringify({ids:['a'],requestId:'00000000-0000-4000-8000-000000000001'})});assert.equal(launch.status,202)
  await new Promise(resolve=>setImmediate(resolve));assert.equal(started,1)
  // A later state read reports the actual closed browser, not the old success.
  await fetch(base+'/state',{headers})
  await new Promise(resolve=>setImmediate(resolve))
  const live=await(await fetch(base+'/state',{headers})).json()
  assert.equal(live.monitoring,true)
  assert.equal(live.runtime.find(r=>r.profile_id==='a')?.status,'closed')
  assert.equal(started,1,'Polling must never relaunch a closed profile')
})
