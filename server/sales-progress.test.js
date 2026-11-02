import test from 'node:test'
import assert from 'node:assert/strict'
import {collectionProgress} from '../src/lib/collector.js'
import {newestSalesFirst,saleDateLabel} from '../src/lib/salesOrder.js'

const now=Date.parse('2026-11-02T15:00:00Z')
const browser={connected:true,enabled:true,phase:'extract',lastContactAt:now,job:{id:'one'}}
test('progress counts successful retrievals and does not turn failed jobs into 100 percent',()=>{
 const counts={total:8,completed:3,queued:3,running:1,review:1}
 const state=collectionProgress(counts,browser,[],'',now)
 assert.equal(state.percent,37);assert.equal(state.working,true);assert.match(state.detail,/1 à vérifier/)
 assert.equal(collectionProgress({...counts,completed:999,total:1000},browser,[],'',now).percent,99)
 assert.equal(collectionProgress({total:3,completed:3},null,[],'',now).percent,100)
 assert.equal(collectionProgress({total:0},null,[],'',now).percent,0)
 assert.equal(collectionProgress(counts,browser,[],'network error',now).percent,null)
})
test('a paused, blocked or disconnected extension never animates as working',()=>{
 const counts={total:2,completed:1,running:1}
 for(const state of [null,{...browser,enabled:false},{...browser,phase:'blocked'},{...browser,lastContactAt:now-180000}]){
  const result=collectionProgress(counts,state,[],'',now)
  assert.equal(result.working,false);assert.equal(result.tone,'warning');assert.equal(result.percent,50)
 }
})
test('sales use sale date, not import time, preparation stage or shipping deadline',()=>{
 const rows=[{id:'old',sale_date:'2026-11-01',updated_at:'2026-11-03',order:{deadline:'2026-11-02'}},{id:'missing'},{id:'new',sale_date:'2026-11-02',stage:'shipped'},{id:'middle',order:{order_date:'2026-11-01T23:00:00Z'}},{id:'invalid',sale_date:'bad'}]
 assert.deepEqual(rows.sort(newestSalesFirst).map(r=>r.id),['new','middle','old','missing','invalid'])
 assert.match(saleDateLabel('2026-11-02T14:00:00Z'),/15:00/)
})
