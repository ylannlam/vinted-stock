import {SITE, TOKEN} from './config.js'

// Agent Stock Vinted : veille du compte (bandeau Vinted) + exécution des tâches du site, une à la fois.
const VERSION = chrome.runtime.getManifest().version
const WATCH_EVERY = 45 // minutes entre deux vérifications du compte
const get = async key => (await chrome.storage.local.get(key))[key]
const set = values => chrome.storage.local.set(values)
const schedule = () => {
  chrome.alarms.create('watch', {delayInMinutes: 2, periodInMinutes: WATCH_EVERY})
  chrome.alarms.create('agent', {delayInMinutes: 1, periodInMinutes: 1})
}
chrome.runtime.onInstalled.addListener(schedule)
chrome.runtime.onStartup.addListener(schedule)

async function site(action, body) {
  const response = await fetch(`${SITE}/api/collector`, {method: 'POST', redirect: 'error', credentials: 'omit',
    headers: {'Content-Type': 'application/json', Authorization: `Bearer ${TOKEN}`}, body: JSON.stringify({action, ...body, version: VERSION})})
  const result = await response.json().catch(() => ({}))
  if (!response.ok) throw new Error(result.error || `Erreur ${response.status}`)
  return result
}
async function journal(entry) {
  const list = (await get('history')) || []
  list.unshift({...entry, at: Date.now()})
  await set({history: list.slice(0, 30)})
}

// ---------- Veille du compte ----------
chrome.alarms.onAlarm.addListener(async alarm => {
  if (alarm.name === 'watch') {
    const tab = await chrome.tabs.create({url: 'https://www.vinted.fr/', active: false})
    await set({check_tab: tab.id})
    setTimeout(() => chrome.tabs.remove(tab.id).catch(() => {}), 60000)
  }
  // En cas d'erreur du site : nouvel essai dans 10 min seulement.
  if (alarm.name === 'agent') tick().catch(e => set({agent: {...(agentState || {}), state: 'error', message: e.message || 'Site injoignable', at: Date.now()}, agent_next: Date.now() + 600000}))
})
async function report(o) {
  const last = (await get('last')) || {}
  const key = `${o.status}|${o.until_date || ''}`
  // On n'écrit au site que si l'état change, ou au plus une fois toutes les 40 minutes.
  if (last.key === key && last.member_id === o.member_id && last.ok && Date.now() - (last.at || 0) < 40 * 60000) return
  let result = {}, error = null
  try { result = await site('watch_report', {report: {...o, observed_at: new Date().toISOString()}}) } catch (e) { error = e.message }
  await set({last: {key, member_id: o.member_id, login: o.login, at: Date.now(), ok: !error && result.saved !== false, error: error || (result.saved === false ? result.reason : null)}})
  if (result.agent_paused) await journal({level: 'warn', text: 'Agent mis en pause : alerte Vinted sur le compte.'})
}

// ---------- Agent ----------
let agentState = null, busyUntil = 0
async function vintedTab() {
  const tabs = await chrome.tabs.query({url: 'https://www.vinted.fr/*'})
  const checkTab = await get('check_tab')
  return tabs.find(t => t.status === 'complete' && t.id !== checkTab && !t.discarded) || null
}
async function tick() {
  if (Date.now() < busyUntil) return
  const next = (await get('agent_next')) || 0
  if (Date.now() < next) return
  const tab = await vintedTab()
  if (!tab) { agentState = {state: 'no_tab', message: 'Ouvre un onglet Vinted dans ce profil.', at: Date.now()}; return set({agent: agentState}) }
  const who = await chrome.tabs.sendMessage(tab.id, {type: 'identity'}).catch(() => null)
  if (!who?.member_id) { agentState = {state: 'logged_out', message: 'Compte Vinted non connecté dans ce profil.', at: Date.now()}; return set({agent: agentState}) }
  if (who.status !== 'ok') { agentState = {state: 'paused', message: 'Alerte Vinted sur le compte : agent arrêté.', login: who.login, at: Date.now()}; return set({agent: agentState}) }
  busyUntil = Date.now() + 200000
  try {
    const r = await site('agent_poll', {member_id: who.member_id, login: who.login})
    agentState = {state: r.state, message: r.reason || r.message || null, login: r.account || who.login, at: Date.now()}
    await set({agent: agentState, agent_next: Date.now() + (r.wait_seconds || 60) * 1000 - 5000})
    if (r.state !== 'task' || !r.task) return
    const task = {...r.task, member_id: who.member_id}
    await set({agent: {...agentState, task: task.kind}})
    const outcome = await chrome.tabs.sendMessage(tab.id, {type: 'run', task}).catch(e => ({ok: false, code: 'failed', error: e.message || 'Onglet Vinted fermé.'}))
    const saved = await site('agent_result', {task_id: task.id, lease: task.lease, member_id: who.member_id, ...outcome})
    await journal({level: outcome.ok ? 'info' : 'warn', text: outcome.ok ? (saved.message || `${task.kind} : terminé`) : `${task.kind} : ${outcome.error || outcome.code}`})
    await set({agent: {...agentState, task: null, at: Date.now()}, agent_next: Date.now() + 15000})
  } finally { busyUntil = 0 }
}

// ---------- Messages des pages Vinted ----------
const LABEL_TYPES = /pdf|octet-stream/
chrome.runtime.onMessage.addListener((message, sender, reply) => {
  if (!sender.tab?.url?.startsWith('https://www.vinted.fr/')) return
  if (message?.type === 'observation') {
    const o = message.observation
    if (!o?.member_id) return // pas connecté, ou page sans données du compte
    ;(async () => {
      await report(o).catch(async e => set({last: {...((await get('last')) || {}), ok: false, error: e.message || 'Site injoignable', at: Date.now()}}))
      if (sender.tab.id === (await get('check_tab'))) chrome.tabs.remove(sender.tab.id).catch(() => {})
    })()
  }
  if (message?.type === 'progress') { busyUntil = Math.max(busyUntil, Date.now() + 60000); return }
  if (message?.type === 'seen') { remember(message.kind, message.recipe); return }
  if (message?.type === 'fetch_bytes') { download(message.url).then(reply, e => reply({error: e.message})); return true }
})
// Téléchargement à la place de la page (photos Vinted, bordereau chez le transporteur) : images et PDF uniquement.
async function download(url) {
  const u = new URL(url)
  if (u.protocol !== 'https:' || u.username || u.password) throw new Error('Adresse refusée.')
  const r = await fetch(u.href, {credentials: 'omit', redirect: 'follow'})
  if (!r.ok) throw new Error(`Téléchargement refusé (${r.status}).`)
  const type = r.headers.get('content-type') || ''
  if (!/^image\//.test(type) && !LABEL_TYPES.test(type)) throw new Error('Type de fichier refusé.')
  const bytes = new Uint8Array(await r.arrayBuffer())
  if (bytes.length > 8e6) throw new Error('Fichier trop volumineux.')
  let s = ''
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000))
  return {base64: btoa(s)}
}

// ---------- Apprentissage ----------
async function remember(kind, recipe) {
  const seen = (await get('seen')) || []
  const id = `${recipe.method} ${recipe.path}`
  await set({seen: [{id, kind, recipe, at: Date.now()}, ...seen.filter(s => s.id !== id)].slice(0, 25)})
  if (kind) await learn(kind, recipe)
}
async function learn(kind, recipe) {
  const who = await vintedTab().then(t => t && chrome.tabs.sendMessage(t.id, {type: 'identity'})).catch(() => null)
  try {
    await site('agent_learn', {kind, recipe, member_id: who?.member_id, login: who?.login})
    const learned = (await get('learned')) || {}
    learned[kind] = {at: Date.now(), path: `${recipe.method} ${recipe.path}`}
    await set({learned})
    await journal({level: 'info', text: `Appris : ${kind} (${recipe.method} ${recipe.path})`})
  } catch (e) { await journal({level: 'warn', text: `Apprentissage refusé : ${e.message}`}) }
}
// Depuis le popup : activer / couper l'apprentissage, ou attribuer une requête vue à une action.
chrome.runtime.onMessage.addListener((message, sender, reply) => {
  if (sender.tab) return
  if (message?.type === 'set_learning') {
    (async () => {
      await set({learning: message.on === true})
      for (const t of await chrome.tabs.query({url: 'https://www.vinted.fr/*'})) chrome.tabs.sendMessage(t.id, {type: 'learning', on: message.on === true}).catch(() => {})
      reply({ok: true})
    })()
    return true
  }
  if (message?.type === 'assign') {
    (async () => {
      const item = ((await get('seen')) || []).find(s => s.id === message.id)
      if (!item) return reply({ok: false})
      await learn(message.kind, item.recipe); reply({ok: true})
    })()
    return true
  }
  if (message?.type === 'tick_now') { set({agent_next: 0}).then(() => tick()).then(() => reply({ok: true}), e => reply({ok: false, error: e.message})); return true }
})
