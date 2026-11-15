import test from 'node:test'
import assert from 'node:assert/strict'
import {mkdtemp,rm,writeFile} from 'node:fs/promises'
import path from 'node:path'
import {tmpdir} from 'node:os'
import {parseHTML} from 'linkedom'
import {routineMemory} from './ylavint-routine.mjs'
import {renderedListing,visibleDraft,favouriteMatches} from './ylavint-browsing.mjs'
import {VisibleVinted,PACE} from './ylavint-visible.mjs'
import {runDesktop} from './ylavint.mjs'

async function directory(t){
 const dir=await mkdtemp(path.join(tmpdir(),'ylavint-routine-'))
 t.after(async()=>{const relative=path.relative(tmpdir(),dir);assert.ok(relative.startsWith('ylavint-routine-')&&!relative.includes(path.sep));await rm(dir,{recursive:true,force:true})})
 return dir
}
const binding={account_id:'00000000-0000-4000-8000-000000000001',member_id:'123',login:'demo',profile_id:'profile76',token:'test-token'}
const pace={...PACE,browse_enabled:true,browse_like_enabled:true,browse_like_percent:100,browse_variety:false,pause_close_percent:100}
const detail={url:'https://www.vinted.fr/items/101-robe',title:'Robe été',price_text:'30,00 €',price:30,seller:'/member/456',available:true,favourite:'false',favourite_ready:true}
function dom(html,fn,url=detail.url){
 const {document,HTMLElement}=parseHTML('<html><body>'+html+'</body></html>')
 HTMLElement.prototype.getClientRects=function(){return this.closest('[hidden]')?[]:[{}]}
 const previous={document:globalThis.document,location:globalThis.location,getComputedStyle:globalThis.getComputedStyle}
 Object.assign(globalThis,{document,location:new URL(url),getComputedStyle:()=>({visibility:'visible',display:'block'})})
 try{return fn()}finally{Object.assign(globalThis,previous)}
}
const listingHtml=`<div data-testid="item-page-summary-plugin"><h1>Robe été</h1></div><div data-testid="item-price">30,00 €</div><button>33,30 € protection incluse</button><a href="/member/456"><span data-testid="profile-username">vendeuse</span></a><button>Acheter</button><button data-testid="favourite-button" aria-pressed="false">Ajouter aux favoris</button><div hidden><button data-testid="favourite-button" aria-pressed="true"></button></div>`

test('only the rendered item price, title, seller and unique favourite control are used',()=>{
 const d=dom(listingHtml,renderedListing)
 assert.equal(d.price_text,'30,00 €');assert.equal(d.title,'Robe été');assert.equal(d.favourite,'false');assert.equal(d.seller,'/member/456');assert.equal(d.available,true)
 assert.equal(dom(listingHtml+'<button data-testid="favourite-button" aria-pressed="false"></button>',renderedListing).favourite_ready,false)
 assert.equal(dom(listingHtml+'<div data-testid="item-price">40 €</div>',renderedListing).price_text,'')
})

test('dress favourites require the exact item, another seller, an available dress and inclusive price bounds',()=>{
 for(const price of [20,35,50])assert.equal(favouriteMatches({...detail,price},pace,'123','101'),true)
 assert.equal(favouriteMatches({...detail,title:'Lot de robes fleuries'},pace,'123','101'),true)
 for(const patch of [{price:19.99},{price:50.01},{price:null},{title:'Pull beige'},{title:'Penderie wardrobe'},{seller:'/member/123'},{seller:null},{seller:'https://evil.test/member/456'},{url:'https://www.vinted.fr/items/102-robe'},{favourite:'true'},{favourite:null},{favourite_ready:false},{available:false}])assert.equal(favouriteMatches({...detail,...patch},pace,'123','101'),false,JSON.stringify(patch))
})

test('draft detection preserves messages, rich text and the publication form',()=>{
 assert.equal(dom('<textarea>Mon brouillon</textarea>',visibleDraft),true)
 assert.equal(dom('<div contenteditable="true">En cours</div>',visibleDraft),true)
 assert.equal(dom('<textarea hidden>Brouillon masqué</textarea>',visibleDraft),false)
 assert.equal(dom('',visibleDraft,'https://www.vinted.fr/items/new'),true)
 assert.equal(dom('<textarea></textarea>',visibleDraft),false)
})

test('favourite reservations survive restart, consume the daily cap, and enforce a ten-minute gap',async t=>{
 const dir=await directory(t);let now=Date.parse('2026-11-14T10:00:00Z')
 let memory=await routineMemory(dir,{now:()=>now})
 assert.equal(await memory.reserveLike('101',2),true);assert.equal(memory.countLikes(),1)
 assert.equal(await memory.reserveLike('102',2),false)
 now+=10*60000;memory=await routineMemory(dir,{now:()=>now})
 assert.equal(memory.canLike('101',2),false);assert.equal(await memory.reserveLike('102',2),true)
 await memory.confirmLike('102');now+=10*60000
 assert.equal(memory.canLike('103',2),false);assert.equal(memory.countLikes(),2)
 now=Date.parse('2026-11-14T23:01:00Z')
 assert.equal(memory.countLikes(),0,'a new Paris day starts before UTC midnight')
 assert.equal(memory.canLike('103',2),true);assert.equal(memory.canLike('101',2),false,'the same item is not clicked again the next day')
})

test('consultations require both elapsed interval and completed tasks; five-minute breaks persist',async t=>{
 const dir=await directory(t);let now=Date.parse('2026-11-14T10:00:00Z')
 let memory=await routineMemory(dir,{now:()=>now,random:()=>0})
 await memory.initialize(pace)
 for(let i=0;i<3;i++)await memory.completed()
 assert.equal(memory.due(pace),false)
 now+=30*60000;assert.equal(memory.due(pace),true)
 await memory.browsed(pace);assert.equal(memory.state.tasks,0);now+=30*60000
 assert.equal(memory.due(pace),false);assert.equal(memory.due(pace,{idle:true}),true)
 await memory.beginBreak(pace);const until=memory.state.break_until
 assert.equal(until,now+5*60000);assert.equal(memory.state.close_for_break,true)
 now+=2*60000;memory=await routineMemory(dir,{now:()=>now,random:()=>0});await memory.initialize(pace)
 assert.equal(memory.state.break_until,until)
 await memory.finishBreak(pace);assert.equal(memory.state.break_until,0);assert.equal(memory.state.next_pause_at,now+25*60000)
})

test('corrupt favourite memory stops the routine rather than resetting its quota',async t=>{
 const dir=await directory(t);await writeFile(path.join(dir,'routine.json'),'{oops')
 await assert.rejects(routineMemory(dir),/mémoire.*illisible/)
})

async function favouriteFixture(t,{confirm=true,control,listing}={}){
 const routine=await routineMemory(await directory(t));let clicks=0,reads=0,requests=0,pressed='false'
 const button={filter(){return this},count:async()=>1,getAttribute:async()=>pressed,click:async()=>{clicks++;if(confirm)pressed='true'}}
 const page={locator:()=>button,evaluate:async()=>listing?listing(++reads,pressed):{...detail,favourite:pressed}}
 const reader=new VisibleVinted({page,binding,routine,pace,check:()=>{},sleep:async()=>{},update:()=>{},random:()=>0,control:async()=>control?control(++requests):{allowed:true,in_window:true,pace}})
 reader.identity=async()=>{}
 return {reader,routine,get clicks(){return clicks}}
}

test('a matching dress is clicked once and counted only after visible confirmation',async t=>{
 const f=await favouriteFixture(t)
 assert.equal(await f.reader.maybeFavourite('101'),true);assert.equal(f.clicks,1);assert.equal(f.reader.favouriteCount,1);assert.equal(f.routine.state.likes[0].state,'confirmed')
 assert.equal(await f.reader.maybeFavourite('101'),false);assert.equal(f.clicks,1)
})

test('site pause, changed criteria or changed price before the click prevent favourites',async t=>{
 for(const scenario of [
  {control:n=>({allowed:n<3,in_window:true,pace})},
  {control:n=>({allowed:true,in_window:true,pace:{...pace,browse_like_enabled:n<3}})},
  {listing:n=>({...detail,price_text:n>=3?'60,00 €':'30,00 €'})},
  {listing:()=>({...detail,price_text:'30,00 € 40,00 €'})},
  {listing:()=>({...detail,favourite:'true'})},
 ]){
  const f=await favouriteFixture(t,scenario);assert.equal(await f.reader.maybeFavourite('101'),false);assert.equal(f.clicks,0)
 }
})

test('an uncertain favourite is left for review, retained in the quota and never clicked twice',async t=>{
 const f=await favouriteFixture(t,{confirm:false})
 await assert.rejects(f.reader.maybeFavourite('101'),e=>e.keep_page===true&&/pas confirmé/.test(e.message))
 assert.equal(f.clicks,1);assert.equal(f.routine.countLikes(),1);assert.equal(f.reader.favouriteCount,0)
 assert.equal(await f.reader.maybeFavourite('101'),false);assert.equal(f.clicks,1)
})

async function runtimeFixture(t,{takeover=false,draft=false,stopped=false,outside=false,between=false,restart=false,resumeEarly=false}={}){
 const dataDir=await directory(t),controller=new AbortController(),events=[],updates=[],pages=[]
 let now=Date.parse('2026-11-14T10:00:00Z'),polls=0,paused=false
 const settings={...pace,browse_enabled:between,browse_items:1,browse_every_minutes:5,browse_after_actions_min:1,browse_after_actions_max:1,session_minutes:between?120:5}
 const memory=await routineMemory(path.join(dataDir,'ylavint',binding.account_id),{now:()=>now,random:()=>0});await memory.initialize(settings)
 if(restart){await memory.beginBreak(settings);now+=2*60000}
 class Reader{
  constructor(options){Object.assign(this,options)}
  async open(){events.push(['open',now])}
  async identity(full){events.push([full?'identity_full':'identity',now])}
  async inbox(){events.push(['inbox',now]);return {conversations:[]}}
  async likes(){events.push(['task',now]);return {likes:[]}}
  async assertNoDraft(){if(draft)throw Object.assign(Error('draft'),{keep_page:true})}
  async browseOne(){events.push(['browse',now]);controller.abort({takeover:true});return true}
 }
 const request=async(_token,action)=>{
  events.push([action,now])
  if(action==='agent_status')return {allowed:!stopped||!paused,in_window:!outside,pace:settings}
  if(action==='agent_preview')return {actions:[]}
  if(action==='agent_context')return {saved:true}
  if(action==='agent_poll'){
   polls++
   if(restart){controller.abort({takeover:true});return {state:'idle'}}
   if(polls===1)return {state:'task',task:{id:'00000000-0000-4000-8000-000000000002',kind:'scan_likes',lease:'lease',lease_until:new Date(now+180000).toISOString()}}
   controller.abort({takeover:true});return {state:'idle'}
  }
  if(action==='agent_result'){now+=5*60000+1;events.push(['ack',now]);return {saved:true}}
  assert.fail(action)
 }
 const work=runDesktop(binding,{start:async()=>({address:'test'})},{signal:controller.signal,dataDir,Reader,request,now:()=>now,random:()=>0,resumeBreak:()=>resumeEarly,update:p=>{updates.push(p);if(p.state==='break')paused=true},waitFor:async ms=>{events.push(['wait',now,ms]);now+=ms;if(takeover&&paused||outside)controller.abort({takeover:true})},connect:async()=>({contexts:()=>[{newPage:async()=>{const p={closed:false,isClosed(){return this.closed},close:async()=>{if(!p.closed){events.push(['close',now]);p.closed=true}}};pages.push(p);return p}}],close:async()=>{events.push(['disconnect',now])}})})
 if(draft)await assert.rejects(work,/draft/);else await work
 return {events,updates,pages,polls,paused,dataDir,now}
}

test('a pause closes only the owned tab after acknowledgement, waits five minutes, then rechecks identity and context',async t=>{
 const r=await runtimeFixture(t),closes=r.events.filter(e=>e[0]==='close'),opens=r.events.filter(e=>e[0]==='open')
 assert.equal(r.pages.length,2);assert.equal(closes.length,1);assert.equal(opens[1][1]-closes[0][1],5*60000)
 assert.ok(r.events.findIndex(e=>e[0]==='ack')<r.events.findIndex(e=>e[0]==='close'))
 const reopened=r.events.findIndex((e,i)=>e[0]==='open'&&i>0&&e[1]===opens[1][1]),tail=r.events.slice(reopened).map(e=>e[0])
 assert.ok(tail.indexOf('identity_full')<tail.indexOf('agent_poll'));assert.ok(tail.indexOf('inbox')<tail.indexOf('agent_poll'))
 assert.equal(r.updates.findLast(p=>p.summary)?.summary.tabs_reopened,1)
})

test('manual takeover or a site pause during a break never reopens the tab',async t=>{
 for(const options of [{takeover:true},{stopped:true}]){const r=await runtimeFixture(t,options);assert.equal(r.pages.length,1);assert.equal(r.pages[0].closed,true);assert.equal(r.polls,1)}
})

test('restarting during a persisted break waits the remaining three minutes before opening Vinted',async t=>{
 const r=await runtimeFixture(t,{restart:true}),opened=r.events.find(e=>e[0]==='open')
 assert.equal(opened[1],Date.parse('2026-11-14T10:05:00Z'));assert.equal(r.pages.length,1);assert.equal(r.polls,1)
 assert.equal(r.events.filter(e=>e[0]==='wait').reduce((n,e)=>n+e[2],0),3*60000)
})

test('outside planning no Vinted tab is created and a draft prevents a planned close',async t=>{
 const outside=await runtimeFixture(t,{outside:true});assert.equal(outside.pages.length,0);assert.equal(outside.polls,0)
 const draft=await runtimeFixture(t,{draft:true});assert.equal(draft.pages.length,1);assert.equal(draft.pages[0].closed,false)
})

test('the home resume button ends a programmed break but still verifies identity and context',async t=>{
 const r=await runtimeFixture(t,{restart:true,resumeEarly:true})
 assert.equal(r.events.find(e=>e[0]==='open')[1],Date.parse('2026-11-14T10:02:00Z'))
 assert.ok(r.events.findIndex(e=>e[0]==='identity_full')<r.events.findIndex(e=>e[0]==='agent_poll'))
 assert.ok(r.events.findIndex(e=>e[0]==='inbox')<r.events.findIndex(e=>e[0]==='agent_poll'))
})

test('consultation occurs between acknowledged tasks even without an idle poll',async t=>{
 const r=await runtimeFixture(t,{between:true})
 assert.equal(r.polls,1);assert.ok(r.events.findIndex(e=>e[0]==='browse')>r.events.findIndex(e=>e[0]==='ack'))
 assert.equal(r.paused,false)
})
