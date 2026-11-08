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
  assert.equal(r.result.likes.length,1)
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
