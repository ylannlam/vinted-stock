import test from 'node:test'
import assert from 'node:assert/strict'
import {randomUUID} from 'node:crypto'
import {consumeLotTicket,lotKey,runLotEntry,variantKey} from './scalency-lots.js'
import {ScalencyError} from './scalency-api.js'
import {lotProgress} from '../src/lib/lotProgress.js'
import {lotSchedule} from '../src/lib/lotSchedule.js'

test('dix horaires de Paris sont répartis entre 8 h et 20 h, en hiver et en été',()=>{
  for(const [day,utcHour] of [['2026-11-26',7],['2027-06-01',6]]){
    const window={day,from:'08:00',to:'20:00'}
    const {times,end}=lotSchedule(window,10)
    assert.equal(times.length,10)
    assert.equal(new Date(times[0]).getUTCHours(),utcHour)
    assert.equal(Date.parse(times[1])-Date.parse(times[0]),75*60000)
    assert.equal(Date.parse(end)-Date.parse(times[9]),45*60000)
    assert.equal(lotSchedule(window,1).times[0],times[0])
    const entries=[{id:randomUUID(),version:1},{id:randomUUID(),version:1}]
    assert.notEqual(lotKey('u','a',entries),lotKey('u','a',entries,window))
    assert.notEqual(lotKey('u','a',entries,window),lotKey('u','a',[...entries].reverse(),window))
  }
  assert.throws(()=>lotSchedule({day:'2027-03-28',from:'02:30',to:'06:00'},2))
  assert.throws(()=>lotSchedule({day:'2026-11-26',from:'08:00',to:'08:02'},3))
  assert.throws(()=>lotSchedule({day:'2026-11-26',from:'20:00',to:'08:00'},1))
})

test('un double clic sur le même lot de dix versions donne le même identifiant',()=>{
  const entries=Array.from({length:10},()=>({id:randomUUID(),version:3}))
  const id=lotKey('u','a',entries)
  assert.equal(lotKey('u','a',[...entries].reverse()),id)
  assert.notEqual(lotKey('u','b',entries),id)
  assert.notEqual(lotKey('u','a',[{...entries[0],version:4},...entries.slice(1)]),id)
  assert.throws(()=>lotKey('u','a',[entries[0],entries[0]]))
  assert.notEqual(variantKey('sz42','M'),variantKey('sz42','XL'))
  assert.equal(variantKey('sz42','xl'),variantKey('sz42','XL'))
})
test('un refus de quota reprend le même article après le délai demandé',async()=>{
  const writes=[],receipts=[]
  const worker={prepare:async()=>({sku:'robe'}),authorizeSend:async()=>true,
    publish:async p=>{writes.push(p.sku);if(writes.length===1)throw Object.assign(new ScalencyError('quota',429),{retryAfterSeconds:34});return {job:{id:52}}},
    finish:async(...args)=>receipts.push(args)}
  await runLotEntry(worker);await runLotEntry(worker)
  assert.deepEqual(receipts.map(([state,,delay,id])=>[state,delay,id]),[['pending',34,undefined],['queued',0,'52']])
})
test('un ticket arrivé après la fin du créneau rend le brouillon sans envoi',async()=>{
  const writes=[]
  const claim={
    update(){return this},eq(){return this},gt(){return this},select(){return this},
    async maybeSingle(){return {data:{attempts:0,window_end:'2000-01-01T20:00:00Z'}}}
  }
  const db={from:()=>claim,async rpc(name,args){writes.push([name,args]);return {data:true}}}
  await consumeLotTicket(db,{id:randomUUID(),ticket:randomUUID()},assert.fail,assert.fail)
  assert.equal(writes.length,1)
  assert.equal(writes[0][1].p_status,'failed')
  assert.match(writes[0][1].p_message,/Créneau terminé/)
})
test('une réponse perdue reste à vérifier et une validation refusée est corrigeable',async()=>{
  const base={prepare:async()=>({}),authorizeSend:async()=>true,publish:async()=>{throw Error('timeout')}}
  const results=[]
  const finish=async state=>results.push(state)
  await runLotEntry({...base,finish})
  await runLotEntry({...base,finish,prepare:async()=>{throw new ScalencyError('taille manquante',409)},publish:assert.fail})
  await runLotEntry({...base,finish,authorizeSend:async()=>false,publish:assert.fail})
  assert.deepEqual(results,['uncertain','failed'])
  let sent=0
  await assert.rejects(runLotEntry({...base,publish:async()=>{sent++;return {job:{id:42}}},finish:async()=>{throw Error('base indisponible')}}))
  assert.equal(sent,1)
})
test('les statuts distinguent réception, publication confirmée et vérification',()=>{
  assert.equal(lotProgress({status:'queued'}).group,'queue')
  assert.equal(lotProgress({status:'queued',job:{status:'done'}}).group,'check')
  assert.equal(lotProgress({status:'queued',job:{status:'done',new_item_id:'72'}}).group,'live')
  assert.equal(lotProgress({status:'failed',message:'taille'}).detail,'taille')
})
