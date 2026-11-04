import test from 'node:test'
import assert from 'node:assert/strict'
import {readSheinOrders} from './shein-orders.js'

// Each call resolves only when released, so the test sees which reads are in flight together.
function database(){
 const started=[],gates=new Map()
 const wait=(name,value)=>{started.push(name);return new Promise(resolve=>gates.set(name,()=>resolve(value)))}
 const order={ref:'GTEST000001',order_date:'2026-11-01',observed_at:'2026-11-01T10:00:00Z',updated_at:'2026-11-01T10:00:00Z',shipment_observations:[],payment:null,shein_order_items:[{id:'GTEST000001:x',sku:'SKU-A',quantity:1}]}
 const table=name=>{const q={select(){return q},order(){return q},range(){return wait(name,{data:[order],count:1,error:null})},eq(){return q},maybeSingle(){return wait(name,{data:{},error:null})},limit(){return name==='shein_sync_runs'?wait(name,{data:[],error:null}):q},single(){return wait(name,{data:{},error:null})},in(){return wait(name,{data:name==='workspace_sales'?[{id:'line-1',currency:'EUR',actual_cost:5,source:{selling_price:'12'}}]:[{line_id:'line-1',item_id:'GTEST000001:x'}],error:null})}};return q}
 return {started,release:name=>gates.get(name)(),db:{from:table,rpc:(name)=>wait(name,{data:[{id:'line-1',sku:'sku-a'}],error:null})}}
}
const tick=()=>new Promise(r=>setImmediate(r))
test('order links and sale choices are read at the same time, finances right after the choices',async()=>{
 const {db,started,release}=database()
 const pending=readSheinOrders(db,{})
 await tick();for(const name of ['shein_orders','shein_sync_state','shein_sync_runs','dotb_tracking_period'])release(name)
 await tick();await tick()
 assert.ok(started.includes('shein_order_links')&&started.includes('shein_sale_choices'),'both reads started before either answered')
 assert.equal(started.includes('workspace_sales'),false)
 release('shein_sale_choices');await tick();await tick()
 assert.ok(started.includes('workspace_sales'),'finances do not wait for the links')
 release('workspace_sales');release('shein_order_links')
 const result=await pending
 assert.equal(result.orders[0].items[0].links.length,1);assert.equal(result.lines[0].actual_cost,5);assert.equal(result.lines[0].selling_price,'12')
})
