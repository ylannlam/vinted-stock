import test from 'node:test'
import assert from 'node:assert/strict'
import {runPublicationBatch} from '../src/lib/publicationBatch.js'
const account=(id,bridge=true)=>({id,login:id,source_present:true,bridge_connected:bridge})
test('refresh all deduplicates accounts, completes pagination, respects spacing and continues after individual failures',async()=>{
  let clock=0,reads=0,pages=0
  const calls=[],progress=[]
  const result=await runPublicationBatch([account('a'),account('a'),account('offline',false),account('error')],{
    now:()=>clock,wait:async ms=>{clock+=ms},onProgress:p=>progress.push(p),onPage:async()=>{pages++},
    request:async(action,query,body)=>{
      calls.push({time:clock,...body});assert.equal(action,'publication-sync')
      if(body.account_id==='error')throw Error('Source indisponible')
      if(++reads===1)return {waiting:true}
      return {synced:true,complete:reads===3}
    }
  })
  assert.deepEqual(calls.map(c=>c.time),[0,10000,20000,30000])
  assert.deepEqual(calls.map(c=>c.force),[true,true,false,true])
  assert.equal(pages,2);assert.equal(result.total,3);assert.equal(result.done,3)
  assert.equal(result.updated,1);assert.equal(result.offline,1);assert.equal(result.failed,1)
  assert.equal(result.running,false);assert.equal(result.issues.length,2)
  assert.equal(progress[0].done,0);assert.equal(progress.at(-1).done,3)
})
test('an occupied account is retried within a bounded window and never reported as refreshed',async()=>{
  let clock=0,calls=0
  const result=await runPublicationBatch([account('a')],{now:()=>clock,wait:async ms=>{clock+=ms},request:async()=>{calls++;return {waiting:true}}})
  assert.equal(calls,7);assert.equal(clock,60000);assert.equal(result.updated,0);assert.equal(result.failed,1)
})
test('stopping a batch preserves finished work and does not start another account',async()=>{
  const controller=new AbortController(),calls=[]
  const result=await runPublicationBatch([account('a'),account('b')],{signal:controller.signal,
    request:async(action,query,body)=>{calls.push(body.account_id);return {synced:true,complete:true}},onPage:async()=>controller.abort()})
  assert.deepEqual(calls,['a']);assert.equal(result.updated,1);assert.equal(result.done,1);assert.equal(result.cancelled,true)
})
test('cancellation interrupts the spacing delay and leaves partial pages resumable',async()=>{
  const controller=new AbortController();let calls=0
  const result=await runPublicationBatch([account('a')],{signal:controller.signal,request:async()=>{calls++;return {synced:true,complete:false}},onPage:async()=>controller.abort()})
  assert.equal(calls,1);assert.equal(result.updated,0);assert.equal(result.done,0);assert.equal(result.cancelled,true)
})
test('unknown replies and disconnected accounts cannot count as successful refreshes',async()=>{
  const result=await runPublicationBatch([account('a'),account('offline',false)],{request:async()=>({})})
  assert.equal(result.updated,0);assert.equal(result.failed,1);assert.equal(result.offline,1);assert.equal(result.done,2)
})
