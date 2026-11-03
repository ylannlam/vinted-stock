import test from 'node:test'
import assert from 'node:assert/strict'
import {buildDailyPurchases,purchaseDay,shiftPurchaseDay,dailyPurchaseText} from '../src/lib/dailyPurchases.js'
import {readDailyPurchases} from './daily-purchases.js'

const now=Date.parse('2026-11-03T15:00:00Z'),day='2026-11-03'
const product={sku:'SKU-1',supplier_url:'https://fr.shein.com/Body-p-123.html',color:'Noir',price:'12.50',currency:'EUR',sizes:[{size:'S',availability:'available'},{size:'M',availability:'available'}],observed_at:new Date(now).toISOString()}
const line=(id,extra={})=>({id,source:{title:'Body noir'},resolved_sku:'SKU-1',supplier_size:'M',sale_date:'2026-11-03T10:00:00Z',effective_stage:'to_order',...extra})
const cart=(lines,extra={})=>buildDailyPurchases({day,lines,catalog:[product],...extra},now)

test('daily quantities group exact SKU, normalized size and color across accounts, never different sizes',()=>{
  const result=cart([line('a'),line('b',{supplier_size:'38(M)',account_login:'second'}),line('c',{supplier_size:'S'})])
  assert.equal(result.groups.length,2);assert.deepEqual(result.groups.map(g=>g.quantity),[2,1]);assert.equal(result.counts.ready,3);assert.equal(result.estimated_total,37.5)
  assert.match(dailyPurchaseText(result),/2 × Body noir/)
})
test('Paris day boundaries handle winter, summer and midnight without UTC day drift',()=>{
  assert.equal(purchaseDay('2026-11-02T23:30:00Z'),day)
  assert.equal(purchaseDay('2026-07-02T22:30:00Z'),'2026-07-03')
  assert.equal(shiftPurchaseDay('2026-03-30',-1),'2026-03-29')
  assert.equal(cart([line('before',{sale_date:'2026-11-02T22:59:59Z'}),line('start',{sale_date:'2026-11-02T23:00:00Z'}),line('end',{sale_date:'2026-11-03T23:00:00Z'})]).counts.sold,1)
})
test('purchased, linked, cancelled and shipped sales never enter quantities to buy',()=>{
  const result=cart([line('ordered',{effective_stage:'ordered'}),line('ref',{supplier_order_ref:'GORDER001'}),line('linked',{shein_item_id:'item1'}),line('shipped',{effective_stage:'shipped'}),line('cancelled',{is_blocked:true}),line('inactive',{source_active:false}),line('buy')])
  assert.equal(result.counts.ready,1);assert.equal(result.counts.ordered,4);assert.equal(result.counts.excluded,2)
})
test('unallocated paid purchases require review instead of recommending a duplicate buy',()=>{
  const pending={sku:'SKU-1',size:'38(M)',color:'Noir',status:'shipped',remaining:2,order_ref:'GORDER001',order_date:day}
  assert.equal(cart([line('a')],{unallocated:[pending]}).groups[0].state,'purchase_review')
  for(const change of [{remaining:0},{status:'unpaid'},{size:'S'},{color:'Bleu'},{order_date:'2026-11-02'}])assert.equal(cart([line('a')],{unallocated:[{...pending,...change}]}).counts.ready,1)
})
test('missing references and unavailable variants stay visible but outside the buy list',()=>{
  const result=cart([line('sku',{resolved_sku:''}),line('size',{supplier_size:''}),line('color',{supplier_color:'Bleu'}),line('unknown',{supplier_size:'XL'})])
  assert.equal(result.counts.ready,0);assert.equal(result.counts.attention,4);assert.equal(result.counts.missing_sku,1)
  assert.equal(cart([line('a')],{catalog:[{...product,sizes:[{size:'M',availability:'unavailable'}]}]}).groups[0].state,'unavailable')
  assert.equal(cart([line('a')],{catalog:[{sku:'SKU-1',retrieval_status:'queued'}]}).groups[0].state,'searching')
  assert.equal(cart([line('a')],{catalog:[{sku:'SKU-1',retrieval_status:'failed'}]}).groups[0].state,'lookup_failed')
})
test('recalculation replaces quantities and completed SKU lookup needs no saved cart',()=>{
  const rows=[line('a'),line('b')]
  assert.equal(cart(rows,{catalog:[]}).counts.attention,2)
  assert.equal(cart(rows).groups[0].quantity,2)
  assert.equal(cart(rows).groups[0].quantity,2)
  rows[0].effective_stage='ordered';assert.equal(cart(rows).groups[0].quantity,1)
})
test('unknown prices are not presented as a full estimate and unsafe product URLs cannot be opened',()=>{
  const result=cart([line('a')],{catalog:[{...product,price:null}]})
  assert.equal(result.missing_prices,1);assert.equal(result.groups[0].price,null)
  assert.equal(cart([line('a')],{catalog:[{...product,supplier_url:'https://attacker.invalid/Body-p-123.html'}]}).counts.ready,0)
})
test('API validates date, uses one consistent snapshot and preserves read failures',async()=>{
  const calls=[],db={rpc:async(name,args)=>{calls.push([name,args]);return {data:{day,lines:[line('a')],catalog:[product]}}}}
  for(const invalid of ['2026-02-31','2026-11-04','bad',['2026-11-03']])await assert.rejects(()=>readDailyPurchases(db,{day:invalid},now))
  assert.equal(calls.length,0)
  assert.equal((await readDailyPurchases(db,{},now)).counts.ready,1)
  assert.deepEqual(calls,[['daily_purchase_context',{p_day:day}]])
  await assert.rejects(()=>readDailyPurchases({rpc:async()=>({error:Error('offline')})},{day},now),/offline/)
})
