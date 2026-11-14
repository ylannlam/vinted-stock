import test from 'node:test'
import assert from 'node:assert/strict'
import {mkdtemp,readFile,rm} from 'node:fs/promises'
import path from 'node:path'
import {tmpdir} from 'node:os'
import {taskJournal} from './ylavint-journal.mjs'
import {DesktopAssistants,desktopRequest,runDesktop} from './ylavint.mjs'
import {VintedMessenger,conversationUrl} from './ylavint-ui.mjs'
import {VisibleVinted,PACE,renderedPage,readLikes,readThread,visibleDate,euros} from './ylavint-visible.mjs'
import {parseHTML} from 'linkedom'

const task={id:'00000000-0000-4000-8000-000000000001',lease:'00000000-0000-4000-8000-000000000002',kind:'like_message',payload:{message:'Bonjour !',user_id:'44',offer_price:8}}
const binding={token:'svwk_00000000-0000-4000-8000-000000000003.'+'a'.repeat(43),profile_id:'abc123',account_id:task.id,member_id:'123',login:'demo'}
class FakeReader {async open(){}async identity(){return {member_id:'123',status:'ok'}}async wardrobe(){return {items:[]}}async likes(){return {likes:[]}}async inbox(){return {conversations:[]}}}

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

function fixture({draft='',changed=false,confirmed=true,wrongIdentity=false,authorize=async()=>{}}={}){
 let text=draft,clicked=0,checks=0;const steps=[],typed=[]
 const field={first(){return this},filter(){return this},count:async()=>1,waitFor:async()=>{},inputValue:async()=>text,pressSequentially:async(v,opts)=>{typed.push({v,opts});text+=v},press:async()=>{text+='\n'},fill:async v=>{text=v}}
 const button={...field,click:async()=>{clicked++}}
 const page={url:()=>conversationUrl('55'),bringToFront:async()=>{},locator:selector=>selector.includes('button')?button:field,getByRole:()=>button,waitForResponse:async()=>confirmed?{ok:()=>true,json:async()=>({reply:{id:9}})}:null}
 const ui=new VintedMessenger({page,identity:async()=>({member_id:wrongIdentity?'999':'123',status:'ok'}),member:'123',journal:{step:async(...v)=>steps.push(v)},task,check:()=>{},update:()=>{},authorize,thread:async()=>({messages:[]}),confirm:async()=>confirmed?{id:'ui:9'}:null,sleep:async()=>{},recheck:async()=>{checks++;return changed&&checks===2?{cancelled:'Buyer replied'}:{ok:true}}})
 return {ui,get clicked(){return clicked},get text(){return text},steps,typed}
}
test('progressive text sends once and records confirmation, not just the click',async()=>{
 const f=fixture();assert.equal((await f.ui.send({task_id:task.id,conversation_id:'55',body:task.payload.message})).reply.id,'ui:9')
 assert.equal(f.clicked,1);assert.equal(f.typed[0].opts.delay,70);assert.equal(f.steps.at(-1)[2],'confirmed')
})

test('pausing on the site during typing prevents the final send click',async()=>{
 const f=fixture({authorize:async()=>{throw Error('Compte mis en pause sur le site')}})
 await assert.rejects(f.ui.send({task_id:task.id,conversation_id:'55',body:task.payload.message}),/pause/)
 assert.equal(f.text,task.payload.message);assert.equal(f.clicked,0)
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
test('conversation destinations only accept numeric or UUID identifiers',()=>{
 assert.equal(conversationUrl('55'),'https://www.vinted.fr/inbox/55')
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
 await runDesktop({...binding,check_only:true},{start:async()=>{opened++;return {address:'ws://127.0.0.1/devtools/browser/test'}}},{signal:controller.signal,dataDir:tmpdir(),update:x=>updates.push(x),Reader:FakeReader,connect:async()=>browser,request:async()=>{claimed++}})
 assert.equal(opened,1);assert.equal(claimed,0);assert.equal(closed,1);assert.equal(disconnects,1);assert.equal(updates.at(-1).state,'checked')
})

test('restart reports an interrupted write and stops before claiming new work',async()=>{
 const dir=await mkdtemp(path.join(tmpdir(),'ylavint-recovery-'))
 try{
  const journal=taskJournal(path.join(dir,'ylavint',binding.account_id));await journal.begin(task,binding.member_id);await journal.step(task.id,'message','submitting')
  const actions=[],page={url:()=> 'https://www.vinted.fr/',goto:async()=>{},evaluate:async fn=>typeof fn==='string'?undefined:{member_id:'123',status:'ok'},close:async()=>{}}
  await assert.rejects(runDesktop(binding,{start:async()=>({address:'ws://127.0.0.1/devtools/browser/test'})},{signal:new AbortController().signal,dataDir:dir,update:()=>{},Reader:FakeReader,connect:async()=>({contexts:()=>[{newPage:async()=>page}],close:async()=>{}}),request:async(_token,action,body)=>{actions.push(action);assert.equal(body.task_id,task.id);assert.equal(body.ok,false);return {saved:true,paused:true}}}),/action interrompue/)
  assert.deepEqual(actions,['agent_result']);assert.equal((await journal.pending()).length,0)
 }finally{const relative=path.relative(tmpdir(),dir);if(relative.startsWith('ylavint-recovery-')&&!relative.includes(path.sep))await rm(dir,{recursive:true,force:true})}
})

function domSnapshot(html){
 const {document,HTMLElement}=parseHTML('<html><body>'+html+'</body></html>')
 HTMLElement.prototype.getClientRects=function(){return this.closest('[hidden]')?[]:[{}]}
 const previous={document:globalThis.document,location:globalThis.location,getComputedStyle:globalThis.getComputedStyle}
 Object.assign(globalThis,{document,location:{href:conversationUrl('55')},getComputedStyle:()=>({visibility:'visible',display:'block'})})
 try{return renderedPage()}finally{Object.assign(globalThis,previous)}
}
const pageHtml=`<header><button data-testid="user-menu-button"><img alt="demo"></button></header>
<aside><a href="https://www.vinted.fr/items/999">Wrong item</a></aside>
<div data-testid="conversation-header"><a href="https://www.vinted.fr/member/44">acheteuse</a></div>
<a data-testid="hero-message" href="https://www.vinted.fr/items/101"><span>Robe bordeaux</span><br>48,20 €</a>
<div data-testid="conversation-content">
 <div>il y a 10 minutes</div><div><div class="web_ui__Bubble__bubble"><span aria-label="Message from acheteuse: Bonjour">Bonjour</span></div></div>
 <div>il y a 5 minutes</div><div><div class="web_ui__Bubble__bubble web_ui__Bubble__inverse"><span data-testid="offer-current-price-label">44,80 €</span><span data-testid="offer-original-price-label">48,20 €</span></div></div>
 <div>il y a 4 minutes</div><div><div class="web_ui__Bubble__bubble web_ui__Bubble__inverse"><span aria-label="Message from me: Bonsoir">Bonsoir</span></div></div>
</div><textarea data-testid="composer-input"></textarea>`
test('rendered-page reader separates buyer messages, own offers, and the actual header item',()=>{
 const s=domSnapshot(pageHtml+'<script>PRIVATE HYDRATION</script><a hidden href="https://evil.example/">SECRET</a>')
 const c=readThread(s,Date.parse('2026-11-14T12:00:00Z'))
 assert.equal(c.item.id,'101');assert.equal(c.item.price,48.2);assert.equal(c.other.id,'44')
 assert.deepEqual(c.messages.map(m=>[m.from_me,m.kind]),[[false,'message'],[true,'offer'],[true,'message']])
 assert.equal(c.messages[0].sent_at,'2026-11-14T11:49:00.000Z')
 assert.equal(c.messages[0].id,readThread(s,Date.parse('2026-11-14T12:01:00Z')).messages[0].id)
 assert.ok(!s.links.some(l=>l.href.includes('evil.example')))
 assert.equal(euros('1 234,50 €'),1234.5)
})
test('favourite reader needs a real notification link, buyer, item, and readable date',()=>{
 const notices=[{href:'https://www.vinted.fr/inbox/want_it?receiver_id=44&item_id=101&offer_request=true',text:'acheteuse a marqué ton article Robe comme favori\nil y a 3 minutes'}]
 const r=readLikes({notices},Date.parse('2026-11-14T12:00:00Z'));assert.equal(r.likes[0].liked_at,'2026-11-14T11:56:00.000Z')
 assert.equal(r.complete,false)
 for(const n of [{...notices[0],text:'Date illisible'},{...notices[0],href:'https://evil.example/inbox/want_it?receiver_id=44&item_id=101'}])assert.equal(readLikes({notices:[n]}).likes.length,0)
 assert.equal(visibleDate('inconnue'),null)
})
test('unknown bubbles disable automatic context validation instead of guessing',()=>{
 const c=readThread(domSnapshot(pageHtml.replace('aria-label="Message from acheteuse: Bonjour"','')))
 assert.equal(c.uncertain,true)
})
test('visible identity requires the own-profile menu, not a profile visited on screen',async()=>{
 let clicked=0
 const reader=new VisibleVinted({page:{locator:()=>({click:async()=>{clicked++}})},binding,check:()=>{},sleep:async()=>{}})
 reader.snapshot=async()=>({login:'demo',links:[{text:'Mon profil',href:'https://www.vinted.fr/member/999'}]})
 await assert.rejects(reader.identity(true),/identifiant/)
 assert.equal(reader.verified,false)
 reader.snapshot=async()=>({login:'demo',links:[{text:'Mon profil',href:'https://www.vinted.fr/member/123'}]})
 assert.equal((await reader.identity(true)).member_id,'123');assert.equal(clicked,3)
})
test('consultation stops on site pause before clicking an article and never likes',async()=>{
 let requests=0,clicks=0,wheels=0
 const reader=new VisibleVinted({page:{mouse:{wheel:async()=>{wheels++}}},binding,check:()=>{},sleep:async()=>{},update:()=>{},control:async()=>({allowed:++requests===1,in_window:true,pace:{...PACE,browse_enabled:true}})})
 reader.open=async()=>({cards:[{href:'https://www.vinted.fr/items/101'}]});reader.identity=async()=>{};reader.clickLink=async()=>{clicks++}
 assert.equal(await reader.browseOne(),false);assert.equal(clicks,0);assert.equal(wheels,0)
})
test('visual confirmation rejects old matching bubbles and incoming echoes',async()=>{
 const reader=new VisibleVinted({check:()=>{},sleep:async()=>{}}),before=[{id:'ui:old',from_me:true,kind:'message',body:'Bonsoir'}]
 reader.thread=async()=>({messages:[...before,{id:'ui:buyer',from_me:false,kind:'message',body:'Bonsoir'}]})
 await assert.rejects(reader.confirm({kind:'message',body:'Bonsoir',before}),/non confirmé/)
 reader.thread=async()=>({messages:[...before,{id:'ui:new',from_me:true,kind:'message',body:'Bonsoir'}]})
 assert.equal((await reader.confirm({kind:'message',body:'Bonsoir',before})).id,'ui:new')
})
test('pausing a desktop session prevents claiming a task',async()=>{
 const actions=[],page={close:async()=>{}}
 await runDesktop(binding,{start:async()=>({address:'ws://127.0.0.1/devtools/browser/test'})},{signal:new AbortController().signal,dataDir:tmpdir(),update:()=>{},Reader:FakeReader,connect:async()=>({contexts:()=>[{newPage:async()=>page}],close:async()=>{}}),request:async(_token,action)=>{actions.push(action);return {allowed:false}}})
 assert.deepEqual(actions,['agent_status'])
})

test('first-contact availability requires a unique visible seller control on the item page',async()=>{
 let count=1,visible=true,verified=0,opened=''
 const control={or(){return this},count:async()=>count,isVisible:async()=>visible}
 const reader=new VisibleVinted({page:{getByRole:()=>control}})
 reader.open=async url=>{opened=url};reader.identity=async()=>{verified++}
 await reader.availableItem('101');assert.equal(opened,'/items/101');assert.equal(verified,1)
 for(const state of [[0,true],[2,true],[1,false]]){
  [count,visible]=state;await assert.rejects(reader.availableItem('101'),/pas confirmé disponible/)
 }
 await assert.rejects(reader.availableItem('../inbox'),/Article inconnu/)
})

import {browseMemory} from './ylavint-memory.mjs'
import {browseCandidates} from './ylavint-visible.mjs'
import {DESKTOP_DEFAULTS} from '../../src/lib/ylavintExecution.js'

test('website and connector share the same complete pacing defaults',()=>assert.deepEqual(PACE,DESKTOP_DEFAULTS))

test('consultation filters visible cards, excludes recent visits and deduplicates item links',()=>{
 const now=Date.now(),pace={...PACE,browse_keywords:'Sézane, robe',browse_price_min:10,browse_price_max:30}
 const card=(id,text)=>({href:'https://www.vinted.fr/items/'+id,text})
 const cards=[card('1','Robe 20 €'),card('1','Robe 20 €'),card('2','SEZANE 25 €'),card('3','Jean 12 €'),card('4','Robe 50 €'),card('5','Robe sans prix'),{href:'https://evil.example/items/6',text:'Robe 20 €'}]
 assert.deepEqual(browseCandidates(cards,pace,new Map([['1',now]]),now).map(c=>c.id),['2'])
 assert.deepEqual(browseCandidates(cards,pace,new Map([['1',now-25*3600000]]),now).map(c=>c.id),['1','2'])
})

test('consultation memory persists across restarts without storing page content',async()=>{
 const dir=await mkdtemp(path.join(tmpdir(),'ylavint-browse-')),now=Date.now()
 try{
  const memory=await browseMemory(dir,now);await memory.record('123',now)
  assert.equal((await browseMemory(dir,now)).visited.get('123'),now)
  assert.equal((await browseMemory(dir,now+9*86400000)).visited.size,0)
  assert.deepEqual(JSON.parse(await readFile(path.join(dir,'navigation.json'),'utf8')),[['123',now]])
 }finally{if(path.relative(tmpdir(),dir).startsWith('ylavint-browse-')&&!path.relative(tmpdir(),dir).includes(path.sep))await rm(dir,{recursive:true,force:true})}
})

test('a new buyer message interrupts a long reply before the rest is typed',async()=>{
 const f=fixture({changed:true}),body='Bonjour, je regarde les mesures de cette robe et je te réponds.'
 f.ui.task={...task,payload:{body}}
 const r=await f.ui.send({task_id:task.id,conversation_id:'55',body})
 assert.equal(r.desktop_cancelled,'Buyer replied');assert.equal(f.typed.reduce((n,c)=>n+c.v.length,0),12)
 assert.equal(f.clicked,0);assert.equal(f.text,'')
})

test('a seller edit during typing is kept and never submitted or cleared',async()=>{
 const f=fixture(),body='Bonjour, je vérifie les mesures avant de répondre.'
 f.ui.task={...task,payload:{body}};f.ui.recheck=async()=>{if(f.typed.length)await f.ui.page.locator('textarea').fill('Mon propre brouillon');return {ok:true}}
 await assert.rejects(f.ui.send({task_id:task.id,conversation_id:'55',body}),e=>e.keep_page===true)
 assert.equal(f.text,'Mon propre brouillon');assert.equal(f.clicked,0)
})

test('loss of focus stops progressive typing with the draft left for review',async()=>{
 const f=fixture(),body='Bonjour, je vérifie les mesures avant de répondre.';f.ui.task={...task,payload:{body}}
 f.ui.page.locator('textarea').evaluate=async()=>false
 await assert.rejects(f.ui.send({task_id:task.id,conversation_id:'55',body}),e=>e.keep_page===true&&/focus/.test(e.message))
 assert.equal(f.typed.length,1);assert.equal(f.clicked,0)
})

test('manual replies require review when their remembered context has changed',async()=>{
 const reader=new VisibleVinted({binding,check:()=>{},sleep:async()=>{},update:()=>{}})
 reader.identity=async()=>{};reader.thread=async()=>({id:'55',allow_reply:true,messages:[{id:'new',from_me:false}]})
 const r=await reader.recheck({...task,kind:'reply_message',payload:{context_message_id:'old',source:'site',manual:true}},'55')
 assert.equal(r.context_changed,true);assert.equal(r.review_required,true)
 const auto=await reader.recheck({...task,kind:'reply_message',payload:{source_message_id:'old',source:'ai',manual:false}},'55')
 assert.equal(auto.context_changed,true);assert.equal(auto.review_required,false)
})

test('rehearsal only reads visible pages and the scoped plan, without task claims or sends',async()=>{
 const actions=[],updates=[],page={close:async()=>{}}
 await runDesktop({...binding,rehearse:true},{start:async()=>({address:'test'})},{signal:new AbortController().signal,dataDir:tmpdir(),Reader:FakeReader,update:x=>updates.push(x),connect:async()=>({contexts:()=>[{newPage:async()=>page}],close:async()=>{}}),request:async(_token,action)=>{actions.push(action);return {actions:[{id:'preview'}]}}})
 assert.deepEqual(actions,['agent_preview']);assert.equal(updates.at(-1).state,'rehearsed');assert.equal(updates.at(-1).actions_preview[0].id,'preview')
 assert.equal(updates.find(x=>x.summary).summary.messages_sent,0)
})

test('resume rereads and imports context before polling; takeover leaves the owned page open',async()=>{
 const actions=[],controller=new AbortController();let closed=0
 const page={close:async()=>{closed++}}
 class Reader extends FakeReader{async inbox(){actions.push('visible_inbox');return {conversations:[]}}}
 await runDesktop(binding,{start:async()=>({address:'test'})},{signal:controller.signal,dataDir:tmpdir(),Reader,update:()=>{},connect:async()=>({contexts:()=>[{newPage:async()=>page}],close:async()=>{}}),request:async(_token,action)=>{
  actions.push(action)
  if(action==='agent_status')return {allowed:true,in_window:true,pace:PACE}
  if(action==='agent_preview')return {actions:[]}
  if(action==='agent_context')return {saved:true}
  if(action==='agent_poll'){controller.abort({takeover:true});return {state:'idle'}}
  assert.fail(action)
 }})
 assert.deepEqual(actions,['agent_status','agent_preview','visible_inbox','agent_context','agent_status','agent_poll']);assert.equal(closed,0)
})

test('manual takeover blocks automatic restart and keeps a distinct session status',async()=>{
 const manager=new DesktopAssistants({getClient:()=>({}),dataDir:'.',run:async(_binding,_ads,{signal})=>{await new Promise(resolve=>signal.addEventListener('abort',resolve,{once:true}))}})
 manager.start(binding);await new Promise(setImmediate)
 assert.throws(()=>manager.start({...binding,account_id:task.lease,profile_id:'another'}),/déjà/)
 manager.stop(binding.account_id,true);await new Promise(setImmediate)
 assert.equal(manager.active,false);assert.equal(manager.snapshot()[0].state,'manual');await manager.close()
})
