import test from 'node:test'
import assert from 'node:assert/strict'
import {VisibleVinted,PACE,BASE,sameVintedRoute} from './ylavint-visible.mjs'
import {dueScans,normalizeSettings} from '../../server/vinted-agent.js'

function fixture(){
 let clock=0,url='about:blank',loading=0
 const visits=[],waits=[],clicks=[],updates=[]
 const snapshot=()=>({url,login:loading-->0?null:'demo',text:'Messages',conversation:true,links:[],cards:[],messages:[],notices:[]})
 const page={url:()=>url,goto:async to=>{visits.push({url:to,at:clock});url=to},bringToFront:async()=>{},evaluate:async fn=>fn.name==='visibleDraft'?false:snapshot()}
 const reader=new VisibleVinted({page,binding:{login:'demo'},pace:PACE,check:()=>{},update:x=>updates.push(x),sleep:async ms=>{waits.push(ms);clock+=ms},now:()=>clock})
 return {reader,page,visits,waits,clicks,updates,get clock(){return clock},set loading(n){loading=n},set url(v){url=v}}
}
test('reading the current inbox and its selected conversation never reloads it',async()=>{
 const f=fixture();await f.reader.open('/inbox/55')
 await f.reader.open('/inbox');await f.reader.open('/inbox/55')
 f.url=BASE+'/inbox/55?referrer=%2Finbox&offer_request=true'
 await f.reader.open('/inbox/55')
 assert.equal(f.visits.length,1)
})
test('route changes leave a full reading interval and prefer the existing visible link',async()=>{
 const f=fixture();await f.reader.open('/inbox/55');const settled=f.clock
 f.reader.snapshot=async()=>({url:f.page.url(),login:'demo',text:'Notifications',links:[{href:BASE+'/member/notifications'}],notices:[]})
 const link={count:async()=>1,getAttribute:async()=>'/member/notifications',isVisible:async()=>true,click:async()=>{f.clicks.push(f.clock);f.url=BASE+'/member/notifications'}}
 f.page.locator=()=>({...link,all:async()=>[link]})
 await f.reader.open('/member/notifications')
 assert.equal(f.visits.length,1);assert.equal(f.clicks.length,1)
 assert.ok(f.clicks[0]-settled>=10000)
 assert.ok(f.updates.some(x=>x.next_navigation_at))
})
test('hydration is awaited by reading DOM without retrying navigation',async()=>{
 const f=fixture();f.loading=5;await f.reader.open('/inbox/55')
 assert.equal(f.visits.length,1);assert.ok(f.waits.filter(x=>x===500).length>=5)
})
test('only an explicit scan may refresh a stale page; actions keep the loaded conversation',async()=>{
 const f=fixture();let refreshes=0;f.page.reload=async()=>{refreshes++}
 await f.reader.open('/member/notifications');await f.reader.sleep(180001)
 await f.reader.open('/member/notifications');assert.equal(refreshes,0)
 await f.reader.open('/member/notifications',{refresh:true});await f.reader.open('/member/notifications',{refresh:true})
 assert.equal(refreshes,1);assert.equal(f.visits.length,1)
})
test('neither navigation nor an explicit refresh discards a visible draft',async()=>{
 const f=fixture();let refreshes=0;f.page.reload=async()=>{refreshes++}
 await f.reader.open('/inbox/55');await f.reader.sleep(180001)
 f.reader.assertNoDraft=async()=>{throw Error('brouillon présent')}
 await f.reader.open('/inbox/55')
 await assert.rejects(f.reader.open('/inbox/55',{refresh:true}),/brouillon/)
 await assert.rejects(f.reader.open('/inbox/66'),/brouillon/)
 assert.equal(refreshes,0);assert.equal(f.visits.length,1)
})
test('the notifications bell is followed through its visible View all link',async()=>{
 const f=fixture();await f.reader.open('/')
 let bell=0,all=0
 f.reader.snapshot=async()=>({url:f.page.url(),login:'demo',text:'Notifications',links:[{href:BASE+'/member/notifications'}],notices:[]})
 const link={count:async()=>1,getAttribute:async()=>'/member/notifications',isVisible:async()=>true,click:async()=>{bell++}}
 f.page.locator=()=>({...link,all:async()=>[link]})
 const seeAll={filter(){return this},first(){return this},waitFor:async()=>{},count:async()=>1,getAttribute:async()=>'/member/notifications',click:async()=>{all++;f.url=BASE+'/member/notifications'}}
 f.page.getByRole=()=>seeAll
 await f.reader.open('/member/notifications')
 assert.equal(bell,1);assert.equal(all,1);assert.equal(f.visits.length,1)
})
test('a conversation button switches the loaded inbox without direct navigation',async()=>{
 const f=fixture();await f.reader.open('/inbox/55');let clicks=0
 f.reader.snapshot=async()=>({url:f.page.url(),login:'demo',text:'Messages',conversation:true,links:[],inboxRows:[{id:'66'}],messages:[]})
 f.page.locator=selector=>{assert.match(selector,/inbox-list-item-66/);return {count:async()=>1,click:async()=>{clicks++;f.url=BASE+'/inbox/66'}}}
 await f.reader.open('/inbox/66');assert.equal(clicks,1);assert.equal(f.visits.length,1)
})

test('new replies are prioritized without waiting for a full inbox rotation',async()=>{
 const reader=new VisibleVinted({pace:{...PACE,response_priority:false}}),opened=[]
 let rows=Array.from({length:10},(_,i)=>({id:String(i+1),text:`buyer ${i+1}\nil y a 5 minutes\nAncien message ${i+1}`}))
 reader.identity=async()=>{}
 reader.open=async path=>{if(path==='/inbox')return {inboxRows:rows,links:[],text:'Messages'};opened.push(path.split('/').at(-1))}
 reader.thread=async()=>({id:opened.at(-1)})
 const scan=async()=>(await reader.inbox()).conversations.map(c=>c.id)
 assert.deepEqual(await scan(),['1','2','3','4'])
 // Time labels alone do not steal priority from older threads.
 rows=rows.map(r=>({...r,text:r.text.replace('5 minutes','6 minutes')}))
 assert.deepEqual(await scan(),['1','2','5','6'])
 rows[3]={...rows[3],text:'buyer 4\nil y a 1 minute\nNouvelle question'}
 assert.deepEqual(await scan(),['4','1','2','7'])
 assert.deepEqual(await scan(),['1','2','8','9'])
 // Newly received threads at the head are checked on the next scan too.
 rows.unshift({id:'11',text:'nouvel acheteur\nil y a 1 minute\nBonjour'})
 assert.deepEqual(await scan(),['11','1','9','10'])
 const before=reader.inboxOffset
 assert.deepEqual((await reader.inbox({conversation_ids:['6']})).conversations.map(c=>c.id),['6'])
 assert.equal(reader.inboxOffset,before)
})
test('an unreadable page stops after bounded waiting instead of a refresh loop',async()=>{
 const f=fixture();f.loading=100
 await assert.rejects(f.reader.open('/inbox/55'),/stabilisée/)
 assert.equal(f.visits.length,1);assert.ok(f.clock<20000)
})

test('priority inbox bounds each batch, visits new and changed threads, then rotates history',async()=>{
 const reader=new VisibleVinted({pace:{...PACE,response_priority:true}}),opened=[]
 let rows=Array.from({length:6},(_,i)=>({id:String(i+1),text:`buyer ${i+1} il y a 1 minute message`}))
 reader.identity=async()=>{}
 reader.open=async path=>path==='/inbox'?{inboxRows:rows,links:[],text:'Messages'}:opened.push(path.split('/').at(-1))
 reader.thread=async()=>({id:opened.at(-1)})
 const scan=async()=>(await reader.inbox()).conversations.map(c=>c.id)
 assert.deepEqual(await scan(),['1','2'])
 assert.deepEqual(await scan(),['3','4'])
 rows[1]={...rows[1],text:'buyer 2 Nouvelle question'}
 assert.deepEqual(await scan(),['2','5'])
 assert.deepEqual(await scan(),['6','1'])
 assert.equal((await scan()).length,2)
 rows.unshift({id:'7',text:'nouvel acheteur'})
 assert.equal((await scan())[0],'7')
})
test('desktop scan deadlines leave two minutes for inbox and three for favourites',()=>{
 const now=Date.parse('2026-11-15T12:00:00Z'),settings=normalizeSettings({messaging:{executor:'desktop',desktop:{response_priority:false},sync_seconds:20},features:{inbox:true,likes:true}})
 const last={sync_inbox:new Date(now-60000).toISOString(),scan_likes:new Date(now-150000).toISOString(),scan_wardrobe:new Date(now).toISOString()}
 assert.ok(!dueScans(settings,last,now).includes('sync_inbox'));assert.ok(!dueScans(settings,last,now).includes('scan_likes'))
 assert.ok(dueScans(settings,last,now+121000).includes('sync_inbox'));assert.ok(dueScans(settings,last,now+121000).includes('scan_likes'))
 settings.messaging.sync_seconds=600
 assert.ok(!dueScans(settings,last,now+121000).includes('sync_inbox'))
})
function offerFixture({draft='',escapeWorks=false,missing=false,staysOpen=false}={}){
 let open=true,clicked=0,escaped=0
 const dialog={locator:selector=>selector.startsWith('input')?{count:async()=>1,inputValue:async()=>draft}:{count:async()=>missing?0:1,click:async()=>{clicked++;if(!staysOpen)open=false}},waitFor:async()=>{if(open)throw Error('still visible')}}
 const reader=new VisibleVinted({page:{keyboard:{press:async()=>{escaped++;if(escapeWorks)open=false}}},check:()=>{}})
 return {reader,dialog,get clicked(){return clicked},get escaped(){return escaped},get open(){return open}}
}
test('an ignored Escape falls back to the observed close cross and verifies dismissal',async()=>{
 const f=offerFixture();await f.reader.closeEmptyOffer(f.dialog)
 assert.equal(f.clicked,1);assert.equal(f.open,false)
 const escaped=offerFixture({escapeWorks:true});await escaped.reader.closeEmptyOffer(escaped.dialog);assert.equal(escaped.clicked,0)
})
test('closing an offer never clears an entered price or clicks another button',async()=>{
 const drafted=offerFixture({draft:'40'});await assert.rejects(drafted.reader.closeEmptyOffer(drafted.dialog),/déjà saisi/);assert.equal(drafted.escaped,0);assert.equal(drafted.clicked,0)
 const missing=offerFixture({missing:true});await assert.rejects(missing.reader.closeEmptyOffer(missing.dialog),/identifiable/);assert.equal(missing.clicked,0)
 const stuck=offerFixture({staysOpen:true});await assert.rejects(stuck.reader.closeEmptyOffer(stuck.dialog),/encore ouvert/);assert.equal(stuck.clicked,1)
})

test('an article redirect to its canonical title is ready and reused',async()=>{
 const f=fixture()
 f.page.goto=async url=>{f.visits.push(url);f.url=url+'-robe-verte-taille-s'}
 await f.reader.open('/items/10577522169');await f.reader.open('/items/10577522169')
 assert.equal(f.visits.length,1);assert.ok(f.clock<10000)
 assert.equal(sameVintedRoute(BASE+'/items/123-robe',BASE+'/items/123'),true)
 for(const path of ['/items/1234-robe','/items/123/edit','/items/123/photos','/member/123'])assert.equal(sameVintedRoute(BASE+path,BASE+'/items/123'),false)
 assert.equal(sameVintedRoute('https://example.com/items/123',BASE+'/items/123'),false)
})

test('a favourite verification includes article availability before its conversation',async()=>{
 const f=fixture(),events=[]
 f.reader.availableItem=async id=>events.push(['item',id])
 f.reader.openLike=async()=>{events.push(['favourite']);return '55'}
 f.reader.identity=async()=>{};f.reader.thread=async()=>({id:'55'})
 await f.reader.verifyFavourite({item_id:'123'})
 assert.deepEqual(events,[['item','123'],['favourite']])
})
