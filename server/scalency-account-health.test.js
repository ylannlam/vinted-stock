import test from 'node:test'
import assert from 'node:assert/strict'
import {accountBlock,createHealthReader,requireListingAccount} from './scalency-account-health.js'

const now=Date.parse('2026-11-24T07:00:00Z'),end='2026-11-26T07:00:00.000Z'
const account=(agent={},extra={})=>({id:'demo',login:'boutique-test',linked:true,agent:{paused:null,paused_until:null,publication_pause:null,paused_actions:[],...agent},...extra})
const block=(agent,extra)=>accountBlock(account(agent,extra),now)
test('bannissement, restriction temporaire et pause ciblée ont des libellés distincts',()=>{
  assert.equal(block({paused:'account_banned'}).kind,'banned')
  assert.deepEqual(block({publication_pause:{reason:'restriction Vinted',until:end}}),{kind:'restricted',label:'Compte restreint',until:end})
  assert.equal(block({paused:'account_blocked'}).kind,'blocked')
  assert.equal(block({paused_actions:['publish']}).kind,'publication')
  assert.equal(block({publication_pause:true}).kind,'publication')
  assert.equal(block({}, {linked:false,status:'banned'}).kind,'banned')
})
test('repos, pause manuelle, limites et restrictions de messagerie autorisent la préparation',()=>{
  for(const agent of [{rest:true},{active:false},{paused:'captcha'},{manual_control:true},{paused:'night'},
    {paused_actions:['messages']},{paused:'messaging_restricted'},{publication_pause:{reason:'daily_quota'}},
    {paused_actions:[{action:'publish',reason:'manual'}]}]) assert.equal(block(agent),null)
})
test('une restriction levée ou expirée libère le compte',()=>{
  for(const pause of [false,{active:false,reason:'restricted'},{status:'cleared',code:'restriction'},
    {reason:'restriction levée'},{reason:'restricted',until:'2026-11-23T00:00:00Z'},'2026-11-23T00:00:00Z']){
    assert.equal(block({publication_pause:pause}),null)
  }
  assert.equal(block({paused:'restricted',paused_until:'2026-11-23T00:00:00Z'}),null)
  assert.equal(block({}, {linked:false,agent:null}).kind,'unlinked')
  assert.equal(block({}, {agent:null}).kind,'unknown')
})
test('toutes les pages sont lues une seule fois pour plusieurs préparations et la levée est relue',async()=>{
  let stamp=now,restricted=true,calls=0
  const read=createHealthReader(async(path,{query})=>{
    calls++;assert.equal(path,'accounts')
    if(!query.cursor)return {data:[account({}, {id:'autre'})],has_more:true,next_cursor:'suite'}
    return {data:[account({paused:restricted?'vinted_restriction':null})],has_more:false}
  },()=>stamp)
  const [a,b]=await Promise.all([read(),read()]);assert.equal(a,b);assert.equal(calls,2)
  await assert.rejects(requireListingAccount('demo',read),{status:423})
  await requireListingAccount('autre',read);assert.equal(calls,2)
  restricted=false;stamp+=31000;await requireListingAccount('demo',read);assert.equal(calls,4)
})
test('une panne ou une page manquante empêche tout feu vert à partir du cache expiré',async()=>{
  let stamp=now,failed=false
  const read=createHealthReader(async()=>failed?{data:[],has_more:true}:{data:[account()]},()=>stamp)
  await requireListingAccount('demo',read)
  failed=true;stamp+=31000
  await assert.rejects(requireListingAccount('demo',read),{status:503})
  failed=false;await requireListingAccount('demo',read)
  await assert.rejects(requireListingAccount('absent',read),{status:409})
  await assert.rejects(requireListingAccount('demo',async()=>({accounts:[{id:'demo',block:{kind:'unknown'}}]})),{status:503})
})
