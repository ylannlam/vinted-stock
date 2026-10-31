import test from 'node:test'
import assert from 'node:assert/strict'
import vm from 'node:vm'
import {readFileSync} from 'node:fs'
import {trustedSender,publicState} from '../extensions/shein/protocol.js'
import {collectorBridge} from '../src/lib/collectorBridge.js'
import {latestCollections} from '../src/lib/collector.js'
import {missingProductFields} from '../src/lib/catalog.js'
import {expandProductSection} from '../extensions/shein/enrich.js'

test('only the exact site top frame or own popup can control the worker',()=>{
  const runtime={id:'ours',getURL:p=>`chrome-extension://ours/${p}`}
  const sender={id:'ours',frameId:0,url:'https://vinted-stock.vercel.app/',tab:{url:'https://vinted-stock.vercel.app/'}}
  assert.equal(trustedSender(sender,{fromSite:true,action:'start'},runtime),true)
  for(const patch of [{frameId:1},{id:'other'},{url:'https://fr.shein.com/'},{url:'https://vinted-stock.vercel.app.evil.test/'},{tab:{url:'https://evil.test'}}])assert.equal(trustedSender({...sender,...patch},{fromSite:true,action:'connect'},runtime),false)
  assert.equal(trustedSender(sender,{fromSite:true,action:'disconnect'},runtime),false)
  const state=publicState({enabled:true,job:{id:'job',lease:'SECRET',input:'SKU'},outbox:{secret:'SECRET'},tabId:7},'svpc_00000000-0000-4000-8000-000000000001.'+'a'.repeat(43),'0.4.0')
  assert.equal(state.connected,true);assert.equal(state.hasTab,true);assert.equal(state.version,'0.4.0')
  assert.equal(JSON.stringify(state).includes('SECRET'),false);assert.equal(JSON.stringify(state).includes('svpc_'),false)
})
test('site bridge accepts only matching origin, window and request ID, without arbitrary payload fields',async()=>{
  const handlers=new Set();let posted,removed=0
  const host={crypto:{randomUUID:()=> 'request'},location:{origin:'https://vinted-stock.vercel.app'},setTimeout,clearTimeout,
    addEventListener:(name,f)=>handlers.add(f),removeEventListener:(name,f)=>{removed++;handlers.delete(f)},postMessage:(m,origin)=>{posted={m,origin}}}
  const promise=collectorBridge('start',{url:'https://evil.test'},host)
  assert.equal(posted.m.url,undefined)
  const reply={channel:'stock-vinted-response',id:'request',ok:true,state:{enabled:true}}
  for(const handler of handlers){handler({source:host,origin:'https://evil.test',data:reply});handler({source:{},origin:host.location.origin,data:reply});handler({source:host,origin:host.location.origin,data:{...reply,id:'other'}})}
  assert.equal(removed,0)
  for(const handler of handlers)handler({source:host,origin:host.location.origin,data:reply})
  assert.deepEqual(await promise,{enabled:true});assert.equal(removed,1)
})
test('content bridge rejects foreign windows and disallowed commands and never passes URLs to worker',async()=>{
  let listener,received,response
  const window={addEventListener:(name,fn)=>{listener=fn},postMessage:(m,origin)=>{response={m,origin}}};window.top=window
  const context={window,location:{origin:'https://vinted-stock.vercel.app'},chrome:{runtime:{sendMessage:async m=>{received=m;return {ok:true,state:{connected:true}}}}}}
  vm.runInNewContext(readFileSync(new URL('../extensions/shein/site-bridge.js',import.meta.url),'utf8'),context)
  const event={source:window,origin:context.location.origin,data:{channel:'stock-vinted-request',id:'123',action:'open',url:'https://evil.test'}}
  await listener({...event,source:{}});assert.equal(received,undefined)
  await listener({...event,data:{...event.data,action:'anything'}});assert.equal(received,undefined)
  await listener(event);assert.equal(received.url,undefined);assert.equal(received.action,'open');assert.equal(response.m.id,'123')
})
test('latest attempt hides superseded failures, and missing information remains explicit',()=>{
  const jobs=[{id:'old',created_at:'2026-10-31T10:00:00Z',expected_sku:'sz123',input:'https://fr.shein.com/Dress-p-123.html',status:'failed'},
    {id:'new',created_at:'2026-10-31T11:00:00Z',input:'https://fr.shein.com/Dress-p-123.html',status:'completed'}]
  assert.deepEqual(latestCollections(jobs).map(j=>j.id),['new'])
  assert.deepEqual(missingProductFields({price:12,color:'Noir',photo_url:'photo',sizes:[{}]}),['description','détails'])
})
test('detail expansion never clicks a product with mismatched identity or a challenge',async()=>{
  const context={location:{pathname:'/risk/challenge'},document:{body:{innerText:''}}}
  assert.equal((await vm.runInNewContext(`(${expandProductSection.toString()})('description','123','sz123')`,context)).error,'human_check')
  context.location.pathname='/Dress-p-123.html';context.document.body.innerText='SKU: szWrong';context.document.querySelectorAll=()=>[]
  assert.equal((await vm.runInNewContext(`(${expandProductSection.toString()})('description','123','sz123')`,context)).error,'sku_mismatch')
})

test('description with extra trend text still opens only the matching product section',async()=>{
  let clicked=0,disconnected=0
  const button={innerText:'Description\n#Looks festifs\nJacquard',querySelector:()=>null,getClientRects:()=>[{}],getAttribute:k=>k==='aria-expanded'?'false':null,click:()=>{clicked++}}
  const context={location:{pathname:'/Dress-p-123.html'},document:{body:{innerText:'SKU: sz123'},querySelectorAll:()=>[button]},
    setTimeout:fn=>setTimeout(fn,0),clearTimeout,MutationObserver:class {observe(){} disconnect(){disconnected++}}}
  const result=await vm.runInNewContext(`(${expandProductSection.toString()})('description','123','sz123')`,context)
  assert.equal(result.opened,true);assert.equal(clicked,1);assert.equal(disconnected,1)
})
