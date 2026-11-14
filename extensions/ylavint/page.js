// YlaVint, côté page Vinted (monde de la page, pour utiliser la session déjà ouverte du compte).
// 1. Exécute les tâches reçues de l'extension avec les « recettes » apprises sur le vrai site Vinted.
// 2. Mode apprentissage (activé à la main dans le popup) : relève la forme des requêtes que Vinted fait lui-même.
// Jamais de cookie ni de jeton envoyé hors de Vinted ; ce script ne connaît pas la clé du site.
(() => {
  if (globalThis.__svAgent && !globalThis.__ylavintDesktopMode) return
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
    // Session expirée : on la renouvelle comme le fait le site Vinted, puis un seul nouvel essai.
    memory.csrf = null
    try { await nativeFetch('/web/api/auth/refresh', {method: 'POST', credentials: 'include', headers: {accept: 'application/json', ...(csrf() ? {'x-csrf-token': csrf()} : {})}, signal: AbortSignal.timeout(10000)}) } catch {}
    await sleep(3000)
    return callOnce(recipe, {...opts, retried: true})
  }
  // Services Vinted hors du site (même compte, même session) : liste fermée de chemins.
  const API_ORIGIN = 'https://api.vinted.fr'
  const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
  const isUuid = v => UUID.test(String(v ?? ''))
  const API_PATHS = [/^\/inbox-notifications\/v1\/notifications$/, /^\/messaging\/main\/(inbox|inquiries)$/,
    /^\/messaging\/main\/conversations\/(\d{1,18}|[0-9a-f-]{36})(\/replies)?$/i, /^\/escrow-orders\/api\/v2\/current-user\/escrow-orders$/]
  async function callOnce(recipe, {ids = {}, query = {}, json = null, form = null, raw = false, timeout = null} = {}) {
    if (!recipe) throw new Stop('no_recipe', 'Action pas encore apprise.')
    const external = recipe.origin === API_ORIGIN
    // UUID : seulement pour la nouvelle messagerie Vinted.
    const path = recipe.path.replace(/\{(id|offer_id)\}/g, (_, key) => { const v = String(ids[key] ?? ''); if (!/^\d{1,18}$/.test(v) && !(key === 'id' && external && isUuid(v))) throw new Stop('failed', 'Identifiant manquant.'); return v })
    if (recipe.origin && !(external && API_PATHS.some(p => p.test(path)))) throw new Stop('failed', 'Origine de requête refusée.')
    const url = new URL(path, external ? API_ORIGIN : location.origin)
    if (url.origin !== (external ? API_ORIGIN : location.origin)) throw new Stop('failed', 'Adresse de requête refusée.')
    for (const [k, v] of Object.entries({...(recipe.query || {}), ...query})) url.searchParams.set(k, v)
    const headers = {accept: 'application/json, text/plain, */*', ...(recipe.headers || {})}
    delete headers['content-type']; delete headers['content-length']
    // Jetons de session : sur le site, et pour les envois de la nouvelle messagerie (comme le fait Vinted). Jamais ailleurs.
    const token = csrf(), anon = memory.anon || cookie('anon_id'), withTokens = !external || recipe.method !== 'GET'
    if (token && withTokens) headers['x-csrf-token'] = token
    if (anon && withTokens) headers['x-anon-id'] = anon
    if (json) headers['content-type'] = 'application/json'
    let response
    try { response = await nativeFetch(url.href, {method: recipe.method, headers, body: json ? JSON.stringify(json) : form || undefined, credentials: 'include',...(timeout?{signal:AbortSignal.timeout(timeout)}:{})}) }
    catch { throw new Stop('network', 'Vinted ne répond pas.') }
    const type = response.headers.get('content-type') || ''
    if (raw && response.ok && /pdf/.test(type)) return {pdf: await response.arrayBuffer()}
    const text = await response.text()
    let data = null
    try { data = JSON.parse(text) } catch {}
    if (response.status === 401) throw new Stop('logged_out', 'Session Vinted expirée.', 401)
    if (response.status === 429) throw new Stop('rate_limited', 'Vinted limite les requêtes.', 429)
    const head = text.slice(0, 3000)
    // Contrôle Cloudflare : la requête n'a pas atteint Vinted. L'onglet est rechargé et la tâche repart plus tard.
    if (/challenge-platform|__CF\$cv\$params|_cf_chl_opt/.test(head) && !response.ok) throw new Stop('challenge', 'Vérification de sécurité Vinted.', response.status)
    if (/captcha-delivery|datadome|captcha/i.test(head) && !response.ok) throw new Stop('captcha', 'Vérification Vinted demandée.', response.status)
    if (response.status === 403) {
      // Refus ciblés (membre qui t'a bloqué, conversation refusée) : à distinguer d'une restriction du compte.
      const mc = String(data?.message_code || ''), c = data?.code
      if (Number(c) === 106) throw new Stop('blocked', errorText(data, text), 403)
      if (mc === 'access_denied') throw new Stop('access_denied', errorText(data, text), 403)
      if (c === 'FORBIDDEN') throw new Stop('messaging_refused', errorText(data, text), 403)
      throw new Stop(/restrict|restrein|bloqu|banned|suspendu/i.test(text) ? 'restricted' : 'forbidden', errorText(data, text), 403)
    }
    if (!response.ok) throw new Stop('vinted_error', `Vinted ${response.status} :${errorText(data, '')}`, response.status)
    if (data && data.code && data.code !== 0 && data.message) {
      if (/restrict|restrein/i.test(data.message)) throw new Stop('restricted', data.message)
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
  const CARRIERS = /colissimo|mondial ?relay|relais ?colis|chronopost|inpost|vinted ?go|shop2shop|ups|dpd|dhl|gls|la poste|lettre suivie/i
  function orderExtras(o) {
    const deadline = findDeep(o, (k, v) => (typeof v === 'string' || typeof v === 'number') && /(ship|shipping|send|dispatch|delivery|package|parcel)\w*_?(deadline|due|until|expir\w*|limit|before|by)|deadline|must_ship|ship_by/i.test(k))
    let carrier = findDeep(o, (k, v) => typeof v === 'string' && /^(carrier|carrier_name|carrier_code|transporter|shipping_carrier|delivery_service|courier|shipping_method|delivery_method)(_name|_title|_code)?$/i.test(k))
      || findDeep(o, (k, v) => v && typeof v === 'object' && /carrier|transporter/i.test(k) && typeof (v.name || v.title || v.code) === 'string')
    if (carrier && typeof carrier === 'object') carrier = carrier.name || carrier.title || carrier.code
    // Nom du transporteur trouvé n'importe où dans la réponse (Colissimo surtout : son bordereau ne doit jamais être généré).
    if (typeof carrier !== 'string' || !CARRIERS.test(carrier)) { const m = JSON.stringify(o).match(CARRIERS); if (m) carrier = m[0] }
    const buyer = o.buyer || o.user || o.opposite_user || o.transaction?.buyer || null
    return {ship_deadline: deadline ?? null, carrier: typeof carrier === 'string' ? carrier : null, buyer_id: buyer?.id || o.buyer_id || o.transaction?.buyer_id || null, buyer_login: buyer?.login || null}
  }
  const photoOf = p => typeof p === 'string' ? p : p?.url || p?.full_size_url || p?.thumbnails?.find(t => /310|medium/.test(t.type || ''))?.url || p?.thumbnails?.[0]?.url || null
  function orderRow(o) {
    const t = o.transaction || o
    const status = [o.status, o.transaction_user_status, o.status_title, t.status].find(v => typeof v === 'string') || ''
    const row = {transaction_id: t.transaction_id || o.transaction_id || t.id || o.id, status,
      title: o.title || o.item_title || o.item?.title || t.item_title || '', price: amount(o.price || o.total_item_price || o.item?.price || t.price),
      currency: (o.price || o.item?.price)?.currency_code || 'EUR', order_date: o.date || o.created_at || t.created_at || o.updated_at || null,
      item_ids: [o.item_id, o.item?.id, ...(o.item_ids || [])].filter(Boolean),
      shipment_id: o.shipment_id || o.shipment?.id || t.shipment_id || null, conversation_id: o.conversation_id || t.conversation_id || null,
      photo_url: photoOf(o.photo) || photoOf(o.item?.photo) || photoOf(o.photos?.[0]) || photoOf(o.item?.photos?.[0]) || null, ...orderExtras(o)}
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
  // Ventes : liste classique de Vinted, ou la nouvelle (escrow-orders) si l'ancienne ne répond plus pour ce compte.
  const ESCROW_ORDERS = {method: 'GET', origin: API_ORIGIN, path: '/escrow-orders/api/v2/current-user/escrow-orders', query: {type: 'sold'}, headers: {'x-next-app': 'marketplace-web'}}
  async function syncOrders(task) {
    let data
    try { data = await call(task.recipes.orders_list, {query: {page: 1, per_page: 20}}) }
    catch (e) { if (!(e instanceof Stop) || ![403, 404, 410].includes(e.status) || ['restricted', 'captcha'].includes(e.code)) throw e; data = await call(ESCROW_ORDERS, {query: {page: 1, per_page: 20}}) }
    const orders = (Array.isArray(data?.my_orders) ? data.my_orders : firstArray(data)).map(orderRow).filter(o => o.transaction_id)
    // Détail d'une vente (articles du lot, envoi) : seulement pour les ventes pas encore détaillées, et si la lecture a été apprise.
    const detailed = new Set((task.payload?.detailed || []).map(String))
    if (task.recipes.order_detail) for (const o of orders.filter(o => !detailed.has(String(o.transaction_id))).slice(0, 8)) {
      try {
        await pause(1500, 4000)
        const d = await call(task.recipes.order_detail, {ids: {id: o.transaction_id}}), t = d.transaction || d
        const items = [t.item_id, t.item?.id, ...(Array.isArray(t.items) ? t.items.map(i => i.id) : []), ...(Array.isArray(t.order?.items) ? t.order.items.map(i => i.id || i.item_id) : [])].filter(Boolean)
        if (items.length) o.item_ids = [...new Set(items.map(String))]
        o.shipment_id = o.shipment_id || t.shipment?.id || t.shipment_id || null
        if (!o.photo_url) o.photo_url = photoOf(t.item?.photo) || photoOf(t.item?.photos?.[0]) || photoOf(t.order?.items?.[0]?.photos?.[0]) || null
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
      offers: detail ? pendingOffers(c, me) : [],
      messages: detail ? firstArray(c.messages ? {messages: c.messages} : c).map(m => messageRow(m, me)).filter(m => m.body || m.kind !== 'message') : null}
  }
  // Messagerie Vinted : ancienne (/api/v2/conversations) ou nouvelle (api.vinted.fr/messaging/main), selon le compte.
  // On regarde laquelle le site Vinted utilise lui-même pour ce compte (comme Dotb), et on s'y tient.
  const CHAT_HEADERS = {platform: 'web', 'x-next-app': 'marketplace-web'}
  const CHAT = {
    inbox: {method: 'GET', origin: API_ORIGIN, path: '/messaging/main/inbox', headers: CHAT_HEADERS},
    read: {method: 'GET', origin: API_ORIGIN, path: '/messaging/main/conversations/{id}', headers: CHAT_HEADERS},
    create: {method: 'POST', origin: API_ORIGIN, path: '/messaging/main/inquiries', headers: CHAT_HEADERS},
    reply: {method: 'POST', origin: API_ORIGIN, path: '/messaging/main/conversations/{id}/replies', headers: CHAT_HEADERS},
  }
  const LEGACY_READ = {method: 'GET', path: '/api/v2/conversations/{id}'}
  const CHAT_KEY = 'ylv_chat_api'
  // Le passage à la nouvelle messagerie est définitif : « v2 » est gardé 7 jours, « v1 » revérifié toutes les 6 h.
  function chatApi() {
    try { const s = JSON.parse(localStorage.getItem(CHAT_KEY) || 'null'); if (s && ['v1', 'v2'].includes(s.v) && Date.now() - s.at < (s.v === 'v2' ? 7 * 86400000 : 6 * 3600000)) return s.v } catch {}
    return memory.chat || null
  }
  function chatCheckedAt() { try { return Number(JSON.parse(localStorage.getItem(CHAT_KEY) || 'null')?.at) || memory.chatAt || 0 } catch { return memory.chatAt || 0 } }
  function setChat(v) {
    if (!['v1', 'v2'].includes(v)) return
    if (memory.chat !== v) memory.chatAt = Date.now()
    memory.chat = v
    try { const s = JSON.parse(localStorage.getItem(CHAT_KEY) || 'null'); if (s?.v !== v || Date.now() - s.at > 3600000) localStorage.setItem(CHAT_KEY, JSON.stringify({v, at: Date.now()})) } catch {}
  }
  function forgetChat() { memory.chat = null; try { localStorage.removeItem(CHAT_KEY) } catch {} }
  // Requêtes faites par la page Vinted elle-même (jamais les nôtres) : elles disent quelle messagerie le compte utilise.
  function chatFromUrls(urls) {
    if (urls.some(u => /\/messaging\/main\//.test(u))) return 'v2'
    if (urls.some(u => /\/api\/v2\/(inbox|conversations)(\?|\/|$)/.test(u))) return 'v1'
    return null
  }
  // Adresse où la messagerie Vinted s'ouvre : /inbox/123 (ancienne) ou /inbox/<uuid> (nouvelle).
  const chatFromPath = path => { const id = String(path || '').match(/^\/inbox\/([^/?#]+)\/?$/)?.[1]; return !id ? null : /^\d+$/.test(id) ? 'v1' : isUuid(id) ? 'v2' : null }
  // Compte pas encore vérifié : la messagerie Vinted est ouverte hors écran quelques secondes, comme le fait Dotb,
  // pour voir ce qu'elle utilise (adresse de la conversation ouverte, requêtes faites par la page Vinted).
  let probing = null
  async function detectChat() {
    const known = chatApi(); if (known) return known
    if (!document.body || typeof document.createElement !== 'function') return 'v1'
    probing ||= (async () => {
      const frame = document.createElement('iframe')
      frame.style.cssText = 'position:fixed;left:-3000px;top:0;width:1024px;height:800px;border:0;pointer-events:none'
      frame.setAttribute('aria-hidden', 'true'); frame.tabIndex = -1; frame.src = '/inbox'
      document.body.appendChild(frame)
      try {
        for (let i = 0; i < 20; i++) {
          await sleep(500)
          let v = null
          try { const w = frame.contentWindow; v = chatFromPath(w.location.pathname) || chatFromUrls(w.performance.getEntriesByType('resource').map(e => e.name)) } catch {}
          if (v) { setChat(v); return v }
        }
        return null
      } finally { frame.src = 'about:blank'; frame.remove() }
    })().finally(() => { probing = null })
    return (await probing) || 'v1' // rien vu : l'ancienne messagerie, comme Dotb
  }
  // Nouvelle messagerie → même forme que l'ancienne, pour que la suite (lecture, IA, likes) ne change pas.
  function v2Conversation(c) {
    const d = c?.data || {}, first = (c?.opposite_users || [])[0], system = first?.type === 'system' || c?.conversation_type === 'notice'
    const inv = Array.isArray(d.inventory_items) ? d.inventory_items : [], refs = (Array.isArray(d.items) ? d.items : []).filter(i => !i.is_deleted)
    const messages = (Array.isArray(c?.messages) ? c.messages : []).flatMap(m => {
      const x = m.data || {}, at = x.created_at_ts ?? m.created_at ?? null
      if (typeof x.entity_type === 'string' && x.entity_type !== 'message') return [{entity_type: x.entity_type, created_at_ts: at, entity: {...x, user_id: x.user_id ?? m.sender_id}}]
      const body = typeof x.content === 'string' ? x.content : '', photos = Array.isArray(x.photos) ? x.photos : []
      if (!body && !photos.length) return []
      return [{entity_type: 'message', created_at_ts: at, entity: {id: x.id ?? m.id, user_id: m.sender_id, body, photos}}]
    })
    const tid = d.order_id ?? d.transaction_id ?? null, last = c?.messages?.length ? c.messages[c.messages.length - 1] : null
    return {id: c?.id, legacy_id: c?.core_id_deprecated ?? null, conversation_type: c?.conversation_type ?? null, allow_reply: c?.allow_reply !== false,
      read_by_current_user: c?.is_unread_by_current_user !== true,
      opposite_user: system ? {id: null, login: 'Vinted'} : first?.data ? {id: first.data.id, login: first.data.login_name, photo: first.data.photo} : null,
      item: inv[0] || refs[0] ? {id: refs[0]?.inventory_item_id ?? inv[0]?.id ?? null, title: inv[0]?.title ?? null, price: inv[0]?.price ?? null, photo: inv[0]?.photos?.[0] ?? null} : null,
      transaction: tid ? {id: tid, current_user_side: d.current_user_side ?? null} : null,
      subtitle: d.subject ?? null, updated_at: last?.created_at ?? c?.updated_at ?? null, messages}
  }
  function v2Entry(e) {
    const items = Array.isArray(e?.data?.inventory_items) ? e.data.inventory_items : [], other = (e?.opposite_users || [])[0]?.data, last = e?.last_message
    return {id: e?.id, updated_at: last?.created_at ?? e?.updated_at ?? e?.created_at ?? null,
      description: (typeof last?.data?.content === 'string' && last.data.content) || items.map(i => i.title).filter(Boolean).join(', '),
      unread: e?.is_unread_by_current_user === true,
      opposite_user: e?.conversation_type === 'notice' ? {id: null, login: 'Vinted'} : other ? {id: other.id, login: other.login_name, photo: other.photo} : {},
      item_photos: items.map(i => i.photos?.[0]).filter(Boolean), item_title: items[0]?.title || null}
  }
  const skippable = e => e instanceof Stop && ['vinted_error', 'failed', 'access_denied', 'blocked', 'messaging_refused', 'forbidden'].includes(e.code)
  // Une conversation, quelle que soit la messagerie du compte (forme de l'ancienne messagerie).
  async function readConversation(R, id, chat) {
    const legacy = () => call(R.conversation_read || LEGACY_READ, {ids: {id}}).then(d => d.conversation || d)
    const fresh = () => call(CHAT.read, {ids: {id}}).then(v2Conversation)
    if (isUuid(id)) return fresh()
    if ((chat || chatApi()) === 'v2') { try { return await fresh() } catch (e) { if (!(e instanceof Stop && e.status === 404)) throw e } }
    return legacy()
  }
  // Envoi d'un texte dans une conversation existante.
  async function sendText(R, conversation, body, chat) {
    if(currentTask?.desktop===true){
      const result=await globalThis.__ylavintDesktopSend({task_id:currentTask.id,conversation_id:String(conversation),body,chat:chat||chatApi()})
      if(result?.desktop_cancelled)throw new Stop('desktop_context_changed',result.desktop_cancelled)
      return result
    }
    const v2 = () => call(CHAT.reply, {ids: {id: conversation}, json: {content: body, is_personal_data_sharing_check_skipped: false, photo_temp_uuids: null}})
      .then(r => ({reply: {id: r?.data?.id ?? r?.message?.id ?? r?.id ?? null}, conversation_id: r?.conversation_id ?? null}))
    if (isUuid(conversation)) return v2()
    if ((chat || chatApi()) === 'v2') { try { return await v2() } catch (e) { if (!(e instanceof Stop && e.status === 404)) throw e } }
    if (!R.message_send) throw new Stop('no_recipe', 'Envoi de message pas encore appris.')
    return call(R.message_send, {ids: {id: conversation}, json: fillShape(R.message_send.template, [[/^(body|message|text|content)$/, body], [/photo/, []]])})
  }
  async function inboxPage(R, chat, {page, cursor}) {
    if (chat === 'v2') {
      const data = await call(CHAT.inbox, {query: cursor ? {next_cursor: cursor.next, ...(cursor.temp ? {next_cursor_temp: cursor.temp} : {})} : {}})
      const next = data?.pagination?.has_next === true && data.pagination.next_cursor ? {next: data.pagination.next_cursor, temp: data.pagination_temp?.next_cursor || null} : null
      return {rows: (Array.isArray(data?.conversations) ? data.conversations : []).map(v2Entry), next}
    }
    const data = await call(R.inbox_list, {query: {page, per_page: 20}})
    const rows = Array.isArray(data.conversations) ? data.conversations : firstArray(data)
    return {rows, next: rows.length >= 20 ? {page: page + 1} : null}
  }
  async function scanInbox(task) {
    const p = task.payload || {}, known = p.known || {}, forced = new Set((p.conversation_ids || []).map(String)), me = task.member_id
    const first = !Object.keys(known).length, historyPage = Number(p.history_page) || 0
    let chat = await detectChat()
    const list = [], pages = historyPage ? 1 : first && !forced.size ? 2 : 1
    let cursor = chat === 'v2' && p.cursor && typeof p.cursor.next === 'string' ? p.cursor : null, page = historyPage || 1, next = null
    for (let i = 0; i < pages; i++) {
      let r
      try { r = await inboxPage(task.recipes, chat, {page, cursor}) }
      catch (e) {
        // L'ancienne messagerie ne répond plus pour ce compte : il est passé sur la nouvelle.
        if (chat !== 'v1' || !(e instanceof Stop) || ![403, 404, 410].includes(e.status)) throw e
        forgetChat(); chat = 'v2'; setChat('v2'); r = await inboxPage(task.recipes, chat, {page, cursor: null})
      }
      list.push(...r.rows); next = r.next
      if (!next) break
      if (chat === 'v2') cursor = next; else page = next.page
      if (i + 1 < pages) await pause(200, 400)
    }
    const changed = list.filter(c => c && (forced.has(String(c.id)) || known[String(c.id)] !== String(c.updated_at ?? ''))).slice(0, historyPage ? 20 : first ? 40 : 20)
    for (const id of forced) if (!list.some(c => String(c.id) === id)) changed.push({id})
    const out = new Map(list.filter(c => c?.id).map(c => [String(c.id), conversationRow(c, null, me)]))
    for (const c of changed) {
      await pause(100, 200)
      try {
        const detail = await readConversation(task.recipes, c.id, chat)
        out.set(String(c.id), conversationRow(c, detail, me))
        progress()
      } catch (e) { if (!skippable(e)) throw e }
    }
    const moreHistory = !!historyPage && !!next && list.some(c => { const v = c.updated_at, n = Number(v), t = Number.isFinite(n) ? n * (n < 1e12 ? 1000 : 1) : Date.parse(v); return !Number.isFinite(t) || t >= Date.parse(p.history_since) })
    return {conversations: [...out.values()], more_history: moreHistory, chat, ...(moreHistory && chat === 'v2' ? {next_cursor: next} : {})}
  }
  async function replyMessage(task) {
    if(task.payload.skip)return {skipped:task.payload.skip,context_changed:task.payload.context_changed===true}
    const {conversation_id, body} = task.payload, R = task.recipes
    if (!body) throw new Stop('failed', 'Message vide.')
    const chat = isUuid(conversation_id) ? 'v2' : await detectChat()
    if(task.payload.source==='ai'&&task.payload.manual!==true){
      const c=await readConversation(R,conversation_id,chat)
      if(!Array.isArray(c.messages))throw new Stop('failed','Conversation illisible : réponse automatique non envoyée.')
      if(c.allow_reply===false)return {skipped:'Vinted ne permet plus de répondre dans cette conversation.'}
      const at=v=>{const n=Number(v);return v==null?0:Number.isFinite(n)?n*(n<1e12?1000:1):Date.parse(v)||0}
      const messages=c.messages.map(m=>messageRow(m,task.member_id)).filter(m=>!['action','status'].includes(m.kind)).sort((a,b)=>at(a.sent_at)-at(b.sent_at))
      const last=messages.at(-1)
      if(!last||last.from_me||!task.payload.source_message_id||last.id!==String(task.payload.source_message_id))
        return {skipped:'La conversation a changé : réponse automatique à recalculer.',context_changed:true}
    }
    const r = await sendText(R, conversation_id, body, chat)
    const m = r.reply || r.message || r.conversation?.messages?.slice(-1)?.[0]?.entity || r
    return {conversation_id: String(conversation_id), message_id: m?.id != null ? String(m.id) : null}
  }
  function pendingOffers(c, me) {
    const t=c.transaction
    if(!t||String(t.seller_id)!==String(me)||t.current_user_side!=='seller'||t.is_completed||t.purchase_id||t.item_is_closed||typeof t.is_bundle!=='boolean')return []
    return (c.messages||[]).filter(m=>m.entity_type==='offer_request_message').flatMap(m=>{
      const e=m.entity||{}
      if(e.current!==true||Number(e.status)!==10||String(e.user_id)!==String(t.buyer_id)||String(e.transaction_id)!==String(t.id))return []
      return [{id:String(e.offer_request_id),transaction_id:String(t.id),buyer_id:String(t.buyer_id),price:amount(e.price),original_price:amount(e.original_price),
        currency:e.price?.currency_code||e.currency,is_bundle:t.is_bundle,created_at:m.created_at_ts??m.created_at??e.created_at_ts??e.created_at??null}]
    })
  }
  function offerAllowed(o, cfg) {
    if(cfg?.history_since){const v=o.created_at,n=Number(v),at=v==null?NaN:Number.isFinite(n)?n*(n<1e12?1000:1):Date.parse(v);if(!Number.isFinite(at)||at<Date.parse(cfg.history_since))return false}
    if(!cfg?.enabled||o.currency!=='EUR'||typeof o.is_bundle!=='boolean')return false
    const p=Number(o.price),base=Number(o.original_price),pct=o.is_bundle?cfg.bundle_discount:cfg.single_discount
    return Number.isFinite(p)&&Number.isFinite(base)&&Number.isFinite(pct)&&pct>=0&&pct<=80&&p>=1&&base>=p&&
      Math.round(p*100)>=Math.ceil(Math.round(base*100)*(10000-Math.round(pct*100))/10000)
  }
  async function acceptOffer(task) {
    const p=task.payload, R=task.recipes
    const data=await call(R.conversation_read,{ids:{id:p.conversation_id}})
    const offer=pendingOffers(data.conversation||data,task.member_id).find(o=>o.id===String(p.offer.id)&&o.transaction_id===String(p.offer.transaction_id)&&o.buyer_id===String(p.offer.buyer_id))
    if(!offer||Number(offer.price)!==Number(p.offer.price)||Number(offer.original_price)!==Number(p.offer.original_price)||!offerAllowed(offer,p.offer_settings))return {skipped:'Offre modifiée, inactive ou hors des seuils.'}
    await call(R.offer_accept,{ids:{id:offer.transaction_id,offer_id:offer.id}})
    return {accepted:true,offer_id:offer.id,price:Number(offer.price),conversation_id:String(p.conversation_id)}
  }
  async function fetchBytes(url) {
    const u = new URL(url, location.origin)
    if (u.origin === location.origin) {
      const r = await nativeFetch(u.href, {credentials: 'include',signal:AbortSignal.timeout(30000)})
      if (!r.ok) throw new Stop('failed', `Téléchargement refusé (${r.status}).`)
      return r.arrayBuffer()
    }
    try { const r = await nativeFetch(u.href, {credentials: 'omit',signal:AbortSignal.timeout(30000)}); if (r.ok) return r.arrayBuffer() } catch {}
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
    // On relit la vente avant tout : jamais de bordereau Colissimo (le générer annule la vente), et le bon identifiant d'envoi.
    let shipment = p.shipment_id
    const detailRecipe = task.recipes.order_detail || {method: 'GET', path: '/api/v2/transactions/{id}', query: {}, headers: {}, body: 'none'}
    const d = await call(detailRecipe, {ids: {id: p.transaction_id}}), t = d.transaction || d
    const x = orderExtras(t)
    if (/colissimo/i.test(x.carrier || '') || /colissimo/i.test(JSON.stringify(t))) return {transaction_id: p.transaction_id, skipped: 'colissimo', carrier: 'Colissimo'}
    shipment = shipment || t.shipment?.id || t.shipment_id || null
    let carrier = x.carrier
    const byShipment = recipe.id_from === 'shipment' || /\/shipments\//.test(recipe.path || '')
    if (!carrier || (byShipment && !shipment)) {
      // Transporteur ou envoi absent du détail : Vinted les donne aussi à part (lecture seule). Même contrôle Colissimo.
      try {
        await pause(800, 2000)
        const s = await call({method: 'GET', path: '/api/v2/escrow_orders/{id}/shipment'}, {ids: {id: p.transaction_id}})
        if (/colissimo/i.test(JSON.stringify(s))) return {transaction_id: p.transaction_id, skipped: 'colissimo', carrier: 'Colissimo'}
        shipment = shipment || s?.shipment?.id || s?.id || null
        carrier = carrier || orderExtras(s?.shipment || s || {}).carrier
      } catch (e) { if (!skippable(e)) throw e }
    }
    // Transporteur inconnu, ou La Poste (peut être Colissimo) : on ne prend aucun risque, le bordereau se fait sur Vinted.
    if (/la ?poste/i.test(carrier || '')) return {transaction_id: p.transaction_id, skipped: 'colissimo', carrier}
    if (!carrier || !CARRIERS.test(carrier)) return {transaction_id: p.transaction_id, shipment_id: shipment, pending: true, ship_deadline: x.ship_deadline}
    const id = byShipment ? shipment : p.transaction_id
    // Pas encore d'envoi ou de bordereau généré sur Vinted : on ne l'active jamais nous-mêmes, on repassera.
    if (!id) return {transaction_id: p.transaction_id, pending: true, carrier, ship_deadline: x.ship_deadline}
    let data
    try { data = await call(recipe, {ids: {id}, raw: true}) }
    catch (e) { if (e instanceof Stop && e.status === 404) return {transaction_id: p.transaction_id, shipment_id: shipment, pending: true, carrier, ship_deadline: x.ship_deadline}; throw e }
    let pdf = data.pdf
    if (!pdf) {
      const url = findDeep(data, (k, v) => typeof v === 'string' && /^https:\/\//.test(v) && /label|pdf|url/i.test(k))
      if (!url) return {transaction_id: p.transaction_id, shipment_id: shipment, pending: true, carrier, ship_deadline: x.ship_deadline}
      pdf = await fetchBytes(url)
    }
    if (pdf.byteLength > 4e6) throw new Stop('failed', 'Bordereau trop volumineux.')
    return {transaction_id: p.transaction_id, shipment_id: shipment, carrier, ship_deadline: x.ship_deadline, pdf_base64: toBase64(pdf)}
  }
  async function scanLikes(task) {
    // Anciennes recettes enregistrées : l’ancienne route /api/v2/notifications renvoie désormais 404.
    const recipe = !task.recipes.likes_list || task.recipes.likes_list.path === '/api/v2/notifications'
      ? {method:'GET',origin:'https://api.vinted.fr',path:'/inbox-notifications/v1/notifications',headers:{platform:'web','x-next-app':'marketplace-web',locale:'fr-FR'}} : task.recipes.likes_list
    const likes = [], seen = new Set(), historyPage=Number(task.payload?.history_page)||0
    // Lecture courante : on s'arrête dès qu'une page ne contient plus que des notifications déjà lues au passage précédent.
    const since = Date.parse(task.payload?.since || '')
    const timeOf = n => { const v=n.updated_at??n.created_at_ts??n.created_at??n.timestamp,num=Number(v); return v==null?NaN:Number.isFinite(num)?num*(num<1e12?1000:1):Date.parse(v) }
    let moreHistory=false, notifications=0
    for (let page = historyPage||1; page <= (historyPage||5); page++) {
      const query = {page, per_page: historyPage ? 50 : 20}
      let data
      try { data = await call(recipe, {query}) }
      catch (e) {
        // Comme Dotb : si le service de notifications ne répond pas, la route du site Vinted prend le relais.
        if (!(e instanceof Stop) || !e.status || [401, 429].includes(e.status) || ['captcha', 'restricted'].includes(e.code)) throw e
        data = await call({method: 'GET', path: '/web/api/notifications/notifications', headers: {platform: 'web'}}, {query})
      }
      const rows = Array.isArray(data?.notifications) ? data.notifications : firstArray(data)
      notifications += rows.length
      for (const n of rows) {
        const row = notificationLike(n, task.member_id)
        if (!row || seen.has(`${row.item_id}:${row.user_id}`)) continue
        seen.add(`${row.item_id}:${row.user_id}`); likes.push(row)
      }
      const hasMore=rows.length>0&&(data.pagination?.total_pages? page<Number(data.pagination.total_pages):rows.length===(historyPage?50:20))
      if(historyPage){moreHistory=hasMore&&rows.some(n=>{const at=timeOf(n);return !Number.isFinite(at)||at>=Date.parse(task.payload.history_since)});break}
      if (!hasMore) break
      const oldest = timeOf(rows[rows.length - 1])
      if (Number.isFinite(since) && Number.isFinite(oldest) && oldest < since) break
      await pause(500, 1000)
    }
    return {likes,more_history:moreHistory,notifications}
  }
  function notificationLike(n, me) {
    // Le lien sert seulement à lire des identifiants : il peut être relatif, absolu ou une adresse d'application.
    const raw = String(n.link || n.url || n.path || '')
    let link
    try { link = new URL(raw, location.origin) } catch { link = new URL(location.origin) }
    if (!(Number(n.entry_type) === 20 || /favou?ri|aim[ée]|like/i.test(String(n.body || n.title || '')))) return null
    const item = n.item_id || n.subject_id && Number(n.entry_type) === 20 && n.subject_id || raw.match(/items\/(\d+)/)?.[1] || n.item?.id
    // user_id est le destinataire de la notification, PAS le membre qui a liké.
    const user = link.searchParams.get('offering_id') || raw.match(/offering_id=(\d+)/)?.[1] || link.searchParams.get('user_id') || n.sender_id || n.sender?.id || n.notifier?.id
    const login = n.sender?.login || n.notifier?.login || String(n.body || '').match(/^([A-Za-z0-9._-]+) a (marqué|ajouté|aimé) /)?.[1] || null
    // Date du like : updated_at d'abord (une notification regroupée est mise à jour au dernier like), comme Dotb.
    return item && user && /^\d{1,18}$/.test(String(user)) && String(user) !== String(me) ? {item_id:String(item),user_id:String(user),login,liked_at:n.updated_at??n.created_at_ts??n.created_at??n.timestamp??null} : null
  }

  // Une photo envoyée comme le fait le formulaire Vinted (champs relevés à l'apprentissage).
  async function uploadPhoto(recipe, bytes, tempUuid, type='image/jpeg') {
    const form = new FormData(), blob = new Blob([bytes], {type})
    for (const f of recipe.fields) {
      const name = typeof f === 'string' ? f : f.name, value = typeof f === 'string' ? null : f.value
      if (/file/i.test(name)) form.append(name, blob, 'photo.'+({ 'image/png':'png','image/webp':'webp'}[type]||'jpg'))
      else if (/uuid/i.test(name)) form.append(name, tempUuid)
      else if (/type/i.test(name)) form.append(name, value || 'item')
      else if (value != null) form.append(name, value)
    }
    const r = await call(recipe, {form,timeout:45000,retried:true})
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
  // Données strictement issues de la fiche ; aucun titre, photo ou option d'une annonce apprise n'est réutilisé.
  function publicationBody(fields,assigned,tempUuid,live){
    const attrs=(fields.item_attributes||[]).filter(a=>!['size','condition'].includes(a.code)).map(a=>({code:a.code,ids:a.ids.map(Number)}))
    if(fields.size_id)attrs.push({code:'size',ids:[Number(fields.size_id)]})
    if(fields.status_id)attrs.push({code:'condition',ids:[Number(fields.status_id)]})
    const item={id:null,currency:'EUR',temp_uuid:tempUuid,title:fields.title,description:fields.description,brand_id:fields.brand_id,brand:fields.brand_title,
      catalog_id:fields.catalog_id,isbn:null,price:Number(fields.price).toFixed(2),package_size_id:fields.package_size_id,shipment_prices:{domestic:null},color_ids:fields.color_ids||[],
      assigned_photos:assigned,item_attributes:attrs,measurement_length:null,measurement_width:null,manufacturer:null,manufacturer_labelling:null}
    return {[live?'item':'draft']:item,...(live?{push_up:false}:{}),parcel:null,upload_session_id:uuid()}
  }
  async function publicationIdentity(member){
    // Relit la session réelle avant chaque création ; une identité ancienne en cache ne peut pas choisir le vendeur.
    const data=await call({method:'GET',path:'/api/v2/users/current'},{timeout:20000,retried:true})
    const u=data.user
    if(!u||String(u.id)!==String(member))throw new Stop('failed','Le compte Vinted connecté ne correspond pas au compte choisi. Aucun envoi.')
    if(u.is_account_banned||u.action_restriction)throw new Stop('restricted','Vinted signale une restriction : publication arrêtée.')
  }
  async function publish() { throw new Stop('failed','L’envoi direct est désactivé. Ouvre le formulaire avec YlaVint 3.8 puis valide toi-même.') }
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
    if(currentTask?.desktop===true&&price){
      const r=await globalThis.__ylavintDesktopOffer({task_id:currentTask.id,conversation_id:String(conversation),price,chat:chatApi()})
      if(r?.desktop_cancelled){if(r.message_confirmed)return false;throw new Stop('desktop_context_changed',r.desktop_cancelled)}
      return r===true
    }
    if (!R.offer_send || !price) return false
    const body = fillShape(R.offer_send.template, [[/^(price|amount|offer_price|value)$/, price.toFixed(2)], [/currency/, 'EUR']])
    await call(R.offer_send, {ids: {id: idFor(R.offer_send, {conversation_id: conversation, transaction_id: transaction}, 'transaction')}, json: body})
    return true
  }
  // Refus de Vinted qui concernent ce membre ou cet article seulement : le like est écarté, la suite continue (comme Dotb).
  function likeRefusal(e) {
    if (!(e instanceof Stop)) return null
    if (e.status === 404 || e.status === 410) return {skip_code: 'item_unavailable', skipped: 'article plus disponible sur Vinted'}
    if (e.code === 'blocked') return {skip_code: 'user_blocked_you', skipped: 'le membre t’a bloqué'}
    if (e.code === 'access_denied') return {skip_code: 'access_denied', skipped: 'Vinted refuse d’ouvrir une conversation avec ce membre'}
    if (e.code === 'messaging_refused') return {skip_code: 'messaging_refused', skipped: 'Vinted refuse la messagerie avec ce membre'}
    return null
  }
  async function openConversation(task, chat) {
    const p = task.payload, R = task.recipes
    if (chat === 'v2') {
      const r = await call(CHAT.create, {json: {item_ids: [String(p.item_id)], receiver_id: String(p.user_id)}})
      const id = r?.conversation_id || r?.conversation?.id || r?.id
      if (!id) throw new Stop('vinted_error', 'Conversation non ouverte.')
      return {id: String(id), transaction: null}
    }
    const created = await call(R.conversation_create, {json: fillShape(R.conversation_create.template, [[/item_id/, Number(p.item_id)], [/(opposite|receiver|recipient)_?user_id|^user_id$/, Number(p.user_id)]])})
    const id = created.conversation?.id || created.id
    if (!id) throw new Stop('vinted_error', 'Conversation non ouverte.')
    return {id: String(id), transaction: created.conversation?.transaction?.id || null}
  }
  async function likeMessage(task) {
    const p = task.payload, R = task.recipes
    if (p.skip) return {skipped: p.skip}
    if(task.desktop&&p.offer_requested&&!p.offer_price)throw new Stop('price_unknown','Prix de l’article indisponible : message et réduction à vérifier.')
    const offerAttempt=async(...args)=>{try{return await sendOffer(...args)}catch(e){if(task.desktop)throw e;return false}}
    const chat = p.followup && isUuid(p.conversation_id) ? 'v2' : await detectChat()
    if (p.followup) {
      // Relance : seulement si le membre n'a pas répondu et que Vinted permet encore d'écrire.
      let c
      try { c = await readConversation(R, p.conversation_id, chat) } catch (e) { const r = likeRefusal(e); if (r) return {...r, conversation_id: String(p.conversation_id)}; throw e }
      if(!Array.isArray(c.messages))throw new Stop('failed','Conversation illisible : relance non envoyée.')
      if (c.allow_reply === false) return {skipped: 'Vinted ne permet plus d’écrire dans cette conversation', conversation_id: String(p.conversation_id)}
      if (buyerEngaged(c, task.member_id)) return {skipped:'le membre a déjà envoyé un message ou une offre',conversation_id:String(p.conversation_id),buyer_engaged:true}
      if (p.message) { await sendText(R, p.conversation_id, p.message, chat); await pause(3000, 7000) }
      const offer = await offerAttempt(R, p.conversation_id, c.transaction?.id, p.offer_price)
      return {conversation_id: String(p.conversation_id), message: p.message || null, offer}
    }
    const member = await memberCheck(task)
    if (member.skip) return {skipped: member.skip, login: member.login}
    let created
    try { created = await openConversation(task, chat) }
    catch (e) {
      const r = likeRefusal(e)
      // Refus d'accès sur l'ancienne messagerie : on revérifiera laquelle le compte utilise au prochain envoi.
      if (r?.skip_code === 'access_denied' && chat === 'v1' && chatCheckedAt() < Date.now() - 30 * 60000) forgetChat()
      if (r) return {...r, login: member.login}
      throw e
    }
    const conversation = created.id
    await pause(4000, 9000)
    // Relire juste avant l'envoi : une offre ou un message peut arriver pendant l'attente du like.
    let current
    try { current = await readConversation(R, conversation, chat) } catch (e) { const r = likeRefusal(e); if (r) return {...r, conversation_id: conversation, login: member.login}; throw e }
    if(!Array.isArray(current.messages))throw new Stop('failed','Conversation illisible : message au like non envoyé.')
    if(buyerEngaged(current,task.member_id))return {skipped:'le membre a déjà envoyé un message ou une offre',conversation_id:conversation,buyer_engaged:true,login:member.login}
    if (current.allow_reply === false) return {skipped: 'Vinted ne permet pas d’écrire dans cette conversation', conversation_id: conversation, login: member.login}
    if (p.message) {
      try { await sendText(R, conversation, p.message, chat) }
      catch (e) { const r = likeRefusal(e); if (r) return {...r, conversation_id: conversation, login: member.login}; throw e }
    }
    let offer = false
    const transaction = created.transaction || current.transaction?.id || null
    if (p.offer_price && (task.desktop||R.offer_send)) { await pause(3000, 7000); offer = await offerAttempt(R, conversation, transaction, p.offer_price) }
    return {conversation_id: conversation, message: p.message || null, offer, login: member.login}
  }
  function buyerEngaged(conversation,me){
    return (conversation.messages||[]).map(m=>messageRow(m,me)).some(m=>!m.from_me&&['message','offer','photo'].includes(m.kind))
  }
  async function desktopRecheck(task,conversation,{afterMessage=false}={}){
    const c=await readConversation(task.recipes,conversation,isUuid(conversation)?'v2':await detectChat())
    if(!Array.isArray(c.messages)||c.allow_reply===false)return {cancelled:'Conversation indisponible.'}
    if(task.kind==='like_message'){
      if(buyerEngaged(c,task.member_id))return {cancelled:'L’acheteur a répondu ou fait une offre : relance annulée.'}
      if(String(c.opposite_user?.id)!==String(task.payload.user_id)||String(c.item?.id)!==String(task.payload.item_id))throw new Stop('desktop_review','Le membre ou l’article de la conversation n’est pas confirmé.')
      if(task.payload.offer_requested&&(amount(c.item?.price)==null||Number(amount(c.item.price))!==Number(task.payload.expected_price)))throw new Stop('desktop_review','Le prix a changé ou n’est plus lisible : réduction à vérifier.')
      if(!afterMessage&&!task.payload.followup&&c.messages.map(m=>messageRow(m,task.member_id)).some(m=>m.from_me&&m.kind==='message'))return {cancelled:'Ce membre a déjà reçu un message dans cette conversation.'}
    }
    if(task.kind==='reply_message'&&task.payload.source==='ai'&&task.payload.manual!==true){
      const at=v=>{const n=Number(v);return v==null?0:Number.isFinite(n)?n*(n<1e12?1000:1):Date.parse(v)||0}
      const last=c.messages.map(m=>messageRow(m,task.member_id)).filter(m=>!['action','status'].includes(m.kind)).sort((a,b)=>at(a.sent_at)-at(b.sent_at)).at(-1)
      if(!last||last.from_me||last.id!==String(task.payload.source_message_id))return {cancelled:'La conversation a changé : réponse IA à recalculer.'}
    }
    return {ok:true}
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
    const r = await sendText(task.recipes, p.conversation_id, p.body, isUuid(p.conversation_id) ? 'v2' : await detectChat())
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
      order_review: orderReview, item_delete: itemDelete, accept_offer: acceptOffer}
    try {
      if (!runners[task.kind]) throw new Stop('failed', 'Tâche inconnue.')
      return {ok: true, result: await runners[task.kind](task)}
    } catch (e) {
      if(e.code==='desktop_context_changed')return {ok:true,result:{skipped:e.message,context_changed:true}}
      return {ok: false, code: e.code || 'failed', error: String(e.message || 'Erreur').slice(0, 300), status: e.status || null}
    } finally { currentTask = null }
  }

  // ---------- Apprentissage ----------
  const SECRET = /^(cookie|authorization|x-csrf-token|x-anon-id|x-v-udt|x-datadome.*|x-client-id)$/i
  const RULES = [
    ['offer_accept', /^PUT$/, /^\/api\/v2\/transactions\/\{id\}\/offer_requests\/\{offer_id\}\/accept$/],
    ['offer_send', /^POST$/, /^\/api\/v2\/transactions\/\{id\}\/offers$/],
    ['shipping_extension', /^(POST|PUT|PATCH)$/, /extend|extension|deadline|postpone|prolong/i],
    ['order_cancel', /^(POST|PUT|PATCH)$/, /cancel/i],
    ['feedback_send', /^(POST|PUT)$/, /feedback/i],
    ['item_delete', /^(POST|DELETE)$/, /^\/api\/v2\/items\/\{id\}(\/delete)?$/],
    ['user_read', /^GET$/, /^\/api\/v2\/users\/\{id\}$/],
    ['wardrobe', /^GET$/, /^\/api\/v2\/wardrobe\/\{id\}\/items$/],
    ['item_form', /^GET$/, /^\/api\/v2\/item_upload\/items\/\{id\}$/],
    ['item_edit', /^(PUT|POST|PATCH)$/, /^\/api\/v2\/item_upload\/items\/\{id\}$/],
    ['draft_create', /^POST$/, /^\/api\/v2\/item_upload\/drafts$/],
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
    // La page Vinted elle-même dit quelle messagerie ce compte utilise.
    if (response.ok !== false) { const chat = chatFromUrls([url.href]); if (chat) setChat(chat) }
    if (url.origin !== location.origin || !/^\/(api\/v2|web\/api)\//.test(url.pathname)) return
    const all = headersOf(headers)
    if (all['x-csrf-token']) memory.csrf = all['x-csrf-token']
    if (all['x-anon-id']) memory.anon = all['x-anon-id']
    if (!learning) return
    const path = url.pathname.replace(/\/offer_requests\/\d+(?=\/|$)/g, '/offer_requests/{offer_id}').replace(/\/\d+(?=\/|$)/g, '/{id}'), m = method.toUpperCase()
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
      recipe.id_from = /\/shipments\//.test(url.pathname) || [...memory.orders.values()].some(o => String(o.shipment_id) === id) ? 'shipment' : 'transaction'
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
  globalThis.__svAgent = {version: 5,...(globalThis.__ylavintDesktopMode?{run,recheck:desktopRecheck}: {})}
  // Pour les tests : fonctions pures.
  globalThis.__svAgentTest = {publicationBody,fillItem, wardrobeItem, orderRow, shape, fillShape, hiddenFlag, messageRow, conversationRow, notificationLike, pendingOffers, offerAllowed,
    v2Conversation, v2Entry, chatFromUrls, chatFromPath, setChat, forgetChat, chatApi, desktopRecheck}
})()
