import test from 'node:test'
import assert from 'node:assert/strict'
import {GPUS,RESOLUTIONS,pickHardware,chromeMajor,fingerprintConfig,readProxy,createProfile,replaceFingerprint,profileProxies} from './factory.mjs'
import {createCompanion,SITE,VERSION} from './companion.mjs'
import {AdsPowerClient,LocalError} from './adspower.mjs'

const UA='Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.7390.55 Safari/537.36'
const proxy={host:'disp.oxylabs.io',port:8001,user:'user-disp_38bc6771',password:'p@ss:word=1'}
const sequence=values=>{let i=0;return ()=>values[i++%values.length]}
// Records every AdsPower call; `answers` maps an API path to its data (or a function of the body).
function fakeAds(answers={}){
  const calls=[]
  return {calls,call:async(path,body)=>{calls.push({path,body});const key=Object.keys(answers).find(k=>path.startsWith(k));const value=key?answers[key]:{};return typeof value==='function'?value(body,path):structuredClone(value)}}
}

test('hardware stays NVIDIA, common resolutions and supported thread counts, high-end cards lean 1440p',()=>{
  const seen={resolution:new Set(),threads:new Set(),gpu:new Set()},high=GPUS.filter(g=>g.high).map(g=>g.name)
  let highTotal=0,high1440=0
  for(let i=0;i<4000;i++){
    const h=pickHardware()
    seen.resolution.add(h.resolution);seen.threads.add(h.threads);seen.gpu.add(h.gpu)
    assert.ok(h.gpu.startsWith('NVIDIA GeForce RTX'));assert.equal(GPUS.find(g=>g.name===h.gpu).id,h.gpuId)
    if(high.includes(h.gpu)){highTotal++;if(h.resolution==='2560_1440')high1440++}
  }
  assert.deepEqual([...seen.resolution].sort(),RESOLUTIONS);assert.deepEqual([...seen.threads].sort((a,b)=>a-b),[8,16])
  assert.equal(seen.gpu.size,GPUS.length);assert.ok(high1440/highTotal>0.5)
  assert.deepEqual(pickHardware(sequence([0])),{gpu:GPUS[0].name,gpuId:GPUS[0].id,resolution:'1920_1080',threads:16})
})

test('creation lets AdsPower draw a Windows 11 UA; replacement keeps the profile Chrome version',()=>{
  const h={gpu:'NVIDIA GeForce RTX 4060',gpuId:'0x00002882',resolution:'2560_1440',threads:16}
  const created=fingerprintConfig(h)
  assert.deepEqual(created.random_ua,{ua_browser:['chrome'],ua_system_version:['Windows 11']});assert.equal(created.ua,undefined)
  assert.equal(created.webrtc,'forward');assert.equal(created.automatic_timezone,'1');assert.equal(created.screen_resolution,'2560_1440')
  assert.equal(created.hardware_concurrency,'16');assert.equal(created.device_memory,'8');assert.equal(created.webgl,'2')
  assert.equal(created.webgl_config.unmasked_renderer,'ANGLE (NVIDIA, NVIDIA GeForce RTX 4060 (0x00002882) Direct3D11 vs_5_0 ps_5_0, D3D11)')
  const replaced=fingerprintConfig(h,{chrome:141})
  assert.equal(replaced.random_ua,undefined);assert.match(replaced.ua,/^Mozilla\/5\.0 \(Windows NT 10\.0; Win64; x64\) .* Chrome\/141\.0\.0\.0 Safari\/537\.36$/)
  assert.deepEqual(replaced.browser_kernel_config,{version:'ua_auto',type:'chrome'})
  assert.equal(chromeMajor(UA),141);assert.equal(chromeMajor('Mozilla/5.0 (Windows NT 10.0; rv:128.0) Gecko/20100101 Firefox/128.0'),null)
  for(const bad of [null,'',42,'Chrome/12.0.0','Mozilla/5.0 Chrome/x.0'])assert.equal(chromeMajor(bad),null)
})

test('proxies are validated, normalised and never point at this PC or the local network',()=>{
  assert.deepEqual(readProxy({...proxy,host:' DISP.Oxylabs.IO '}),proxy)
  assert.deepEqual(readProxy({host:'isp.decodo.com',port:'10003',user:'spuser',password:'x'}),{host:'isp.decodo.com',port:10003,user:'spuser',password:'x'})
  for(const bad of [{...proxy,host:'localhost'},{...proxy,host:'127.0.0.1'},{...proxy,host:'192.168.1.4'},{...proxy,host:'printer.local'},{...proxy,host:'bad_host'},{...proxy,port:0},{...proxy,port:70000},{...proxy,port:'80a'},{...proxy,user:''},{...proxy,password:'a\nb'},{...proxy,password:undefined},null])
    assert.throws(()=>readProxy(bad),LocalError)
})

test('creation reuses or creates the group, sends the proxy once and returns no secret',async()=>{
  const ads=fakeAds({'/api/v1/group/list':{list:[{group_id:7,group_name:'Autre'}]},'/api/v1/group/create':{group_id:'12'},'/api/v2/browser-profile/create':{profile_id:'k1abc',profile_no:'41'},'/api/v2/browser-profile/ua':{list:[{profile_id:'k1abc',ua:UA}]}})
  const result=await createProfile(ads,{name:'  dressing_lea ',group:'Stock Vinted',proxy},{random:sequence([0])})
  assert.deepEqual(result,{profile_id:'k1abc',profile_no:'41',name:'dressing_lea',group:'Stock Vinted',resolution:'1920_1080',threads:16,gpu:'NVIDIA GeForce RTX 4060 Ti',chrome:141})
  assert.equal(JSON.stringify(result).includes(proxy.password),false)
  const create=ads.calls.find(c=>c.path==='/api/v2/browser-profile/create').body
  assert.equal(create.group_id,'12');assert.equal(create.name,'dressing_lea')
  assert.deepEqual(create.user_proxy_config,{proxy_soft:'other',proxy_type:'http',proxy_host:'disp.oxylabs.io',proxy_port:'8001',proxy_user:'user-disp_38bc6771',proxy_password:proxy.password})
  assert.equal(ads.calls.filter(c=>c.path==='/api/v2/browser-profile/create').length,1)
  // An existing group is reused, a missing profile number is looked up, an unreadable UA is not fatal.
  const again=fakeAds({'/api/v1/group/list':{list:[{group_id:'9',group_name:'Stock Vinted'}]},'/api/v2/browser-profile/create':{profile_id:'k2abc'},'/api/v2/browser-profile/list':{list:[{profile_id:'k2abc',profile_no:'42'}]},'/api/v2/browser-profile/ua':{}})
  const second=await createProfile(again,{name:'b',proxy})
  assert.equal(second.profile_no,'42');assert.equal(second.chrome,null);assert.equal(second.group,'Stock Vinted')
  assert.equal(again.calls.some(c=>c.path==='/api/v1/group/create'),false);assert.equal(again.calls.find(c=>c.path==='/api/v2/browser-profile/create').body.group_id,'9')
  await assert.rejects(createProfile(fakeAds({'/api/v1/group/list':{list:[]},'/api/v1/group/create':{group_id:'1'},'/api/v2/browser-profile/create':{}}),{name:'c',proxy}),/n’a pas confirmé/)
  await assert.rejects(createProfile(fakeAds(),{name:'\u0007',proxy}),/Nom du profil invalide/)
})

test('an AdsPower refusal is explained without the proxy password or the API key',async()=>{
  let msg=`Proxy check failed for ${proxy.user}:${proxy.password}@disp.oxylabs.io`
  const api=new AdsPowerClient({apiKey:'key-123456',interval:0,wait:async()=>{},fetcher:async url=>({ok:true,json:async()=>url.includes('group/list')?{code:0,data:{list:[{group_id:'1',group_name:'Stock Vinted'}]}}:{code:-1,msg}})})
  await assert.rejects(createProfile(api,{name:'a',proxy}),e=>e.status===502&&e.message.startsWith('AdsPower a refusé la création du profil : Proxy check failed')&&!e.message.includes(proxy.password))
  msg='invalid key-123456 value'
  await assert.rejects(replaceFingerprint(api,'k1abc'),e=>!e.message.includes('key-123456'))
})

test('fingerprint replacement sends only the fingerprint and refuses unreadable Chrome versions',async()=>{
  const ads=fakeAds({'/api/v2/browser-profile/ua':{list:[{profile_id:'k1abc',ua:UA}]}})
  const result=await replaceFingerprint(ads,'k1abc',{random:sequence([0.99])})
  assert.deepEqual(result,{profile_id:'k1abc',resolution:'1920_1080',threads:8,gpu:'NVIDIA GeForce RTX 3070',chrome:141})
  const update=ads.calls.find(c=>c.path==='/api/v2/browser-profile/update').body
  assert.deepEqual(Object.keys(update).sort(),['fingerprint_config','profile_id'],'proxy, cookies and session must not be sent')
  assert.match(update.fingerprint_config.ua,/Chrome\/141\.0\.0\.0/)
  await assert.rejects(replaceFingerprint(fakeAds({'/api/v2/browser-profile/ua':{list:[{profile_id:'k1abc',ua:'Mozilla/5.0 Firefox/128.0'}]}}),'k1abc'),e=>e.status===409)
  await assert.rejects(replaceFingerprint(fakeAds(),'../etc'),/Profil invalide/)
})

test('profile proxies are listed without passwords and broken pages are rejected',async()=>{
  const page=Array.from({length:100},(_,i)=>({profile_id:`p${i}`,profile_no:String(i),user_proxy_config:{proxy_host:'ISP.decodo.com',proxy_port:String(10001+i),proxy_user:'spuser',proxy_password:'NEVER'}}))
  const ads=fakeAds({'/api/v2/browser-profile/list':body=>({list:body.page===1?page:[{profile_id:'last',profile_no:'200',user_proxy_config:{proxy_soft:'no_proxy'}}]})})
  const rows=await profileProxies(ads)
  assert.equal(rows.length,101);assert.deepEqual(rows[0],{id:'p0',number:'0',proxy:{host:'isp.decodo.com',port:10001,user:'spuser'}});assert.equal(rows[100].proxy,null)
  assert.equal(JSON.stringify(rows).includes('NEVER'),false)
  await assert.rejects(profileProxies(fakeAds({'/api/v2/browser-profile/list':{list:[{profile_id:'a'},{profile_id:'a'}]}})),/incomplète/)
})

test('HTTP: creation is idempotent per request, fingerprints wait for closed and idle profiles',async t=>{
  let created=0,open=new Set(['busy'])
  const client={
    profiles:async()=>[{id:'k1abc',number:'41',name:'A',group:'G'},{id:'busy',number:'2',name:'B',group:'G'}],
    opened:async()=>open,openConnections:async()=>new Map([...open].map(id=>[id,null])),
    call:async(path,body)=>{
      if(path.startsWith('/api/v1/group/list'))return {list:[{group_id:'1',group_name:'Stock Vinted'}]}
      if(path==='/api/v2/browser-profile/create'){created++;return {profile_id:`new${created}`,profile_no:String(40+created)}}
      if(path==='/api/v2/browser-profile/ua')return {list:[{profile_id:body.profile_id[0],ua:UA}]}
      if(path==='/api/v2/browser-profile/update')return {}
      if(path==='/api/v2/browser-profile/list')return {list:[{profile_id:'k1abc',profile_no:'41',user_proxy_config:{proxy_host:'disp.oxylabs.io',proxy_port:'8001',proxy_user:'user-disp_x',proxy_password:'NEVER'}}]}
      return {}
    }}
  const {server}=await createCompanion({monitorOptions:{interval:0},load:async()=>({apiKey:'k',port:50325}),verify:async ticket=>{if(ticket!=='test-admin')throw new LocalError('Denied',401);return {user_id:'admin',expires_at:Date.now()+90000}},clientFactory:()=>client,runner:async()=>({features:[]})})
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));t.after(()=>server.close())
  const base=`http://127.0.0.1:${server.address().port}`,headers={Origin:SITE,Authorization:'Bearer test-admin','Content-Type':'application/json'}
  const post=(path,body,extra=headers)=>fetch(base+path,{method:'POST',headers:extra,body:JSON.stringify(body)})
  const state=await(await fetch(base+'/state',{headers})).json();assert.equal(state.version,VERSION);assert.equal(state.factory,true)
  assert.equal((await post('/profiles/create',{requestId:crypto.randomUUID(),name:'x',proxy},{...headers,Origin:'https://evil.test'})).status,403)
  assert.equal((await post('/profiles/create',{requestId:crypto.randomUUID(),name:'x',proxy},{...headers,Authorization:'Bearer nope'})).status,401)
  assert.equal(created,0)
  const requestId=crypto.randomUUID(),first=await post('/profiles/create',{requestId,name:'dressing',proxy})
  assert.equal(first.status,201);const body=await first.json();assert.equal(body.profile.profile_no,'41');assert.equal(JSON.stringify(body).includes(proxy.password),false)
  assert.equal((await(await post('/profiles/create',{requestId,name:'dressing',proxy})).json()).profile.profile_id,'new1');assert.equal(created,1,'a replayed request must not create a second profile')
  assert.equal((await post('/profiles/create',{requestId,name:'different',proxy})).status,409,'request ids cannot be reused for another payload')
  assert.equal((await post('/profiles/create',{requestId:crypto.randomUUID(),name:'already-used',proxy:{...proxy,user:'user-disp_x'}})).status,409,'an existing AdsPower proxy cannot be assigned again')
  assert.equal(created,1)
  assert.equal((await post('/profiles/create',{requestId:'not-a-uuid',name:'dressing',proxy})).status,400)
  const busy=await post('/profiles/fingerprint',{requestId:crypto.randomUUID(),id:'busy'});assert.equal(busy.status,409);assert.match((await busy.json()).error,/Ferme ce profil/)
  assert.equal((await post('/profiles/fingerprint',{requestId:crypto.randomUUID(),id:'gone'})).status,409)
  const done=await post('/profiles/fingerprint',{requestId:crypto.randomUUID(),id:'k1abc'});assert.equal(done.status,200);assert.equal((await done.json()).profile.chrome,141)
  const listed=await(await fetch(base+'/profiles/proxies',{headers})).text();assert.equal(listed.includes('NEVER'),false);assert.match(listed,/user-disp_x/)
})
