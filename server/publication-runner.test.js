import test from 'node:test'
import assert from 'node:assert/strict'
import {startPlanSend,resumeSend,cancelSchedules,stopRunner,getRunnerState,subscribeRunner,resetRunner} from '../src/lib/publicationRunner.js'

const item=(n,extra={})=>({id:`i${n}`,version:1,title:`Robe ${n}`,at:Date.now()+3600000*n,...extra})
const steps=[]
function api(over={}){
  return async(method,body)=>{
    steps.push(body.action)
    if(over[body.action])return over[body.action](body)
    if(body.action==='plan')return {results:body.items.map(i=>({id:i.id,ok:true,state:'preparing',message:'',version:2}))}
    if(body.action==='step')return {draft:{state:'scheduled',message:'ok',last_error:null,version:3}}
    return {}
  }
}

test('the send keeps going without any screen mounted and reports progress to whoever listens',async()=>{
  resetRunner();steps.length=0
  const seen=[];const off=subscribeRunner(()=>seen.push(getRunnerState().progress?.phase||(getRunnerState().running?'run':'idle')))
  const done=startPlanSend({request:api(),items:[item(1),item(2)],mode:'live',step:0})
  assert.equal(getRunnerState().running,true)
  assert.equal(await startPlanSend({request:api(),items:[item(9)],mode:'live',step:0}),false,'a second send cannot start while one runs')
  await done;off()
  const state=getRunnerState()
  assert.equal(state.running,false);assert.equal(state.finished,1)
  assert.match(state.notice,/2 annonces programmées chez Dotb/)
  assert.deepEqual(steps,['plan','step','step'])
  assert.ok(seen.includes('reserve')&&seen.includes('dotb'))
})

test('refused or blocked listings are listed for review, and a Dotb limit pauses instead of failing',async()=>{
  resetRunner()
  const request=api({
    plan:body=>({results:body.items.map(i=>i.id==='i1'?{id:i.id,ok:false,error:'Fiche modifiée'}:{id:i.id,ok:true,state:'preparing',version:2})}),
    step:body=>body.id==='i3'?{draft:{state:'attention',message:'Photos refusées',version:4}}:{draft:{state:'scheduled',version:3}}
  })
  await startPlanSend({request,items:[item(1),item(2),item(3)],mode:'live',step:0})
  const {failures,notice}=getRunnerState()
  assert.deepEqual(failures.map(f=>f.id).sort(),['i1','i3'])
  assert.match(notice,/1 annonce programmée chez Dotb\. 2 à revoir/)
})

test('stopping lets the current step finish and keeps the rest in the queue',async()=>{
  resetRunner()
  let calls=0
  const request=api({step:()=>{calls++;stopRunner();return {draft:{state:'scheduled',version:3}}}})
  await startPlanSend({request,items:[item(1),item(2),item(3)],mode:'live',step:0})
  assert.equal(calls,1)
  assert.match(getRunnerState().notice,/Envoi arrêté\. 1 annonce programmée ;/)
})

test('a failing reservation call ends with a clear error and the runner is free again',async()=>{
  resetRunner()
  await startPlanSend({request:async()=>{throw new Error('Réseau coupé')},items:[item(1)],mode:'live',step:0})
  assert.equal(getRunnerState().error,'Réseau coupé');assert.equal(getRunnerState().running,false)
  assert.equal(await resumeSend({request:api(),rows:[],step:0}),false,'nothing to resume')
})

test('resume and cancel use the same runner and count what was really processed',async()=>{
  resetRunner()
  await resumeSend({request:api(),rows:[{id:'r1',title:'A'},{id:'r2',title:'B'}],step:0})
  assert.equal(getRunnerState().notice,'Envoi terminé.')
  const request=api({unschedule:body=>{if(body.id==='c2')throw new Error('Trop tard');return {}}})
  await cancelSchedules({request,rows:[{id:'c1',title:'A',version:1},{id:'c2',title:'B',version:1}]})
  const s=getRunnerState()
  assert.match(s.notice,/1 programmation annulée/);assert.equal(s.failures[0].error,'Trop tard')
})
