import test from 'node:test'
import assert from 'node:assert/strict'
import vm from 'node:vm'
import {readFileSync} from 'node:fs'
function worker(response){
 const data={},timers=[],alarms=[],listeners={},event=k=>({addListener:fn=>listeners[k]=fn})
 let polls=0
 const chrome={runtime:{getManifest:()=>({version:'3.5.0'}),onInstalled:event('installed'),onStartup:event('startup'),onMessage:event('message')},
  alarms:{create:(...args)=>alarms.push(args),onAlarm:event('alarm')},storage:{onChanged:event('storage'),local:{get:async keys=>typeof keys==='string'?{[keys]:data[keys]}:data,set:async p=>Object.assign(data,p)}},
  action:{setBadgeText:async()=>{},setBadgeBackgroundColor:async()=>{}},tabs:{query:async()=>[{id:1,status:'complete'}],sendMessage:async(_,m)=>m.type==='identity'?{member_id:'7',status:'ok'}:{ok:true,result:{}}}}
 const ctx=vm.createContext({chrome,Date,console,URL,setTimeout:(fn,ms)=>{timers.push(ms);return timers.length},clearTimeout:()=>{},fetch:async(_,opts)=>{const a=JSON.parse(opts.body).action;if(a==='agent_poll')polls++;return {ok:true,json:async()=>a==='agent_poll'?response:{}}}})
 vm.runInContext(readFileSync(new URL('../extensions/ylavint/worker.js',import.meta.url),'utf8').replace("import {SITE, TOKEN} from './config.js'","const SITE='https://example.test',TOKEN='test'")+ '\nglobalThis.testTick=tick;',ctx)
 return {data,timers,alarms,listeners,tick:()=>ctx.testTick(),polls:()=>polls}
}
test('worker follows a ten-second server delay, with a thirty-second wake-up backup',async()=>{
 const w=worker({state:'idle',wait_seconds:10});w.listeners.installed();await w.tick()
 assert.equal(w.alarms.find(a=>a[0]==='agent')[1].periodInMinutes,.5)
 assert.ok(w.timers.at(-1)>=9900&&w.timers.at(-1)<=10000)
 await w.tick();assert.equal(w.polls(),1)
})
test('worker advances one second after a task and serializes simultaneous wake-ups',async()=>{
 const w=worker({state:'task',task:{id:'one',kind:'sync_inbox'}})
 await Promise.all([w.tick(),w.tick()])
 assert.equal(w.polls(),1);assert.equal(w.timers.at(-1),1000)
})
