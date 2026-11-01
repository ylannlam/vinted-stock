import test from 'node:test'
import assert from 'node:assert/strict'
import {salesFilters,financeValues,batchValues} from './workspace.js'
import {readAllRows,commonNextStage,directionReady} from '../src/lib/workspace.js'
import {workspaceHandler} from '../api/workspace.js'
test('sales filters reject invalid dates, oversized search and inverted periods',()=>{
 assert.deepEqual(salesFilters({stage:'ordered',page:'2',urgent:'true',from:'2026-11-01'}),{stage:'ordered',page:2,urgent:true,from:'2026-11-01',to:'',search:'',account:''})
 for(const q of [{page:-1},{page:1.1},{stage:'other'},{from:'2026-02-30'},{from:'2026-99-99'},{from:'2026-11-02',to:'2026-11-01'},{search:'x'.repeat(201)},{account:['a','b']}])assert.throws(()=>salesFilters(q))
})
test('finance confirmation requires a cost and exact positive monetary values',()=>{
 assert.deepEqual(financeValues({actual_cost:10,fees_amount:'2.10',refund_amount:'0',finance_confirmed:true}),{fees:2.1,refund:0,confirmed:true})
 assert.deepEqual(financeValues({}),{fees:0,refund:0,confirmed:false})
 for(const x of [{fees_amount:-1},{refund_amount:'Infinity'},{fees_amount:'0.001'},{fees_amount:true},{finance_confirmed:'yes'},{finance_confirmed:true,actual_cost:''}])assert.throws(()=>financeValues(x))
})
test('bulk edits require unique, versioned lines and an allowed operation',()=>{
 const line={id:'test:1',updated_at:'2026-11-02T00:00:00Z'}
 const body={lines:[line],operation:'order_ref',value:'  GS-123 '}
 assert.equal(batchValues(body).value,'GS-123')
 for(const patch of [{lines:[]},{lines:[line,line]},{lines:[{id:'test'}]},{lines:Array.from({length:101},(_,i)=>({...line,id:String(i)}))},{operation:'delete'},{operation:'advance',value:'gone'},{value:''}])assert.throws(()=>batchValues({...body,...patch}))
})
test('bulk advance is offered only for a common allowed next stage',()=>{
 const line={stage:'ordered',order:{status:'payment_received'}}
 assert.equal(commonNextStage([line,{...line}]),'in_transit')
 assert.equal(commonNextStage([line,{...line,stage:'prepared'}]),null)
 assert.equal(commonNextStage([line,{...line,order:{status:'cancelled'}}]),null)
 assert.equal(commonNextStage([]),null)
})
test('large stock reads cross page boundaries and never return a partial success',async()=>{
 const rows=Array.from({length:1001},(_,id)=>({id})),ranges=[]
 const result=await readAllRows(()=>({async range(a,b){ranges.push([a,b]);return {data:rows.slice(a,b+1)}}}))
 assert.equal(result.length,1001);assert.deepEqual(ranges.at(-1),[1000,1249])
 let calls=0
 const exact=await readAllRows(()=>({async range(a,b){calls++;assert.ok(a<500,'must not request an out-of-range page');return {data:rows.slice(a,b+1),count:500}}}))
 assert.equal(exact.length,500);assert.equal(calls,2)
 await assert.rejects(readAllRows(()=>({async range(a){return a?{error:Error('offline')}:{data:rows.slice(0,250)}}})),/offline/)
})
test('a usable DA requires both inherited or overridden prompts and an active background',()=>{
 const bg={content:'Face',content_back:'Dos'}
 assert.ok(directionReady({prompt_front:null,prompt_back:null},bg))
 assert.equal(directionReady({prompt_front:'',prompt_back:null},bg),false)
 assert.equal(directionReady({}, {...bg,archived_at:'2026-11-02'}),false)
 assert.equal(directionReady({},null),false)
})
const response=()=>({statusCode:200,setHeader(){},status(n){this.statusCode=n;return this},json(v){this.body=v;return this},end(){return this}})
test('stock users cannot access finance or restore accounts through the new endpoint',async()=>{
 const handler=workspaceHandler(async()=>({role:'stock',db:{},user:{id:'u'}}))
 for(const req of [{method:'GET',query:{view:'finance'}},{method:'GET',query:{view:'trash',kind:'vinted_accounts'}},{method:'PATCH',query:{},body:{action:'restore',kind:'vinted_accounts',id:'11111111-1111-4111-8111-111111111111'}}]){
  const res=response();await handler(req,res);assert.equal(res.statusCode,403)
 }
})
