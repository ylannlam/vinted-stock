import {SITE} from './config.js'

const KINDS = {wardrobe: 'Dressing', orders_list: 'Liste des ventes', order_detail: 'Détail d’une vente', order_label: 'Bordereau', likes_list: 'Likes',
  inbox_list: 'Messagerie', conversation_read: 'Lecture d’une conversation', item_form: 'Ouverture d’une annonce', item_edit: 'Enregistrement d’une annonce',
  photo_upload: 'Envoi d’une photo', item_create: 'Création d’une annonce', conversation_create: 'Ouverture d’une conversation', message_send: 'Envoi d’un message',
  user_read: 'Profil d’un membre', offer_send: 'Envoi d’une offre', shipping_extension: 'Demande de délai', order_cancel: 'Annulation d’une vente', feedback_send: 'Évaluation', item_delete: 'Suppression d’annonce'}
const STATES = {task: 'au travail', idle: 'en attente', busy: 'occupé', paused: 'en pause', disabled: 'non activé sur le site', unknown: 'compte inconnu du site',
  no_tab: 'ouvre un onglet Vinted', logged_out: 'compte déconnecté', error: 'site injoignable', off: 'Bridge coupé'}
const FEATURES = {inbox: 'Messagerie', ai: 'Agent IA', orders: 'Ventes', sales: 'Onglet Ventes', labels: 'Bordereaux', dressing: 'Dressing', unmask: 'Démasquage', pricing: 'Prix', publish: 'Publication', likes: 'Likes'}
const labels = {ok: 'aucune restriction', restricted: 'compte restreint', blocked: 'compte bloqué', permanent: 'bannissement définitif'}
const $ = id => document.getElementById(id)
const when = t => t ? new Date(t).toLocaleString('fr-FR', {day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit'}) : ''
const li = (text, cls) => { const e = document.createElement('li'); e.textContent = text; if (cls) e.className = cls; return e }
const chip = (text, cls) => { const e = document.createElement('span'); e.className = `chip ${cls || ''}`; e.textContent = text; return e }
$('version').textContent = `v${chrome.runtime.getManifest().version}`

async function render() {
  const {last, agent, learning, bridge, seen = [], learned = {}, history = []} = await chrome.storage.local.get(['last', 'agent', 'learning', 'bridge', 'seen', 'learned', 'history'])
  const on = bridge !== false, [status, until] = String(last?.key || '').split('|')
  const alert = on && (['paused', 'logged_out', 'error'].includes(agent?.state) || (status && status !== 'ok'))
  $('bridge').className = !on ? 'off' : alert ? 'warn' : ''
  $('bridge').setAttribute('aria-pressed', String(on))
  $('bridgeLabel').textContent = on ? (alert ? 'À vérifier' : 'Bridge allumé') : 'Bridge coupé'
  $('account').textContent = last?.login || agent?.login || 'Aucun compte Vinted détecté'
  $('status').textContent = !on ? 'Touche le bouton pour rallumer YlaVint dans ce profil.' : `${STATES[agent?.state] || 'démarrage…'}${agent?.task ? ` · ${agent.task}` : ''}${agent?.message && agent.state !== 'off' ? ` · ${agent.message}` : ''}`
  const chips = $('chips'); chips.replaceChildren()
  if (status) chips.append(chip(status === 'ok' ? 'Compte sain' : `${labels[status] || status}${until ? ` → ${until.split('-').reverse().join('/')}` : ''}`, status === 'ok' ? 'on' : 'bad'))
  for (const f of agent?.features || []) if (FEATURES[f]) chips.append(chip(FEATURES[f], 'on'))
  if (on && agent?.state === 'disabled') chips.append(chip('Active ce compte sur le site'))
  $('unread').hidden = !(agent?.unread > 0); $('unread').textContent = agent?.unread || 0

  $('state').textContent = `Veille : ${labels[status] || '—'}${until ? ` jusqu’au ${until.split('-').reverse().join('/')}` : ''}${last?.at ? ` · ${when(last.at)}` : ''}`
  $('state').className = status === 'ok' ? 'ok' : status ? 'bad' : ''
  $('agent').textContent = `Agent : ${STATES[agent?.state] || '—'}${agent?.at ? ` · ${when(agent.at)}` : ''}`
  $('error').textContent = last?.error || ''
  $('learn').textContent = `Mode apprentissage : ${learning ? 'activé' : 'coupé'}`
  $('learn').className = learning ? 'small on' : 'small'
  $('learning').hidden = !learning
  if (learning) $('more').open = true
  const s = $('seen'); s.replaceChildren()
  if (!seen.length) s.append(li('Aucune requête vue. Fais le geste sur Vinted.', 'muted'))
  for (const item of seen) {
    const row = li(''), code = document.createElement('code')
    code.textContent = `${item.id}${item.kind ? ` → ${KINDS[item.kind] || item.kind}` : ''}`
    const select = document.createElement('select')
    select.append(new Option('Attribuer…', ''), ...Object.entries(KINDS).map(([k, v]) => new Option(v, k)))
    select.onchange = async () => { if (select.value) { await chrome.runtime.sendMessage({type: 'assign', id: item.id, kind: select.value}); render() } }
    row.append(code, document.createElement('br'), select); s.append(row)
  }
  const l = $('learned'); l.replaceChildren()
  const entries = Object.entries(learned)
  if (!entries.length) l.append(li('Rien pour l’instant.', 'muted'))
  for (const [k, v] of entries) l.append(li(`${KINDS[k] || k} · ${when(v.at)}`))
  const h = $('history'); h.replaceChildren()
  if (!history.length) h.append(li('Aucune action.', 'muted'))
  for (const e of history.slice(0, 12)) h.append(li(`${when(e.at)} · ${e.text}`, e.level === 'warn' ? 'bad' : ''))
}
$('bridge').onclick = async () => {
  const {bridge} = await chrome.storage.local.get('bridge')
  $('bridge').disabled = true
  await chrome.runtime.sendMessage({type: 'set_bridge', on: bridge === false})
  $('bridge').disabled = false; render()
}
for (const b of document.querySelectorAll('[data-open]')) b.onclick = () => chrome.tabs.create({url: `${SITE}/ylavint#${b.dataset.open}`})
$('learn').onclick = async () => { const {learning} = await chrome.storage.local.get('learning'); await chrome.runtime.sendMessage({type: 'set_learning', on: !learning}); render() }
$('now').onclick = async () => { $('now').disabled = true; await chrome.runtime.sendMessage({type: 'tick_now'}); $('now').disabled = false; render() }
chrome.storage.onChanged.addListener(render)
render()
