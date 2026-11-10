import test from 'node:test'
import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'
import {execFileSync} from 'node:child_process'
import {fileURLToPath} from 'node:url'

// Page Vinted simulée : on rejoue les tâches de l'agent contre un faux site Vinted et on regarde les requêtes envoyées.
const calls = [], posted = []
let handler = null, vinted = async () => ({status: 404, body: {}})
globalThis.window = {
  fetch: async (url, init = {}) => {
    calls.push({url: String(url), method: init.method || 'GET', headers: init.headers || {}, body: init.body})
    const r = await vinted(String(url), init)
    const text = typeof r.body === 'string' ? r.body : JSON.stringify(r.body)
    return {ok: r.status >= 200 && r.status < 300, status: r.status, headers: {get: k => k === 'content-type' ? r.type || 'application/json' : null}, text: async () => text, arrayBuffer: async () => new TextEncoder().encode(text).buffer}
  },
  addEventListener: (type, fn) => { if (type === 'message') handler = fn },
  postMessage: msg => posted.push(msg),
}
globalThis.location = {origin: 'https://www.vinted.fr', href: 'https://www.vinted.fr/'}
globalThis.document = {cookie: 'anon_id=anon-1', querySelector: () => ({content: 'csrf-1'}), scripts: []}
await import('../extensions/ylavint/page.js')
const T = globalThis.__svAgentTest

test('notifications: offering_id is the liker; user_id is the seller', async()=>{
  const notification={entry_type:20,body:'alice a marqué ton article comme favori',user_id:7,subject_id:9,link:'/items/9/want_it/new?offering_id=88'}
  assert.deepEqual(T.notificationLike(notification,'7'),{item_id:'9',user_id:'88',login:'alice',liked_at:null})
  assert.equal(T.notificationLike({...notification,updated_at:'2026-11-08T12:00:00Z'},'7').liked_at,'2026-11-08T12:00:00Z')
  assert.equal(T.notificationLike({...notification,link:'/items/9'},'7'),null)
  calls.length=0
  vinted=async()=>({status:200,body:{notifications:[notification],pagination:{total_pages:1}}})
  const r=await run({kind:'scan_likes',member_id:'7',recipes:{likes_list:{method:'GET',path:'/api/v2/notifications'}}})
  assert.equal(r.result.likes.length,1);assert.equal(r.result.notifications,1)
  // Lien absolu ou adresse d'application : les identifiants sont quand même lus.
  assert.deepEqual(T.notificationLike({...notification,link:'https://www.vinted.fr/items/9/want_it/new?offering_id=88'},'7')?.user_id,'88')
  assert.deepEqual(T.notificationLike({...notification,link:'vintedfr://items/9/want_it/new?offering_id=88'},'7')?.item_id,'9')
  assert.match(calls[0].url,/^https:\/\/api.vinted.fr\/inbox-notifications\/v1\/notifications/)
  assert.equal(calls[0].headers['x-csrf-token'],undefined)
  assert.equal(calls[0].headers['x-anon-id'],undefined)
})

test('offer acceptance rechecks current status, buyer and exact price before PUT',async()=>{
  const offer={id:'30',transaction_id:'20',buyer_id:'88',price:40,original_price:50,currency:'EUR',is_bundle:false}
  const cfg={enabled:true,single_discount:20,bundle_discount:10}
  const conversation={transaction:{id:20,seller_id:7,buyer_id:88,current_user_side:'seller',is_bundle:false},messages:[{entity_type:'offer_request_message',entity:{offer_request_id:30,transaction_id:20,user_id:88,current:true,status:10,price:{amount:'40',currency_code:'EUR'},original_price:{amount:'50'}}}]}
  const recipes={conversation_read:{method:'GET',path:'/api/v2/conversations/{id}'},offer_accept:{method:'PUT',path:'/api/v2/transactions/{id}/offer_requests/{offer_id}/accept'}}
  const task={kind:'accept_offer',member_id:'7',recipes,payload:{conversation_id:'10',offer,offer_settings:cfg}}
  calls.length=0;vinted=async()=>({status:200,body:{conversation}})
  assert.equal((await run(task)).result.accepted,true)
  assert.equal(calls.at(-1).method,'PUT');assert.match(calls.at(-1).url,/transactions\/20\/offer_requests\/30\/accept$/)
  for(const alter of [()=>conversation.messages[0].entity.status=20,()=>conversation.messages[0].entity.price.amount='39',()=>conversation.transaction.seller_id=8,()=>cfg.enabled=false]){
    conversation.messages[0].entity.status=10;conversation.messages[0].entity.price.amount='40';conversation.transaction.seller_id=7;cfg.enabled=true
    alter();calls.length=0
    assert.ok((await run(task)).result.skipped);assert.ok(calls.every(c=>c.method==='GET'))
  }
})

async function run(task) {
  const id = crypto.randomUUID()
  await handler({source: window, origin: location.origin, data: {source: 'sva-ext', type: 'run', id, task}})
  return posted.find(p => p.type === 'result' && p.id === id).payload
}

test('automatic replies recheck the current conversation before sending on both messaging APIs',async()=>{
  const uuid='12345678-1234-4234-8234-123456789abc'
  const recipes={conversation_read:{method:'GET',path:'/api/v2/conversations/{id}'},message_send:{method:'POST',path:'/api/v2/conversations/{id}/replies',template:{reply:{body:''}}}}
  for(const id of ['42',uuid]){
    const modern=id===uuid
    T.setChat(modern?'v2':'v1')
    const task={kind:'reply_message',member_id:'7',recipes,payload:{conversation_id:id,body:'Je vérifie.',source:'ai',manual:false,source_message_id:'m1'}}
    for(const [lastId,sender,shouldSend] of [['m1','88',true],['m2','88',false],['m2','7',false]]){
      calls.length=0
      vinted=async(_url,init)=>{
        if(init.method==='POST')return {status:200,body:{reply:{id:'sent'},data:{id:'sent'}}}
        return {status:200,body:modern?{id,messages:[{id:lastId,sender_id:sender,created_at:'2026-11-10T12:00:00Z',data:{content:'Une question'}}]}:
          {conversation:{id,messages:[{entity_type:'message',created_at_ts:1794312000,entity:{id:lastId,user_id:sender,body:'Une question'}}]}}}
      }
      const r=await run(task)
      assert.equal(r.ok,true,r.error)
      assert.equal(calls.filter(c=>c.method==='POST').length,shouldSend?1:0)
      if(!shouldSend)assert.equal(r.result.context_changed,true)
    }
    calls.length=0
    await run({...task,payload:{...task.payload,manual:true}})
    assert.equal(calls.length,1,'explicitly approved replies are not overridden');assert.equal(calls[0].method,'POST')
  }
  T.forgetChat()
})

test('an unreadable conversation never triggers an automatic reply',async()=>{
  T.setChat('v1');calls.length=0
  vinted=async()=>({status:200,body:{conversation:{id:'42'}}})
  const r=await run({kind:'reply_message',member_id:'7',recipes:{},payload:{conversation_id:'42',body:'Bonjour',source:'ai',source_message_id:'m1'}})
  assert.equal(r.ok,false);assert.ok(calls.every(c=>c.method==='GET'))
  T.forgetChat()
})

test('likes: fresh buyer message or offer cancels the initial message and follow-up',async t=>{
 t.mock.method(globalThis,'setTimeout',fn=>{queueMicrotask(fn);return 0})
 const recipes={conversation_create:{method:'POST',path:'/api/v2/conversations',template:{item_id:0,opposite_user_id:0}},conversation_read:{method:'GET',path:'/api/v2/conversations/{id}'},message_send:{method:'POST',path:'/api/v2/conversations/{id}/replies',template:{reply:{body:''}}}}
 const task={kind:'like_message',member_id:'7',recipes,payload:{item_id:'9',user_id:'88',message:'Merci pour ton like !'}}
 for(const incoming of [{entity_type:'message',entity:{user_id:88,body:'Bonjour, disponible ?'}},{entity_type:'offer_request_message',entity:{user_id:88,price:{amount:40}}},{entity_type:'message',entity:{user_id:88,photos:[{id:1}]}}]){
   vinted=async url=>({status:200,body:url.endsWith('/api/v2/conversations')?{conversation:{id:10,messages:[]}}:{conversation:{id:10,messages:[incoming]}}})
   for(const followup of [false,true]){
     calls.length=0
     const r=await run({...task,payload:{...task.payload,followup,conversation_id:'10'}})
     assert.equal(r.result.buyer_engaged,true);assert.equal(r.result.conversation_id,'10')
     assert.ok(r.result.skipped);assert.ok(calls.every(c=>!c.url.endsWith('/replies')),'no thanks message sent')
   }
 }
 calls.length=0;vinted=async url=>({status:200,body:url.endsWith('/api/v2/conversations')?{conversation:{id:10}}:{conversation:{id:10,messages:[{entity:{user_id:7,body:'Ancien message vendeur'}}]}}})
 assert.equal((await run(task)).result.message,'Merci pour ton like !')
 assert.equal(calls.filter(c=>c.url.endsWith('/replies')).length,1,'seller messages alone do not suppress a like')
 calls.length=0;vinted=async()=>({status:200,body:{conversation:{id:10}}})
 assert.equal((await run(task)).ok,false,'unreadable conversation fails closed')
 assert.ok(calls.every(c=>!c.url.endsWith('/replies')))
 t.mock.restoreAll()
})

test('history reads paginate beyond the initial page and stop at the time boundary',async t=>{
 t.mock.method(globalThis,'setTimeout',fn=>{queueMicrotask(fn);return 0})
 const since='2026-11-08T00:00:00Z',notification={entry_type:20,user_id:7,link:'/items/9/want_it/new?offering_id=88',updated_at:'2026-11-08T06:00:00Z'}
 let old=false
 vinted=async()=>({status:200,body:{notifications:Array.from({length:50},()=>({...notification,updated_at:old?'2026-11-07T06:00:00Z':notification.updated_at})),pagination:{total_pages:10}}})
 const task={kind:'scan_likes',member_id:'7',recipes:{},payload:{history_page:6,history_since:since}}
 calls.length=0
 assert.equal((await run(task)).result.more_history,true)
 assert.equal(new URL(calls[0].url).searchParams.get('page'),'6')
 old=true;assert.equal((await run(task)).result.more_history,false)
 t.mock.restoreAll()
})
const R = {
  item_form: {method: 'GET', path: '/api/v2/item_upload/items/{id}', headers: {}},
  item_edit: {method: 'PUT', path: '/api/v2/item_upload/items/{id}', headers: {'x-money-object': 'true'}, body: 'json',
    template: {item: {id: 0, title: '', description: '', price: {amount: '0', currency_code: 'EUR'}, assigned_photos: [], color_ids: [], is_unisex: false}, feedback_id: null, upload_session_id: 'old'}},
  photo_upload: {method: 'POST', path: '/api/v2/photos', body: 'form', fields: [{name: 'photo[type]', value: 'item'}, {name: 'photo[file]', value: null}, {name: 'photo[temp_uuid]', value: null}]},
}

test('unmask: same photos sent again, a dot added, price lowered; Vinted headers come from the open session', async () => {
  calls.length = 0
  let photo = 100
  vinted = async (url, init) => {
    if (url.includes('/item_upload/items/77') && (init.method || 'GET') === 'GET') return {status: 200, body: {item: {id: 77, title: 'Robe', description: 'Belle robe', price: {amount: '10.0', currency_code: 'EUR'}, color_ids: [1], photos: [{id: 1, url: 'https://www.vinted.fr/p/1.jpg'}, {id: 2, url: 'https://www.vinted.fr/p/2.jpg'}]}}}
    if (url.includes('/p/')) return {status: 200, body: 'JPEGDATA', type: 'image/jpeg'}
    if (url.endsWith('/api/v2/photos')) return {status: 200, body: {id: ++photo}}
    if (init.method === 'PUT') return {status: 200, body: {item: {id: 77}}}
    return {status: 404, body: {}}
  }
  const r = await run({kind: 'unmask_item', payload: {item_id: '77', price: 10, new_price: 9}, recipes: R})
  assert.deepEqual(r, {ok: true, result: {item_id: '77', price: 9}})
  const put = calls.find(c => c.method === 'PUT'), body = JSON.parse(put.body)
  assert.equal(body.item.description, 'Belle robe.')
  assert.deepEqual(body.item.price, {amount: '9.00', currency_code: 'EUR'})
  assert.deepEqual(body.item.assigned_photos.map(p => p.id), [101, 102], 'new photo ids, same order')
  assert.equal(body.item.title, 'Robe'); assert.equal(body.item.id, 77); assert.notEqual(body.upload_session_id, 'old')
  assert.equal(put.headers['x-csrf-token'], 'csrf-1'); assert.equal(put.headers['x-anon-id'], 'anon-1'); assert.equal(put.headers['x-money-object'], 'true')
  assert.equal(calls.filter(c => c.url.endsWith('/api/v2/photos')).length, 2)
})
test('Vinted refusals become stop codes (captcha, session, rate limit)', async () => {
  vinted = async () => ({status: 403, body: '{"url":"https://geo.captcha-delivery.com/captcha/"}'})
  assert.equal((await run({kind: 'reprice_item', payload: {item_id: '1', new_price: 5}, recipes: R})).code, 'captcha')
  vinted = async () => ({status: 401, body: {}})
  assert.equal((await run({kind: 'reprice_item', payload: {item_id: '1', new_price: 5}, recipes: R})).code, 'logged_out')
  vinted = async () => ({status: 429, body: {}})
  assert.equal((await run({kind: 'scan_wardrobe', member_id: '5', payload: {}, recipes: {}})).code, 'rate_limited')
  assert.equal((await run({kind: 'sync_orders', payload: {}, recipes: {}})).code, 'no_recipe', 'nothing guessed without a recipe')
})
test('wardrobe pages are read until the last one, hidden listings are flagged', async () => {
  vinted = async url => {
    const page = Number(new URL(url).searchParams.get('page'))
    return {status: 200, body: {items: page === 1 ? [{id: 1, title: 'A', price: {amount: '5.0', currency_code: 'EUR'}, is_hidden: false}, {id: 2, title: 'B', price: '7', item_box: {badge: {title: 'Masqué du catalogue'}}}] : [{id: 3, title: 'C', is_closed: true}],
      pagination: {current_page: page, total_pages: 2}}}
  }
  const r = await run({kind: 'scan_wardrobe', member_id: '3206068112', payload: {}, recipes: {}})
  assert.equal(r.ok, true); assert.equal(r.result.complete, true)
  assert.deepEqual(r.result.items.map(i => [i.id, i.is_hidden, i.is_closed]), [[1, false, false], [2, true, false], [3, false, true]])
  assert.match(calls.at(-1).url, /\/api\/v2\/wardrobe\/3206068112\/items\?.*page=2/)
})
test('a new listing is built from the learned template and the site sheet', () => {
  const body = T.fillItem({item: {id: 9, title: 'x', price: 1, color1_id: null, color2_id: null, temp_uuid: '', is_draft: false, isbn: null}, upload_session_id: ''},
    {title: 'Robe', description: 'Belle', price: '12.5', catalog_id: 10, brand_id: 3, brand_title: 'Shein', size_id: 4, status_id: 6, package_size_id: 1, color_ids: [7, 8], item_attributes: []},
    [{id: 1, orientation: 0}], {tempUuid: 'tmp', live: false})
  assert.deepEqual(body.item, {id: null, title: 'Robe', price: 12.5, color1_id: 7, color2_id: 8, temp_uuid: 'tmp', is_draft: true, isbn: null, description: 'Belle', catalog_id: 10, brand_id: 3, brand: 'Shein', size_id: 4, status_id: 6, package_size_id: 1, item_attributes: [], assigned_photos: [{id: 1, orientation: 0}]})
  assert.notEqual(body.upload_session_id, '')
  assert.deepEqual(T.shape({a: 'secret', b: 4, c: [{d: 'x'}, {d: 'y'}], e: null, f: true}), {a: '', b: 0, c: [{d: ''}], e: null, f: true})
})
test('orders are read whatever their exact layout', () => {
  const o = T.orderRow({transaction: {id: 55, status: 'À expédier'}, item: {id: 9, title: 'Robe', price: {amount: '12.00', currency_code: 'EUR'}}, shipment: {id: 66}})
  assert.deepEqual([o.transaction_id, o.title, o.price, o.shipment_id, o.label_ready], [55, 'Robe', '12.00', 66, true])
  assert.equal(T.orderRow({id: 1, status: 'Commande terminée', shipment_id: 3}).label_ready, false)
})
test('the extension files are valid scripts and the manifest declares the page script in the page world', () => {
  for (const f of ['worker.js', 'content.js', 'popup.js', 'read.js', 'page.js', 'overlay.js']) execFileSync(process.execPath, ['--check', fileURLToPath(new URL(`../extensions/ylavint/${f}`, import.meta.url))])
  const m = JSON.parse(readFileSync(new URL('../extensions/ylavint/manifest.json', import.meta.url), 'utf8'))
  assert.equal(m.manifest_version, 3)
  assert.deepEqual(m.content_scripts.map(c => c.world || 'ISOLATED'), ['MAIN', 'ISOLATED'])
  const page = readFileSync(new URL('../extensions/ylavint/page.js', import.meta.url), 'utf8')
  assert.ok(!page.includes('config.js') && !page.includes('svwk_') && !page.includes('vinted-stock.vercel.app'), 'the site key and address never reach the Vinted page')
})
test('inbox: list read, only changed conversations opened, messages tagged mine / theirs', async () => {
  calls.length = 0
  vinted = async url => {
    const u = new URL(url)
    if (u.pathname === '/api/v2/inbox') return {status: 200, body: {conversations: [
      {id: 11, updated_at: '2026-11-07T15:00:00+01:00', unread: true, description: 'Elle taille comment ?', opposite_user: {id: 77, login: 'acheteuse', photo: {url: 'https://images1.vinted.net/u.jpg'}}},
      {id: 12, updated_at: '2026-11-06T10:00:00+01:00', unread: false, description: 'Merci', opposite_user: {id: 78, login: 'autre'}}]}}
    if (u.pathname === '/api/v2/conversations/11') return {status: 200, body: {conversation: {id: 11, allow_reply: true, opposite_user: {id: 77, login: 'acheteuse'},
      transaction: {id: 900, status: 'Payée', item_id: 5, item_title: 'Robe'},
      messages: [{entity_type: 'message', entity: {id: 1, body: 'Bonjour', user_id: 77}, created_at_ts: '2026-11-07T14:50:00+01:00'},
        {entity_type: 'message', entity: {id: 2, body: 'Bonjour !', user_id: 3206068112}, created_at_ts: '2026-11-07T14:55:00+01:00'},
        {entity_type: 'offer_request_message', entity: {id: 3, price: {amount: '20.0'}, user_id: 77}, created_at_ts: '2026-11-07T14:58:00+01:00'}]}}}
    return {status: 404, body: {}}
  }
  const recipes = {inbox_list: {method: 'GET', path: '/api/v2/inbox'}, conversation_read: {method: 'GET', path: '/api/v2/conversations/{id}'}}
  const r = await run({kind: 'sync_inbox', member_id: '3206068112', payload: {known: {12: '2026-11-06T10:00:00+01:00', 99: 'x'}}, recipes})
  assert.equal(r.ok, true)
  const [a, b] = r.result.conversations
  assert.equal(calls.filter(c => c.url.includes('/conversations/')).length, 1, 'unchanged conversation 12 not reopened')
  assert.deepEqual(a.messages.map(m => [m.id, m.from_me, m.kind]), [['1', false, 'message'], ['2', true, 'message'], ['3', false, 'offer']])
  assert.match(a.messages[2].body, /20/); assert.equal(a.transaction.id, 900); assert.equal(a.item.title, 'Robe'); assert.equal(a.unread, true)
  assert.equal(b.messages, null); assert.equal(b.preview, 'Merci')
})
test('a reply is sent with the learned message recipe, never without it', async () => {
  calls.length = 0
  vinted = async (url, init) => init.method === 'POST' ? {status: 200, body: {reply: {id: 4242}}} : {status: 404, body: {}}
  const recipes = {message_send: {method: 'POST', path: '/api/v2/conversations/{id}/replies', body: 'json', template: {reply: {body: '', photo_temp_uuids: [], is_personal_data_sharing_check_skipped: false}}}}
  const r = await run({kind: 'reply_message', payload: {conversation_id: '11', body: 'Oui, dispo !'}, recipes})
  assert.deepEqual(r, {ok: true, result: {conversation_id: '11', message_id: '4242'}})
  const post = calls.at(-1)
  assert.match(post.url, /\/api\/v2\/conversations\/11\/replies$/)
  assert.deepEqual(JSON.parse(post.body), {reply: {body: 'Oui, dispo !', photo_temp_uuids: [], is_personal_data_sharing_check_skipped: false}})
  assert.equal(post.headers['x-csrf-token'], 'csrf-1')
  assert.equal((await run({kind: 'reply_message', payload: {conversation_id: '11', body: 'x'}, recipes: {}})).code, 'no_recipe')
})
test('the extension ships its icons and the YlaVint name', () => {
  const m = JSON.parse(readFileSync(new URL('../extensions/ylavint/manifest.json', import.meta.url), 'utf8'))
  assert.equal(m.name, 'YlaVint')
  for (const p of Object.values(m.icons)) assert.ok(readFileSync(new URL(`../extensions/ylavint/${p}`, import.meta.url)).subarray(1, 4).toString() === 'PNG')
})

test('old direct publication is disabled and makes no Vinted request',async()=>{
 calls.length=0
 const result=await run({kind:'publish_item',member_id:'7',recipes:{},listing:{fields:{title:'Test'},photos:[],live:true}})
 assert.equal(result.ok,false);assert.match(result.error,/direct est désactivé/);assert.equal(calls.length,0)
})

// ---------- 3.8.7 : messages aux likes, nouvelle messagerie Vinted, ventes et bordereaux ----------
const likeRecipes={conversation_create:{method:'POST',path:'/api/v2/conversations',body:'json',template:{initiator:'seller_enters_notification',item_id:0,opposite_user_id:0}},
  conversation_read:{method:'GET',path:'/api/v2/conversations/{id}'},message_send:{method:'POST',path:'/api/v2/conversations/{id}/replies',body:'json',template:{reply:{body:'',photo_temp_uuids:null,is_personal_data_sharing_check_skipped:false}}}}
const likeTask={kind:'like_message',member_id:'7',recipes:likeRecipes,payload:{item_id:'9',user_id:'88',message:'Merci pour ton like !'}}
const CONV='0b6f7c2e-4a1d-4c8e-9f3b-2d5e6a7b8c9d'

test('likes: a refusal from Vinted skips that like only (deleted item, blocked, access denied), nothing is sent',async t=>{
 t.mock.method(globalThis,'setTimeout',fn=>{queueMicrotask(fn);return 0})
 T.forgetChat()
 for(const [status,body,code] of [[404,{code:404,message:'Not found'},'item_unavailable'],[403,{code:106,message:'Ce membre t’a bloqué'},'user_blocked_you'],[403,{code:0,message_code:'access_denied',message:'Accès refusé'},'access_denied']]){
   calls.length=0
   vinted=async(url,init)=>init.method==='POST'?{status,body}:{status:200,body:{conversation:{id:10,messages:[]}}}
   const r=await run(likeTask)
   assert.equal(r.ok,true,`${code}: not a failure`);assert.equal(r.result.skip_code,code);assert.ok(r.result.skipped)
   assert.ok(calls.every(c=>!c.url.endsWith('/replies')),'no message after a refusal')
 }
 t.mock.restoreAll()
})

test('likes: a conversation where Vinted no longer allows replies is skipped before writing',async t=>{
 t.mock.method(globalThis,'setTimeout',fn=>{queueMicrotask(fn);return 0})
 T.forgetChat();calls.length=0
 vinted=async url=>({status:200,body:url.endsWith('/api/v2/conversations')?{conversation:{id:10}}:{conversation:{id:10,allow_reply:false,messages:[]}}})
 const r=await run(likeTask)
 assert.match(r.result.skipped,/ne permet pas/);assert.ok(calls.every(c=>!c.url.endsWith('/replies')))
 t.mock.restoreAll()
})

test('likes on the new Vinted messaging: inquiry, re-read, reply and offer go to the right services',async t=>{
 t.mock.method(globalThis,'setTimeout',fn=>{queueMicrotask(fn);return 0})
 T.setChat('v2');calls.length=0
 vinted=async(url,init)=>{
   const u=new URL(url)
   if(u.pathname==='/messaging/main/inquiries')return {status:200,body:{conversation_id:CONV}}
   if(u.pathname===`/messaging/main/conversations/${CONV}`)return {status:200,body:{id:CONV,core_id_deprecated:555,conversation_type:'inquiry',allow_reply:true,data:{transaction_id:777,items:[{inventory_item_id:9}]},opposite_users:[{type:'user',data:{id:88,login_name:'alice'}}],messages:[]}}
   if(u.pathname===`/messaging/main/conversations/${CONV}/replies`)return {status:200,body:{data:{id:4242},conversation_id:CONV}}
   if(u.pathname==='/api/v2/transactions/777/offers')return {status:200,body:{offer:{id:1}}}
   return {status:404,body:{}}
 }
 const recipes={...likeRecipes,offer_send:{method:'POST',path:'/api/v2/transactions/{id}/offers',body:'json',template:{offer:{price:'',currency:''}},id_from:'transaction'}}
 const r=await run({...likeTask,recipes,payload:{...likeTask.payload,offer_price:12}})
 assert.equal(r.ok,true,r.error);assert.equal(r.result.conversation_id,CONV);assert.equal(r.result.offer,true)
 const create=calls.find(c=>c.url.endsWith('/messaging/main/inquiries'))
 assert.equal(new URL(create.url).origin,'https://api.vinted.fr')
 assert.deepEqual(JSON.parse(create.body),{item_ids:['9'],receiver_id:'88'})
 assert.equal(create.headers['x-csrf-token'],'csrf-1');assert.equal(create.headers['x-next-app'],'marketplace-web')
 const reply=calls.find(c=>c.url.endsWith('/replies'))
 assert.deepEqual(JSON.parse(reply.body),{content:'Merci pour ton like !',is_personal_data_sharing_check_skipped:false,photo_temp_uuids:null})
 assert.ok(!calls.some(c=>c.url.includes('/api/v2/conversations')),'the old messaging is not used')
 T.forgetChat();t.mock.restoreAll()
})

test('new Vinted messaging is read into the same shape: inbox, messages, item, buyer',async()=>{
 T.setChat('v2');calls.length=0
 vinted=async url=>{
   const u=new URL(url)
   if(u.pathname==='/messaging/main/inbox')return {status:200,body:{conversations:[{id:CONV,conversation_type:'inquiry',is_unread_by_current_user:true,last_message:{created_at:'2026-11-10T10:00:00Z',data:{content:'Toujours dispo ?'}},
     opposite_users:[{type:'user',data:{id:88,login_name:'alice',photo:{url:'https://images1.vinted.net/a.jpg'}}}],data:{inventory_items:[{id:9,title:'Robe',photos:[{url:'https://images1.vinted.net/r.jpg'}]}]}}],pagination:{has_next:false}}}
   if(u.pathname===`/messaging/main/conversations/${CONV}`)return {status:200,body:{id:CONV,conversation_type:'inquiry',allow_reply:true,is_unread_by_current_user:true,data:{items:[{inventory_item_id:9}],inventory_items:[{id:9,title:'Robe',price:{amount:'25.0',currency_code:'EUR'}}]},
     opposite_users:[{type:'user',data:{id:88,login_name:'alice'}}],
     messages:[{message_type:'reply_text',sender_id:'88',created_at:'2026-11-10T09:59:00Z',data:{id:1,content:'Bonjour'}},{message_type:'reply_text',sender_id:'3206068112',created_at:'2026-11-10T09:59:30Z',data:{id:2,content:'Bonjour !'}},
       {message_type:'offer',sender_id:'88',created_at:'2026-11-10T10:00:00Z',data:{id:3,entity_type:'offer_request_message',price:{amount:'20.0'}}}]}}
   return {status:404,body:{}}
 }
 const r=await run({kind:'sync_inbox',member_id:'3206068112',payload:{known:{}},recipes:{inbox_list:{method:'GET',path:'/api/v2/inbox'},conversation_read:{method:'GET',path:'/api/v2/conversations/{id}'}}})
 assert.equal(r.ok,true,r.error);assert.equal(r.result.chat,'v2')
 const [c]=r.result.conversations
 assert.equal(c.id,CONV);assert.equal(c.other.login,'alice');assert.equal(c.item.id,9);assert.equal(c.item.title,'Robe');assert.equal(c.unread,true);assert.equal(c.allow_reply,true)
 assert.deepEqual(c.messages.map(m=>[m.id,m.from_me,m.kind]),[['1',false,'message'],['2',true,'message'],['3',false,'offer']])
 assert.ok(calls.every(c=>new URL(c.url).origin==='https://api.vinted.fr'))
 assert.ok(calls.every(c=>c.headers['x-csrf-token']===undefined),'no session token on reads outside the site')
 T.forgetChat()
})

test('an account moved to the new messaging is detected when the old inbox stops answering',async()=>{
 T.forgetChat();calls.length=0
 vinted=async url=>{
   const u=new URL(url)
   if(u.pathname==='/api/v2/inbox')return {status:404,body:{code:404}}
   if(u.pathname==='/messaging/main/inbox')return {status:200,body:{conversations:[],pagination:{has_next:false}}}
   return {status:404,body:{}}
 }
 const r=await run({kind:'sync_inbox',member_id:'7',payload:{known:{a:1}},recipes:{inbox_list:{method:'GET',path:'/api/v2/inbox'},conversation_read:{method:'GET',path:'/api/v2/conversations/{id}'}}})
 assert.equal(r.ok,true,r.error);assert.equal(r.result.chat,'v2');assert.equal(T.chatApi(),'v2')
 T.forgetChat()
})

test('replies go to the new messaging for a UUID conversation, to the learned recipe otherwise',async()=>{
 T.forgetChat();calls.length=0
 vinted=async()=>({status:200,body:{data:{id:99},conversation_id:CONV}})
 const r=await run({kind:'reply_message',member_id:'7',payload:{conversation_id:CONV,body:'Oui !'},recipes:{}})
 assert.deepEqual(r,{ok:true,result:{conversation_id:CONV,message_id:'99'}})
 assert.equal(calls[0].url,`https://api.vinted.fr/messaging/main/conversations/${CONV}/replies`)
 // Un UUID n'est jamais accepté sur une route de l'ancienne messagerie.
 assert.equal((await run({kind:'accept_offer',member_id:'7',payload:{conversation_id:CONV,offer:{id:'1'}},recipes:{conversation_read:{method:'GET',path:'/api/v2/conversations/{id}'}}})).error,'Identifiant manquant.')
 assert.equal(T.chatFromPath(`/inbox/${CONV}`),'v2');assert.equal(T.chatFromPath('/inbox/123'),'v1');assert.equal(T.chatFromPath('/inbox'),null)
 assert.equal(T.chatFromUrls(['https://api.vinted.fr/messaging/main/inbox']),'v2');assert.equal(T.chatFromUrls(['https://www.vinted.fr/api/v2/inbox?page=1']),'v1')
})

test('orders: the newer Vinted orders list is used when the classic one stops answering',async()=>{
 calls.length=0
 vinted=async url=>{
   const u=new URL(url)
   if(u.pathname==='/api/v2/my_orders')return {status:404,body:{}}
   if(u.pathname==='/escrow-orders/api/v2/current-user/escrow-orders')return {status:200,body:{my_orders:[{transaction_id:55,status:'À expédier',title:'Robe',price:{amount:'20.0',currency_code:'EUR'},conversation_id:CONV}]}}
   return {status:404,body:{}}
 }
 const r=await run({kind:'sync_orders',member_id:'7',payload:{detailed:['55']},recipes:{orders_list:{method:'GET',path:'/api/v2/my_orders',query:{type:'sold',status:'all'}}}})
 assert.equal(r.ok,true,r.error);assert.equal(r.result.orders[0].transaction_id,55);assert.equal(r.result.orders[0].conversation_id,CONV)
 assert.equal(new URL(calls.at(-1).url).searchParams.get('type'),'sold')
})

test('labels: never generated by YlaVint; not ready yet = pending; Colissimo seen in the shipment = skipped',async t=>{
 t.mock.method(globalThis,'setTimeout',fn=>{queueMicrotask(fn);return 0})
 const recipes={order_label:{method:'GET',path:'/api/v2/shipments/{id}/label_url',id_from:'shipment'},order_detail:{method:'GET',path:'/api/v2/transactions/{id}'}}
 // Envoi connu mais bordereau pas encore généré : 404 de Vinted → en attente, aucune écriture.
 calls.length=0
 vinted=async url=>new URL(url).pathname==='/api/v2/transactions/55'?{status:200,body:{transaction:{id:55,shipment:{id:66,carrier:{name:'Mondial Relay'}}}}}:{status:404,body:{code:404}}
 let r=await run({kind:'fetch_label',payload:{transaction_id:'55'},recipes})
 assert.equal(r.ok,true);assert.equal(r.result.pending,true);assert.equal(r.result.shipment_id,66)
 assert.ok(calls.every(c=>(c.method||'GET')==='GET'),'reads only')
 // Envoi absent du détail : lu à part ; Colissimo → jamais de bordereau.
 calls.length=0
 vinted=async url=>{const p=new URL(url).pathname;return p==='/api/v2/transactions/55'?{status:200,body:{transaction:{id:55}}}:p==='/api/v2/escrow_orders/55/shipment'?{status:200,body:{shipment:{id:67,carrier:{name:'Colissimo'}}}}:{status:404,body:{}}}
 r=await run({kind:'fetch_label',payload:{transaction_id:'55'},recipes})
 assert.equal(r.result.skipped,'colissimo');assert.ok(!calls.some(c=>c.url.includes('label')))
 // Transporteur introuvable : aucun risque pris, pas de bordereau demandé.
 calls.length=0
 vinted=async url=>{const p=new URL(url).pathname;return p==='/api/v2/transactions/55'?{status:200,body:{transaction:{id:55,shipment:{id:68}}}}:p==='/api/v2/escrow_orders/55/shipment'?{status:200,body:{shipment:{id:68}}}:{status:200,body:{label_url:'https://x.test/l.pdf'}}}
 r=await run({kind:'fetch_label',payload:{transaction_id:'55'},recipes})
 assert.equal(r.result.pending,true);assert.ok(!calls.some(c=>c.url.includes('label')))
 // La Poste peut être Colissimo : écarté aussi.
 vinted=async url=>{const p=new URL(url).pathname;return p==='/api/v2/transactions/55'?{status:200,body:{transaction:{id:55,shipment:{id:68,carrier:{name:'La Poste'}}}}}:{status:404,body:{}}}
 r=await run({kind:'fetch_label',payload:{transaction_id:'55'},recipes})
 assert.equal(r.result.skipped,'colissimo')
 t.mock.restoreAll()
})

test('Vinted refusals are told apart: Cloudflare check, blocked member, access denied, restriction',async()=>{
 const read={kind:'reply_message',member_id:'7',payload:{conversation_id:'11',body:'x'},recipes:{message_send:{method:'POST',path:'/api/v2/conversations/{id}/replies',body:'json',template:{reply:{body:''}}}}}
 T.forgetChat()
 for(const [status,body,code] of [[503,'<html><script src="/cdn-cgi/challenge-platform/h/b/orchestrate"></script></html>','challenge'],[403,{code:106},'blocked'],[403,{message_code:'access_denied'},'access_denied'],[403,{code:'FORBIDDEN'},'messaging_refused'],[403,{message:'Compte restreint'},'restricted']]){
   vinted=async()=>({status,body});assert.equal((await run(read)).code,code)
 }
})

test('likes: a regular read stops at notifications already seen; the liker comes from the link',async t=>{
 t.mock.method(globalThis,'setTimeout',fn=>{queueMicrotask(fn);return 0})
 const n=(at,i)=>({entry_type:20,body:`bob${i} a marqué ton article comme favori`,subject_id:9,link:`/items/9/want_it/new?offering_id=${100+i}`,updated_at:at})
 calls.length=0
 vinted=async url=>{const page=Number(new URL(url).searchParams.get('page'));return {status:200,body:{notifications:Array.from({length:20},(_,i)=>n(page===1?'2026-11-10T10:00:00Z':'2026-11-09T08:00:00Z',page*100+i)),pagination:{total_pages:9}}}}
 const r=await run({kind:'scan_likes',member_id:'7',recipes:{},payload:{since:'2026-11-10T09:00:00Z'}})
 assert.equal(calls.length,2,'page 2 is older than the last read: stop there');assert.equal(r.result.likes.length,40)
 assert.equal(T.notificationLike({entry_type:20,subject_id:9,link:'/member/general/notifications?user_id=55',body:'carla a marqué ton article comme favori'},'7').user_id,'55')
 t.mock.restoreAll()
})

test('likes: the site notifications route takes over when the notifications service fails',async()=>{
 calls.length=0
 vinted=async url=>new URL(url).origin==='https://api.vinted.fr'?{status:500,body:{}}:{status:200,body:{notifications:[{entry_type:20,subject_id:9,link:'/items/9/want_it/new?offering_id=88',body:'alice a marqué ton article comme favori',updated_at:'2026-11-10T10:00:00Z'}],pagination:{total_pages:1}}}
 const r=await run({kind:'scan_likes',member_id:'7',recipes:{},payload:{}})
 assert.equal(r.ok,true,r.error);assert.equal(r.result.likes[0].user_id,'88')
 assert.equal(new URL(calls.at(-1).url).pathname,'/web/api/notifications/notifications')
})
