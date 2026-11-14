import test from 'node:test'
import assert from 'node:assert/strict'
import {mkdtemp,readFile,rm} from 'node:fs/promises'
import path from 'node:path'
import {tmpdir} from 'node:os'
import {taskJournal} from './ylavint-journal.mjs'
import {DesktopAssistants,desktopRequest,runDesktop} from './ylavint.mjs'
import {VintedMessenger,matchingReply,conversationUrl} from './ylavint-ui.mjs'

const task={id:'00000000-0000-4000-8000-000000000001',lease:'00000000-0000-4000-8000-000000000002',kind:'like_message',payload:{message:'Bonjour !',user_id:'44',offer_price:8}}
const binding={token:'svwk_00000000-0000-4000-8000-000000000003.'+'a'.repeat(43),profile_id:'abc123',account_id:task.id,member_id:'123',login:'demo'}

test('desktop jobs deduplicate profile/account, never expose the token, and stop before restarting',async()=>{
 let runs=0
 const a=new DesktopAssistants({getClient:()=>({}),dataDir:'.',run:async(_b,{},{signal})=>{runs++;await new Promise(resolve=>signal.addEventListener('abort',resolve,{once:true}))}})
 a.start(binding);a.start(binding);await new Promise(setImmediate)
 assert.equal(runs,1);assert.ok(!JSON.stringify(a.snapshot()).includes(binding.token))
 assert.throws(()=>a.start({...binding,account_id:task.lease}),/déjà/)
 a.stop(binding.account_id);await a.close();assert.equal(a.snapshot()[0].state,'stopped')
})

test('durable task journal preserves partial sends across restart',async()=>{
 const dir=await mkdtemp(path.join(tmpdir(),'ylavint-journal-'))
 try{
  const j=taskJournal(dir);await j.begin(task,'123');await j.step(task.id,'message','confirmed')
  const restarted=taskJournal(dir),before=await restarted.begin({...task,lease:'another'},'123')
  assert.equal(before.lease,task.lease);assert.equal(before.steps.message,'confirmed');assert.equal(before.state,'started')
  assert.equal((await restarted.pending()).length,1)
  await assert.rejects(restarted.begin(task,'999'),/Compte différent/)
  await j.complete(task.id,{task_id:task.id,ok:false});await j.acknowledge(task.id)
  assert.equal((await restarted.read(task.id)).state,'acknowledged')
  assert.equal((await restarted.pending()).length,0)
 }finally{const relative=path.relative(tmpdir(),dir);if(relative.startsWith('ylavint-journal-')&&!relative.includes(path.sep))await rm(dir,{recursive:true,force:true})}
})

function fixture({draft='',changed=false,confirmed=true,wrongIdentity=false}={}){
 let text=draft,clicked=0,checks=0;const steps=[],typed=[]
 const field={first(){return this},filter(){return this},count:async()=>1,waitFor:async()=>{},inputValue:async()=>text,pressSequentially:async(v,opts)=>{typed.push({v,opts});text+=v},press:async()=>{text+='\n'},fill:async v=>{text=v}}
 const button={...field,click:async()=>{clicked++}}
 const page={url:()=>conversationUrl('55'),bringToFront:async()=>{},locator:selector=>selector.includes('button')?button:field,getByRole:()=>button,waitForResponse:async()=>confirmed?{ok:()=>true,json:async()=>({reply:{id:9}})}:null}
 const ui=new VintedMessenger({page,identity:async()=>({member_id:wrongIdentity?'999':'123',status:'ok'}),member:'123',journal:{step:async(...v)=>steps.push(v)},task,check:()=>{},update:()=>{},sleep:async()=>{},recheck:async()=>{checks++;return changed&&checks===2?{cancelled:'Buyer replied'}:{ok:true}}})
 return {ui,get clicked(){return clicked},get text(){return text},steps,typed}
}
test('progressive text sends once and records confirmation, not just the click',async()=>{
 const f=fixture();assert.equal((await f.ui.send({task_id:task.id,conversation_id:'55',body:task.payload.message})).reply.id,'9')
 assert.equal(f.clicked,1);assert.equal(f.typed[0].opts.delay,45);assert.equal(f.steps.at(-1)[2],'confirmed')
})
test('drafts, wrong account and changed buyer context cannot be sent',async()=>{
 for(const options of [{draft:'my draft'},{wrongIdentity:true}]){const f=fixture(options);await assert.rejects(f.ui.send({task_id:task.id,conversation_id:'55',body:task.payload.message}));assert.equal(f.clicked,0)}
 const f=fixture({changed:true}),r=await f.ui.send({task_id:task.id,conversation_id:'55',body:task.payload.message})
 assert.equal(r.desktop_cancelled,'Buyer replied');assert.equal(f.clicked,0);assert.equal(f.text,'')
})
test('an uncertain send stops with no API fallback or second click',async()=>{
 const f=fixture({confirmed:false});await assert.rejects(f.ui.send({task_id:task.id,conversation_id:'55',body:task.payload.message}),/non confirmé/)
 assert.equal(f.clicked,1);assert.equal(f.steps.at(-1)[2],'submitting')
})
test('response confirmation matches origin, exact conversation and exact text',()=>{
 const req=(url,data,method='POST')=>({url:()=>url,postDataJSON:()=>data,method:()=>method})
 assert.equal(matchingReply(req('https://api.vinted.fr/messaging/main/conversations/55/replies',{content:'hello'}),'55','hello'),true)
 for(const [url,data] of [['https://evil.example/messaging/main/conversations/55/replies',{content:'hello'}],['https://api.vinted.fr/messaging/main/conversations/56/replies',{content:'hello'}],['https://api.vinted.fr/messaging/main/conversations/55/replies',{content:'other'}]])assert.equal(matchingReply(req(url,data),'55','hello'),false)
 assert.throws(()=>conversationUrl('../evil'))
})
test('collector sends only a scoped key to the fixed site without cookies',async()=>{
 let seen
 await desktopRequest(binding.token,'agent_poll',{member_id:'123'},async(url,opts)=>{seen={url,opts};return {ok:true,json:async()=>({state:'idle'})}})
 assert.equal(seen.url,'https://vinted-stock.vercel.app/api/collector');assert.equal(seen.opts.credentials,'omit');assert.equal(seen.opts.redirect,'error')
})

test('offer cancels before submission when buyer replies, preserving an already sent message',async()=>{
 let checks=0,clicked=0,text='',escaped=false
 const field={first(){return this},filter(){return this},count:async()=>1,waitFor:async()=>{},inputValue:async()=>text,pressSequentially:async v=>{text=v},fill:async v=>{text=v},press:async k=>{escaped=k==='Escape'}}
 const button={...field,click:async()=>{clicked++}}
 const dialog={...field,locator:selector=>selector.includes('button')?button:field}
 const page={url:()=>conversationUrl('55'),bringToFront:async()=>{},locator:()=>dialog,getByRole:()=>button}
 const ui=new VintedMessenger({page,identity:async()=>({member_id:'123',status:'ok'}),member:'123',task,check:()=>{},update:()=>{},sleep:async()=>{},journal:{step:()=>assert.fail('no submission')},recheck:async()=>++checks===2?{cancelled:'Buyer replied'}:{ok:true}})
 ui.messageConfirmed=true
 const r=await ui.offer({task_id:task.id,conversation_id:'55',price:8})
 assert.equal(r.desktop_cancelled,'Buyer replied');assert.equal(r.message_confirmed,true);assert.equal(clicked,1);assert.equal(text,'');assert.equal(escaped,true)
})

test('checking a profile verifies identity without polling a task or writing to Vinted',async()=>{
 let claimed=0,closed=0,disconnects=0,opened=0
 const page={url:()=> 'https://www.vinted.fr/',goto:async()=>{},evaluate:async fn=>typeof fn==='string'?undefined:{member_id:'123',status:'ok'},close:async()=>{closed++}}
 const browser={contexts:()=>[{newPage:async()=>page}],close:async()=>{disconnects++}}
 const controller=new AbortController(),updates=[]
 await runDesktop({...binding,check_only:true},{start:async()=>{opened++;return {address:'ws://127.0.0.1/devtools/browser/test'}}},{signal:controller.signal,dataDir:tmpdir(),update:x=>updates.push(x),sources:{read:'identity-source',agent:'agent-source'},connect:async()=>browser,request:async()=>{claimed++}})
 assert.equal(opened,1);assert.equal(claimed,0);assert.equal(closed,1);assert.equal(disconnects,1);assert.equal(updates.at(-1).state,'checked')
})

test('restart reports an interrupted write and stops before claiming new work',async()=>{
 const dir=await mkdtemp(path.join(tmpdir(),'ylavint-recovery-'))
 try{
  const journal=taskJournal(path.join(dir,'ylavint',binding.account_id));await journal.begin(task,binding.member_id);await journal.step(task.id,'message','submitting')
  const actions=[],page={url:()=> 'https://www.vinted.fr/',goto:async()=>{},evaluate:async fn=>typeof fn==='string'?undefined:{member_id:'123',status:'ok'},close:async()=>{}}
  await assert.rejects(runDesktop(binding,{start:async()=>({address:'ws://127.0.0.1/devtools/browser/test'})},{signal:new AbortController().signal,dataDir:dir,update:()=>{},sources:{read:'identity-source',agent:'agent-source'},connect:async()=>({contexts:()=>[{newPage:async()=>page}],close:async()=>{}}),request:async(_token,action,body)=>{actions.push(action);assert.equal(body.task_id,task.id);assert.equal(body.ok,false);return {saved:true,paused:true}}}),/action interrompue/)
  assert.deepEqual(actions,['agent_result']);assert.equal((await journal.pending()).length,0)
 }finally{const relative=path.relative(tmpdir(),dir);if(relative.startsWith('ylavint-recovery-')&&!relative.includes(path.sep))await rm(dir,{recursive:true,force:true})}
})
