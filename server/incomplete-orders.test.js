import test from 'node:test'
import assert from 'node:assert/strict'
import {readIncompleteOrders} from './incomplete-orders.js'
import {normalizeOrders} from './dotb.js'
test('an order without items remains an order, without a fabricated price, quantity or item ID',()=>{
  const {orders,lines}=normalizeOrders([{id:'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',items:[],account:{login:'seller'},normalized_status:'payment_received',order_date:'2026-11-04T12:00:00Z'}])
  assert.equal(orders.length,1);assert.equal(lines.length,0);assert.equal(orders[0].account_login,'seller')
})
test('incomplete orders are paginated from the dedicated view and failed reads are explicit',async()=>{
  const calls=[];const rows=[{id:'o',account_login:'seller',status:'payment_received'}]
  const db={from(name){assert.equal(name,'sales_orders_without_items');const q={select(fields,options){assert.equal(options.count,'exact');assert.ok(!fields.includes('label_url'));return q},order(name,options){calls.push(['order',name,options]);return q},range(start,end){calls.push(['range',start,end]);return Promise.resolve({data:rows,count:21,error:null})}};return q}}
  assert.deepEqual(await readIncompleteOrders(db,1),{orders:rows,count:21,page:1,page_size:10})
  assert.deepEqual(calls.at(-1),['range',10,19]);assert.equal(calls[0][1],'order_date')
  for(const value of [-1,1.1,'wrong',100001])await assert.rejects(readIncompleteOrders(db,value),/Page invalide/)
  await assert.rejects(readIncompleteOrders({from(){return {select(){return this},order(){return this},range(){return {error:Error('offline')}}}}}),/offline/)
})
