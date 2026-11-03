import test from 'node:test'
import assert from 'node:assert/strict'
import {RuntimeMonitor,panelActivity,readDotbActivity} from './monitor.mjs'
import {FEATURES} from './dotb.mjs'
import {AdsPowerClient} from './adspower.mjs'
import {activityView} from '../../src/lib/adspowerStatus.js'

const panel=n=>({cards:FEATURES.map((f,i)=>({id:f.id,state:i<n?'running':'ready'}))})
const profile={id:'a',number:'78'},job={id:'job1',profile,state:'started',checked_at:1000,features:FEATURES.map(f=>f.id)}

test('current UI distinguishes active, paused, partial and missing Dotb pages',()=>{
  assert.equal(panelActivity([panel(4)]).status,'running')
  assert.equal(panelActivity([panel(2)]).status,'partial')
  assert.equal(panelActivity([panel(0)]).status,'paused')
  assert.equal(panelActivity([]).status,'page_closed')
  assert.equal(panelActivity([panel(4),panel(4)]).status,'unknown')
  assert.equal(panelActivity([{cards:[]}]).status,'unknown')
})

test('monitor detects page closure then browser closure without opening or relaunching anything',async()=>{
  let now=1000,connections=new Map([['a','ws://local']]),result=panelActivity([panel(4)]),inspections=0
  const client={openConnections:async()=>connections,start:()=>assert.fail('Must never reopen a closed profile')}
  const monitor=new RuntimeMonitor({getClient:()=>client,now:()=>now,inspect:async()=>{inspections++;return result}})
  const read=async()=>{now+=5000;await monitor.refresh([profile],[job]);return monitor.snapshot().runtime[0]}
  assert.equal((await read()).status,'running')
  result=panelActivity([]);assert.equal((await read()).status,'page_closed')
  connections=new Map();assert.equal((await read()).status,'closed');assert.equal(inspections,2)
  client.openConnections=async()=>{throw Error('API disconnected')}
  assert.equal((await read()).status,'unknown');assert.equal(monitor.snapshot().opened_ids,null)
})

test('read-only inspection never focuses, navigates, clicks or creates tabs',async()=>{
  let pagePresent=true,disconnected=0
  const page={url:()=> 'https://www.vinted.fr/my_orders'}
  const forbidden=()=>assert.fail('Monitoring must not change a page')
  const connect=async(address,options)=>{assert.equal(options.noDefaults,true);return {contexts:()=>[{pages:()=>pagePresent?[page]:[],newPage:forbidden}],close:async()=>{disconnected++}}}
  const createUI=async()=>({inspect:async()=>[{value:panel(4)}],close:async()=>{},click:forbidden})
  assert.equal((await readDotbActivity('ws://local',{connect,createUI})).status,'running')
  pagePresent=false;assert.equal((await readDotbActivity('ws://local',{connect,createUI})).status,'page_closed')
  assert.equal(disconnected,2)
})

test('overlapping polls share one scan and at most three read-only inspections run at once',async()=>{
  let now=1000,calls=0,active=0,max=0,release
  const held=new Promise(resolve=>{release=resolve})
  const profiles=Array.from({length:7},(_,i)=>({id:String(i)})),jobs=profiles.map(p=>({...job,profile:p}))
  const client={openConnections:async()=>{calls++;return new Map(profiles.map(p=>[p.id,'ws://local']))}}
  const monitor=new RuntimeMonitor({getClient:()=>client,now:()=>now,inspect:async()=>{active++;max=Math.max(max,active);await held;active--;return panelActivity([panel(4)])}})
  const a=monitor.refresh(profiles,jobs),b=monitor.refresh(profiles,jobs)
  assert.equal(a,b);await new Promise(resolve=>setImmediate(resolve));assert.equal(calls,1);assert.equal(max,3)
  release();await a;await monitor.refresh(profiles,jobs);assert.equal(calls,1);assert.equal(monitor.snapshot().runtime.length,7)
})

test('malformed AdsPower browser lists never imply that all profiles are closed',async()=>{
  const api=new AdsPowerClient({apiKey:'test',interval:0,wait:async()=>{},fetcher:async()=>({ok:true,json:async()=>({code:0,data:{}})})})
  await assert.rejects(api.openConnections(),/indisponible/)
})

test('the site replaces historical success with current closure and never shows stale green statuses',()=>{
  const now=10000,options={monitoring:true,opened:true,browserCheckedAt:now,now}
  const live={job_id:'job1',status:'running',checked_at:now,message:'Active'}
  assert.equal(activityView(job,live,options).label,'Dotb actif')
  assert.equal(activityView(job,{...live,status:'page_closed'},options).label,'Dotb fermé')
  assert.equal(activityView(job,live,{...options,opened:false}).label,'Profil fermé')
  assert.equal(activityView(job,live,{...options,now:now+25000}).state,'unknown')
  assert.equal(activityView({...job,id:'job2'},live,options).state,'unknown')
  assert.equal(activityView(job,null,{monitoring:false}).state,'unknown')
  assert.equal(activityView({...job,checked_at:12000},null,{...options,opened:false}).state,'unknown')
})
