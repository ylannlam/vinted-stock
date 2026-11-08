import test from 'node:test'
import assert from 'node:assert/strict'
import {agentProgress} from './vinted-agent.js'
const id=()=>crypto.randomUUID()
function setup(){
 const task={id:id(),lease:id(),kind:'publish_item',state:'running',account_id:id(),lease_until:new Date(Date.now()+600000).toISOString(),payload:{listing:{assisted:true}},result:null}
 const account={id:task.account_id,vinted_id:'7'},tables={vinted_agent_tasks:[task],publication_accounts:[account]}
 const db={from(table){let predicates=[],patch;const q={select(){return q},eq(k,v){predicates.push(r=>(r[k]&&typeof r[k]==='object'?JSON.stringify(r[k]):r[k])===v);return q},is(k,v){return q.eq(k,v)},gt(k,v){predicates.push(r=>r[k]>v);return q},update(v){patch=v;return q},async maybeSingle(){const row=tables[table].find(r=>predicates.every(p=>p(r)));if(row&&patch)Object.assign(row,patch);return {data:row?structuredClone(row):null,error:null}}};return q}}
 const body={task_id:task.id,lease:task.lease,member_id:'7',progress:{seq:1,steps:[{name:'Photos',status:'running'}]}}
 return {db,task,body,account}
}
test('progress is lease-bound, ordered, timestamped and cannot change task state',async()=>{
 const {db,task,body}=setup()
 assert.deepEqual(await agentProgress(db,{},body),{saved:true})
 assert.equal(task.state,'running');assert.equal(task.result.progress.steps[0].status,'running');assert.ok(task.result.progress.at)
 assert.deepEqual(await agentProgress(db,{},body),{saved:false})
 body.progress={seq:2,steps:[{name:'Photos',status:'done'}]}
 assert.deepEqual(await agentProgress(db,{},body),{saved:true});assert.equal(task.result.progress.seq,2)
})
test('wrong account, expired lease, terminal task, legacy job and malformed progress are rejected',async()=>{
 for(const mode of ['account','lease','expired','done','legacy','invalid']){
  const {db,task,body,account}=setup()
  if(mode==='account')account.id=id()
  if(mode==='lease')body.lease=id()
  if(mode==='expired')task.lease_until=new Date(0).toISOString()
  if(mode==='done')task.state='done'
  if(mode==='legacy')task.payload.listing.assisted=false
  if(mode==='invalid')body.progress.steps[0].status='published'
  await assert.rejects(agentProgress(db,{},body),undefined,mode);assert.equal(task.result,null)
 }
})
