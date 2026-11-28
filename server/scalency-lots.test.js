import test from 'node:test'
import assert from 'node:assert/strict'
import {randomUUID} from 'node:crypto'
import {canTransmitEntry,consumeLotTicket,lotKey,runLotEntry,transmitPublicationLot,variantKey} from './scalency-lots.js'
import {transferConfirmedLot} from '../src/lib/lotTransfer.js'
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

test('une confirmation transmet le créneau réservé à la file API et conserve le reçu Scalency',async t=>{
  const ticket=randomUUID(),id=randomUUID(),draft=randomUUID(),lot='a'.repeat(64),owner=randomUUID()
  const scheduled=new Date(Date.now()+86400000).toISOString(),account='test-account'
  const entry={id,lot_id:lot,draft_id:draft,reviewed_version:2,attempts:0,scheduled_for:scheduled,
    window_end:new Date(Date.now()+90000000).toISOString(),next_attempt:scheduled,status:'pending',job_id:null,token:ticket}
  const tables={scalency_publication_lots:[{id:lot,owner_id:owner,account}],scalency_lot_entries:[entry],
    profiles:[{id:owner,role:'admin'}],listing_drafts:[{id:draft,owner_id:owner,version:3,state:'preparing',fields:{account_id:account},photos:['image'],payload:{batch:{status:'ready'}}}]}
  const db={from(table){
    let matches=tables[table].slice(),changes=null
    function filter(fn){matches=matches.filter(fn);return builder}
    function read(){for(const row of matches)Object.assign(row,changes);return matches.map(r=>({...r}))}
    const builder={select(){return this},order(){return this},update(values){changes=values;return this},
      eq(k,v){return filter(r=>(k==='payload->>scalency_job_id'?r.payload.scalency_job_id:r[k])===v)},
      gt(k,v){return filter(r=>r[k]>v)},is(k,v){return this.eq(k,v)},
      single(){return this.maybeSingle()},async maybeSingle(){return {data:read()[0]||null}},
      then(resolve){return resolve({data:read()})}}
    return builder
  },async rpc(name,params){
    assert.equal(name,'scalency_finish_lot_entry');assert.equal(params.p_status,'queued')
    assert.equal(params.p_token,entry.token);assert.equal(entry.status,'sending')
    Object.assign(entry,{status:'queued',job_id:params.p_job});const row=tables.listing_drafts[0]
    row.version++;row.state='scheduled';row.payload.scalency_job_id=params.p_job
    return {data:true}
  }}
  const calls=[],records=[]
  const previous=process.env.SCALENCY_API_KEY
  process.env.SCALENCY_API_KEY='test-only'
  t.after(()=>{if(previous===undefined)delete process.env.SCALENCY_API_KEY;else process.env.SCALENCY_API_KEY=previous})
  t.mock.method(globalThis,'fetch',async(url,opts)=>{
    assert.equal(url.pathname,'/api/pub/public_api/v1/items')
    assert.equal(opts.method,'POST')
    calls.push(JSON.parse(opts.body))
    return Response.json({job:{id:42,account_id:account,not_before:scheduled}})
  })
  const prepare=async(_db,row,options)=>{
    assert.deepEqual(options,{quick:true,schedule:scheduled})
    return {payload:{account_id:row.fields.account_id,scheduled_at:options.schedule}}
  }
  const save=async(_db,kind,jobs)=>records.push([kind,jobs[0].id])
  await assert.rejects(transmitPublicationLot(db,{id:'other'},lot,prepare,save),/introuvable/)
  for(let i=0;i<2;i++)assert.deepEqual(await transmitPublicationLot(db,{id:owner},lot,prepare,save),{total:1,received:1,more:false})
  assert.deepEqual(calls,[{account_id:account,scheduled_at:scheduled}])
  assert.deepEqual(records,[['jobs',42]]);assert.equal(tables.listing_drafts[0].scheduled_at,scheduled)
})

test('un lot reprend uniquement le travail disponible et affiche le nombre exact de réceptions',async()=>{
  const future=new Date(Date.now()+3600000).toISOString(),past=new Date(0).toISOString()
  for(const status of ['queued','sending','uncertain','stopped','failed'])assert.equal(canTransmitEntry({status,lease_until:past}),false)
  assert.equal(canTransmitEntry({status:'working',lease_until:future}),false)
  assert.equal(canTransmitEntry({status:'dispatched',lease_until:past}),true)
  assert.equal(canTransmitEntry({status:'pending',attempts:1,next_attempt:future}),false)
  assert.equal(canTransmitEntry({status:'pending',attempts:0,next_attempt:future}),true)
  assert.equal(canTransmitEntry({status:'pending',attempts:0,job_id:'42'}),false)
  const receipts=[{total:3,received:1,more:true},{total:3,received:2,more:true},{total:3,received:2,more:false}],seen=[]
  const final=await transferConfirmedLot('lot',async(action,{lot})=>{
    assert.equal(action,'transmit-lot');assert.equal(lot,'lot');return receipts[seen.length]
  },state=>seen.push(state))
  assert.deepEqual(seen,receipts);assert.equal(final.received,2)
})
