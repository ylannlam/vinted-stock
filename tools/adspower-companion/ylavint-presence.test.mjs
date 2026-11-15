import test from 'node:test'
import assert from 'node:assert/strict'
import {EventEmitter} from 'node:events'
import vm from 'node:vm'
import {createPresence,humanActivityClock,interrupted,mayRetryInterrupted} from './ylavint-presence.mjs'
import {visibleDraft} from './ylavint-browsing.mjs'
import {runDesktop} from './ylavint.mjs'
import {taskJournal} from './ylavint-journal.mjs'
import {mkdtemp,rm} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import path from 'node:path'
import {randomUUID} from 'node:crypto'

test('each human event resets the quiet period; resetting releases the next action',()=>{
  let time=1000;const clock=humanActivityClock(()=>time)
  assert.equal(clock.pending,false);clock.touch();time+=59000;assert.equal(clock.remaining(),1000)
  clock.touch();assert.equal(clock.remaining(),60000);time+=60000;assert.equal(clock.remaining(),0)
  assert.equal(clock.pending,true);clock.reset();assert.equal(clock.pending,false)
})

function fixture(){
  let time=1000,draft=false,clicks=0,notified=0
  const listeners=new Map(),window={addEventListener:(name,fn)=>listeners.set(name,fn),removeEventListener:name=>listeners.delete(name)}
  const sandbox=vm.createContext({window})
  const page=new EventEmitter(),context=new EventEmitter()
  const emit=name=>listeners.get(name)?.({type:name,isTrusted:true})
  Object.assign(context,{pages:()=>[page],newPage:async()=>page,exposeBinding:async(name,fn)=>{window[name]=async()=>{notified++;return fn({page})}}})
  const field={click:async()=>{clicks++;emit('pointerdown')},pressSequentially:async()=>{emit('keydown');emit('input')},inputValue:async()=>'',evaluateAll:async()=>false}
  Object.assign(page,{url:()=> 'https://www.vinted.fr/inbox',close:async()=>{},isClosed:()=>false,mainFrame:()=>page,
    addInitScript:async()=>{},evaluate:async(fn,arg)=>fn===visibleDraft?draft:vm.runInContext('('+fn.toString()+')',sandbox)(arg),locator:()=>field,
    goto:async()=>{emit('keydown')}
  })
  return {context,page,emit,get clicks(){return clicks},get notified(){return notified},now:()=>time,advance:ms=>{time+=ms},setDraft:value=>{draft=value}}
}

test('own clicks and typing are not human activity; a human event blocks the next input',async()=>{
  const f=fixture(),presence=await createPresence(f.context,{now:f.now}),page=await presence.page(f.page)
  await page.locator('textarea').click();await page.locator('textarea').pressSequentially('hello')
  assert.equal(presence.pending,false);assert.equal(f.notified,0)
  f.emit('wheel');assert.equal(presence.pending,true)
  await assert.rejects(page.locator('textarea').click(),e=>e.code==='desktop_interrupted');assert.equal(f.clicks,1)
  await presence.dispose();assert.equal(f.context.listenerCount('page'),0);assert.equal(f.page.listenerCount('framenavigated'),0)
})

test('keyboard input during agent navigation is not suppressed as an agent click',async()=>{
  const f=fixture(),presence=await createPresence(f.context,{now:f.now}),page=await presence.page(f.page)
  await assert.rejects(page.goto('https://www.vinted.fr/inbox'),e=>e.code==='desktop_interrupted')
  assert.equal(presence.pending,true);await presence.dispose()
})

test('user navigation without a DOM input event also yields',async()=>{
  const f=fixture(),presence=await createPresence(f.context,{now:f.now});await presence.page(f.page)
  f.page.url=()=> 'https://www.vinted.fr/items/42';f.page.emit('framenavigated',f.page)
  await assert.rejects(presence.guard(),e=>e.code==='desktop_interrupted');await presence.dispose()
})

test('waiting protects a draft indefinitely and resumes only after the last interaction',async()=>{
  const f=fixture(),presence=await createPresence(f.context,{now:f.now});await presence.page(f.page)
  f.emit('pointerdown');f.setDraft(true)
  let ticks=0;const updates=[]
  assert.equal(await presence.wait({signal:new AbortController().signal,control:async()=>({allowed:true}),update:x=>updates.push(x),sleep:async ms=>{
    f.advance(ms);ticks++
    if(ticks===40){assert.equal(presence.pending,true);f.setDraft(false);f.emit('input')}
    assert.ok(ticks<=70)
  }}),true)
  assert.equal(ticks,70);assert.equal(presence.pending,false)
  assert.ok(updates.some(x=>x.state==='user_wait'&&x.message.includes('brouillon')&&x.resume_at===null));await presence.dispose()
})

test('manual pause and Stop terminate the wait without automatic resumption',async()=>{
  for(const stop of ['pause','stop']){
    const f=fixture(),presence=await createPresence(f.context,{now:f.now});await presence.page(f.page);f.emit('wheel')
    const controller=new AbortController();let calls=0
    const result=await presence.wait({signal:controller.signal,control:async()=>({allowed:stop!=='pause'||++calls===1}),update:()=>{},sleep:async ms=>{f.advance(ms);if(stop==='stop')controller.abort()}})
    assert.equal(result,false);assert.equal(presence.pending,true);await presence.dispose()
  }
})

test('a publication or any submission record forbids automatic replay',()=>{
  assert.equal(mayRetryInterrupted({kind:'sync_inbox'},null),true)
  assert.equal(mayRetryInterrupted({kind:'reply_message'},{steps:{}}),true)
  for(const row of [{steps:{message:'submitting'}},{steps:{offer:'confirmed'}},{confirmed:{message:{id:'sent'}}}])assert.equal(mayRetryInterrupted({kind:'like_message'},row),false)
  assert.equal(mayRetryInterrupted({kind:'publish_item'},{steps:{}}),false)
  assert.equal(interrupted().keep_page,true)
})

for(const kind of ['scan_likes','like_message'])test(`${kind}: takeover releases the lease and resumes the same work after rereading context`,async t=>{
  const dir=await mkdtemp(path.join(tmpdir(),'ylavint-presence-'))
  t.after(async()=>{if(path.dirname(dir)===tmpdir()&&path.basename(dir).startsWith('ylavint-presence-'))await rm(dir,{recursive:true,force:true})})
  const f=fixture(),account_id=randomUUID(),id=randomUUID(),updates=[],reports=[]
  const leases=[randomUUID(),randomUUID()];let attempts=0,reads=0,polls=0,done=false
  class Reader{
    constructor(options){Object.assign(this,options)}
    async open(){} async identity(){}
    async inbox(){reads++;return {conversations:[]}}
    async attempt(){if(++attempts===1)f.emit('wheel');await this.page.locator('x').inputValue()}
    async likes(){await this.attempt();return {likes:[]}}
    async memberFilter(){await this.attempt();return 'Test sans envoi'}
  }
  await runDesktop({account_id,member_id:'123',profile_id:'p42',token:'test'},{start:async()=>({address:'test'})},{
    signal:new AbortController().signal,dataDir:dir,Reader,now:f.now,waitFor:async ms=>f.advance(ms),update:x=>updates.push(x),
    connect:async()=>({contexts:()=>[f.context],close:async()=>{}}),request:async(_token,action,body)=>{
      if(action==='agent_status')return {allowed:!done,in_window:true,pace:{}}
      if(action==='agent_preview')return {actions:[]}
      if(action==='agent_context')return {saved:true}
      if(action==='agent_poll'){assert.ok(polls<2);return {state:'task',task:{id,kind,lease:leases[polls++],payload:{},lease_until:new Date(f.now()+180000).toISOString()}}}
      if(action==='agent_result'){reports.push(body);if(body.code==='desktop_interrupted')return {saved:true,requeued:true};done=true;return {saved:true}}
      assert.fail(action)
    }
  })
  assert.equal(attempts,2);assert.equal(reads,2);assert.equal(reports.length,2)
  assert.equal(reports[0].before_submission,true);assert.equal(reports[1].ok,true)
  assert.ok(f.now()>=71000);assert.ok(updates.some(x=>x.state==='user_wait'));assert.equal(f.clicks,0)
  if(kind==='like_message'){const row=await taskJournal(path.join(dir,'ylavint',account_id)).read(id);assert.equal(row.state,'acknowledged');assert.equal(row.lease,leases[1]);assert.equal(row.resumed_after_interruption,true)}
})

test('real browser input: agent click, reload, human scroll, draft and idle resumption',{skip:process.env.YLAVINT_BROWSER_TEST!=='1'},async t=>{
  const {chromium}=await import('playwright-core')
  const browser=await chromium.launch({channel:'msedge',headless:true})
  t.after(()=>browser.close())
  const context=await browser.newContext()
  // All requests are fulfilled locally; no Vinted account or service is used.
  await context.route('**/*',route=>route.fulfill({contentType:'text/html',body:'<html><body style="height:4000px"><button onclick="history.pushState({},\'\',\'/inbox/55\')">Conversation</button><textarea></textarea></body></html>'}))
  let time=1000
  const presence=await createPresence(context,{now:()=>time}),raw=await context.newPage(),page=await presence.page(raw)
  await page.goto('https://www.vinted.fr/inbox')
  await page.getByRole('button').click()
  await page.reload()
  await page.locator('textarea').pressSequentially('Texte de test')
  assert.equal(presence.pending,false,'agent navigation and keyboard must not trigger takeover')
  // Unwrapped inputs stand in for manual browser input: trusted DOM events.
  await raw.mouse.wheel(0,150)
  await assert.rejects(page.getByRole('button').click(),e=>e.code==='desktop_interrupted')
  let ticks=0
  const resumed=await presence.wait({signal:new AbortController().signal,control:async()=>({allowed:true}),update:()=>{},sleep:async ms=>{
    time+=ms;ticks++
    if(ticks===35){assert.equal(await raw.locator('textarea').inputValue(),'Texte de test');await raw.locator('textarea').fill('')}
    assert.ok(ticks<70)
  }})
  assert.equal(resumed,true);assert.equal(ticks,65)
  await page.getByRole('button').click();assert.equal(presence.pending,false)
  await presence.dispose()
})
