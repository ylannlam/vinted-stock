import test from 'node:test'
import assert from 'node:assert/strict'
import {reschedulePublications} from './scalency-reschedule.js'
import {replacementWindow} from '../src/lib/publicationWindow.js'
import {lotProgress} from '../src/lib/lotProgress.js'

const now=Date.parse('2026-11-26T06:00:00Z')
const window={day:'2026-11-26',from:'08:00',to:'20:00'}
const jobs=[5,7,9].map(id=>({id,type:'publish',status:'queued',account_id:'a',not_before:null}))
const entries=jobs.map(({id})=>({id:String(id),previous:null}))
const body={kind:'job',account:'a',entries,window}
const run=(b,request)=>reschedulePublications({}, {id:'owner'}, b, async()=>{}, request, now)

test('un lot reçu est déplacé une seule fois, dans l’ordre affiché, avec les horaires confirmés',async()=>{
  const calls=[]
  const request=async(path,options)=>{
    calls.push([path,options])
    if(path==='jobs')return {data:[...jobs].reverse()}
    return {status:'scheduled',data:[{id:9,not_before:'2026-11-26T18:15:00Z'},
      {id:5,not_before:'2026-11-26T07:45:00Z',note:'Pause de nuit'}]}
  }
  const result=await run(body,request)
  assert.equal(calls.filter(([path])=>path==='jobs/schedule').length,1)
  const payload=calls[1][1].body
  assert.deepEqual(payload.job_ids,[5,7,9])
  assert.equal(payload.scheduled_at,'2026-11-26T07:00:00.000Z')
  assert.equal(payload.every_minutes,337)
  assert.deepEqual(result.rows.map(r=>r.id),['5','7','9'])
  assert.equal(result.rows[0].note,'Pause de nuit')
  assert.equal(result.rows[1].at,null)
})

test('un compte différent, une transmission commencée ou un conflit de date empêche tout envoi',async()=>{
  for(const change of [{account_id:'other'},{type:'delete'},{status:'running'},{sent_at:'2026-11-26T06:01:00Z'},{not_before:'2026-11-27T07:00:00Z'}]){
    await assert.rejects(run(body,async(path)=>{assert.equal(path,'jobs');return {data:[{...jobs[0],...change},...jobs.slice(1)]}}),/sélection a changé/i)
  }
  await assert.rejects(run({...body,window:{...window,day:'2026-11-27'}},async path=>{assert.equal(path,'jobs');return {data:jobs}}),/jour déjà réservé/)
})

test('un créneau local passe par la réservation du compte et ne touche pas à la file distante',async()=>{
  const id='655e4e79-1714-41ae-8996-dea0b1627215'
  const db={rpc:async(name,params)=>{
    assert.equal(name,'scalency_move_pending')
    assert.equal(params.p_owner,'owner')
    assert.equal(params.p_entries[0].at,'2026-11-27T07:00:00.000Z')
    return {data:null}
  }}
  const result=await reschedulePublications(db,{id:'owner'},{kind:'draft',account:'a',entries:[{id,version:2,previous:null}],
    window:{day:'2026-11-27',from:'08:00'}},assert.fail,assert.fail,now)
  assert.equal(result.rows[0].id,id)
  assert.throws(()=>replacementWindow({day:'2027-03-28',from:'02:15'},1,Date.parse('2027-03-27T12:00:00Z')),/n’existe pas/)
  assert.throws(()=>replacementWindow({...window,from:'06:00'},1,now),/à venir/)
  assert.equal(lotProgress({status:'queued',job:{status:'running'}}).group,'queue')
})
