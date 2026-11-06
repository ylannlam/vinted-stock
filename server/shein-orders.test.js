import test from 'node:test'
import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'
import {parseHTML} from 'linkedom'
import {readSheinOrders} from '../extensions/shein/orders-dom.js'
import {createOrderEngine,orderState} from '../extensions/shein/orders-engine.js'
import {validateSheinOrder,orderStatus,importSheinOrder} from './shein-orders.js'
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
test('a total on an order with cancelled/refunded items is kept for review, never as a Budget expense',()=>{
  const oldDoc=globalThis.document,oldLocation=globalThis.location
  try{
    globalThis.document=parseHTML(readFileSync(new URL('../tests/fixtures/shein-order-1.html',import.meta.url),'utf8')+'<ul><li>Frais de livraison:3,90€</li><li>Total31,50€</li></ul>').document
    globalThis.location={href:'https://fr.shein.com/user/orders/detail/GTEST000001'}
    const input=readSheinOrders()
    assert.equal(validateSheinOrder(input).payment.source,'order_summary')
    input.items[0].status_text='Remboursé'
    const review=validateSheinOrder(input).payment
    assert.equal(review.source,'order_summary_review');assert.equal(review.paid_total,31.5)
    input.items[1].status_text='En attente de paiement';assert.equal(validateSheinOrder(input).payment,null)
    input.items[1].status_text='Statut inconnu';assert.equal(validateSheinOrder(input).payment,null)
  }finally{globalThis.document=oldDoc;globalThis.location=oldLocation}
})
test('a reading missing previously recorded items is rejected with a readable 409, so the extension keeps the previous snapshot',async()=>{
  const order={...fixture(),ref:'GTEST000000',observed_at:new Date().toISOString()}
  const db={rpc:async()=>({error:{message:'shein_items_missing'}})}
  await assert.rejects(importSheinOrder(db,{enabled:true,id:'d'},order),e=>e.status===409&&/relevé précédent est conservé/.test(e.message))
  const ok={rpc:async(name,args)=>{assert.equal(name,'import_shein_order_v2');assert.equal(args.p_order.ref,'GTEST000000');return {error:null}}}
  assert.deepEqual(await importSheinOrder(ok,{enabled:true,id:'d'},order),{saved:true})
})
test('the extension records a rejected import as an error and moves on without sending it again',async()=>{
  const h=harness(),engine=createOrderEngine(h.port)
  await engine.command('start');h.setResult(list);await engine.tick()
  const api=h.port.api;h.port.api=async body=>{if(body.action==='orders_import'){h.calls.push(body);throw Object.assign(Error('Des articles déjà relevés manquent'),{status:409})}return api(body)}
  h.setResult({...fixture(),ref:'GTEST000000'});await engine.tick()
  assert.equal(h.state.phase,'partial');assert.equal(h.state.outbox,null)
  assert.equal(h.state.errors[0].code,'import_rejected');assert.equal(h.state.errors[0].ref,'GTEST000000')
  assert.equal(h.calls.filter(c=>c.action==='orders_import').length,1)
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

// Pages Shein réelles (anonymisées) : la page embarque ses données, lues sans dépendre de l'affichage.
function page(file,href){
  const old={document:globalThis.document,location:globalThis.location,DOMParser:globalThis.DOMParser}
  const html=readFileSync(new URL(`../tests/fixtures/${file}`,import.meta.url),'utf8'),dom=parseHTML(html)
  globalThis.document=dom.document;globalThis.location={href};globalThis.DOMParser=class{parseFromString(s){return parseHTML(`<html><body>${s}</body></html>`).document}}
  try{return readSheinOrders()}finally{Object.assign(globalThis,old)}
}
test('order page data: tracking number, exact unit prices, real total paid and statuses without clicking any tab',()=>{
  const r=page('shein-order-json.html','https://fr.shein.com/user/orders/detail/GTESTJSON0001')
  assert.equal(r.source,'json');assert.equal(r.order_date,'2026-11-01');assert.deepEqual(r.sections,[])
  assert.deepEqual(r.payment,{paid_total:31.5,shipping:3.9,currency:'EUR',source:'order_summary'})
  assert.equal(r.items[0].product_url,'https://fr.shein.com/SHEIN-Belle-Robe-p-328855779.html','the real product link of the page is kept')
  assert.match(r.items[1].product_url,/^https:\/\/fr\.shein\.com\/Flirla-[^/]+-p-45969235\.html$/)
  assert.equal(r.items[0].status_text,'Expédiés');assert.equal(r.items[0].eta,'06-12 nov.')
  assert.equal(r.parcels.length,1);assert.equal(r.parcels[0].tracking_number,'GFFR00000000000001');assert.equal(r.parcels[0].carrier,'GOFO')
  assert.deepEqual(r.parcels[0].skus,['sz25092721773738883','sz2410092319181622'])
  const v=validateSheinOrder({...r,observed_at:new Date().toISOString()})
  const pair=v.items.find(i=>i.sku==='sztest0003')
  assert.equal(pair.quantity,2);assert.equal(pair.unit_price,9.1,'two units at the same exact price keep their unit price');assert.equal(pair.status,'processing')
  assert.equal(v.items.find(i=>i.sku==='sztest0004').status,'exception','an unknown code with a refund record is a refund')
  assert.equal(v.payment.source,'order_summary_review','a refunded line keeps the total for review only')
  assert.ok(v.items.every(i=>i.photo?.startsWith('https://')))
})
test('track page data: carrier, GOFO link, steps and dated events',()=>{
  const r=page('shein-track.html','https://fr.shein.com/orders/track?billno=GTESTJSON0001')
  assert.equal(r.kind,'track');assert.equal(r.packages.length,1)
  const p=r.packages[0]
  assert.equal(p.tracking_number,'GFFR00000000000001');assert.equal(p.carrier,'GOFO');assert.equal(p.track_url,'https://www.gofo.com/fr/tracking-results/?id=GFFR00000000000001')
  assert.equal(p.status_text,'En cours de livraison');assert.equal(p.delivered,false);assert.equal(p.steps.length,5)
  assert.equal(p.events[0].at,'2026-11-06T12:52:51.000Z');assert.equal(p.events[1].place,'Ville');assert.equal(p.events[1].text,'Le chauffeur est sorti pour la livraison')
  assert.ok(!p.events.some(e=>/<p>/.test(e.text)),'HTML is reduced to text')
  assert.equal(page('shein-track.html','https://fr.shein.com/orders/track?billno=GOTHER000001').error,'reference_mismatch')
})
test('a tracking read attaches steps to the parcel, and a later read without them keeps the known steps',async()=>{
  const {parcelObservation,mergeParcels}=await import('./shein-orders.js')
  const items=[{sku:'a'}],at=Date.now()
  const rich=parcelObservation({tracking_number:'gffr1234567',carrier:'GOFO',status_text:'En cours de livraison',events:[{at:new Date(at-3600000).toISOString(),place:'Marseille',text:'Arrivé'}],steps:[{name:'Livré',done:false}],skus:['a','zz'],track_url:'javascript:alert(1)'},items,at)
  assert.equal(rich.tracking_number,'GFFR1234567');assert.equal(rich.tracked,true);assert.deepEqual(rich.skus,['a']);assert.equal(rich.track_url,null)
  const bare=parcelObservation({tracking_number:'GFFR1234567',carrier:'',skus:['a']},items,at+1000)
  const [merged]=mergeParcels([bare],[rich])
  assert.equal(merged.events.length,1);assert.equal(merged.status_text,'En cours de livraison');assert.equal(merged.carrier,'GOFO');assert.equal(merged.observed_at,bare.observed_at)
})
test('a shipped order also opens its « Suivre » page; the parcel steps reach the import; no new visit within 25 minutes',async()=>{
  const h=harness(),engine=createOrderEngine(h.port)
  const detail=page('shein-order-json.html','https://fr.shein.com/user/orders/detail/GTESTJSON0001')
  const track=page('shein-track.html','https://fr.shein.com/orders/track?billno=GTESTJSON0001')
  const listOne={kind:'list',orders:[{ref:'GTESTJSON0001',order_date:'2026-11-02'}],has_next:false}
  await engine.command('start');h.setResult(listOne);await engine.tick()
  h.setResult(detail);await engine.tick()
  assert.equal(h.state.phase,'track');assert.equal(h.nav.at(-1),'https://fr.shein.com/orders/track?billno=GTESTJSON0001')
  h.setResult(track);await engine.tick()
  const sent=h.calls.find(c=>c.action==='orders_import').order
  assert.equal(sent.parcels[0].events.length>5,true);assert.equal(sent.parcels[0].status_text,'En cours de livraison');assert.equal(sent.tracked,true)
  assert.equal(h.state.phase,'done')
  h.advance(600001);await engine.tick();h.setResult(listOne);await engine.tick();h.setResult(detail);await engine.tick()
  assert.notEqual(h.state.phase,'track','tracking is refreshed at most every 25 minutes');assert.equal(h.calls.filter(c=>c.action==='orders_import').length,2)
})
test('a « Suivre » page that does not answer still saves the order with its tracking numbers',async()=>{
  const h=harness(),engine=createOrderEngine(h.port)
  await engine.command('start');h.setResult({kind:'list',orders:[{ref:'GTESTJSON0001',order_date:'2026-11-02'}],has_next:false});await engine.tick()
  h.setResult(page('shein-order-json.html','https://fr.shein.com/user/orders/detail/GTESTJSON0001'));await engine.tick()
  h.setResult({error:'page_unavailable'});await engine.tick();assert.equal(h.state.phase,'track')
  h.advance(45001);await engine.tick()
  const sent=h.calls.find(c=>c.action==='orders_import').order
  assert.equal(sent.parcels[0].tracking_number,'GFFR00000000000001');assert.equal(sent.tracked,false);assert.equal(h.state.errors.length,0)
})
test('a delivered parcel marks its items as delivered',async()=>{
  const h=harness(),engine=createOrderEngine(h.port)
  const track=page('shein-track.html','https://fr.shein.com/orders/track?billno=GTESTJSON0001');track.packages[0].delivered=true
  await engine.command('start');h.setResult({kind:'list',orders:[{ref:'GTESTJSON0001',order_date:'2026-11-02'}],has_next:false});await engine.tick()
  h.setResult(page('shein-order-json.html','https://fr.shein.com/user/orders/detail/GTESTJSON0001'));await engine.tick();h.setResult(track);await engine.tick()
  const sent=h.calls.find(c=>c.action==='orders_import').order
  assert.deepEqual(sent.items.filter(i=>i.status_text==='Livré').map(i=>i.sku),['sz25092721773738883','sz2410092319181622'])
  assert.equal(validateSheinOrder({...sent,observed_at:new Date().toISOString()}).items.find(i=>i.sku==='sz2410092319181622').status,'delivered')
})
