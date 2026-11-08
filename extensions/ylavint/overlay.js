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
    return act('save_settings', {enabled: s.enabled, version: acc()?.settings?.version, settings: {features: s.features, limits: s.limits, unmask: s.unmask, pricing: s.pricing, likes: s.likes, messaging: s.messaging || S.data.defaults.messaging}}, msg)
  }
  const on = f => !!acc()?.settings?.enabled && !!acc()?.settings?.features?.[f]
  const today = kind => (S.data?.tasks || []).filter(t => t.kind === kind && t.state === 'done' && Date.now() - Date.parse(t.finished_at || 0) < 864e5).length

  function stateOf(features) {
    const s = acc()?.settings
    if (!S.bridge) return 'Bridge coupé'
    if (!s?.enabled) return 'Compte non activé'
    if (s.paused) return 'En pause'
    return features.some(f => s.features[f]) ? 'En attente…' : 'Arrêté'
  }
  function card(title, desc, features, chips, extraTag = 'live') {
    const running = features.some(f => on(f)) && !acc()?.settings?.paused
    return `<div class="card"><h3>${esc(title)}<span class="tag ${running ? 'live' : ''}">${running ? esc(extraTag) : 'arrêt'}</span></h3><p>${esc(desc)}</p>
      <div class="state">${esc(stateOf(features))}</div><div class="chips">${chips.map(c => `<span class="chip">${esc(c)}</span>`).join('')}</div>
      <button class="btn ${running ? '' : 'gray'}" data-toggle="${features.join(',')}" ${S.busy || !S.data ? 'disabled' : ''}>${running ? '❚❚ Pause' : '▶ Activer'}</button></div>`
  }

  function pageAuto() {
    const d = S.data, s = settings()
    if (!d) return `<p class="note">${S.error ? '' : 'Chargement…'}</p>`
    const log = (d.log || []).filter(l => S.tab === 'likes' ? /like/i.test(l.event + l.message) : S.tab === 'agent' ? /ai|reply|réponse|message/i.test(l.event + l.message) : /order|vente|label|bordereau/i.test(l.event + l.message))
    const tasks = (d.tasks || []).filter(t => S.tab === 'likes' ? ['scan_likes', 'like_message'].includes(t.kind) : S.tab === 'agent' ? ['sync_inbox', 'reply_message'].includes(t.kind) : ['sync_orders', 'fetch_label'].includes(t.kind))
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
  function pageLikes() {
    const s = settings()
    return settingsForm('Messages aux likes', 'Message envoyé après un like sur une de tes annonces.', `
      ${sw('features.likes', s.features.likes, 'Messages aux likes', 'Envoyer un message aux membres qui likent un article')}
      <label class="f">Message ({article} et {prix} sont remplacés)</label><textarea class="in" data-t="likes.message" maxlength="500">${esc(s.likes.message)}</textarea>
      <div class="grid2">${num('likes', 'wait_minutes', 'Attente après le like (min)', s.likes.wait_minutes)}${num('limits', 'like_message_per_day', 'Messages par jour', s.limits.like_message_per_day)}</div>`)
  }
  function pageAgent() {
    const s = settings(), m = s.messaging || S.data.defaults.messaging
    return settingsForm('Smart Agent', 'Messagerie centralisée et agent IA pour ce compte. Les consignes de l’agent se règlent sur le site (Smart Agent).', `
      ${sw('features.inbox', s.features.inbox, 'Messagerie centralisée', 'Les conversations de ce compte arrivent sur ton site et ton téléphone')}
      ${sw('features.ai', s.features.ai, 'Agent IA', `Agent ${S.data.ai?.enabled ? (S.data.ai.mode === 'auto' ? 'qui répond seul' : 'qui propose les réponses') : 'coupé sur le site'}`)}
      <div class="grid2">${num('messaging', 'sync_minutes', 'Relire la messagerie toutes les (min)', m.sync_minutes)}${num('messaging', 'reply_per_day', 'Réponses par jour', m.reply_per_day)}</div>
      <p class="note" style="margin-top:12px"><a href="${SITE_URL}/ylavint#agent" target="_blank" rel="noopener">Ouvrir les consignes du Smart Agent ↗</a></p>`)
  }
  function pageFlow() {
    const s = settings()
    return settingsForm('Flux de commandes', 'Ventes et bordereaux de ce compte.', `
      ${sw('features.orders', s.features.orders, 'Lecture des ventes', 'Lire les nouvelles commandes toutes les 30 minutes')}
      ${sw('features.sales', s.features.sales, 'Ventes → onglet Ventes', 'Envoyer les commandes dans l’onglet Ventes de ton site (à la place de Dotb)')}
      ${sw('features.labels', s.features.labels, 'Bordereau automatique', 'Récupérer le bordereau dès qu’il est disponible, pour l’imprimer depuis le site')}`)
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
    box.innerHTML = html
  }

  async function openPage(page) {
    S.open = true; S.menu = false; S.page = page; S.notice = ''; render()
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
    if (d.toggle) { const fs = d.toggle.split(','), running = fs.some(on) && !acc()?.settings?.paused
      if (acc()?.settings?.paused && !running) return act('resume', {}, 'YlaVint relancé sur ce compte.')
      return saveSettings(s => { if (!running) s.enabled = true; for (const f of fs) s.features[f] = !running }, running ? 'Automatisation mise en pause.' : 'Automatisation activée.') }
    if ('save' in d) { const s = collect(); return act('save_settings', {enabled: s.enabled, version: acc()?.settings?.version, settings: {features: s.features, limits: s.limits, unmask: s.unmask, pricing: s.pricing, likes: s.likes, messaging: s.messaging || S.data.defaults.messaging}}, 'Paramètres enregistrés.') }
    if (d.reload) { await act('enqueue', {kind: d.reload}, 'Lecture demandée : elle arrive dans quelques minutes.'); return }
    if (d.unmask) { await act('item_unmask', {item_id: d.unmask}, r => r.message || 'Démasquage demandé.'); return openPage('dressing') }
    if (d.price) { const v = prompt(`Nouveau prix (actuel ${euro(d.cur)}) :`, String(Math.max(1, Number(d.cur) - 1))); if (!v) return
      await act('item_reprice', {item_id: d.price, new_price: Number(v.replace(',', '.'))}, r => r.message || 'Changement de prix demandé.'); return openPage('dressing') }
  })
  box.addEventListener('input', e => {
    if (e.target.matches('[data-q]')) { S.q = e.target.value; const pos = e.target.selectionStart; render(); const el = box.querySelector('[data-q]'); el.focus(); el.setSelectionRange(pos, pos) }
  })
  box.addEventListener('change', e => { if (e.target.matches('[data-status]')) { S.status = e.target.value; render() } })
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
