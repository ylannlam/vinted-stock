import test from 'node:test'
import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'
import {execFileSync} from 'node:child_process'

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
await import('../extensions/vinted-agent/page.js')
const T = globalThis.__svAgentTest

async function run(task) {
  const id = crypto.randomUUID()
  await handler({source: window, origin: location.origin, data: {source: 'sva-ext', type: 'run', id, task}})
  return posted.find(p => p.type === 'result' && p.id === id).payload
}
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
  for (const f of ['worker.js', 'content.js', 'popup.js', 'read.js', 'page.js']) execFileSync(process.execPath, ['--check', new URL(`../extensions/vinted-agent/${f}`, import.meta.url).pathname])
  const m = JSON.parse(readFileSync(new URL('../extensions/vinted-agent/manifest.json', import.meta.url), 'utf8'))
  assert.equal(m.manifest_version, 3)
  assert.deepEqual(m.content_scripts.map(c => c.world || 'ISOLATED'), ['MAIN', 'ISOLATED'])
  const page = readFileSync(new URL('../extensions/vinted-agent/page.js', import.meta.url), 'utf8')
  assert.ok(!page.includes('config.js') && !page.includes('svwk_') && !page.includes('vinted-stock.vercel.app'), 'the site key and address never reach the Vinted page')
})
