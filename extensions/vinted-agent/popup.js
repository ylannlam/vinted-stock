const KINDS = {wardrobe: 'Dressing', orders_list: 'Liste des ventes', order_label: 'Bordereau', likes_list: 'Likes', item_form: 'Ouverture d’une annonce',
  item_edit: 'Enregistrement d’une annonce', photo_upload: 'Envoi d’une photo', item_create: 'Création d’une annonce', conversation_create: 'Ouverture d’une conversation', message_send: 'Envoi d’un message'}
const STATES = {task: 'au travail', idle: 'en attente de tâche', busy: 'occupé', paused: 'en pause', disabled: 'non activé sur le site', unknown: 'compte inconnu du site',
  no_tab: 'aucun onglet Vinted', logged_out: 'compte déconnecté', error: 'site injoignable'}
const labels = {ok: 'aucune restriction', restricted: 'compte restreint', blocked: 'compte bloqué', permanent: 'bannissement définitif'}
const $ = id => document.getElementById(id)
const when = t => t ? new Date(t).toLocaleString('fr-FR', {day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit'}) : ''
const li = (text, cls) => { const e = document.createElement('li'); e.textContent = text; if (cls) e.className = cls; return e }

async function render() {
  const {last, agent, learning, seen = [], learned = {}, history = []} = await chrome.storage.local.get(['last', 'agent', 'learning', 'seen', 'learned', 'history'])
  $('account').textContent = `Compte : ${last?.login || agent?.login || 'ouvre une page Vinted connectée'}`
  if (last?.at) {
    const [status, until] = String(last.key || '').split('|')
    $('state').textContent = `Veille : ${labels[status] || '—'}${until ? ` jusqu’au ${until.split('-').reverse().join('/')}` : ''} · ${when(last.at)}`
    $('state').className = status === 'ok' ? 'ok' : 'bad'
  }
  $('agent').textContent = `Agent : ${STATES[agent?.state] || '—'}${agent?.task ? ` (${agent.task})` : ''}${agent?.message ? ` · ${agent.message}` : ''}`
  $('agent').className = ['paused', 'error', 'logged_out'].includes(agent?.state) ? 'bad' : agent?.state === 'task' || agent?.state === 'idle' ? 'ok' : ''
  $('error').textContent = last?.error || ''
  $('learn').textContent = `Mode apprentissage : ${learning ? 'activé' : 'coupé'}`
  $('learn').className = learning ? 'on' : ''
  $('learning').hidden = !learning
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
  for (const e of history.slice(0, 10)) h.append(li(`${when(e.at)} · ${e.text}`, e.level === 'warn' ? 'bad' : ''))
}
$('learn').onclick = async () => { const {learning} = await chrome.storage.local.get('learning'); await chrome.runtime.sendMessage({type: 'set_learning', on: !learning}); render() }
$('now').onclick = async () => { $('now').disabled = true; await chrome.runtime.sendMessage({type: 'tick_now'}); $('now').disabled = false; render() }
chrome.storage.onChanged.addListener(render)
render()
