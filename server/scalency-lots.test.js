import test from 'node:test'
import assert from 'node:assert/strict'
import {randomUUID} from 'node:crypto'
import {lotKey,runLotEntry,variantKey} from './scalency-lots.js'
import {ScalencyError} from './scalency-api.js'
import {lotProgress} from '../src/lib/lotProgress.js'

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
