import test from 'node:test'
import assert from 'node:assert/strict'
import {budgetTotals,mergeExpenses} from '../src/lib/budget.js'
import {nextCreationStep,accountDeadline,initialCreation,readyWithoutTracking} from '../src/lib/accountTracking.js'

test('legacy accounts can be marked ready without bypassing isolation or blocked states',()=>{
 const a={creation_stage:null,statut:'en_preparation',is_ready:false}
 assert.deepEqual(readyWithoutTracking(a),{creation_stage:'ready',creation_next_at:null,is_ready:true,statut:'actif'})
 for(const patch of [{creation_stage:'post1'},{creation_stage:'post2'},{creation_stage:'wait'},{is_shadowbanned:true},{statut:'banni_temp'},{statut:'banni_def'},{statut:'suspendu'},{is_ready:true}])assert.equal(readyWithoutTracking({...a,...patch}),null)
})
test('budget uses cents and handles arbitrary categories',()=>{
 const rows=[{type:'out',cat:'__proto__',amount:0.1},{type:'out',cat:'__proto__',amount:0.2},{type:'in',cat:'Ventes',amount:1}]
 const t=budgetTotals(rows);assert.equal(t.expenses,0.3);assert.equal(t.balance,0.7);assert.equal(t.categories[0].amount,0.3)
})

test('phone preparation keeps reminders but accepts manual completion before them',()=>{
 const start=Date.parse('2026-10-30T08:00:00Z')
 let a=initialCreation(start)
 assert.equal(a.creation_next_at,'2026-10-30T10:00:00.000Z')
 assert.equal(a.is_ready,false)
 assert.equal(nextCreationStep(a,start+3600000).creation_stage,'post2')
 a={...a,...nextCreationStep(a,start+7200000)}
 assert.equal(a.creation_stage,'post2')
 assert.equal(a.creation_next_at,'2026-10-31T10:00:00.000Z')
 assert.equal(nextCreationStep(a,start+7200001).creation_stage,'wait')
 a={...a,...nextCreationStep(a,Date.parse(a.creation_next_at))}
 assert.equal(a.creation_stage,'wait')
 assert.equal(a.creation_next_at,'2026-11-01T10:00:00.000Z')
 assert.equal(nextCreationStep({...a,is_shadowbanned:true},Date.parse(a.creation_next_at)),null)
 a={...a,...nextCreationStep(a,Date.parse(a.creation_next_at))}
 assert.equal(a.is_ready,true)
 assert.equal(a.creation_stage,'ready')
 assert.equal(a.statut,'actif')
 assert.equal(a.creation_next_at,null)
})
test('import is idempotent and rejects conflicting operations',()=>{
 const row={id:'1',date:'2026-10-30',type:'out',cat:'A',label:'',amount:5}
 assert.equal(mergeExpenses([row],[row]).length,1)
 assert.throws(()=>mergeExpenses([row],[{...row,amount:6}]))
})
test('creation steps schedule 24 hours and blocked accounts cannot advance',()=>{
 assert.equal(nextCreationStep({creation_stage:'post1',statut:'en_preparation'},0).creation_next_at,'1970-01-02T00:00:00.000Z')
 assert.equal(nextCreationStep({creation_stage:'wait',statut:'en_preparation'},0).is_ready,true)
 assert.equal(nextCreationStep({creation_stage:'post1',statut:'suspendu'}),null)
 assert.equal(accountDeadline({creation_stage:'wait',creation_next_at:'2026-01-01'},Date.now()),'Délai écoulé · à vérifier')
})
