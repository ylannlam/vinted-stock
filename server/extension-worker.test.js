import test from 'node:test'
import assert from 'node:assert/strict'

test('Chrome adapter connects, wakes on tab completion, sends a result, rejects foreign messages and forgets stale tab ownership',async()=>{
  const originalChrome=globalThis.chrome,originalFetch=globalThis.fetch
  const events={},local={},session={},requests=[];let tab=null,access,alarm,badge
  const area=data=>({get:async key=>key?{[key]:data[key]}:{...data},set:async patch=>Object.assign(data,structuredClone(patch)),remove:async key=>{delete data[key]}})
  const job={id:'job',lease:'lease',expected_sku:'sz25052272411726746',expected_supplier_id:'90176146',input:'https://fr.shein.com/Dress-p-90176146.html'}
  const sender={id:'test-extension',url:'chrome-extension://test-extension/popup.html'}
  globalThis.chrome={storage:{local:{...area(local),setAccessLevel:async v=>{access=v.accessLevel}},session:area(session)},
    alarms:{get:async()=>null,create:async(name,options)=>{alarm={name,...options}},onAlarm:{addListener:f=>{events.alarm=f}}},
    action:{setBadgeText:async v=>{badge=v.text},setBadgeBackgroundColor:async()=>{}},
    runtime:{id:sender.id,getURL:p=>`chrome-extension://test-extension/${p}`,onMessage:{addListener:f=>{events.message=f}},onStartup:{addListener:f=>{events.startup=f}}},
    tabs:{create:async options=>(tab={id:7,windowId:1,status:'complete',...options}),get:async id=>{assert.equal(id,tab.id);return tab},update:async(id,patch)=>{assert.equal(id,tab.id);Object.assign(tab,patch);return tab},onUpdated:{addListener:f=>{events.updated=f}}},
    windows:{update:async()=>{}},scripting:{executeScript:async({target,func})=>{assert.equal(target.tabId,7);assert.equal(func.name,'readSheinPage');return [{result:{supplier_url:job.input,supplier_sku:job.expected_sku,title:'Robe',price:'32.64',price_text:'32,64€',currency:'EUR',color:'Nude',photos:['https://img.ltwebstatic.com/p.webp'],observed_at:new Date().toISOString()}}]}}}
  globalThis.fetch=async(target,options)=>{
    assert.equal(target,'https://vinted-stock.vercel.app/api/collector')
    const body=JSON.parse(options.body);requests.push(body)
    return {ok:true,json:async()=>body.action==='claim'?{job}:body.action==='heartbeat'?{enabled:true}:{saved:true}}
  }
  try {
    await import('../extensions/shein/worker.js?adapter-test')
    const send=message=>new Promise(resolve=>assert.equal(events.message(message,sender,resolve),true))
    assert.equal(events.message({action:'start'},{id:sender.id,url:'https://fr.shein.com/'},()=>assert.fail()),false)
    assert.equal(events.message({action:'start'},{...sender,id:'other-extension'},()=>assert.fail()),false)
    const token='svpc_00000000-0000-4000-8000-000000000001.'+'a'.repeat(43)
    const connected=await send({action:'connect',token});assert.equal(connected.ok,true);assert.equal(connected.state.connected,true)
    assert.equal(JSON.stringify(connected).includes(token),false);assert.equal(access,'TRUSTED_CONTEXTS');assert.equal(alarm.periodInMinutes,0.5)
    await send({action:'start'});assert.equal(tab.url,job.input);assert.equal(session.ownedTabId,7);assert.equal(badge,'ON')
    events.updated(7,{status:'complete'});const result=await send({action:'status'})
    assert.equal(result.state.completed,1);assert.equal(requests.at(-1).action,'complete')
    // A browser restart clears storage.session. Do not reuse the restored tab ID.
    delete session.ownedTabId;events.startup();const restarted=await send({action:'status'})
    assert.equal(restarted.state.enabled,false);assert.equal(restarted.state.tabId,null)
    await send({action:'disconnect'});assert.equal(local.token,undefined);assert.equal(badge,'')
  } finally {globalThis.chrome=originalChrome;globalThis.fetch=originalFetch}
})
