import test from 'node:test'
import assert from 'node:assert/strict'
import {walletSlot,walletDue} from '../src/lib/ylavintWallet.js'
import {normalizeSettings} from './vinted-agent-config.js'
import {dueScans} from './vinted-agent.js'
import {parseWallet,applyWallet,applyDesktopOrders,applyDesktopLabel,desktopLabelPayload,desktopLabelLink} from './ylavint-commerce.js'

const account='11111111-1111-4111-8111-111111111111',other='22222222-2222-4222-8222-222222222222',conversation='01a1babe-a720-7963-879d-eb437fc23e79',now=Date.parse('2026-11-14T08:10:00Z')
const settings=normalizeSettings({features:{wallet:true,orders:true,labels:true},messaging:{executor:'desktop'}})
function fakeDb(){
 const state={},uploads=[]
 return {state,uploads,from(table){const rows=state[table]??=[];let predicates=[],op='select',value,keys='id';const q={select:()=>q,eq:(k,v)=>{predicates.push(r=>r[k]===v);return q},in:(k,v)=>{predicates.push(r=>v.includes(r[k]));return q},upsert:(v,options)=>{op='upsert';value=v;keys=options?.onConflict||'id';return q},update:v=>{op='update';value=v;return q},insert:v=>{op='insert';value=v;return q},maybeSingle:async()=>{const r=await q;return {...r,data:r.data?.[0]||null}},then(ok,ko){try{
  let data=rows.filter(r=>predicates.every(p=>p(r)))
  if(op==='update')data.forEach(r=>Object.assign(r,value))
  if(op==='upsert')for(const row of [].concat(value)){const old=rows.find(r=>keys.split(',').every(k=>r[k]===row[k]));if(old)Object.assign(old,row);else rows.push({...row})}
  if(op==='insert'){if(table==='vinted_agent_tasks'&&rows.some(r=>r.dedupe_key===value.dedupe_key&&['queued','running'].includes(r.state)))return Promise.resolve({error:{code:'23505'}}).then(ok,ko);rows.push({state:'queued',...value})}
  return Promise.resolve({data,error:null}).then(ok,ko)
 }catch(e){return Promise.reject(e).then(ok,ko)}}};return q},storage:{from:()=>({upload:async(path,bytes)=>{uploads.push({path,bytes});return {data:{path}}},createSignedUrl:async path=>({data:{signedUrl:'https://storage.example/'+path}})})}}
}
test('wallet checks use two Paris calendar slots, survive restart, and never catch up twice at once',()=>{
 assert.equal(walletSlot(Date.parse('2026-11-14T07:59:00Z')),null)
 assert.equal(walletSlot(now),'2026-11-14:09')
 assert.equal(walletSlot(Date.parse('2026-07-14T07:00:00Z')),'2026-07-14:09','summer offset')
 assert.equal(walletSlot(Date.parse('2026-10-25T08:00:00Z')),'2026-10-25:09','after daylight-saving transition')
 assert.equal(walletDue(null,now,[9,18]),true)
 assert.equal(walletDue('2026-11-14T08:05:00Z',now,[9,18]),false)
 assert.equal(walletDue('2026-11-14T08:05:00Z',Date.parse('2026-11-14T17:00:00Z'),[9,18]),true)
 assert.equal(walletDue('2026-11-14T18:00:00Z',Date.parse('2026-11-15T07:00:00Z'),[9,18]),false)
 assert.equal(dueScans(settings,{},now).filter(k=>k==='scan_wallet').length,1)
 assert.ok(!dueScans({...settings,features:{wallet:false}}, {},now).includes('scan_wallet'))
 assert.ok(!dueScans({...settings,messaging:{...settings.messaging,executor:'extension'}},{},now).includes('scan_wallet'))
 for(const hours of [[9,9],[9],[9,18,20],[-1,18],['9',18],[1.5,18]])assert.throws(()=>normalizeSettings({messaging:{desktop:{wallet_hours:hours}}}))
})
test('wallet results cannot turn missing data into zero, mix currencies or claim an impossible transfer',async()=>{
 for(const value of [{available:null,pending:2,currency:'EUR',withdrawal:'unknown'},{available:1,pending:2,currency:'USD',withdrawal:'available'},{available:0,pending:2,currency:'EUR',withdrawal:'available'},{available:NaN,pending:2,currency:'EUR',withdrawal:'unknown'}])assert.throws(()=>parseWallet(value))
 const db=fakeDb();await applyWallet(db,{account_id:account},{available:0,pending:92,currency:'EUR',withdrawal:'unavailable'},now)
 assert.equal(db.state.ylavint_wallets[0].checked_at,new Date(now).toISOString());assert.equal(db.state.ylavint_wallets[0].account_id,account)
})
test('visible orders enqueue a label once, preserve saved documents and never use another account’s label',async()=>{
 const db=fakeDb(),task={account_id:account},result={orders:[{conversation_id:conversation,title:'Robe',price:52,status:'À expédier',label_state:'ready',detail_read:true,carrier:'Mondial Relay',item_id:'25'}]}
 await applyDesktopOrders(db,task,result,settings,now);await applyDesktopOrders(db,task,result,settings,now)
 assert.equal(db.state.vinted_agent_tasks.length,1)
 const labelTask=db.state.vinted_agent_tasks[0];assert.equal((await desktopLabelPayload(db,labelTask)).item_id,'25')
 const pdf_base64=Buffer.from('%PDF-1.7\n'+'x'.repeat(150)).toString('base64')
 await assert.rejects(applyDesktopLabel(db,labelTask,{conversation_id:'99',pdf_base64},now))
 await assert.rejects(applyDesktopLabel(db,{...labelTask,account_id:other},{conversation_id:conversation,pdf_base64},now))
 await applyDesktopLabel(db,labelTask,{conversation_id:conversation,pdf_base64},now)
 await applyDesktopLabel(db,labelTask,{conversation_id:conversation,pdf_base64},now)
 assert.equal(db.uploads.length,1)
 await applyDesktopOrders(db,task,result,settings,now)
 assert.equal(db.state.ylavint_desktop_orders[0].label_state,'saved')
 assert.match((await desktopLabelPayload(db,labelTask)).skip,/déjà/)
 await assert.rejects(desktopLabelLink(db,other,conversation),/pas encore/)
 assert.match((await desktopLabelLink(db,account,conversation)).url,/visible-/)
})
test('an unavailable document waits two hours and does not start a generation or order action',async()=>{
 const db=fakeDb(),task={account_id:account},row={conversation_id:conversation,title:'Robe',price:52,status:'À expédier',label_state:'ready',detail_read:true}
 await applyDesktopOrders(db,task,{orders:[row]},settings,now)
 const t=db.state.vinted_agent_tasks[0];t.state='done'
 await applyDesktopLabel(db,t,{conversation_id:conversation,pending:true,reason:'Prolongation en attente'},now)
 await applyDesktopOrders(db,task,{orders:[row]},settings,now+3600000)
 assert.equal(db.state.vinted_agent_tasks.length,1)
 await applyDesktopOrders(db,task,{orders:[row]},settings,now+3*3600000)
 assert.equal(db.state.vinted_agent_tasks.length,2)
 assert.ok(db.state.vinted_agent_tasks.every(t=>t.kind==='fetch_label'))
})
