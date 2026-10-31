import test from 'node:test'
import assert from 'node:assert/strict'
import {readDotbPage,normalizeOrders} from './dotb.js'
import {readTrackingPeriod} from './tracking.js'
test('order import sends an inclusive fixed timestamp, not a moving yesterday or UTC-only date',async()=>{
  await readDotbPage('cursor',async url=>{
    assert.equal(url.searchParams.get('from'),'2026-10-29T23:00:00Z')
    assert.equal(url.searchParams.get('cursor'),'cursor');assert.equal(url.searchParams.get('sort'),'order_date')
    return {ok:true,json:async()=>({data:[],has_more:false})}
  },'test-only','2026-10-29T23:00:00Z')
})
test('a sale retains the actual Dotb listing id separately from its order-line id',()=>{
  const order='11111111-1111-4111-8111-111111111111',line='22222222-2222-4222-8222-222222222222',listing='33333333-3333-4333-8333-333333333333'
  const result=normalizeOrders([{id:order,items:[{id:line,vinted_item_id:listing,sku:'same-sku'}]}])
  assert.equal(result.lines[0].dotb_item_id,line);assert.equal(result.lines[0].source.dotb_listing_id,listing)
})
test('a missing tracking setting fails visibly instead of importing all history',async()=>{
  const db={from:()=>({select:()=>({single:async()=>({data:null,error:null})})})}
  await assert.rejects(readTrackingPeriod(db),/tracking_period_missing/)
})
