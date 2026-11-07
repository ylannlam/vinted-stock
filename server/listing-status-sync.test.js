import test from 'node:test'
import assert from 'node:assert/strict'
import {syncListingStatuses} from '../src/lib/listingStatusSync.js'

test('status sync only checks pending sends, keeps true drafts and continues after errors',async()=>{
 const rows=[{id:'live',state:'scheduled',dotb_item_id:'r1'},{id:'live',state:'scheduled',dotb_item_id:'r1'},{id:'failed',state:'attention',dotb_item_id:'r2'},{id:'draft',state:'scheduled',dotb_item_id:'r3'},{id:'done',state:'published',dotb_item_id:'r4'},{id:'local',state:'draft'}]
 const calls=[],accepted=[],errors=[]
 const changed=await syncListingStatuses(rows,async(method,body)=>{
  calls.push([method,body]);if(body.id==='failed')throw Error('Dotb indisponible')
  return {draft:{id:body.id,state:body.id==='draft'?'vinted_draft':'published'}}
 },{onDraft:d=>accepted.push(d),onError:(row,e)=>errors.push([row.id,e.message])})
 assert.equal(changed,true)
 assert.deepEqual(calls.map(c=>c[1]),['live','failed','draft'].map(id=>({action:'refresh',id})))
 assert.deepEqual(accepted.map(d=>d.state),['published','vinted_draft'])
 assert.deepEqual(errors,[['failed','Dotb indisponible']])
})
test('unmount prevents late results and further checks; another listing result is rejected',async()=>{
 let active=true,calls=0,accepted=0
 await syncListingStatuses([{id:'a',state:'scheduled',dotb_item_id:'a'},{id:'b',state:'scheduled',dotb_item_id:'b'}],async()=>{calls++;active=false;return {draft:{id:'a',state:'published'}}},{active:()=>active,onDraft:()=>accepted++})
 assert.equal(calls,1);assert.equal(accepted,0)
 let error=''
 await syncListingStatuses([{id:'a',state:'scheduled',dotb_item_id:'a'}],async()=>({draft:{id:'wrong',state:'published'}}),{onError:(_r,e)=>error=e.message,onDraft:()=>accepted++})
 assert.match(error,/correspond pas/);assert.equal(accepted,0)
})
