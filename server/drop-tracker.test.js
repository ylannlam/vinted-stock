import test from 'node:test'
import assert from 'node:assert/strict'
import { validateTracker } from './drop-tracker.js'
import handler from '../api/drop-tracker.js'
const base=()=>({accounts:[],expenses:[],settings:{budget:100}})
test('backup round-trip preserves budget and accounting',()=>{
 const data=base();data.expenses.push({id:'e1',date:'2026-10-30',type:'out',cat:'Outils',label:'Test',amount:12.50})
 assert.deepEqual(validateTracker(data),data)
})
test('reject invalid imported IDs, amounts and calendar dates',()=>{
 for(const patch of [{id:'"><script>'},{amount:-5},{amount:Infinity},{date:'2026-02-30'}]) {
 const data=base();data.expenses=[{id:'e1',date:'2026-10-30',type:'out',cat:'Outils',label:'Test',amount:1,...patch}]
 assert.throws(()=>validateTracker(data))
 }
})
test('reject duplicate rows and unknown account stages',()=>{
 const data=base();const a={id:'a1',pseudo:'Test',email:'',phone:'',browser:'',createdAt:0,nextAt:null,notes:'',stage:'ready'}
 data.accounts=[a,a];assert.throws(()=>validateTracker(data))
 data.accounts=[{...a,stage:'unknown'}];assert.throws(()=>validateTracker(data))
})
test('API refuses unauthenticated reads and writes',async()=>{
 for(const method of ['GET','PUT']) {
 const res={setHeader(){},status(n){this.code=n;return this},json(body){this.body=body;return this}}
 await handler({method,headers:{},body:{payload:base(),revision:0}},res)
 assert.equal(res.code,401)
 }
})
