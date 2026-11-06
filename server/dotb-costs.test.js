import test from 'node:test'
import assert from 'node:assert/strict'
import {syncDotbCosts,patchPurchasePrice,COST_MESSAGES} from './dotb-costs.js'

function fakeDb(rows){
  const calls=[]
  return {calls,rpc:async(name,args)=>{
    calls.push([name,args])
    if(name==='pending_dotb_costs')return {data:rows.slice(0,args.p_limit),error:null}
    if(name==='count_pending_dotb_costs')return {data:[{pending:rows.length-calls.filter(c=>c[0]==='record_dotb_cost'&&!c[1].p_error).length,failed:0}],error:null}
    return {data:null,error:null}
  }}
}
const row=n=>({id:`o${n}:i${n}`,order_id:`00000000-0000-0000-0000-00000000000${n}`,dotb_item_id:`10000000-0000-0000-0000-00000000000${n}`,cost:`${n}.50`})

test('each Shein cost is written as the purchase price of the Dotb order item',async()=>{
  const sent=[]
  const fetcher=async(url,init)=>{sent.push([url,init.method,JSON.parse(init.body)]);return {ok:true,status:200}}
  const db=fakeDb([row(1),row(2)])
  const r=await syncDotbCosts(db,{fetcher,token:'t'})
  assert.equal(r.sent,2);assert.equal(r.stop,null);assert.equal(r.pending,0)
  assert.deepEqual(sent[0],['https://dotb.io/api/public/v1/orders/00000000-0000-0000-0000-000000000001/items/10000000-0000-0000-0000-000000000001','PATCH',{purchase_price:'1.50'}])
  assert.deepEqual(db.calls.filter(c=>c[0]==='record_dotb_cost').map(c=>c[1]),[{p_id:'o1:i1',p_cost:'1.50',p_error:null},{p_id:'o2:i2',p_cost:'2.50',p_error:null}])
})

test('a key without orders_write stops at once with a clear message, nothing is recorded',async()=>{
  const db=fakeDb([row(1),row(2)])
  const r=await syncDotbCosts(db,{fetcher:async()=>({ok:false,status:403}),token:'t'})
  assert.equal(r.stop,'scope');assert.equal(r.message,COST_MESSAGES.scope);assert.equal(r.sent,0)
  assert.equal(db.calls.filter(c=>c[0]==='record_dotb_cost').length,0)
})

test('a missing order item is recorded as an error and the others continue',async()=>{
  const db=fakeDb([row(1),row(2)])
  const r=await syncDotbCosts(db,{fetcher:async url=>url.includes('000000000001/items')?{ok:false,status:404}:{ok:true,status:200},token:'t'})
  assert.equal(r.sent,1);assert.equal(r.failed,1)
  assert.match(db.calls.find(c=>c[0]==='record_dotb_cost'&&c[1].p_error)[1].p_error,/introuvable/)
})

test('limits, outages and a missing key pause the sync instead of failing items',async()=>{
  assert.deepEqual(await patchPurchasePrice(row(1),{fetcher:async()=>({ok:false,status:429}),token:'t'}),{stop:'limit'})
  assert.deepEqual(await patchPurchasePrice(row(1),{fetcher:async()=>({ok:false,status:503}),token:'t'}),{stop:'offline'})
  assert.deepEqual(await patchPurchasePrice(row(1),{fetcher:async()=>{throw new TypeError('x')},token:'t'}),{stop:'offline'})
  assert.deepEqual(await patchPurchasePrice(row(1),{fetcher:async()=>({ok:true}),token:''}),{stop:'auth'})
})

test('before the database update, the sync stops quietly with an explanation',async()=>{
  const db={rpc:async()=>({data:null,error:{code:'PGRST202'}})}
  const r=await syncDotbCosts(db,{fetcher:async()=>{throw Error('no call expected')},token:'t'})
  assert.equal(r.stop,'setup')
})
