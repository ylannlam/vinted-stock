import test from 'node:test'
import assert from 'node:assert/strict'
import {authorizeDesktop,pairDesktop,desktopDriver,guardDesktop,statusDesktop,desktopWindow} from './ylavint-desktop.js'
import {normalizeSettings} from './vinted-agent-config.js'
import {executionSettings} from '../src/lib/ylavintExecution.js'
import {newWatchToken} from './vinted-watch.js'
import {copiedSettings} from './ylavint-settings-copy.js'
const account={id:'00000000-0000-4000-8000-000000000001',vinted_id:'123',login:'test'}
function db(){const inserted=[];return {inserted,from(table){const q={select:()=>q,eq:()=>q,maybeSingle:async()=>({data:table==='publication_accounts'?account:{messaging:{executor:'desktop'}}}),insert:async row=>{inserted.push(row);return {error:null}}};return q}}}
test('a native key is bound to the exact account and profile and cannot self-configure',async()=>{
 const d=db(),key={desktop_account_id:account.id,desktop_profile_id:'abc'},body={action:'agent_poll',profile_id:'abc',member_id:'123'}
 await authorizeDesktop(d,key,body)
 for(const patch of [{member_id:'999'},{profile_id:'other'},{action:'agent_self'},{action:'agent_learn'}])await assert.rejects(authorizeDesktop(d,key,{...body,...patch}))
 assert.equal(desktopDriver({}),'extension','a caller cannot request desktop authority using its request body')
})
test('pairing returns only a scoped token and stores its hash',async()=>{
 const d=db(),r=await pairDesktop(d,{id:'admin'},{account_id:account.id,profile_id:'abc'},newWatchToken)
 assert.equal(r.member_id,'123');assert.equal(d.inserted[0].desktop_account_id,account.id);assert.equal(d.inserted[0].desktop_profile_id,'abc')
 assert.ok(!JSON.stringify(d.inserted).includes(r.token))
})
test('copying messages and discounts never switches another account executor',()=>{
 assert.equal(copiedSettings({messaging:{executor:'desktop'}},{messaging:{executor:'extension'}},'all').messaging.executor,'extension')
})

test('PC runtime preserves extension preferences but cannot plan unsupported actions',()=>{
 const stored=normalizeSettings({features:{likes:true,inbox:true,dressing:true,orders:true,unmask:true,pricing:true,publish:true},messaging:{executor:'desktop',offers:{enabled:true}},order_flow:{confirm:{enabled:true}}})
 const before=structuredClone(stored),runtime=executionSettings(stored)
 assert.deepEqual(stored,before)
 for(const k of ['likes','inbox','dressing','publish'])assert.equal(runtime.features[k],true)
 for(const k of ['orders','unmask','pricing'])assert.equal(runtime.features[k],false)
 assert.equal(runtime.messaging.offers.enabled,false);assert.equal(runtime.order_flow.confirm.enabled,false)
})

test('desktop pacing validates every limit and keeps consultation opt-in',()=>{
 assert.equal(normalizeSettings().messaging.desktop.browse_enabled,false)
 assert.equal(normalizeSettings({messaging:{desktop:{typing_delay_ms:90,browse_enabled:true}}}).messaging.desktop.typing_delay_ms,90)
 for(const desktop of [{typing_delay_ms:0},{session_minutes:0},{pause_minutes:100},{browse_items:100},{browse_scrolls:-1},{browse_enabled:'yes'},{publication_corrections:'yes'},{publication_typing_ms:10},{publication_review_seconds:0}])assert.throws(()=>normalizeSettings({messaging:{desktop}}))
})

test('desktop status shares settings and Paris hours without claiming tasks',async()=>{
 const settings={enabled:true,paused:false,messaging:{executor:'desktop',desktop:{typing_delay_ms:90,browse_enabled:true}},limits:{from_hour:22,to_hour:6},version:4}
 const d={from(table){assert.equal(table,'vinted_agent_settings');const q={select:()=>q,eq:()=>q,maybeSingle:async()=>({data:settings})};return q}}
 const r=await statusDesktop(d,{desktop_account_id:account.id},Date.parse('2026-11-14T22:00:00Z'))
 assert.equal(r.allowed,true);assert.equal(r.in_window,true);assert.equal(r.pace.typing_delay_ms,90)
 assert.equal(desktopWindow(settings.limits,Date.parse('2026-11-14T12:00:00Z')),false)
 settings.paused=true;assert.equal((await statusDesktop(d,{desktop_account_id:account.id})).allowed,false)
 await assert.rejects(statusDesktop(d,{}))
})

test('the final send guard observes pause, executor, version and lease changes',async()=>{
 const key={desktop_account_id:account.id},body={task_id:account.id,lease:'00000000-0000-4000-8000-000000000002',settings_version:2}
 const task={id:body.task_id,account_id:account.id,lease:body.lease,kind:'reply_message',state:'running',lease_until:new Date(Date.now()+60000).toISOString()}
 const settings={account_id:account.id,enabled:true,paused:false,version:2,messaging:{executor:'desktop'},limits:{from_hour:0,to_hour:0}}
 const d={from(table){let filters=[];const q={select:()=>q,eq(k,v){filters.push(r=>r[k]===v);return q},maybeSingle:async()=>{const r=table==='vinted_agent_tasks'?task:settings;return {data:filters.every(f=>f(r))?r:null}}};return q}}
 assert.equal((await guardDesktop(d,key,body)).allowed,true)
 for(const patch of [{paused:true},{enabled:false},{version:3},{messaging:{executor:'extension'}}]){const saved={...settings};Object.assign(settings,patch);await assert.rejects(guardDesktop(d,key,body));Object.assign(settings,saved)}
 task.state='cancelled';await assert.rejects(guardDesktop(d,key,body));task.state='running'
 task.lease_until=new Date(Date.now()-1).toISOString();await assert.rejects(guardDesktop(d,key,body))
 await assert.rejects(guardDesktop(d,{},body))
})

test('weekly planning handles overnight windows, empty days and absence in Paris time',()=>{
 const limits={from_hour:22,to_hour:6},pace={active_days:[5]}
 assert.equal(desktopWindow(limits,Date.parse('2026-11-13T22:00:00Z'),pace),true)
 assert.equal(desktopWindow(limits,Date.parse('2026-11-14T02:00:00Z'),pace),true,'Saturday dawn belongs to Friday session')
 assert.equal(desktopWindow(limits,Date.parse('2026-11-14T22:00:00Z'),pace),false)
 assert.equal(desktopWindow({from_hour:0,to_hour:0},Date.now(),{active_days:[]}),false)
 assert.equal(desktopWindow(limits,Date.parse('2026-11-13T22:00:00Z'),{...pace,absent_until:'2026-11-14T05:00:00Z'}),false)
})

test('routine settings preserve a valid calendar and reject invalid filters and memories',()=>{
 const saved=normalizeSettings({messaging:{desktop:{active_days:[5,1,1],absent_until:'2026-12-01T10:00:00+01:00',browse_price_min:10,browse_price_max:30},reply_notes:'Envoi mardi',reply_examples:[{before:'Salut',after:'Bonjour'}]}})
 assert.deepEqual(saved.messaging.desktop.active_days,[1,5]);assert.equal(saved.messaging.desktop.absent_until,'2026-12-01T09:00:00.000Z')
 for(const desktop of [{active_days:[0]},{active_days:'1'},{absent_until:'bad'},{browse_price_min:40,browse_price_max:30},{browse_photos:'yes'},{reply_max_age_hours:0}])assert.throws(()=>normalizeSettings({messaging:{desktop}}))
})

test('publication guard requires the frozen draft, account, task and enabled feature',async()=>{
 const key={desktop_account_id:account.id},body={task_id:crypto.randomUUID(),lease:crypto.randomUUID(),settings_version:2},owner=crypto.randomUUID()
 const payload={execution:'desktop',submit:true,fields:{account_id:account.id,title:'Robe'}}
 const task={id:body.task_id,account_id:account.id,created_by:owner,lease:body.lease,kind:'publish_item',state:'running',lease_until:new Date(Date.now()+60000).toISOString(),payload:{draft_id:crypto.randomUUID(),listing:payload}}
 const settings={account_id:account.id,enabled:true,paused:false,version:2,messaging:{executor:'desktop'},limits:{from_hour:0,to_hour:0},features:{publish:true}}
 const draft={id:task.payload.draft_id,owner_id:owner,publication_task_id:task.id,state:'preparing',fields:{account_id:account.id},payload:structuredClone(payload)}
 const db={from(table){const row={vinted_agent_tasks:task,vinted_agent_settings:settings,listing_drafts:draft}[table],filters=[];const q={select:()=>q,eq(k,v){filters.push(()=>row[k]===v);return q},maybeSingle:async()=>({data:filters.every(f=>f())?row:null})};return q}}
 assert.equal((await guardDesktop(db,key,body)).allowed,true)
 for(const patch of [{owner_id:crypto.randomUUID()},{publication_task_id:crypto.randomUUID()},{state:'attention'},{payload:{...payload,submit:false}}]){const old={...draft};Object.assign(draft,patch);await assert.rejects(guardDesktop(db,key,body),/correspond plus/);Object.assign(draft,old)}
 settings.features.publish=false;await assert.rejects(guardDesktop(db,key,body),/non autorisée/)
})
