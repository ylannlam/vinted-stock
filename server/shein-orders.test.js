import test from 'node:test'
import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'
import {parseHTML} from 'linkedom'
import {readSheinOrders} from '../extensions/shein/orders-dom.js'
import {createOrderEngine,orderState} from '../extensions/shein/orders-engine.js'
import {validateSheinOrder,orderStatus} from './shein-orders.js'
import {combinedBudgetRows,budgetTotals} from '../src/lib/budget.js'

function fixture(index=0) {
  const oldDoc=globalThis.document,oldLocation=globalThis.location
  globalThis.document=parseHTML(readFileSync(new URL(`../tests/fixtures/shein-order-${index}.html`,import.meta.url),'utf8')).document
  globalThis.location={href:'https://fr.shein.com/user/orders/detail/GTEST00000'+index}
  try{return readSheinOrders()}finally{globalThis.document=oldDoc;globalThis.location=oldLocation}
}
test('real DOM structure: duplicate product rows are two bought units and inherit rowspan status',()=>{
  const result=fixture();assert.equal(result.items.length,2);assert.equal(result.items[1].status_text,'Emballage')
  const validated=validateSheinOrder(result)
  assert.equal(validated.items.length,1);assert.equal(validated.items[0].quantity,2);assert.equal(validated.items[0].unit_price,8.57)
  assert.equal(validated.items[0].status,'processing');assert.equal(validated.items[0].size,'M')
  assert.equal(JSON.stringify(validated).includes('Informations De Commande'),false)
})
test('separate merchant tables retain their own variants, prices and shipped status',()=>{
  const result=validateSheinOrder(fixture(1));assert.equal(result.items.length,2)
  assert.deepEqual(result.items.map(i=>i.size),['36(S)','38(M)']);assert.deepEqual(result.items.map(i=>i.unit_price),[20.05,7.55]);assert.ok(result.items.every(i=>i.status==='shipped'))
})
test('only explicit paid/shipped states advance; a receipt button or return policy is not a status',()=>{
  for(const text of ['Déjà reçu','Suivre','Retour uniquement par rétractation','livraison prévue'])assert.equal(orderStatus(text),'unknown')
  assert.equal(orderStatus('Annulée'),'exception');assert.equal(orderStatus('En attente de paiement'),'unpaid')
  assert.equal(orderStatus('En cours de traitement'),'processing')
  const order=fixture();order.items[1].status_text='Expédiés'
  assert.equal(validateSheinOrder(order).items[0].status,'processing')
  order.items[1].status_text='Remboursé';assert.equal(validateSheinOrder(order).items[0].status,'exception')
  order.items[0].quantity=2;assert.equal(validateSheinOrder(order).items[0].unit_price,null)
})
test('invalid quantities, destinations, dates and stale snapshots are rejected',()=>{
  for(const mutate of [o=>o.items[0].quantity=-1,o=>o.items[0].product_url='https://attacker.invalid/p-1.html',o=>o.order_date='invalid',o=>o.observed_at='2000-01-01']) {
    const order=fixture();mutate(order);assert.throws(()=>validateSheinOrder(order))
  }
  const order=fixture();order.items[0].photo='https://attacker.invalid/p.jpg';assert.equal(validateSheinOrder(order).items[0].photo,null)
})
test('final item prices are kept as observed; differing units are never averaged',()=>{
  const input=fixture();input.items[1].unit_price=6.15
  const item=validateSheinOrder(input).items[0]
  assert.equal(item.unit_price,null);assert.deepEqual(item.paid_amounts,[8.57,6.15])
  input.items[0].quantity=2
  assert.deepEqual(validateSheinOrder(input).items[0].paid_amounts,[null,null,6.15])
})
test('an exact order summary reads total including delivery; unpaid and unclear totals never enter Budget',()=>{
  const oldDoc=globalThis.document,oldLocation=globalThis.location
  try{
    globalThis.document=parseHTML(readFileSync(new URL('../tests/fixtures/shein-order-1.html',import.meta.url),'utf8')+'<ul><li>Subtotal:27,60€</li><li>Frais de livraison:3,90€</li><li>Total31,50€</li></ul>').document
    globalThis.location={href:'https://fr.shein.com/user/orders/detail/GTEST000001'}
    const input=readSheinOrders(),order=validateSheinOrder(input)
    assert.equal(order.payment.paid_total,31.5);assert.equal(order.payment.shipping,3.9)
    assert.deepEqual(order.items.map(i=>i.unit_price),[20.05,7.55])
    input.items[0].status_text='En attente de paiement';assert.equal(validateSheinOrder(input).payment,null)
    document.body.insertAdjacentHTML('beforeend','<ul><li>Total999,00€</li></ul>');assert.equal(readSheinOrders().payment,null)
  }finally{globalThis.document=oldDoc;globalThis.location=oldLocation}
})
test('Budget includes each order once, detects exact references already entered manually, and preserves manual totals',()=>{
  const auto={id:'shein-GTEST000001',order_ref:'GTEST000001',source:'shein',type:'out',cat:'Stock Shein',label:'Commande GTEST000001',amount:31.5}
  assert.equal(budgetTotals(combinedBudgetRows([],[auto,auto]).rows).expenses,31.5)
  const manual={id:'manual',type:'out',cat:'Stock Shein',label:'Achat GTEST000001',amount:30}
  const result=combinedBudgetRows([manual],[auto]);assert.equal(result.duplicates.length,1);assert.equal(budgetTotals(result.rows).expenses,30)
  assert.equal(combinedBudgetRows([{...manual,label:'Autre achat'}],[auto]).rows.length,2)
})
function harness() {
  let saved=orderState(),now=Date.now(),tab=null,result,error=null
  const calls=[],nav=[]
  const port={load:async()=>structuredClone(saved),save:async s=>saved=structuredClone(s),now:()=>now,
    tab:async id=>tab?.id===id?tab:null,createTab:async()=>{tab={id:7,status:'complete'};return 7},navigate:async(id,url)=>{tab.url=url;nav.push(url)},
    read:async(id,action)=>action==='next'?{clicked:true}:result,
    api:async body=>{calls.push(structuredClone(body));if(error)throw error;return body.action==='orders_context'?{enabled:true,since_date:'2026-10-31'}:body.action==='orders_finish'?{linked:1}:{saved:true}}}
  return {port,calls,nav,get state(){return saved},setResult:r=>result=r,setError:e=>error=e,advance:n=>now+=n,loseTab:()=>tab=null}
}
const list={kind:'list',orders:[{ref:'GTEST000000',order_date:'2026-11-02'},{ref:'GOLD000000',order_date:'2026-05-01'}],has_next:true}
test('list → recent details → durable import → matching; old orders are not imported',async()=>{
  const h=harness(),engine=createOrderEngine(h.port)
  await engine.command('start');h.setResult(list);await engine.tick()
  assert.equal(h.state.total,1);assert.equal(h.state.phase,'detail')
  h.setResult({...fixture(),ref:'GTEST000000'});await engine.tick()
  assert.equal(h.state.phase,'done');assert.equal(h.state.done,1)
  assert.deepEqual(h.calls.map(c=>c.action),['orders_context','orders_import','orders_finish'])
  const calls=h.calls.length;await engine.tick();assert.equal(h.calls.length,calls)
  h.advance(600001);await engine.tick();assert.equal(h.state.phase,'list')
})
test('lost import reply persists the same snapshot across suspension, never duplicates a quantity',async()=>{
  const h=harness(),engine=createOrderEngine(h.port)
  await engine.command('start');h.setResult(list);await engine.tick();h.setResult({...fixture(),ref:'GTEST000000'})
  h.setError(Error('Network'));await engine.tick();const pending=structuredClone(h.state.outbox)
  assert.ok(pending);h.setError(null);h.advance(30001)
  await createOrderEngine(h.port).tick();assert.equal(h.state.phase,'done')
  const imports=h.calls.filter(c=>c.action==='orders_import');assert.equal(imports.length,2);assert.deepEqual(imports[0].order,imports[1].order)
})
test('human check stops navigation and import until explicit resume; pause persists',async()=>{
  const h=harness(),engine=createOrderEngine(h.port)
  await engine.command('start');h.setResult({error:'human_check'});await engine.tick();assert.equal(h.state.phase,'blocked')
  const count=h.calls.length;await engine.tick();assert.equal(h.calls.length,count)
  h.setResult(list);await engine.command('resume');assert.equal(h.state.phase,'detail')
  await engine.command('pause');h.setResult(fixture());await createOrderEngine(h.port).tick();assert.equal(h.calls.length,count)
})
test('an order reference mismatch never reaches the server',async()=>{
  const h=harness(),engine=createOrderEngine(h.port)
  await engine.command('start');h.setResult(list);await engine.tick();h.setResult({...fixture(),ref:'GWRONG000000'});await engine.tick()
  assert.equal(h.state.phase,'partial');assert.equal(h.state.errors[0].code,'reference_mismatch');assert.ok(h.calls.every(c=>c.action!=='orders_import'))
})
test('pagination waits for new contents, then reads details once all recent pages are found',async()=>{
  const h=harness(),engine=createOrderEngine(h.port)
  await engine.command('start');h.setResult({...list,orders:list.orders.slice(0,1)});await engine.tick();assert.equal(h.state.phase,'list_wait')
  await engine.tick();assert.equal(h.state.phase,'list_wait')
  h.setResult({kind:'list',orders:[list.orders[1]],has_next:true});await engine.tick();assert.equal(h.state.phase,'detail');assert.equal(h.state.total,1)
})
test('expired snapshots restart discovery after explicit resume instead of retrying a rejected outbox forever',async()=>{
  const h=harness(),engine=createOrderEngine(h.port)
  await engine.command('start');h.setResult(list);await engine.tick();h.setResult({...fixture(),ref:'GTEST000000'})
  h.setError(Object.assign(Error('Expired'),{status:409}));await engine.tick()
  assert.equal(h.state.phase,'blocked');assert.equal(h.state.outbox,null)
  h.setError(null);await engine.command('resume');assert.equal(h.state.phase,'list')
})
