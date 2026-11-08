// YlaVint, côté page Vinted (monde de la page, pour utiliser la session déjà ouverte du compte).
// 1. Exécute les tâches reçues de l'extension avec les « recettes » apprises sur le vrai site Vinted.
// 2. Mode apprentissage (activé à la main dans le popup) : relève la forme des requêtes que Vinted fait lui-même.
// Jamais de cookie ni de jeton envoyé hors de Vinted ; ce script ne connaît pas la clé du site.
(() => {
  if (globalThis.__svAgent) return
  const nativeFetch = window.fetch.bind(window)
  const memory = {csrf: null, anon: null, orders: new Map()}
  // Apprentissage automatique : les requêtes que Vinted fait quand tu l'utilises normalement sont relevées (forme seulement, jamais de cookie ni de jeton).
  let learning = true
  const post = msg => window.postMessage({source: 'sva-page', ...msg}, location.origin)
  const sleep = ms => new Promise(r => setTimeout(r, ms))
  const pause = (min, max) => sleep(Math.round(min + (max - min) * Math.random()))
  const uuid = () => crypto.randomUUID()
  class Stop extends Error { constructor(code, message, status) { super(message); this.code = code; this.status = status } }

  // ---------- Requêtes Vinted ----------
  const cookie = name => document.cookie.split('; ').find(c => c.startsWith(name + '='))?.slice(name.length + 1) || null
  function csrf() {
    if (memory.csrf) return memory.csrf
    const meta = document.querySelector('meta[name="csrf-token"]')?.content
    if (meta) return meta
    for (const s of document.scripts) {
      const t = s.textContent || '', i = t.indexOf('CSRF_TOKEN')
      if (i < 0) continue
      const m = t.slice(i, i + 300).match(/CSRF_TOKEN\\*"\s*:\s*\\*"([A-Za-z0-9_\-+/=]{16,})/)
      if (m) return m[1]
    }
    return null
  }
  function errorText(json, text) {
    const e = json?.errors?.[0]
    return String(json?.message_code || '') + ' ' + String(e?.value || e?.message || json?.message || json?.error || text || '').slice(0, 250)
  }
  async function call(recipe, opts = {}) {
    try { return await callOnce(recipe, opts) }
    catch (e) { if (!(e instanceof Stop) || e.code !== 'logged_out' || opts.retried) throw e }
    await sleep(4000); memory.csrf = null
    return callOnce(recipe, {...opts, retried: true})
  }
  async function callOnce(recipe, {ids = {}, query = {}, json = null, form = null, raw = false} = {}) {
    if (!recipe) throw new Stop('no_recipe', 'Action pas encore apprise.')
    const path = recipe.path.replace(/\{id\}/g, () => { const v = ids.id; if (!/^\d{1,18}$/.test(String(v))) throw new Stop('failed', 'Identifiant manquant.'); return v })
    const url = new URL(path, location.origin)
    for (const [k, v] of Object.entries({...(recipe.query || {}), ...query})) url.searchParams.set(k, v)
    const headers = {accept: 'application/json, text/plain, */*', ...(recipe.headers || {})}
    delete headers['content-type']; delete headers['content-length']
    const token = csrf(), anon = memory.anon || cookie('anon_id')
    if (token) headers['x-csrf-token'] = token
    if (anon) headers['x-anon-id'] = anon
    if (json) headers['content-type'] = 'application/json'
    let response
    try { response = await nativeFetch(url.href, {method: recipe.method, headers, body: json ? JSON.stringify(json) : form || undefined, credentials: 'include'}) }
    catch { throw new Stop('network', 'Vinted ne répond pas.') }
    const type = response.headers.get('content-type') || ''
    if (raw && response.ok && /pdf/.test(type)) return {pdf: await response.arrayBuffer()}
    const text = await response.text()
    let data = null
    try { data = JSON.parse(text) } catch {}
    if (response.status === 401) throw new Stop('logged_out', 'Session Vinted expirée.', 401)
    if (response.status === 429) throw new Stop('rate_limited', 'Vinted limite les requêtes.', 429)
    if (/captcha-delivery|datadome|captcha/i.test(text.slice(0, 3000)) && !response.ok) throw new Stop('captcha', 'Vérification Vinted demandée.', response.status)
    if (response.status === 403) throw new Stop(/restrict|bloqu|banned/i.test(text) ? 'restricted' : 'forbidden', errorText(data, text), 403)
    if (!response.ok) throw new Stop('vinted_error', `Vinted ${response.status} :${errorText(data, '')}`, response.status)
    if (data && data.code && data.code !== 0 && data.message) {
      if (/restrict/i.test(data.message)) throw new Stop('restricted', data.message)
    }
    return data ?? {}
  }

  // ---------- Lecture souple des réponses (les champs exacts seront confirmés par l'apprentissage) ----------
  const firstArray = data => {
    if (Array.isArray(data)) return data
    for (const v of Object.values(data || {})) if (Array.isArray(v) && v.some(x => x && typeof x === 'object')) return v
    return []
  }
  const amount = v => v && typeof v === 'object' ? v.amount : v
  const findDeep = (obj, test, depth = 0) => {
    if (!obj || typeof obj !== 'object' || depth > 5) return null
    for (const [k, v] of Object.entries(obj)) {
      if (test(k, v)) return v
      const r = findDeep(v, test, depth + 1); if (r != null) return r
    }
    return null
  }
  const hiddenFlag = i => i.is_hidden === true || i.is_visible === false && !i.is_draft ||
    !!findDeep(i, (k, v) => typeof v === 'string' && /masqu[ée]e? du catalogue|hidden from (the )?catalog/i.test(v)) ||
    !!findDeep(i, (k, v) => v === true && /hidden_from_catalog|catalog_hidden|is_shadow/i.test(k))
  function wardrobeItem(i) {
    return {id: i.id, title: i.title, price: amount(i.price), currency: i.price?.currency_code || i.currency,
      photo_url: i.photo?.url || i.photos?.[0]?.url || null, is_hidden: hiddenFlag(i), is_closed: !!i.is_closed, is_draft: !!i.is_draft,
      is_sold: !!(i.is_sold || i.item_closing_action === 'sold'), created_at: i.created_at_ts || i.created_at || i.photo?.high_resolution?.timestamp || i.photos?.[0]?.high_resolution?.timestamp || null}
  }
  // Date limite d'envoi, transporteur et acheteur : noms de champs variables selon les écrans Vinted.
  function orderExtras(o) {
    const deadline = findDeep(o, (k, v) => (typeof v === 'string' || typeof v === 'number') && /(ship|shipping|send|dispatch)\w*_?(deadline|due|until|expires?|limit)|^deadline/i.test(k))
    const carrier = findDeep(o, (k, v) => typeof v === 'string' && /^(carrier|carrier_name|transporter|shipping_carrier|delivery_service|courier)(_name|_title)?$/i.test(k))
      || findDeep(o, (k, v) => v && typeof v === 'object' && /carrier|transporter/i.test(k) && typeof (v.name || v.title) === 'string')?.name || null
    const buyer = o.buyer || o.user || o.opposite_user || o.transaction?.buyer || null
    return {ship_deadline: deadline ?? null, carrier: typeof carrier === 'string' ? carrier : null, buyer_id: buyer?.id || o.buyer_id || o.transaction?.buyer_id || null, buyer_login: buyer?.login || null}
  }
  function orderRow(o) {
    const t = o.transaction || o
    const status = [o.status, o.transaction_user_status, o.status_title, t.status].find(v => typeof v === 'string') || ''
    const row = {transaction_id: t.transaction_id || o.transaction_id || t.id || o.id, status,
      title: o.title || o.item_title || o.item?.title || t.item_title || '', price: amount(o.price || o.total_item_price || o.item?.price || t.price),
      currency: (o.price || o.item?.price)?.currency_code || 'EUR', order_date: o.date || o.created_at || t.created_at || o.updated_at || null,
      item_ids: [o.item_id, o.item?.id, ...(o.item_ids || [])].filter(Boolean),
      shipment_id: o.shipment_id || o.shipment?.id || t.shipment_id || null, conversation_id: o.conversation_id || t.conversation_id || null,
      photo_url: o.photo?.url || o.item?.photo?.url || o.photos?.[0]?.url || null, ...orderExtras(o)}
    row.label_ready = !!(row.shipment_id || /exp[ée]di|envoy|ship|label|bordereau/i.test(status)) && !/annul|cancel|rembours|refund|termin|complete|livr/i.test(status)
    return row
  }

  // ---------- Tâches ----------
  async function scanWardrobe(task) {
    const recipe = task.recipes.wardrobe || {method: 'GET', path: '/api/v2/wardrobe/{id}/items', query: {order: 'relevance'}}
    const items = []
    let complete = false
    for (let page = 1; page <= 15; page++) {
      const data = await call(recipe, {ids: {id: task.member_id}, query: {page, per_page: 96}})
      const list = firstArray(data)
      items.push(...list.map(wardrobeItem))
      const p = data.pagination
      if (!list.length || (p && p.current_page >= p.total_pages) || (!p && list.length < 96)) { complete = true; break }
      await pause(1500, 4000)
    }
    return {items, complete}
  }
  async function syncOrders(task) {
    const data = await call(task.recipes.orders_list, {query: {page: 1, per_page: 20}})
    const orders = firstArray(data).map(orderRow).filter(o => o.transaction_id)
    // Détail d'une vente (articles du lot, envoi) : seulement pour les ventes pas encore détaillées, et si la lecture a été apprise.
    const detailed = new Set((task.payload?.detailed || []).map(String))
    if (task.recipes.order_detail) for (const o of orders.filter(o => !detailed.has(String(o.transaction_id))).slice(0, 8)) {
      try {
        await pause(1500, 4000)
        const d = await call(task.recipes.order_detail, {ids: {id: o.transaction_id}}), t = d.transaction || d
        const items = [t.item_id, t.item?.id, ...(Array.isArray(t.items) ? t.items.map(i => i.id) : []), ...(Array.isArray(t.order?.items) ? t.order.items.map(i => i.id || i.item_id) : [])].filter(Boolean)
        if (items.length) o.item_ids = [...new Set(items.map(String))]
        o.shipment_id = o.shipment_id || t.shipment?.id || t.shipment_id || null
        o.conversation_id = o.conversation_id || t.conversation_id || null
        if (!o.title) o.title = t.item_title || t.item?.title || ''
        const x = orderExtras(t)
        for (const k of Object.keys(x)) if (x[k] != null && o[k] == null) o[k] = x[k]
      } catch (e) { if (e instanceof Stop && e.code !== 'vinted_error') throw e }
    }
    for (const o of orders) memory.orders.set(String(o.transaction_id), o)
    return {orders}
  }

  // ---------- Messagerie ----------
  const photoUrl = p => typeof p === 'string' ? p : p?.url || p?.thumbnails?.[0]?.url || null
  const hashOf = text => { let h = 0; for (const c of String(text)) h = (h * 31 + c.charCodeAt(0)) | 0; return 'h' + (h >>> 0).toString(36) }
  function messageRow(m, me) {
    const e = m.entity && typeof m.entity === 'object' ? m.entity : m
    const type = String(m.entity_type || m.type || e.type || '')
    const kind = /offer/i.test(type) ? 'offer' : /action/i.test(type) ? 'action' : /status/i.test(type) ? 'status' : (e.photos?.length && !e.body) ? 'photo' : 'message'
    let body = e.body ?? e.text ?? e.message ?? e.title ?? ''
    if (kind === 'offer' && !body) body = `Offre : ${amount(e.price || e.offer_price) ?? ''} €`
    if (kind === 'action' && e.subtitle) body = `${body} — ${e.subtitle}`
    const user = e.user_id ?? m.user_id ?? e.sender_id ?? e.user?.id
    const sent = m.created_at_ts ?? m.created_at ?? e.created_at_ts ?? e.created_at ?? e.sent_at ?? null
    const id = e.id ?? m.id ?? hashOf(`${sent}|${body}`)
    return {id: String(id), from_me: m.is_own === true || e.is_own === true || (user != null && String(user) === String(me)), body: String(body || ''), kind, sent_at: sent}
  }
  function conversationRow(entry, detail, me) {
    const c = detail?.conversation || detail || {}, other = c.opposite_user || entry.opposite_user || {}
    const t = c.transaction || null, item = c.item || t?.item || null
    return {id: entry.id || c.id, other: {id: other.id, login: other.login, photo: photoUrl(other.photo)},
      unread: entry.unread === true || entry.is_unread === true || Number(entry.unread_count) > 0 || c.read_by_current_user === false,
      updated_at: entry.updated_at || c.updated_at || null, preview: entry.description || entry.last_message?.body || '',
      item: {id: item?.id || t?.item_id || null, title: item?.title || t?.item_title || c.subtitle || entry.item_title || null,
        price: item?.price || t?.offer_price || t?.item_price || null, photo: photoUrl(item?.photo || item?.photos?.[0] || entry.item_photos?.[0])},
      transaction: t ? {id: t.id, status: t.status_title || t.status || t.transaction_user_status || null} : null,
      allow_reply: c.allow_reply !== false && c.is_replyable !== false,
      messages: detail ? firstArray(c.messages ? {messages: c.messages} : c).map(m => messageRow(m, me)).filter(m => m.body || m.kind !== 'message') : null}
  }
  async function scanInbox(task) {
    const p = task.payload || {}, known = p.known || {}, forced = new Set((p.conversation_ids || []).map(String)), me = task.member_id
    const first = !Object.keys(known).length
    const list = []
    for (let page = 1; page <= (first && !forced.size ? 2 : 1); page++) {
      const data = await call(task.recipes.inbox_list, {query: {page, per_page: 20}})
      const rows = Array.isArray(data.conversations) ? data.conversations : firstArray(data)
      list.push(...rows)
      if (rows.length < 20) break
      await pause(1500, 3500)
    }
    const changed = list.filter(c => c && (forced.has(String(c.id)) || known[String(c.id)] !== String(c.updated_at ?? ''))).slice(0, first ? 15 : 10)
    for (const id of forced) if (!list.some(c => String(c.id) === id)) changed.push({id})
    const out = new Map(list.filter(c => c?.id).map(c => [String(c.id), conversationRow(c, null, me)]))
    for (const c of changed) {
      await pause(1500, 4000)
      try {
        const detail = await call(task.recipes.conversation_read, {ids: {id: c.id}})
        out.set(String(c.id), conversationRow(c, detail, me))
        progress()
      } catch (e) { if (!(e instanceof Stop) || !['vinted_error', 'failed'].includes(e.code)) throw e }
    }
    return {conversations: [...out.values()]}
  }
  async function replyMessage(task) {
    const {conversation_id, body} = task.payload, R = task.recipes
    if (!body) throw new Stop('failed', 'Message vide.')
    if (!R.message_send) throw new Stop('no_recipe', 'Envoi de message pas encore appris.')
    const r = await call(R.message_send, {ids: {id: conversation_id}, json: fillShape(R.message_send.template, [[/^(body|message|text|content)$/, body], [/photo/, []]])})
    const m = r.reply || r.message || r.conversation?.messages?.slice(-1)?.[0]?.entity || r
    return {conversation_id: String(conversation_id), message_id: m?.id != null ? String(m.id) : null}
  }
  async function fetchBytes(url) {
    const u = new URL(url, location.origin)
    if (u.origin === location.origin) {
      const r = await nativeFetch(u.href, {credentials: 'include'})
      if (!r.ok) throw new Stop('failed', `Téléchargement refusé (${r.status}).`)
      return r.arrayBuffer()
    }
    try { const r = await nativeFetch(u.href, {credentials: 'omit'}); if (r.ok) return r.arrayBuffer() } catch {}
    // Hors de Vinted et sans autorisation d'accès croisé : l'extension télécharge à la place de la page.
    const id = uuid()
    post({type: 'need_bytes', id, url: u.href})
    const reply = await new Promise(resolve => { bytesWaiters.set(id, resolve); setTimeout(() => resolve(null), 30000) })
    if (!reply?.base64) throw new Stop('failed', reply?.error || 'Fichier inaccessible.')
    return Uint8Array.from(atob(reply.base64), c => c.charCodeAt(0)).buffer
  }
  const toBase64 = buffer => { const b = new Uint8Array(buffer); let s = ''; for (let i = 0; i < b.length; i += 0x8000) s += String.fromCharCode(...b.subarray(i, i + 0x8000)); return btoa(s) }
  async function fetchLabel(task) {
    const recipe = task.recipes.order_label, p = task.payload
    const id = recipe.id_from === 'shipment' ? p.shipment_id : p.transaction_id
    const data = await call(recipe, {ids: {id}, raw: true})
    let pdf = data.pdf
    if (!pdf) {
      const url = findDeep(data, (k, v) => typeof v === 'string' && /^https:\/\//.test(v) && /label|pdf|url/i.test(k))
      if (!url) throw new Stop('failed', 'Bordereau pas encore disponible sur Vinted.')
      pdf = await fetchBytes(url)
    }
    if (pdf.byteLength > 4e6) throw new Stop('failed', 'Bordereau trop volumineux.')
    return {transaction_id: p.transaction_id, pdf_base64: toBase64(pdf)}
  }
  async function scanLikes(task) {
    const data = await call(task.recipes.likes_list)
    const likes = []
    for (const n of firstArray(data)) {
      const textAll = JSON.stringify(n)
      if (!/favou?ri|favorite|aim[ée]|like/i.test(textAll)) continue
      const link = String(n.link || n.url || n.path || '')
      const item = n.subject_type === 'item' ? n.subject_id : n.item_id || link.match(/items\/(\d+)/)?.[1] || n.item?.id
      const user = n.user_id || n.user?.id || n.sender_id || link.match(/member\/(\d+)/)?.[1]
      const login = n.user?.login || n.user_login || n.sender?.login || null
      if (item && user) likes.push({item_id: item, user_id: user, login})
    }
    return {likes}
  }

  // Une photo envoyée comme le fait le formulaire Vinted (champs relevés à l'apprentissage).
  async function uploadPhoto(recipe, bytes, tempUuid) {
    const form = new FormData(), blob = new Blob([bytes], {type: 'image/jpeg'})
    for (const f of recipe.fields) {
      const name = typeof f === 'string' ? f : f.name, value = typeof f === 'string' ? null : f.value
      if (/file/i.test(name)) form.append(name, blob, 'photo.jpg')
      else if (/uuid/i.test(name)) form.append(name, tempUuid)
      else if (/type/i.test(name)) form.append(name, value || 'item')
      else if (value != null) form.append(name, value)
    }
    const r = await call(recipe, {form})
    const id = r.id || r.photo?.id
    if (!id) throw new Stop('vinted_error', 'Vinted n’a pas accepté la photo.')
    return {id, orientation: 0}
  }
  // Corps d'une annonce : le modèle relevé, rempli avec la fiche du site.
  function fillItem(template, f, photos, {tempUuid, live, current = null}) {
    const body = structuredClone(template || {}), item = body.item && typeof body.item === 'object' ? body.item : body
    if (current) for (const k of Object.keys(item)) if (k in current) item[k] = structuredClone(current[k])
    const set = (k, v) => { if (v !== undefined && v !== null && v !== '') item[k] = v }
    if (f) {
      set('title', f.title); set('description', f.description); set('catalog_id', f.catalog_id); set('brand_id', f.brand_id)
      if ('brand' in item || f.brand_title) set('brand', f.brand_title); set('size_id', f.size_id); set('status_id', f.status_id)
      set('package_size_id', f.package_size_id)
      if ('color_ids' in item || !('color1_id' in item)) item.color_ids = f.color_ids || []
      if ('color1_id' in item) { item.color1_id = f.color_ids?.[0] || null; item.color2_id = f.color_ids?.[1] || null }
      if (Array.isArray(f.item_attributes)) item.item_attributes = f.item_attributes
      setPrice(item, Number(f.price))
      if ('currency' in item) item.currency = 'EUR'
    }
    if (photos) item.assigned_photos = photos
    if ('temp_uuid' in item) item.temp_uuid = tempUuid
    if ('upload_session_id' in body) body.upload_session_id = uuid()
    if ('is_draft' in item && live !== undefined) item.is_draft = !live
    if (!current && 'id' in item) item.id = null
    return body
  }
  function setPrice(item, price) {
    if (!Number.isFinite(price)) return
    if (item.price && typeof item.price === 'object') item.price = {...item.price, amount: price.toFixed(2), currency_code: item.price.currency_code || 'EUR'}
    else item.price = typeof item.price === 'string' ? price.toFixed(2) : price
  }
  async function publish(task) {
    const {fields, photos, live} = task.listing, tempUuid = uuid(), assigned = []
    if (!photos?.length) throw new Stop('failed', 'Aucune photo à envoyer.')
    for (const url of photos) {
      assigned.push(await uploadPhoto(task.recipes.photo_upload, await fetchBytes(url), tempUuid))
      progress(); await pause(1200, 3500)
    }
    const body = fillItem(task.recipes.item_create.template, fields, assigned, {tempUuid, live})
    const r = await call(task.recipes.item_create, {json: body})
    const id = r.item?.id || r.id
    if (!id) throw new Stop('vinted_error', 'Vinted n’a pas confirmé la création.')
    return {vinted_id: String(id), draft: live === false}
  }
  async function editItem(task, {unmask}) {
    const id = String(task.payload.item_id), R = task.recipes
    const form = await call(R.item_form, {ids: {id}})
    const current = form.item || form
    if (String(current.id || id) !== id) throw new Stop('failed', 'Vinted a renvoyé une autre annonce.')
    await pause(2000, 5000)
    let photos = null
    if (unmask) {
      // Mêmes photos renvoyées comme de nouvelles photos (nouvelle empreinte), dans le même ordre.
      const tempUuid = current.temp_uuid || uuid(), list = (current.photos || []).slice(0, 20)
      if (!list.length) throw new Stop('failed', 'Photos de l’annonce introuvables.')
      photos = []
      for (const p of list) {
        photos.push(await uploadPhoto(R.photo_upload, await fetchBytes(p.full_size_url || p.url), tempUuid))
        progress(); await pause(1200, 3500)
      }
    } else if (Array.isArray(current.photos)) photos = current.photos.map(p => ({id: p.id, orientation: p.orientation || 0}))
    const body = fillItem(R.item_edit.template, null, photos, {tempUuid: current.temp_uuid || uuid(), current})
    const item = body.item && typeof body.item === 'object' ? body.item : body
    item.id = Number(id)
    setPrice(item, Number(task.payload.new_price))
    if (unmask) { const d = String(current.description || item.description || '').trimEnd(); item.description = d.endsWith('.') ? d + ' .' : d + '.' }
    await pause(2000, 5000)
    const r = await call(R.item_edit, {ids: {id}, json: body})
    if (String(r.item?.id || r.id || id) !== id) throw new Stop('vinted_error', 'Vinted n’a pas confirmé la modification.')
    return {item_id: id, price: Number(task.payload.new_price)}
  }
  function fillShape(template, values) {
    const body = structuredClone(template || {})
    const walk = o => { for (const [k, v] of Object.entries(o)) {
      if (v && typeof v === 'object' && !Array.isArray(v)) walk(v)
      else for (const [pattern, value] of values) if (pattern.test(k)) { o[k] = value; break }
    } }
    walk(body); return body
  }
  const sendText = (R, conversation, body) => call(R.message_send, {ids: {id: conversation}, json: fillShape(R.message_send.template, [[/^(body|message|text|content)$/, body], [/photo/, []]])})
  // Identifiant à mettre dans le chemin d'une recette : celui relevé à l'apprentissage (vente, conversation, article…).
  const idFor = (recipe, p, fallback) => ({shipment: p.shipment_id, transaction: p.transaction_id, conversation: p.conversation_id, item: p.item_id, user: p.user_id})[recipe.id_from || fallback]
  // Membre filtré (note, sans évaluation, ignoré) : lecture de son profil seulement si un filtre le demande.
  async function memberCheck(task) {
    const p = task.payload, f = p.filters || {}
    if (f.min_rating == null && !f.skip_unrated && !(f.ignored || []).length) return {skip: null, login: p.login}
    let user = null
    try { const d = await call(task.recipes.user_read || {method: 'GET', path: '/api/v2/users/{id}'}, {ids: {id: p.user_id}}); user = d.user || d }
    catch (e) { if (e instanceof Stop && !['vinted_error', 'failed'].includes(e.code)) throw e; return {skip: null, login: p.login} }
    const login = user?.login || p.login
    if (login && (f.ignored || []).includes(String(login).toLowerCase())) return {skip: 'membre ignoré', login}
    const count = Number(user?.feedback_count ?? user?.positive_feedback_count ?? 0), rep = Number(user?.feedback_reputation)
    if (f.skip_unrated && !count) return {skip: 'membre sans évaluation', login}
    if (f.min_rating != null && count && Number.isFinite(rep) && rep * 5 < f.min_rating) return {skip: `note sous ${f.min_rating} étoiles`, login}
    return {skip: null, login}
  }
  async function sendOffer(R, conversation, transaction, price) {
    if (!R.offer_send || !price) return false
    const body = fillShape(R.offer_send.template, [[/^(price|amount|offer_price|value)$/, price.toFixed(2)], [/currency/, 'EUR']])
    await call(R.offer_send, {ids: {id: idFor(R.offer_send, {conversation_id: conversation, transaction_id: transaction}, 'transaction')}, json: body})
    return true
  }
  async function likeMessage(task) {
    const p = task.payload, R = task.recipes
    if (p.skip) return {skipped: p.skip}
    if (p.followup) {
      // Relance : seulement si le membre n'a pas répondu.
      const d = await call(R.conversation_read || {method: 'GET', path: '/api/v2/conversations/{id}'}, {ids: {id: p.conversation_id}})
      const c = d.conversation || d, me = task.member_id
      if (firstArray(c.messages ? {messages: c.messages} : c).map(m => messageRow(m, me)).some(m => !m.from_me && m.kind === 'message')) return {skipped: 'le membre a déjà répondu'}
      if (p.message) { await sendText(R, p.conversation_id, p.message); await pause(3000, 7000) }
      const offer = await sendOffer(R, p.conversation_id, c.transaction?.id, p.offer_price).catch(() => false)
      return {conversation_id: String(p.conversation_id), message: p.message || null, offer}
    }
    const member = await memberCheck(task)
    if (member.skip) return {skipped: member.skip, login: member.login}
    const created = await call(R.conversation_create, {json: fillShape(R.conversation_create.template, [[/item_id/, Number(p.item_id)], [/(opposite|receiver|recipient)_?user_id|^user_id$/, Number(p.user_id)]])})
    const conversation = created.conversation?.id || created.id
    if (!conversation) throw new Stop('vinted_error', 'Conversation non ouverte.')
    await pause(4000, 9000)
    if (p.message) await sendText(R, conversation, p.message)
    let offer = false
    if (p.offer_price && R.offer_send) { await pause(3000, 7000); offer = await sendOffer(R, conversation, created.conversation?.transaction?.id, p.offer_price).catch(() => false) }
    return {conversation_id: String(conversation), message: p.message || null, offer, login: member.login}
  }

  // ---------- Flux de commande ----------
  const STILL_TO_SHIP = s => !/annul|cancel|rembours|refund|termin|complete|exp[ée]di[ée]|envoy[ée]|en route|transit|shipped|livr|deliver|point relais|disponible/i.test(s) || /(exp[ée]die|envoie) (le|ton|votre)|à expédier|to ship/i.test(s)
  async function stillToShip(task) {
    if (!task.recipes.order_detail) return true
    try { const d = await call(task.recipes.order_detail, {ids: {id: task.payload.transaction_id}}), t = d.transaction || d; return STILL_TO_SHIP(String(t.status_title || t.status || t.transaction_user_status || '')) }
    catch (e) { if (e instanceof Stop && !['vinted_error', 'failed'].includes(e.code)) throw e; return true }
  }
  async function orderMessage(task) {
    const p = task.payload
    if (!p.conversation_id) throw new Stop('failed', 'Conversation de la vente inconnue.')
    if (!p.body) return {skipped: 'message vide'}
    const r = await sendText(task.recipes, p.conversation_id, p.body)
    const m = r.reply || r.message || r
    return {conversation_id: String(p.conversation_id), message_id: m?.id != null ? String(m.id) : null}
  }
  async function orderExtension(task) {
    const R = task.recipes.shipping_extension, p = task.payload
    if (!(await stillToShip(task))) return {skipped: 'la vente n’est plus à expédier'}
    await pause(2000, 5000)
    await call(R, {ids: {id: idFor(R, p, 'transaction')}, json: R.body === 'json' ? fillShape(R.template, [[/^(message|body|text|comment|reason_text|note)$/, p.message || '']]) : null})
    return {transaction_id: String(p.transaction_id)}
  }
  async function orderCancel(task) {
    const R = task.recipes.order_cancel, p = task.payload
    if (!(await stillToShip(task))) return {skipped: 'la vente n’est plus à expédier'}
    await pause(2000, 5000)
    // Le motif est celui choisi à la main pendant l'apprentissage.
    await call(R, {ids: {id: idFor(R, p, 'transaction')}, json: R.body === 'json' ? structuredClone(R.template) : null})
    return {transaction_id: String(p.transaction_id)}
  }
  async function orderReview(task) {
    const R = task.recipes.feedback_send, p = task.payload
    const body = R.body === 'json' ? fillShape(R.template, [[/^(rating|rate|stars|score)$/, 5], [/^(feedback|comment|body|text|message)$/, p.text || ''], [/transaction_id/, Number(p.transaction_id)]]) : null
    await call(R, {ids: {id: idFor(R, p, 'transaction')}, json: body})
    return {transaction_id: String(p.transaction_id)}
  }
  async function itemDelete(task) {
    const R = task.recipes.item_delete, p = task.payload
    await call(R, {ids: {id: idFor(R, p, 'item')}, json: R.body === 'json' ? fillShape(R.template, [[/item_id/, Number(p.item_id)]]) : null})
    return {item_id: String(p.item_id)}
  }

  let currentTask = null
  const progress = () => post({type: 'progress'})
  async function run(task) {
    currentTask = task
    const runners = {scan_wardrobe: scanWardrobe, sync_orders: syncOrders, fetch_label: fetchLabel, scan_likes: scanLikes,
      publish_item: publish, unmask_item: t => editItem(t, {unmask: true}), reprice_item: t => editItem(t, {unmask: false}), like_message: likeMessage,
      sync_inbox: scanInbox, reply_message: replyMessage, order_message: orderMessage, order_extension: orderExtension, order_cancel: orderCancel,
      order_review: orderReview, item_delete: itemDelete}
    try {
      if (!runners[task.kind]) throw new Stop('failed', 'Tâche inconnue.')
      return {ok: true, result: await runners[task.kind](task)}
    } catch (e) {
      return {ok: false, code: e.code || 'failed', error: String(e.message || 'Erreur').slice(0, 300), status: e.status || null}
    } finally { currentTask = null }
  }

  // ---------- Apprentissage ----------
  const SECRET = /^(cookie|authorization|x-csrf-token|x-anon-id|x-v-udt|x-datadome.*|x-client-id)$/i
  const RULES = [
    ['offer_send', /^(POST|PUT)$/, /offer/i],
    ['shipping_extension', /^(POST|PUT|PATCH)$/, /extend|extension|deadline|postpone|prolong/i],
    ['order_cancel', /^(POST|PUT|PATCH)$/, /cancel/i],
    ['feedback_send', /^(POST|PUT)$/, /feedback/i],
    ['item_delete', /^(POST|DELETE)$/, /^\/api\/v2\/items\/\{id\}(\/delete)?$/],
    ['user_read', /^GET$/, /^\/api\/v2\/users\/\{id\}$/],
    ['wardrobe', /^GET$/, /^\/api\/v2\/wardrobe\/\{id\}\/items$/],
    ['item_form', /^GET$/, /^\/api\/v2\/item_upload\/items\/\{id\}$/],
    ['item_edit', /^(PUT|POST|PATCH)$/, /^\/api\/v2\/item_upload\/items\/\{id\}$/],
    ['item_create', /^POST$/, /^\/api\/v2\/(item_upload\/items|items)$/],
    ['photo_upload', /^POST$/, /^\/api\/v2\/photos$/],
    ['conversation_create', /^POST$/, /^\/api\/v2\/conversations$/],
    ['message_send', /^POST$/, /^\/api\/v2\/conversations\/\{id\}\/replies$/],
    ['order_label', /^GET$/, /label/],
    ['inbox_list', /^GET$/, /^\/api\/v2\/inbox$/],
    ['conversation_read', /^GET$/, /^\/api\/v2\/conversations\/\{id\}$/],
    ['order_detail', /^GET$/, /^\/api\/v2\/transactions\/\{id\}$/],
    ['orders_list', /^GET$/, /my_orders|\/orders$|\/transactions$/],
    ['likes_list', /^GET$/, /notifications/],
  ]
  const shape = v => Array.isArray(v) ? v.slice(0, 1).map(shape) : v && typeof v === 'object' ? Object.fromEntries(Object.entries(v).map(([k, x]) => [k, shape(x)])) : typeof v === 'string' ? '' : typeof v === 'number' ? 0 : v
  function headersOf(h) {
    const out = {}, entries = h instanceof Headers ? [...h.entries()] : Array.isArray(h) ? h : Object.entries(h || {})
    for (const [k, v] of entries) out[String(k).toLowerCase()] = String(v)
    return out
  }
  function responseKeys(data) {
    if (!data || typeof data !== 'object') return []
    const keys = Object.keys(data).slice(0, 25), list = firstArray(data)[0]
    return list ? [...keys, 'liste:' + Object.keys(list).slice(0, 40).join(',')] : keys
  }
  async function observe(method, href, headers, body, response) {
    const url = new URL(href, location.origin)
    if (url.origin !== location.origin || !/^\/(api\/v2|web\/api)\//.test(url.pathname)) return
    const all = headersOf(headers)
    if (all['x-csrf-token']) memory.csrf = all['x-csrf-token']
    if (all['x-anon-id']) memory.anon = all['x-anon-id']
    if (!learning) return
    const path = url.pathname.replace(/\/\d+(?=\/|$)/g, '/{id}'), m = method.toUpperCase()
    const kind = RULES.find(([, mm, p]) => mm.test(m) && p.test(path))?.[0] || null
    const recipe = {method: m, path, status: response.status,
      query: Object.fromEntries([...url.searchParams].filter(([k, v]) => !/^(page|per_page|time|search_session_id)$/.test(k) && v.length <= 40 && !/^\d{6,}$/.test(v))),
      headers: Object.fromEntries(Object.entries(all).filter(([k]) => !SECRET.test(k) && !/^(accept|content-type|content-length)$/.test(k))),
      secret_headers: Object.keys(all).filter(k => SECRET.test(k)), body: 'none', template: null, fields: [], response: []}
    if (body instanceof FormData) {
      recipe.body = 'form'
      recipe.fields = [...body.entries()].map(([name, v]) => ({name, value: typeof v === 'string' && v.length <= 40 && !/uuid/i.test(name) ? v : null}))
    } else if (typeof body === 'string' && body) {
      try { const json = JSON.parse(body); recipe.body = 'json'; recipe.template = /item/.test(path) ? json : shape(json) } catch {}
    }
    if (kind === 'order_label') {
      const id = url.pathname.match(/\/(\d+)(?=\/|$)/)?.[1]
      recipe.id_from = [...memory.orders.values()].some(o => String(o.shipment_id) === id) ? 'shipment' : 'transaction'
    }
    if (['offer_send', 'shipping_extension', 'order_cancel', 'feedback_send', 'item_delete'].includes(kind)) {
      // Quel identifiant le chemin utilise : la conversation ouverte, une vente connue ou l'article.
      const id = url.pathname.match(/\/(\d+)(?=\/|$)/)?.[1]
      const page = location.pathname.match(/\/(\d{3,})/)?.[1]
      recipe.id_from = !id ? null : kind === 'item_delete' ? 'item' : /\/conversations\//.test(url.pathname) || (page === id && /inbox/.test(location.pathname)) ? 'conversation'
        : /\/items\//.test(url.pathname) ? 'item' : 'transaction'
    }
    try { const ct = response.headers.get('content-type') || ''; if (/json/.test(ct)) recipe.response = responseKeys(await response.clone().json()); else recipe.response = [ct.slice(0, 40)] } catch {}
    if (kind === 'orders_list') try { firstArray(await response.clone().json()).map(orderRow).forEach(o => memory.orders.set(String(o.transaction_id), o)) } catch {}
    if (!response.ok || !kind) return
    post({type: 'seen', kind, recipe})
  }
  // Les enveloppes ne servent qu'à relever, et ne sont posées qu'une fois le mode apprentissage activé à la main.
  // Elles ne modifient jamais les requêtes de Vinted.
  let wrapped = false
  function installWrappers() {
  if (wrapped) return
  wrapped = true
  window.fetch = async function (input, init = {}) {
    const response = await nativeFetch(input, init)
    if (learning) {
      const href = typeof input === 'string' ? input : input?.url || String(input)
      const method = init.method || input?.method || 'GET', headers = init.headers || input?.headers || {}
      observe(method, href, headers, init.body, response.clone()).catch(() => {})
    }
    return response
  }
  if (typeof XMLHttpRequest === 'undefined') return
  const xhrOpen = XMLHttpRequest.prototype.open, xhrSend = XMLHttpRequest.prototype.send, xhrHeader = XMLHttpRequest.prototype.setRequestHeader
  XMLHttpRequest.prototype.open = function (method, url, ...rest) { this.__sva = {method, url, headers: {}}; return xhrOpen.call(this, method, url, ...rest) }
  XMLHttpRequest.prototype.setRequestHeader = function (k, v) { if (this.__sva) this.__sva.headers[k] = v; return xhrHeader.call(this, k, v) }
  XMLHttpRequest.prototype.send = function (body) {
    if (learning && this.__sva) this.addEventListener('load', () => {
      const r = this, info = this.__sva
      const response = {status: r.status, ok: r.status >= 200 && r.status < 300, headers: {get: k => r.getResponseHeader(k)}, clone() { return {json: async () => JSON.parse(r.responseText)} }}
      observe(info.method, info.url, info.headers, body, response).catch(() => {})
    })
    return xhrSend.call(this, body)
  }
  }

  // ---------- Liaison avec l'extension ----------
  const bytesWaiters = new Map()
  window.addEventListener('message', async e => {
    if (e.source !== window || e.origin !== location.origin || e.data?.source !== 'sva-ext') return
    const d = e.data
    if (d.type === 'learning') { learning = d.on !== false; if (learning) installWrappers() }
    if (d.type === 'bytes') { const w = bytesWaiters.get(d.id); if (w) { bytesWaiters.delete(d.id); w(d.payload) } }
    if (d.type === 'run' && d.task && !currentTask) post({type: 'result', id: d.id, payload: await run(d.task)})
    else if (d.type === 'run') post({type: 'result', id: d.id, payload: {ok: false, code: 'busy', error: 'Une tâche est déjà en cours dans cet onglet.'}})
  })
  installWrappers()
  globalThis.__svAgent = {version: 4}
  // Pour les tests : fonctions pures.
  globalThis.__svAgentTest = {fillItem, wardrobeItem, orderRow, shape, fillShape, hiddenFlag, messageRow, conversationRow}
})()
