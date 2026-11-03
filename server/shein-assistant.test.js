import test from 'node:test'
import assert from 'node:assert/strict'
import {associationReasons,sheinAlerts} from '../src/lib/sheinAssistant.js'
import {buildDailyPurchases} from '../src/lib/dailyPurchases.js'
import {createOrderEngine,orderState,orderReference} from '../extensions/shein/orders-engine.js'
import {syncReport} from './shein-assistant.js'
const items=[{id:'a',quantity:2,unit_price:10,status:'processing',present:true},{id:'b',quantity:1,unit_price:5,status:'shipped',present:true}]
test('a prior purchase, incompatible variant and competing orders have explicit explanations',()=>{
  const item={...items[0],sku:'SKU',size:'M',color:'Noir',links:[]}
  assert.deepEqual(associationReasons(item,{size:'S',color:'Bleu',sale_date:'2026-11-03T23:30:00Z'},{ref:'GTEST000001',order_date:'2026-11-03'}),['Taille différente','Couleur différente','Achat antérieur à la vente'])
})
test('old sales and stale prices are explicit; alerts combine due dates, price increase and interrupted sync',()=>{
  const now=Date.parse('2026-11-03T12:00:00Z'),context={day:'2026-11-03',include_earlier:true,lines:[{id:'a',sale_date:'2026-11-01T12:00:00Z',deadline_at:'2026-11-03T22:00:00Z',resolved_sku:'SKU',supplier_size:'M',stage:'to_order',source:{title:'Body'}}],catalog:[{sku:'SKU',supplier_url:'https://fr.shein.com/Body-p-123.html',color:'Noir',sizes:[{size:'M',availability:'available'}],price:12,previous_price:10,currency:'EUR',observed_at:'2026-11-02T12:00:00Z'}]}
  const cart=buildDailyPurchases(context,now)
  assert.equal(cart.groups[0].state,'stale');assert.equal(cart.counts.ready,0);assert.equal(cart.groups[0].urgent,true)
  assert.equal(sheinAlerts({cart,runs:[{state:'partial'}],now}).length,3)
  assert.equal(buildDailyPurchases({...context,include_earlier:false},now).counts.sold,0)
})
function harness(context={}) {
  let state=orderState(),now=Date.parse('2026-11-03T12:00:00Z'),result,tab=null,fail=null
  const calls=[]
  const port={load:async()=>structuredClone(state),save:async s=>{state=structuredClone(s)},now:()=>now,uuid:()=>crypto.randomUUID(),tab:async id=>tab?.id===id?tab:null,createTab:async()=>{tab={id:1,status:'complete'};return 1},navigate:async(id,url)=>{tab.url=url},read:async(id,action)=>action==='next'?{clicked:true}:result,api:async body=>{calls.push(structuredClone(body));if(fail?.(body))throw Object.assign(Error('network'),{status:503});return body.action==='orders_context'?{enabled:true,since_date:'2026-10-31',...context}:{linked:0}}}
  return {port,calls,get state(){return state},set:r=>{result=r},advance:()=>{now+=46000},fail:f=>{fail=f}}
}
const list={kind:'list',has_next:false,orders:[{ref:'GTEST000001',order_date:'2026-11-03'},{ref:'GTEST000002',order_date:'2026-11-03'}]}
test('one unreadable order is recorded, the next imports, and the finish is explicitly partial',async()=>{
  const h=harness(),e=createOrderEngine(h.port)
  await e.command('start');h.set(list);await e.tick();h.set({error:'order_unreadable'});h.advance();await e.tick()
  assert.equal(h.state.cursor,1);assert.equal(h.state.phase,'detail')
  h.set({kind:'detail',ref:'GTEST000002'});await e.tick()
  assert.equal(h.state.phase,'partial');assert.equal(h.state.done,1);assert.equal(h.calls.find(c=>c.action==='orders_finish').complete,false)
})
test('loss of the error report resumes at next order without reading old page under new identity',async()=>{
  const h=harness(),e=createOrderEngine(h.port)
  await e.command('start');h.set(list);await e.tick();h.set({error:'order_unreadable'});h.advance();h.fail(b=>b.action==='orders_report');await e.tick()
  assert.equal(h.state.phase,'advance');assert.equal(h.state.cursor,1)
  h.fail(null);h.advance();await createOrderEngine(h.port).tick();assert.equal(h.state.phase,'detail');assert.equal(h.state.cursor,1);assert.equal(h.state.errors.length,1)
})
test('incremental sync includes old active orders but skips recently verified terminal orders',async()=>{
  const h=harness({pending_refs:['GOLD0000001'],known:{GTEST000001:{stable:true,observed_at:'2026-11-03T11:00:00Z'}}}),e=createOrderEngine(h.port)
  await e.command('start',{mode:'incremental'});h.set(list);await e.tick()
  assert.deepEqual(h.state.queue,['GOLD0000001','GTEST000002'])
})
test('targeted sync validates native order links and never navigates supplied foreign URLs',async()=>{
  assert.equal(orderReference('https://attacker.invalid/user/orders/detail/GTEST000001'),null)
  const h=harness(),e=createOrderEngine(h.port)
  await assert.rejects(()=>e.command('start',{mode:'targeted',reference:'https://attacker.invalid'}))
  await e.command('start',{mode:'targeted',reference:'https://fr.shein.com/user/orders/detail/GTEST000001'})
  assert.equal(h.state.phase,'detail');assert.deepEqual(h.state.queue,['GTEST000001'])
})
test('human verification cannot be restarted around, and a confirmed empty list is a valid result',async()=>{
  const h=harness(),e=createOrderEngine(h.port)
  await e.command('start');h.set({error:'human_check'});await e.tick()
  await assert.rejects(()=>e.command('start'),/vérification/)
  h.set({kind:'list',orders:[],empty:true,has_next:false});await e.command('resume');assert.equal(h.state.phase,'done');assert.equal(h.state.done,0)
})
test('report validates boundaries, trims messages and never accepts foreign order refs',()=>{
  const base={run_id:crypto.randomUUID(),count:1,discovered:2,errors:[{ref:'GTEST000001',message:'x'.repeat(500)}]}
  assert.equal(syncReport(base).errors[0].message.length,300)
  assert.throws(()=>syncReport({...base,discovered:0}));assert.throws(()=>syncReport({...base,errors:[{ref:'invalid'}]}))
})
test('split orders read every parcel tab before importing once, including after worker suspension',async()=>{
  const h=harness(),e=createOrderEngine(h.port),sections=['En cours de traitement','Colis1']
  let selected=sections[0]
  h.port.read=async(id,action)=>{if(action?.section){selected=action.section;return {clicked:true}}return {kind:'detail',ref:'GTEST000001',sections,section:selected,items:[{sku:selected}],parcels:[],observed_at:'2026-11-03T12:00:00Z'}}
  await e.command('start',{mode:'targeted',reference:'GTEST000001'});await e.tick()
  assert.equal(h.state.phase,'sections');assert.equal(h.calls.filter(c=>c.action==='orders_import').length,0)
  await createOrderEngine(h.port).tick();assert.equal(h.state.sectionIndex,1)
  assert.equal(h.calls.filter(c=>c.action==='orders_import').length,0)
  await createOrderEngine(h.port).tick()
  const imports=h.calls.filter(c=>c.action==='orders_import');assert.equal(imports.length,1)
  assert.deepEqual(imports[0].order.items.map(i=>i.sku),sections);assert.equal(h.state.phase,'done')
})
test('an unreadable parcel tab never replaces a complete order with only its first group',async()=>{
  const h=harness(),e=createOrderEngine(h.port),sections=['En cours de traitement','Colis1']
  h.port.read=async(id,action)=>action?.section?{clicked:true}:{kind:'detail',ref:'GTEST000001',sections,section:sections[0],items:[{sku:'a'}]}
  await e.command('start',{mode:'targeted',reference:'GTEST000001'});await e.tick();await e.tick();h.advance();await e.tick()
  assert.equal(h.calls.filter(c=>c.action==='orders_import').length,0);assert.equal(h.state.phase,'partial')
})
