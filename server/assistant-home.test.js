import test from 'node:test'
import assert from 'node:assert/strict'
import {readHome,managedAccounts,profileFor,launchBlock,launchAssistant,companionCurrent} from '../src/lib/assistantHome.js'

test('home shows selected accounts and active sessions, not every enabled account',()=>{
 const accounts=Array.from({length:72},(_,i)=>({id:String(i),settings:{enabled:true}}))
 assert.deepEqual(managedAccounts(accounts,['42'],[]).map(a=>a.id),['42'])
 assert.deepEqual(new Set(managedAccounts(accounts,['42'],[{account_id:'76',state:'review'},{account_id:'3',state:'running'}]).map(a=>a.id)),new Set(['42','3']))
 assert.equal(profileFor('42',{'42':'profile42'},[{account_id:'42',profile_id:'other'}]),'profile42')
 const saved={ids:['42'],selected:'42',bindings:{'42':'profile42'}}
 assert.deepEqual(readHome({getItem:()=>JSON.stringify(saved)}),saved)
 assert.equal(readHome({getItem(){throw Error('storage blocked')}}),null)
})

test('a single home action resumes only its account before pairing and starting',async()=>{
 const calls=[],account={id:'42',settings:{paused:true}}
 await launchAssistant({account,profile:'profile42',request:async(route,body)=>{calls.push([route,body]);return route==='/state'?{version:'1.8.12',assistants:[]}:{assistants:[]}},resume:async body=>calls.push(['resume',body]),pair:async(_method,body)=>{calls.push(['pair',body]);return {...body,token:'scoped-token'}}})
 assert.deepEqual(calls.map(x=>x[0]),['/state','resume','pair','/ylavint/start'])
 assert.equal(calls[1][1].account_id,'42');assert.equal(calls[3][1].profile_id,'profile42')
})

test('failed resume, another live session, or an outdated connector cannot start work',async()=>{
 const account={id:'42',settings:{paused:true}},base={account,profile:'profile42',pair:async()=>assert.fail('no pairing'),resume:async()=>{throw Error('resume refused')}}
 await assert.rejects(launchAssistant({...base,request:async()=>({version:'1.8.12',assistants:[]})}),/resume refused/)
 await assert.rejects(launchAssistant({...base,request:async()=>({version:'1.8.12',assistants:[{account_id:'7',state:'waiting'}]})}),/déjà ouverte/)
 await assert.rejects(launchAssistant({...base,request:async()=>({version:'1.8.3',assistants:[]})}),/Mets à jour/)
 assert.ok(companionCurrent('1.9.0'));assert.ok(!companionCurrent('garbage'))
})

test('checking a paused account never resumes it and carries the no-send mode',async()=>{
 let body
 await launchAssistant({account:{id:'42',settings:{paused:true}},profile:'p42',checkOnly:true,resume:()=>assert.fail('no resume'),pair:async()=>({account_id:'42'}),request:async(route,input)=>{if(route==='/state')return {version:'1.8.12',assistants:[]};body=input;return {assistants:[]}}})
 assert.equal(body.check_only,true);assert.equal(body.account_id,'42')
 assert.match(launchBlock({id:'42',settings:{enabled:true,messaging:{executor:'desktop'}}},'p42',[{id:'p42'}],[{account_id:'9',state:'break'}],true),/autre session/)
})
