// YlaVint dans les pages Vinted : bouton rond en bas à gauche, menu, et panneau plein écran
// (automatisations, réglages du compte, dressing, commandes). Tout passe par le site YlaVint ;
// l'interface est isolée dans un Shadow DOM pour ne jamais toucher la page Vinted.
(() => {
  if (window.top !== window || globalThis.__ylvOverlay) return
  globalThis.__ylvOverlay = true
  const SITE_URL = 'https://vinted-stock.vercel.app'
  const esc = v => String(v ?? '').replace(/[&<>"']/g, c => ({'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'}[c]))
  const euro = v => v == null || v === '' ? '—' : `${Number(v).toFixed(2).replace('.', ',')} €`
  const day = v => v ? new Date(v).toLocaleString('fr-FR', {day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit'}) : '—'
  const hour = v => v ? new Date(v).toLocaleTimeString('fr-FR', {hour: '2-digit', minute: '2-digit', second: '2-digit'}) : ''
  const store = {get: k => chrome.storage.local.get(k), set: o => chrome.storage.local.set(o)}
  const who = () => { try { return globalThis.readVintedAccount?.() || null } catch { return null } }
  const ask = (op, payload) => new Promise((ok, ko) => {
    const w = who()
    chrome.runtime.sendMessage({type: 'ylv_site', op, payload, member_id: w?.member_id, login: w?.login}, r => {
      if (chrome.runtime.lastError) return ko(new Error('Extension indisponible : recharge la page.'))
      r?.error ? ko(new Error(r.error)) : ok(r)
    })
  })

  const host = document.createElement('div')
  host.id = 'ylavint-root'
  host.style.cssText = 'all:initial;position:fixed;z-index:2147483646;inset:auto auto 0 0'
  const root = host.attachShadow({mode: 'open'})
  root.innerHTML = `<style>
  :host{all:initial}
  *{box-sizing:border-box;font-family:system-ui,-apple-system,"Segoe UI",Roboto,sans-serif}
  .t{--bg:#fff;--side:#fafafa;--card:#fff;--line:#e5e7eb;--ink:#111827;--muted:#6b7280;--soft:#f3f4f6;--blue:#1d6cf2;--blue2:#e8f0fe}
  .t.dark{--bg:#0a0a0b;--side:#111113;--card:#1c1c1f;--line:#2a2a2e;--ink:#fafafa;--muted:#a1a1aa;--soft:#27272a;--blue:#3b82f6;--blue2:#1e3a8a55}
  .fab{position:fixed;left:18px;bottom:18px;width:64px;height:64px;border-radius:50%;border:0;cursor:pointer;background:#1d6cf2;color:#fff;box-shadow:0 8px 24px #1d6cf266;display:grid;place-items:center;transition:transform .12s}
  .fab:hover{transform:scale(1.05)}.fab.off{background:#71717a;box-shadow:0 6px 16px #0003}.fab.warn{background:#ea580c}
  .fab b{font:900 28px/1 system-ui}.fab i{position:absolute;right:0;top:0;min-width:20px;height:20px;border-radius:10px;background:#f59e0b;color:#fff;font:700 11px/20px system-ui;font-style:normal;padding:0 5px;border:2px solid #fff}
  .menu{position:fixed;left:18px;bottom:92px;width:230px;background:var(--card);color:var(--ink);border:1px solid var(--line);border-radius:12px;box-shadow:0 12px 32px #0002;padding:6px;font-size:14px}
  .menu button{display:flex;width:100%;align-items:center;gap:10px;border:0;background:none;color:inherit;font:inherit;padding:8px 10px;border-radius:8px;cursor:pointer;text-align:left}
  .menu button:hover{background:var(--soft)}.menu hr{border:0;border-top:1px solid var(--line);margin:4px 0}
  .menu .st{font-size:12px;color:var(--muted);padding:6px 10px}.menu .bad{color:#dc2626}
  .panel{position:fixed;inset:0;display:flex;background:var(--bg);color:var(--ink);font-size:14px}
  aside{width:250px;flex-shrink:0;border-right:1px solid var(--line);background:var(--side);padding:16px 10px;overflow-y:auto}
  .brand{display:flex;align-items:center;gap:10px;padding:0 6px 16px;font-weight:700;font-size:16px}
  .logo{width:44px;height:44px;border-radius:50%;background:#1d6cf2;color:#fff;display:grid;place-items:center;font:900 22px system-ui}
  aside button{display:flex;width:100%;align-items:center;gap:10px;border:0;background:none;color:var(--ink);font:inherit;padding:8px 10px;border-radius:8px;cursor:pointer;text-align:left}
  aside button:hover{background:var(--soft)}aside button.on{background:var(--soft);font-weight:600}
  aside small{display:block;color:var(--muted);font-size:12px;padding:12px 10px 4px}
  .main{flex:1;min-width:0;display:flex;flex-direction:column}
  .top{display:flex;align-items:center;gap:12px;border-bottom:1px solid var(--line);padding:10px 20px}
  .top b{font-size:15px}.top .sp{flex:1}
  .ghost{border:1px solid var(--line);background:var(--card);color:var(--ink);font:inherit;font-size:13px;border-radius:8px;padding:6px 12px;cursor:pointer}
  .ghost:hover{background:var(--soft)}
  .body{flex:1;overflow-y:auto;padding:22px}
  .info{border:1px solid #93c5fd;background:var(--blue2);color:var(--blue);border-radius:10px;padding:14px 16px;font-size:13px;margin-bottom:20px}
  .cards{display:grid;grid-template-columns:repeat(auto-fill,minmax(300px,1fr));gap:16px}
  .card{border:1px solid var(--line);background:var(--card);border-radius:12px;padding:20px 22px}
  .card h3{margin:0;font-size:17px;display:flex;justify-content:space-between;align-items:center;gap:8px}
  .card p{margin:6px 0 10px;color:var(--muted);font-size:13px}
  .tag{border:1px solid var(--line);border-radius:999px;padding:2px 9px;font-size:11px;font-weight:600;color:var(--ink)}
  .live{color:#16a34a;border-color:#86efac}
  .state{font-weight:700;margin:10px 0 8px}
  .chips{display:flex;flex-wrap:wrap;gap:6px;margin-bottom:16px}.chip{background:var(--soft);border-radius:999px;padding:3px 10px;font-size:12px}
  .btn{display:flex;align-items:center;justify-content:center;gap:6px;width:100%;border:0;border-radius:8px;padding:11px;font:600 14px system-ui;color:#fff;background:var(--blue);cursor:pointer}
  .btn.red{background:#e00f0f}.btn.gray{background:#6b7280}.btn:disabled{opacity:.5;cursor:default}
  .tabs{display:inline-flex;background:var(--soft);border-radius:10px;padding:4px;gap:2px;margin:22px 0 14px}
  .tabs button{border:0;background:none;color:var(--muted);font:inherit;font-size:13px;padding:7px 14px;border-radius:8px;cursor:pointer}.tabs button.on{background:var(--card);color:var(--ink);font-weight:600;box-shadow:0 1px 2px #0001}
  table{width:100%;border-collapse:collapse;border:1px solid var(--line);border-radius:10px;overflow:hidden;background:var(--card);font-size:13px}
  th{text-align:left;font-weight:600;color:var(--muted);padding:10px 12px;border-bottom:1px solid var(--line)}td{padding:10px 12px;border-bottom:1px solid var(--line);vertical-align:middle}
  td a{color:var(--blue)}tr:last-child td{border-bottom:0}
  .pill{display:inline-block;border-radius:999px;padding:2px 9px;font-size:12px;font-weight:600;background:var(--soft)}
  .p-green{background:#dcfce7;color:#15803d}.p-red{background:#fee2e2;color:#b91c1c}.p-amber{background:#fef3c7;color:#b45309}.p-blue{background:#dbeafe;color:#1d4ed8}.p-violet{background:#ede9fe;color:#6d28d9}
  .dark .p-green{background:#14532d;color:#86efac}.dark .p-red{background:#7f1d1d;color:#fecaca}.dark .p-amber{background:#78350f;color:#fde68a}.dark .p-blue{background:#1e3a8a;color:#bfdbfe}.dark .p-violet{background:#4c1d95;color:#ddd6fe}
  h1{font-size:19px;margin:0 0 4px}.sub{color:var(--muted);font-size:13px;margin:0 0 18px}
  .form{max-width:680px;border:1px solid var(--line);background:var(--card);border-radius:12px;padding:20px 24px}
  .row{display:flex;justify-content:space-between;align-items:flex-start;gap:16px;padding:12px 0}
  .row b{display:block;font-size:14px}.row span{color:var(--muted);font-size:13px}
  .sw{position:relative;display:inline-block;width:44px;height:24px;flex-shrink:0}.sw input{opacity:0;width:0;height:0}.sw i{position:absolute;inset:0;border-radius:12px;background:#9ca3af;box-shadow:inset 0 0 0 1px #6b7280;cursor:pointer;transition:.15s}
  .sw i:before{content:"";position:absolute;width:18px;height:18px;left:3px;top:3px;border-radius:50%;background:#fff;transition:.15s}.sw input:checked+i{background:var(--blue)}.sw input:checked+i:before{transform:translateX(20px)}
  label.f{display:block;font-weight:600;font-size:13px;margin:14px 0 6px}
  input.in,textarea.in,select.in{width:100%;border:1px solid var(--line);background:var(--bg);color:var(--ink);border-radius:8px;padding:9px 11px;font:inherit;font-size:13px}
  textarea.in{min-height:76px;resize:vertical}.grid2{display:grid;grid-template-columns:1fr 1fr;gap:12px}
  .actions{display:flex;justify-content:flex-end;margin-top:18px}.actions .btn{width:auto;padding:10px 18px}
  .bar{display:flex;flex-wrap:wrap;gap:8px;align-items:center;margin-bottom:14px}.bar .sp{flex:1}
  .box{border:1px solid var(--line);border-radius:10px;padding:14px 16px;margin:14px 0;background:var(--card)}.box h4{margin:0 0 6px;font-size:14px}
  .info{border:1px solid #bfdbfe;background:#eff6ff;color:#1e3a8a;border-radius:10px;padding:10px 14px;font-size:12.5px;margin:14px 0}.dark .info{background:#172554;border-color:#1e3a8a;color:#dbeafe}
  .info ul{margin:4px 0 0;padding-left:18px}.ind{border-left:2px solid var(--line);padding-left:14px;margin-left:2px}
  .inline{display:flex;flex-wrap:wrap;gap:8px;align-items:center}.inline .in{width:auto}.count{display:block;text-align:right;font-size:11px;color:var(--muted)}
  .tabs.full{display:grid;grid-template-columns:repeat(4,1fr);width:100%;margin:0 0 12px}.chipx{display:inline-flex;gap:4px;align-items:center;background:var(--soft);border-radius:6px;padding:2px 8px;font-size:12px;margin:6px 4px 0 0}
  .chipx button{border:0;background:none;color:var(--muted);cursor:pointer;font-size:14px}.center{display:flex;justify-content:center}
  .note{color:var(--muted);font-size:12px}.err{color:#dc2626;font-size:13px;margin:8px 0}.ok{color:#16a34a;font-size:13px;margin:8px 0}
  img.th{width:36px;height:46px;object-fit:cover;border-radius:4px;background:var(--soft)}
  @media(max-width:800px){aside{display:none}.body{padding:14px}}
  </style><div class="t" id="t"></div>`
  const box = root.getElementById('t')

  const S = {open: false, menu: false, page: 'auto', tab: 'likes', data: null, wardrobe: null, sales: null, error: '', notice: '', busy: false, theme: 'light', bridge: true, agent: null, q: '', status: '', flowTab: 'shipping'}
  const PAGES = {auto: 'Automatisations', likes: 'Messages aux likes', agent: 'Smart Agent', flow: 'Flux de commandes', unmask: 'Démasquage & prix', dressing: 'Dressing', orders: 'Commandes'}

  async function refresh() {
    try { S.data = await ask('overview'); S.error = '' } catch (e) { S.error = e.message }
    render()
  }
  async function act(op, payload, msg) {
    S.busy = true; S.error = ''; S.notice = ''; render()
    try { const r = await ask(op, payload); S.notice = typeof msg === 'function' ? msg(r) : msg || ''; await refresh(); return r }
    catch (e) { S.error = e.message } finally { S.busy = false; render() }
  }
  const acc = () => S.data?.account
  const settings = () => acc()?.settings || (S.data?.defaults ? {...structuredClone(S.data.defaults), enabled: false, version: undefined} : null)
  function saveSettings(mut, msg = 'Paramètres enregistrés.') {
    const s = structuredClone(settings()); mut(s)
    return act('save_settings', {enabled: s.enabled, version: acc()?.settings?.version, settings: {features: s.features, limits: s.limits, unmask: s.unmask, pricing: s.pricing, likes: s.likes, messaging: s.messaging || S.data.defaults.messaging, order_flow: s.order_flow || S.data.defaults.order_flow}}, msg)
  }
  const on = f => !!acc()?.settings?.enabled && !!acc()?.settings?.features?.[f]
  const today = kind => (S.data?.tasks || []).filter(t => t.kind === kind && t.state === 'done' && Date.now() - Date.parse(t.finished_at || 0) < 864e5).length

  function stateOf(features) {
    const s = acc()?.settings
    if (!S.bridge) return 'Bridge coupé'
    if (!s?.enabled) return 'Compte non activé'
    if (s.paused) return 'En pause'
    return features.some(f => s.features[f]) || features.includes('ai') && s.messaging?.offers?.enabled ? 'En attente…' : 'Arrêté'
  }
  function card(title, desc, features, chips, extraTag = 'live') {
    const running = (features.some(f => on(f)) || features.includes('ai') && settings().enabled && settings().messaging?.offers?.enabled) && !acc()?.settings?.paused
    return `<div class="card"><h3>${esc(title)}<span class="tag ${running ? 'live' : ''}">${running ? esc(extraTag) : 'arrêt'}</span></h3><p>${esc(desc)}</p>
      <div class="state">${esc(stateOf(features))}</div><div class="chips">${chips.map(c => `<span class="chip">${esc(c)}</span>`).join('')}</div>
      <button class="btn ${running ? '' : 'gray'}" data-toggle="${features.join(',')}" ${S.busy || !S.data ? 'disabled' : ''}>${running ? '❚❚ Pause' : '▶ Activer'}</button></div>`
  }

  function pageAuto() {
    const d = S.data, s = settings()
    if (!d) return `<p class="note">${S.error ? '' : 'Chargement…'}</p>`
    const log = (d.log || []).filter(l => S.tab === 'likes' ? /like/i.test(l.event + l.message) : S.tab === 'agent' ? /ai|reply|réponse|message|offre/i.test(l.event + l.message) : /order|vente|label|bordereau/i.test(l.event + l.message))
    const tasks = (d.tasks || []).filter(t => S.tab === 'likes' ? ['scan_likes', 'like_message'].includes(t.kind) : S.tab === 'agent' ? ['sync_inbox', 'reply_message','accept_offer'].includes(t.kind) : ['sync_orders', 'fetch_label'].includes(t.kind))
    const rows = [...tasks.map(t => ({at: t.finished_at || t.started_at || t.not_before, type: d.kinds?.[t.kind]?.label || t.kind, tone: t.state === 'done' ? 'p-green' : t.state === 'failed' ? 'p-red' : 'p-amber', detail: t.error || ({queued: 'en attente', running: 'en cours', done: 'terminée', failed: 'échec', cancelled: 'annulée'})[t.state]})),
      ...log.map(l => ({at: l.created_at, type: l.event, tone: l.level === 'warn' ? 'p-amber' : l.level === 'error' ? 'p-red' : 'p-blue', detail: l.message}))].sort((a, b) => Date.parse(b.at || 0) - Date.parse(a.at || 0)).slice(0, 60)
    return `<div class="info">ⓘ Les automatisations tournent depuis ce profil AdsPower, dans les plafonds du compte. Si le profil est fermé, elles attendent sa réouverture.</div>
     ${!acc() ? `<div class="err">Ce compte Vinted n’est pas encore connu du site : synchronise la liste des comptes sur ton site.</div>` : ''}
     <div class="cards">
      ${card('Automatisation des messages aux likes', 'Répondre automatiquement aux membres qui likent tes articles', ['likes'], [`✉ ${today('like_message')} message(s) aujourd’hui`, `⏱ après ${s.likes.wait_minutes} min`])}
      ${card('Smart Agent', 'Agent IA qui prépare ou envoie les réponses aux acheteurs', ['ai', 'inbox'], [`✉ ${today('reply_message')} réponse(s) aujourd’hui`, `${d.ai?.enabled ? (d.ai.mode === 'auto' ? 'Répond seul' : 'Propose') : 'Agent IA coupé sur le site'}`, `${d.unread || 0} non lu(s)`])}
      ${card('Flux de commandes', 'Lit tes ventes toutes les 30 min, les envoie dans l’onglet Ventes et récupère les bordereaux', ['orders', 'sales', 'labels'], [`✓ ${today('sync_orders')} lecture(s)`, `🖨 ${today('fetch_label')} bordereau(x)`], 'En direct')}
      ${card('Démasquage & prix', 'Répare les annonces masquées du catalogue et baisse les prix au fil du temps', ['unmask', 'pricing'], [`◉ ${today('unmask_item')} démasquage(s)`, `€ ${today('reprice_item')} baisse(s)`])}
      <div class="card"><h3>Bridge <span class="tag ${S.bridge ? 'live' : ''}">${S.bridge ? '📶' : 'coupé'}</span></h3><p>Relie ce profil à ton site YlaVint : messagerie centralisée, ventes, tableau de bord.</p>
       <div class="state">${S.bridge ? esc(S.agent?.state === 'task' ? 'Au travail…' : 'Connecté') : 'Coupé'}</div><div class="chips"><span class="chip">${esc(acc()?.login || who()?.login || '—')}</span></div>
       <button class="btn ${S.bridge ? 'red' : ''}" data-bridge>${S.bridge ? '⊗ Arrêter' : '▶ Allumer'}</button></div>
     </div>
     <div class="tabs">${[['likes', 'Événements de J’aime'], ['agent', 'Événements Smart Agent'], ['flow', 'Événements des flux de commandes']].map(([k, l]) => `<button data-tab="${k}" class="${S.tab === k ? 'on' : ''}">${l}</button>`).join('')}</div>
     <table><thead><tr><th style="width:110px">Heure</th><th style="width:220px">Type d’événement</th><th>Détails</th></tr></thead><tbody>
      ${rows.length ? rows.map(r => `<tr><td>${esc(hour(r.at))}</td><td><span class="pill ${r.tone}">${esc(r.type)}</span></td><td>${esc(r.detail)}</td></tr>`).join('') : `<tr><td colspan="3" class="note">Aucun événement pour l’instant.</td></tr>`}
     </tbody></table>`
  }
  const sw = (key, checked, title, text) => `<div class="row"><div><b>${esc(title)}</b><span>${esc(text)}</span></div><label class="sw"><input type="checkbox" data-f="${key}" ${checked ? 'checked' : ''}><i></i></label></div>`
  const num = (group, key, label, value, suffix = '') => `<div><label class="f">${esc(label)}</label><input class="in" type="number" data-n="${group}.${key}" value="${esc(value)}">${suffix ? `<span class="note">${esc(suffix)}</span>` : ''}</div>`
  function settingsForm(title, sub, body) {
    if (!S.data) return '<p class="note">Chargement…</p>'
    return `<h1>${esc(title)}</h1><p class="sub">${esc(sub)}</p><div class="form">
      ${sw('enabled', settings().enabled, 'YlaVint actif sur ce compte', 'Sans cela, aucune automatisation ne tourne sur ce compte.')}${body}
      <div class="actions"><button class="btn" data-save ${S.busy ? 'disabled' : ''}>Enregistrer les paramètres</button></div></div>`
  }
  // ---------- Réglages façon Dotb (likes, flux de commande) : brouillon modifié sur place, enregistré d'un coup ----------
  const getPath = (o, path) => path.split('.').reduce((v, k) => v?.[k], o)
  const setPath = (o, path, value) => { const keys = path.split('.'), last = keys.pop(); let t = o; for (const k of keys) t = t[k] ??= {}; t[last] = value }
  const draft = () => S.draft || (S.draft = structuredClone(settings()))
  const dsw = (path, title, text = '') => `<div class="row"><div><b>${esc(title)}</b>${text ? `<span>${esc(text)}</span>` : ''}</div><label class="sw"><input type="checkbox" data-pb="${path}" ${getPath(draft(), path) ? 'checked' : ''}><i></i></label></div>`
  const dtext = (path, label, hint = '', max = 500) => { const v = getPath(draft(), path) || ''
    return `<label class="f">${esc(label)}</label><textarea class="in" data-p="${path}" maxlength="${max}">${esc(v)}</textarea><span class="count">${hint ? esc(hint) + ' · ' : ''}${v.length}/${max}</span>` }
  const dsel = (path, options, label = '') => `${label ? `<label class="f">${esc(label)}</label>` : ''}<select class="in" data-ps="${path}" style="width:auto;min-width:150px">${options.map(([v, l]) => `<option value="${esc(v)}" ${String(getPath(draft(), path)) === String(v) ? 'selected' : ''}>${esc(l)}</option>`).join('')}</select>`
  const dnum = (path, attrs = '') => `<input class="in" type="number" data-pn="${path}" value="${esc(getPath(draft(), path) ?? '')}" style="width:90px" ${attrs}>`
  const dayOpts = (a, b) => Array.from({length: b - a + 1}, (_, i) => [a + i, a + i === 0 ? 'Le jour même' : a + i === 1 ? '1 jour' : `${a + i} jours`])
  const newStep = () => ({message: '', discount: {mode: 'none', amount: 3, unit: 'eur', rounding: 'none'}, followup: {enabled: false, delay_hours: 24, message: '', discount: {mode: 'none', amount: 3, unit: 'eur', rounding: 'none'}}})
  function discountBlock(base) {
    const d = getPath(draft(), base) || {}
    return `<div class="inline" style="margin-top:12px"><b style="font-size:13px">Options de réduction</b>${dsel(base + '.mode', [['none', 'Aucune réduction'], ['simple', 'Réduction simple']])}</div>
      ${d.mode === 'simple' ? `<div class="box"><b style="font-size:13px">Montant de la réduction</b><div class="inline" style="margin-top:6px">${dnum(base + '.amount', 'step="0.5" min="0.5"')}${dsel(base + '.unit', [['eur', '€'], ['pct', '%']])}${dsel(base + '.rounding', [['none', 'Pas d’arrondi'], ['half', 'Arrondi à 0,50 €'], ['euro', 'Arrondi à l’euro']])}</div>
      <p class="note">Offre calculée sur le prix du moment, jamais sous 1 €.</p></div>` : ''}`
  }
  const historyField=(path,label)=>`<label class="f">${label} — historique à traiter (heures)</label><div class="inline">${dnum(path+'.history_hours','min="0" max="720"')} h</div><p class="note">0 = seulement les nouveaux. 12 = les 12 dernières heures, puis les nouveaux. Appliqué à l’activation ou au changement de cette durée ; aucune action déjà effectuée n’est rejouée.</p>`
  function draftForm(title, sub, body) {
    if (!S.data) return '<p class="note">Chargement…</p>'
    return `<h1>${esc(title)}</h1><p class="sub">${esc(sub)}</p><div class="form">${dsw('enabled', 'YlaVint actif sur ce compte', 'Sans cela, aucune automatisation ne tourne sur ce compte.')}${body}
      <div class="actions"><button class="btn" data-savedraft ${S.busy ? 'disabled' : ''}>Enregistrer les paramètres</button></div></div>`
  }
  function pageLikes() {
    if (!S.data) return '<p class="note">Chargement…</p>'
    const L = draft().likes, steps = L.messages?.length ? L.messages : (L.messages = [newStep()])
    const delays = [[0, 'Aucun délai'], [5, '5 minutes'], [15, '15 minutes'], [30, '30 minutes'], [60, '1 heure'], [120, '2 heures'], [360, '6 heures'], [720, '12 heures'], [1440, '24 heures']]
    return draftForm('Automatisation des J’aime d’articles', 'Réponses automatiques quand des membres aiment tes articles.', `
      ${dsw('features.likes', 'Messages aux likes', 'Envoyer un message aux membres qui likent un article')}${historyField('likes','Likes')}
      <div class="info"><b>Comment ça marche ?</b><ul><li>Les messages sont envoyés dans l’ordre, à chaque like d’un même membre.</li><li>Bob aime l’article A → message 1. Bob aime l’article B → message 2.</li>
        <li>S’il n’y a que 2 messages, la rotation s’arrête au message 2.</li><li>Aucun message au même membre pendant les jours choisis plus bas.</li></ul></div>
      ${steps.map((st, i) => `<div class="box"><div class="inline"><h4 style="flex:1">Ce message / cette offre sera envoyé(e) au ${['premier', 'deuxième', 'troisième'][i]} article aimé</h4>${steps.length > 1 ? `<button class="ghost" data-delmsg="${i}">Supprimer</button>` : ''}</div>
        ${dtext(`likes.messages.${i}.message`, 'Message (optionnel)', 'vide = offre seule · @username, {article}, {prix}')}
        ${discountBlock(`likes.messages.${i}.discount`)}
        ${dsw(`likes.messages.${i}.followup.enabled`, '↩ Envoyer un message de relance si le membre n’a pas répondu', 'Un seul rappel, si le membre n’a pas répondu et que l’article est toujours en vente.')}
        ${st.followup?.enabled ? `<div class="ind">${dsel(`likes.messages.${i}.followup.delay_hours`, [[6, '6 heures'], [12, '12 heures'], [24, '1 jour'], [48, '2 jours'], [72, '3 jours'], [120, '5 jours'], [168, '7 jours']], 'Délai avant la relance')}
          ${dtext(`likes.messages.${i}.followup.message`, 'Message de relance', '@username')}${discountBlock(`likes.messages.${i}.followup.discount`)}</div>` : ''}</div>`).join('')}
      ${steps.length < 3 ? `<div class="center"><button class="ghost" data-addmsg>＋ Ajouter un message (${steps.length}/3)</button></div>` : ''}
      <div class="box"><h4>👥 Paramètres membres</h4>
        <div class="row"><div class="inline"><b>Limiter les messages par article à</b>${dnum('likes.per_item.max', 'min="1"')}<span class="note">messages</span></div><label class="sw"><input type="checkbox" data-pb="likes.per_item.enabled" ${L.per_item?.enabled ? 'checked' : ''}><i></i></label></div>
        <label class="f">Jours avant d’envoyer à nouveau des messages automatiques au même membre</label>${dnum('likes.cooldown_days', 'min="0" max="365"')}
        <div class="row"><div class="inline"><b>Ignorer les membres avec une évaluation inférieure à</b>${dsel('likes.min_rating.value', [[1, '1 ★'], [2, '2 ★'], [3, '3 ★'], [4, '4 ★'], [5, '5 ★']])}</div><label class="sw"><input type="checkbox" data-pb="likes.min_rating.enabled" ${L.min_rating?.enabled ? 'checked' : ''}><i></i></label></div>
        ${dsw('likes.skip_unrated', 'Ignorer les membres sans évaluation')}
        <label class="f">Membres ignorés</label><textarea class="in" data-plist="likes.ignored" placeholder="pseudo1, pseudo2">${esc((L.ignored || []).join(', '))}</textarea><span class="count">Pseudos Vinted séparés par des virgules.</span></div>
      <div class="box"><h4>⏱ Paramètres de délai</h4>${dsel('likes.wait_minutes', delays.some(([v]) => v === L.wait_minutes) ? delays : [...delays, [L.wait_minutes, `${L.wait_minutes} minutes`]], 'Délai avant d’envoyer un message après un J’aime')}
        <label class="f">Délai entre chaque envoi (pour faire humain)</label><div class="inline">entre ${dnum('messaging.action_gap_min', 'min="5" max="3600"')} et ${dnum('messaging.action_gap_max', 'min="5" max="3600"')} secondes</div>
        <p class="note">Chaque message (likes, réponses, commandes) part après un temps tiré au hasard dans cette plage. Pas de limite par jour.</p></div>`)
  }
  function pageAgent() {
    if (!S.data) return '<p class="note">Chargement…</p>'
    const s = draft(), m = s.messaging || (s.messaging = structuredClone(S.data.defaults.messaging))
    const o = m.offers || (m.offers = {enabled:false,single_discount:20,bundle_discount:20,max_per_buyer:5,period_days:1})
    return draftForm('Smart Agent', 'Réponses aux messages et acceptation des offres pour ce compte.', `
      ${dsw('features.inbox', 'Messagerie centralisée', 'Les conversations de ce compte arrivent sur ton site et ton téléphone')}
      ${dsw('features.ai', 'Agent IA', `Agent ${S.data.ai?.enabled ? (S.data.ai.mode === 'auto' ? 'qui répond seul' : 'qui propose les réponses') : 'coupé sur le site'}`)}
      <label class="f">Relire la messagerie toutes les (secondes)</label>${dnum('messaging.sync_seconds','min="20" max="7200"')}
      ${dsw('messaging.reply_unlimited','Réponses par jour illimitées','L’intervalle entre les envois reste respecté.')}
      ${!m.reply_unlimited?`<label class="f">Réponses par jour</label>${dnum('messaging.reply_per_day','min="0" max="300"')}`:''}
      ${historyField('messaging','Messages')}
      <div class="box"><h4>Acceptation automatique des offres</h4>
        ${dsw('messaging.offers.enabled', 'Accepter les offres qui me conviennent', 'Accepte les offres formelles sur Vinted selon tes seuils, sans envoyer de message.')}${historyField('messaging.offers','Offres')}
        <label class="f">Remise maximale — article seul</label><div class="inline">${dnum('messaging.offers.single_discount','min="0" max="80" step="0.5"')} %</div>
        <label class="f">Remise maximale — lot</label><div class="inline">${dnum('messaging.offers.bundle_discount','min="0" max="80" step="0.5"')} %</div>
        <p class="note">Exemple sur un article à 50 € : acceptation à partir de ${(Math.ceil(5000*(1-o.single_discount/100))/100).toFixed(2).replace('.',',')} €. Le seuil n’est jamais arrondi vers le bas.</p>
        <label class="f">Limite par acheteur</label><div class="inline">${dnum('messaging.offers.max_per_buyer','min="1" max="100"')} offres sur ${dnum('messaging.offers.period_days','min="1" max="30"')} jour(s)</div>
        <p class="note">Le prix et le statut sont revérifiés avant chaque acceptation. Les offres sous le seuil et les négociations écrites restent à traiter par toi.</p>
      </div>
      <p class="note" style="margin-top:12px"><a href="${SITE_URL}/ylavint#agent" target="_blank" rel="noopener">Consignes et copie des réglages vers les autres comptes ↗</a></p>`)
  }
  function pageFlow() {
    if (!S.data) return '<p class="note">Chargement…</p>'
    const F = draft().order_flow, t = S.flowTab
    const tabs = `<div class="tabs full">${[['shipping', 'Expédition'], ['delay', 'Délai'], ['pickup', 'Retrait'], ['final', 'Finalisation']].map(([k, l]) => `<button data-ftab="${k}" class="${t === k ? 'on' : ''}">${l}</button>`).join('')}</div>`
    let body = ''
    if (t === 'shipping') body = `${dsw('order_flow.confirm.enabled', 'Confirmation de commande', 'Message envoyé à l’acheteur dès que la vente est payée.')}
      ${F.confirm.enabled ? `<div class="ind">${dtext('order_flow.confirm.message', 'Message', '@username, {article}', 1000)}</div>` : ''}
      ${dsw('features.labels', 'Récupérer automatiquement les bordereaux', 'Le bordereau créé par Vinted est enregistré et ajouté à la vente (onglet Ventes).')}
      ${draft().features.labels ? `<div class="ind"><label class="f">Transporteurs à ignorer</label><div class="inline"><input class="in" data-carrier placeholder="Entre le nom du transporteur…" style="width:240px"><button class="ghost" data-addcarrier>＋</button></div>
        <div>${F.labels.ignore_carriers.map(c => `<span class="chipx">${esc(c)}<button data-delcarrier="${esc(c)}" aria-label="Retirer">×</button></span>`).join('')}</div>
        <p class="note">Nom tel qu’il apparaît sur la vente. Ces ventes sont ignorées pour les bordereaux.</p></div>` : ''}
      ${dsw('features.orders', 'Lecture des ventes', 'Lire les nouvelles commandes toutes les 30 minutes')}
      ${dsw('features.sales', 'Ventes → onglet Ventes', 'Envoyer les commandes dans l’onglet Ventes de ton site (à la place de Dotb)')}`
    if (t === 'delay') body = `${dsw('order_flow.extension.enabled', 'Extension de délai', 'Demander automatiquement à l’acheteur un délai supplémentaire pour l’envoi.')}
      ${F.extension.enabled ? `<div class="ind">${dsel('order_flow.extension.after_days', dayOpts(1, 5), 'Délai de demande')}<p class="note">Jours après la vente avant d’envoyer la demande.</p>
        ${dtext('order_flow.extension.message', 'Message de demande', '', 200)}
        ${dtext('order_flow.extension.relance1', 'Relance à +1 jour — si le délai n’est pas encore accordé (optionnel)')}
        ${dtext('order_flow.extension.relance2', 'Relance à +2 jours — si le délai n’est pas encore accordé (optionnel)')}</div>` : ''}
      ${dsw('order_flow.cancel.enabled', 'Annulation automatique', 'Annuler la vente juste avant la date limite d’envoi si elle n’est toujours pas expédiée. Motif : celui de ta dernière annulation faite à la main sur Vinted (choisis un motif qui correspond à la réalité).')}
      ${F.cancel.enabled ? `<div class="ind">${dsel('order_flow.cancel.minutes_before', [[30, '30 minutes'], [60, '1 heure'], [120, '2 heures'], [360, '6 heures'], [720, '12 heures']], 'Combien de temps avant la date limite')}
        <p class="note">L’annulation ne part que pendant la plage horaire du compte.</p></div>` : ''}
      <p class="note" style="margin-top:14px">« J’ai expédié » n’est jamais cliqué automatiquement : YlaVint ne déclare pas un envoi qui n’a pas eu lieu.</p>`
    if (t === 'pickup') body = `${dsw('order_flow.pickup.enabled', 'Prêt à retirer', 'Jusqu’à deux messages une fois le colis disponible au point de retrait.')}
      ${F.pickup.enabled ? `<div class="ind">${dsel('order_flow.pickup.first_days', dayOpts(0, 7), 'Message 1 — envoyer après')}${dtext('order_flow.pickup.first', 'Message 1', '@username', 1000)}
        ${dsel('order_flow.pickup.second_days', dayOpts(1, 14), 'Message 2 — envoyer après')}${dtext('order_flow.pickup.second', 'Message 2 (optionnel)', '', 1000)}</div>` : ''}`
    if (t === 'final') body = `${dsw('order_flow.review.enabled', 'Évaluation automatique', 'Laisser une évaluation 5 étoiles à l’acheteur quand la commande est terminée.')}
      ${F.review.enabled ? `<div class="ind">${dsel('order_flow.review.after_days', dayOpts(0, 14), 'Envoyer l’avis après')}${dtext('order_flow.review.text', 'Texte de l’évaluation')}
        ${dtext('order_flow.review.end_message', 'Message de fin (optionnel) — envoyé dans le chat de la commande', '', 1000)}</div>` : ''}
      ${dsw('order_flow.delete_sold', 'Supprimer l’article vendu', 'Supprimer l’article de ton dressing une fois la commande terminée.')}`
    return draftForm('Flux de commande', 'Expédition, délai, retrait et finalisation de ce compte.', tabs + body)
  }
  function pageUnmask() {
    const s = settings()
    return settingsForm('Démasquage & prix', 'Réparation des annonces « masquées du catalogue » et baisses de prix programmées.', `
      ${sw('features.dressing', s.features.dressing, 'Lecture du dressing', 'Relire le dressing toutes les 2 heures')}
      ${sw('features.unmask', s.features.unmask, 'Démasquage automatique', 'Mêmes photos remises, un point dans la description, −1 €')}
      ${sw('features.pricing', s.features.pricing, 'Prix & cycle de vie', 'Baisser le prix au fil du temps')}
      <div class="grid2">${num('unmask', 'price_drop', 'Baisse par réparation (€)', s.unmask.price_drop)}${num('unmask', 'floor', 'Jamais sous (€)', s.unmask.floor)}
      ${num('pricing', 'after_days', 'Première baisse après (jours)', s.pricing.after_days)}${num('pricing', 'step', 'Baisse (€)', s.pricing.step)}
      ${num('pricing', 'every_days', 'Puis tous les (jours)', s.pricing.every_days)}${num('pricing', 'floor', 'Prix plancher (€)', s.pricing.floor)}</div>`)
  }
  const BADGE = {visible: ['actif', 'p-green'], hidden: ['masqué', ''], repairing: ['en réparation', 'p-amber'], sold: ['vendu', 'p-blue'], draft: ['brouillon', ''], closed: ['fermé', '']}
  function pageDressing() {
    if (!S.wardrobe) return '<p class="note">Chargement du dressing…</p>'
    const rows = S.wardrobe.listings.filter(l => (!S.status || l.state === S.status) && (!S.q || `${l.title} ${l.item_id}`.toLowerCase().includes(S.q.toLowerCase())))
    return `<div class="bar"><input class="in" style="width:260px" placeholder="Rechercher titre ou ID…" data-q value="${esc(S.q)}">
      <select class="in" style="width:170px" data-status><option value="">⊕ Statut</option>${Object.entries(BADGE).map(([k, [l]]) => `<option value="${k}" ${S.status === k ? 'selected' : ''}>${l} (${S.wardrobe.counts[k] || 0})</option>`).join('')}</select>
      <span class="sp"></span><button class="ghost" data-reload="scan_wardrobe">↻ Recharger le dressing</button></div>
      <table><thead><tr><th></th><th>Titre</th><th>Statut</th><th>Prix</th><th>Créé le</th><th></th></tr></thead><tbody>
      ${rows.length ? rows.map(l => { const [lab, cls] = BADGE[l.state] || [l.state, '']; return `<tr><td style="width:50px">${l.photo_url ? `<img class="th" src="${esc(l.photo_url)}" alt="">` : ''}</td>
        <td><a href="/items/${esc(l.item_id)}" target="_blank" rel="noopener">${esc(l.title || l.item_id)}</a></td><td><span class="pill ${cls}">${esc(lab)}</span></td>
        <td><b>${esc(euro(l.price))}</b></td><td>${esc(day(l.listed_at))}</td>
        <td style="white-space:nowrap;text-align:right">${l.state === 'hidden' ? `<button class="ghost" data-unmask="${esc(l.item_id)}" ${l.busy ? 'disabled' : ''}>Démasquer</button> ` : ''}${['visible', 'hidden', 'repairing'].includes(l.state) ? `<button class="ghost" data-price="${esc(l.item_id)}" data-cur="${esc(l.price)}" ${l.busy ? 'disabled' : ''}>Prix</button>` : ''}</td></tr>` }).join('') : `<tr><td colspan="6" class="note">${S.wardrobe.listings.length ? 'Aucun article dans ce filtre.' : 'Dressing pas encore lu : clique sur Recharger le dressing.'}</td></tr>`}
      </tbody></table><p class="note">${rows.length} article(s) · dernière lecture ${esc(day(S.wardrobe.last_scan))}</p>`
  }
  const ORDER = {payment_received: ['Paiement reçu', 'p-blue'], label_sent: ['Étiquette envoyée', 'p-blue'], shipped: ['Expédié', 'p-green'], ready_for_pickup: ['En point relais', 'p-green'], delivered: ['Livré', 'p-green'], completed: ['Terminé', 'p-green'], cancelled: ['Annulé', 'p-red'], returning: ['Retour', 'p-red'], suspended: ['Suspendu', 'p-amber']}
  function pageOrders() {
    if (!S.sales) return '<p class="note">Chargement des commandes…</p>'
    return `<div class="bar"><b>Commandes</b><span class="sp"></span><button class="ghost" data-reload="sync_orders">↻ Relire les ventes</button><a class="ghost" style="text-decoration:none" href="${SITE_URL}/ylavint#commandes" target="_blank" rel="noopener">Toutes les commandes ↗</a></div>
      <table><thead><tr><th>Date de commande</th><th>Titre</th><th>Statut transaction</th><th>Statut</th><th>Prix</th><th>Bordereau</th></tr></thead><tbody>
      ${S.sales.orders.length ? S.sales.orders.map(o => { const [lab, cls] = ORDER[o.normalized] || [o.normalized, '']; return `<tr><td>${esc(day(o.order_date))}</td><td><a href="/transactions/${esc(o.transaction_id)}" target="_blank" rel="noopener">${esc(o.title || o.transaction_id)}</a></td>
        <td>${esc(o.status || '—')}</td><td><span class="pill ${cls}">${esc(lab)}</span></td><td><b>${esc(euro(o.price))}</b></td><td>${o.label_path ? '🖨 récupéré' : '—'}</td></tr>` }).join('') : `<tr><td colspan="6" class="note">Aucune vente lue pour l’instant (active « Lecture des ventes »).</td></tr>`}
      </tbody></table>`
  }

  function render() {
    box.className = `t ${S.theme === 'dark' ? 'dark' : ''}`
    const unread = S.agent?.unread || 0
    const fabCls = !S.bridge ? 'off' : ['paused', 'error'].includes(S.agent?.state) ? 'warn' : ''
    let html = `<button class="fab ${fabCls}" data-fab aria-label="YlaVint"><b>Y</b>${unread ? `<i>${unread > 99 ? '99+' : unread}</i>` : ''}</button>`
    if (S.menu && !S.open) html += `<div class="menu" role="menu">
      <div class="st">${esc(acc()?.login || who()?.login || 'Compte Vinted')} · ${S.bridge ? 'Bridge allumé' : '<span class="bad">Bridge coupé</span>'}</div>
      <button data-go="dressing">👕 Dressing</button><button data-site="messagerie">✉ Boîte de réception${unread ? ` (${unread})` : ''}</button>
      <button data-go="auto">⚙ Automatisations</button><button data-go="orders">📋 Commandes</button><hr>
      <button data-site="accueil">👤 Tableau de bord</button><button data-theme>${S.theme === 'dark' ? '☀ Thème clair' : '☾ Thème sombre'}</button>
      <button data-bridge>${S.bridge ? '⊗ Couper le Bridge' : '▶ Allumer le Bridge'}</button></div>`
    if (S.open) {
      const nav = (k, ic) => `<button data-go="${k}" class="${S.page === k ? 'on' : ''}">${ic} ${esc(PAGES[k])}</button>`
      const pages = {auto: pageAuto, likes: pageLikes, agent: pageAgent, flow: pageFlow, unmask: pageUnmask, dressing: pageDressing, orders: pageOrders}
      html += `<div class="panel"><aside><div class="brand"><span class="logo">Y</span>YlaVint</div>
        ${nav('auto', '⚙')}<small>Paramètres</small>${nav('likes', '✉')}${nav('agent', '🤖')}${nav('flow', '📦')}${nav('unmask', '◉')}
        <small>Compte</small>${nav('dressing', '👕')}${nav('orders', '📋')}<button data-site="messagerie">✉ Boîte de réception ↗</button><button data-site="accueil">▦ Tableau de bord ↗</button></aside>
        <div class="main"><div class="top"><button class="ghost" data-close>✕ Fermer</button><b>${esc(PAGES[S.page])}</b><span class="sp"></span>
          <span class="note">${esc(acc()?.login || '')}</span><button class="ghost" data-theme>${S.theme === 'dark' ? '☀' : '☾'}</button></div>
          <div class="body">${S.error ? `<div class="err">${esc(S.error)}</div>` : ''}${S.notice ? `<div class="ok">${esc(S.notice)}</div>` : ''}${pages[S.page]()}</div></div></div>`
    }
    // Garder la position de lecture : un clic ne renvoie plus en haut de la page.
    const scroller = box.querySelector('.body'), top = scroller?.scrollTop || 0
    box.innerHTML = html
    const after = box.querySelector('.body'); if (after && top) after.scrollTop = top
  }

  async function openPage(page) {
    S.open = true; S.menu = false; S.page = page; S.notice = ''; S.draft = null; render()
    if (!S.data) await refresh()
    if (page === 'dressing') { S.wardrobe = null; render(); try { S.wardrobe = await ask('wardrobe') } catch (e) { S.error = e.message } render() }
    if (page === 'orders') { S.sales = null; render(); try { S.sales = await ask('sales') } catch (e) { S.error = e.message } render() }
  }
  function collect() {
    const s = structuredClone(settings())
    for (const el of box.querySelectorAll('[data-f]')) { const [g, k] = el.dataset.f.split('.'); if (k) s[g][k] = el.checked; else s[g] = el.checked }
    for (const el of box.querySelectorAll('[data-n]')) { const [g, k] = el.dataset.n.split('.'); s[g] = s[g] || {}; s[g][k] = Number(el.value) }
    for (const el of box.querySelectorAll('[data-t]')) { const [g, k] = el.dataset.t.split('.'); s[g][k] = el.value }
    return s
  }
  box.addEventListener('click', async e => {
    const b = e.target.closest('button,a'); if (!b) return
    const d = b.dataset
    if ('fab' in d) { if (S.open) { S.open = false } else S.menu = !S.menu; render(); if (S.menu && !S.data) refresh(); return }
    if (d.go) return openPage(d.go)
    if (d.site) { chrome.runtime.sendMessage({type: 'ylv_open', section: d.site}); S.menu = false; render(); return }
    if ('close' in d) { S.open = false; render(); return }
    if ('theme' in d) { S.theme = S.theme === 'dark' ? 'light' : 'dark'; store.set({ylv_theme: S.theme}); render(); return }
    if ('bridge' in d) { if (S.bridge && !confirm('Couper YlaVint dans ce profil ? Plus aucune automatisation ne tournera ici.')) return; chrome.runtime.sendMessage({type: 'ylv_bridge', on: !S.bridge}); return }
    if (d.tab) { S.tab = d.tab; render(); return }
    if (d.ftab) { S.flowTab = d.ftab; render(); return }
    if ('addmsg' in d) { draft().likes.messages.push(newStep()); render(); return }
    if (d.delmsg) { draft().likes.messages.splice(Number(d.delmsg), 1); render(); return }
    if ('addcarrier' in d) { const v = box.querySelector('[data-carrier]')?.value.trim().toLowerCase(); const l = draft().order_flow.labels.ignore_carriers; if (v && !l.includes(v)) l.push(v); render(); return }
    if (d.delcarrier) { const l = draft().order_flow.labels; l.ignore_carriers = l.ignore_carriers.filter(c => c !== d.delcarrier); render(); return }
    if ('savedraft' in d) { if([...box.querySelectorAll('input[type="number"]')].some(el=>!el.reportValidity()))return; const s = draft()
      const r = await act('save_settings', {enabled: s.enabled, version: acc()?.settings?.version, settings: {features: s.features, limits: s.limits, unmask: s.unmask, pricing: s.pricing, likes: s.likes, messaging: s.messaging || S.data.defaults.messaging, order_flow: s.order_flow}}, 'Paramètres enregistrés.')
      if (r) { S.draft = null; render() } return }
    if (d.toggle) { const fs = d.toggle.split(','), running = (fs.some(on) || fs.includes('ai') && settings().enabled && settings().messaging?.offers?.enabled) && !acc()?.settings?.paused
      if (acc()?.settings?.paused && !running) return act('resume', {}, 'YlaVint relancé sur ce compte.')
      let historyHours=null
      if(!running&&(fs.includes('likes')||fs.includes('ai'))){const choice=prompt('Historique à traiter en heures (0 : uniquement les nouveaux ; 12 : les 12 dernières heures)', '0');if(choice===null)return;historyHours=Number(choice);if(!Number.isInteger(historyHours)||historyHours<0||historyHours>720){alert('Choisis un nombre d’heures entre 0 et 720.');return}}
      return saveSettings(s => { if(historyHours!==null){if(fs.includes('likes'))s.likes.history_hours=historyHours;if(fs.includes('ai')){s.messaging.history_hours=historyHours;if(s.messaging.offers?.enabled)s.messaging.offers.history_hours=historyHours}} if (!running) s.enabled = true; for (const f of fs) s.features[f] = !running; if (running && fs.includes('ai') && s.messaging?.offers) s.messaging.offers.enabled=false }, running ? 'Automatisation mise en pause.' : 'Automatisation activée.') }
    if ('save' in d) { const s = collect(); return act('save_settings', {enabled: s.enabled, version: acc()?.settings?.version, settings: {features: s.features, limits: s.limits, unmask: s.unmask, pricing: s.pricing, likes: s.likes, messaging: s.messaging || S.data.defaults.messaging, order_flow: s.order_flow || S.data.defaults.order_flow}}, 'Paramètres enregistrés.') }
    if (d.reload) { await act('enqueue', {kind: d.reload}, 'Lecture demandée : elle arrive dans quelques minutes.'); return }
    if (d.unmask) { await act('item_unmask', {item_id: d.unmask}, r => r.message || 'Démasquage demandé.'); return openPage('dressing') }
    if (d.price) { const v = prompt(`Nouveau prix (actuel ${euro(d.cur)}) :`, String(Math.max(1, Number(d.cur) - 1))); if (!v) return
      await act('item_reprice', {item_id: d.price, new_price: Number(v.replace(',', '.'))}, r => r.message || 'Changement de prix demandé.'); return openPage('dressing') }
  })
  box.addEventListener('input', e => {
    const el = e.target
    if (el.dataset.p) { setPath(draft(), el.dataset.p, el.value); const c = el.nextElementSibling; if (c?.classList.contains('count')) c.textContent = c.textContent.replace(/\d+\/(\d+)$/, `${el.value.length}/$1`) }
    if (el.dataset.pn) setPath(draft(), el.dataset.pn, el.value === '' ? '' : Number(el.value))
    if (el.dataset.plist) setPath(draft(), el.dataset.plist, el.value.split(',').map(x => x.trim()).filter(Boolean))
    if (e.target.matches('[data-q]')) { S.q = e.target.value; const pos = e.target.selectionStart; render(); const el = box.querySelector('[data-q]'); el.focus(); el.setSelectionRange(pos, pos) }
  })
  box.addEventListener('change', e => {
    const el = e.target
    if (el.matches('[data-status]')) { S.status = el.value; render() }
    if (el.dataset.pb) { setPath(draft(), el.dataset.pb, el.checked); render() }
    if (el.dataset.ps) { setPath(draft(), el.dataset.ps, /^-?\d+(\.\d+)?$/.test(el.value) ? Number(el.value) : el.value); render() }
  })
  document.addEventListener('keydown', e => { if (e.key === 'Escape' && (S.open || S.menu)) { S.open = false; S.menu = false; render() } })
  // Clic hors du menu : fermeture.
  document.addEventListener('click', e => { if (S.menu && !e.composedPath().includes(host)) { S.menu = false; render() } })

  async function sync() {
    const {agent, bridge, ylv_theme} = await store.get(['agent', 'bridge', 'ylv_theme'])
    S.agent = agent || null; S.bridge = bridge !== false; S.theme = ylv_theme || 'light'
    render()
  }
  chrome.storage.onChanged.addListener(c => { if (c.agent || c.bridge || c.ylv_theme) sync() })
  const mount = () => { if (!document.body) return setTimeout(mount, 200); document.documentElement.appendChild(host); sync() }
  mount()
})()
