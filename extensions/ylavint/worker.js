import {SITE, TOKEN} from './config.js'

// YlaVint : le Bridge du profil. Veille du compte (bandeau Vinted) + exécution des tâches du site, une à la fois.
// Le gros bouton du popup allume ou coupe le Bridge de ce profil.
const VERSION = chrome.runtime.getManifest().version
const WATCH_EVERY = 45 // minutes entre deux vérifications du compte
const get = async key => (await chrome.storage.local.get(key))[key]
const set = values => chrome.storage.local.set(values)
const schedule = () => {
  chrome.alarms.create('watch', {delayInMinutes: 2, periodInMinutes: WATCH_EVERY})
  chrome.alarms.create('agent', {delayInMinutes: 0.5, periodInMinutes: 0.5})
}
const bridgeOn = async () => (await get('bridge')) !== false
// Badge de l'icône : messages non lus, pause, Bridge coupé.
async function badge() {
  const {agent, bridge} = await chrome.storage.local.get(['agent', 'bridge'])
  let text = '', color = '#2563eb'
  if (bridge === false) { text = 'OFF'; color = '#79756f' }
  else if (['paused', 'error', 'logged_out'].includes(agent?.state)) { text = '!'; color = '#c2410c' }
  else if (agent?.unread > 0) { text = agent.unread > 99 ? '99+' : String(agent.unread); color = '#e11d48' }
  await chrome.action.setBadgeText({text}).catch(() => {})
  await chrome.action.setBadgeBackgroundColor({color}).catch(() => {})
}
chrome.storage.onChanged.addListener(changes => { if (changes.agent || changes.bridge) badge() })
chrome.runtime.onInstalled.addListener(() => { schedule(); badge() })
chrome.runtime.onStartup.addListener(() => { schedule(); badge() })

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
  if (!(await bridgeOn())) return
  if (alarm.name === 'watch') {
    const tab = await chrome.tabs.create({url: 'https://www.vinted.fr/', active: false})
    await set({check_tab: tab.id})
    setTimeout(() => chrome.tabs.remove(tab.id).catch(() => {}), 60000)
  }
  // Un échec temporaire retente après une minute, sans bloquer la file pendant dix minutes.
  if (alarm.name === 'agent') tick().catch(() => {})
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
let ticking = false, wakeTimer = null
async function tick() {
  if (ticking) return
  ticking = true
  try { await tickWork() }
  catch (e) {
    await set({agent:{...(agentState||{}),state:'error',message:e.message||'Site injoignable',at:Date.now()},agent_next:Date.now()+60000})
    throw e
  } finally {
    ticking = false
    clearTimeout(wakeTimer)
    if (await bridgeOn()) {
      const next = Number(await get('agent_next')) || Date.now()+30000
      wakeTimer = setTimeout(() => tick().catch(() => {}), Math.max(1000,next-Date.now()))
    }
  }
}
// Compte connecté : lu dans la page ; sur les pages qui n'en portent pas les données (messagerie, commandes…),
// on reprend le dernier compte lu dans ce profil (un profil AdsPower = un compte Vinted).
async function identity(tabId) {
  const who = tabId ? await chrome.tabs.sendMessage(tabId, {type: 'identity'}).catch(() => null) : null
  if (who?.member_id) return who
  const last = await get('last')
  if (!last?.member_id) return who
  const status = String(last.key || 'ok|').split('|')[0] || 'ok'
  return {member_id: last.member_id, login: last.login, status, source: 'last'}
}
async function vintedTab() {
  const tabs = await chrome.tabs.query({url: 'https://www.vinted.fr/*'})
  const checkTab = await get('check_tab')
  return tabs.find(t => t.status === 'complete' && t.id !== checkTab && !t.discarded) || null
}
async function tickWork() {
  if (!(await bridgeOn())) { agentState = {state: 'off', message: 'Bridge coupé dans ce profil.', at: Date.now()}; return set({agent: agentState}) }
  if (Date.now() < busyUntil) return
  const pendingPublication=await get('publication_result')
  if(pendingPublication){
    try{await site('agent_result',pendingPublication);await set({publication_result:null})}
    catch(e){await journal({level:'warn',text:'Résultat de publication conservé : '+e.message});return set({agent_next:Date.now()+30000})}
  }
  const next = (await get('agent_next')) || 0
  if (Date.now() < next) return
  const tab = await vintedTab()
  if (!tab) { agentState = {state: 'no_tab', message: 'Ouvre un onglet Vinted dans ce profil.', at: Date.now()}; return set({agent: agentState,agent_next:Date.now()+30000}) }
  const who = await identity(tab.id)
  if (!who?.member_id) { agentState = {state: 'logged_out', message: 'Compte Vinted non connecté dans ce profil.', at: Date.now()}; return set({agent: agentState,agent_next:Date.now()+30000}) }
  if (who.status !== 'ok') { agentState = {state: 'paused', message: 'Alerte Vinted sur le compte : agent arrêté.', login: who.login, at: Date.now()}; return set({agent: agentState,agent_next:Date.now()+60000}) }
  busyUntil = Date.now() + 200000
  try {
    const r = await site('agent_poll', {member_id: who.member_id, login: who.login})
    agentState = {state: r.state, message: r.reason || r.message || null, login: r.account || who.login, at: Date.now(),
      unread: Number.isFinite(r.unread) ? r.unread : agentState?.unread || 0, features: r.features || agentState?.features || []}
    await set({agent: agentState, agent_next: Date.now() + (r.wait_seconds || 30) * 1000})
    if (r.state !== 'task' || !r.task) return
    const task = {...r.task, member_id: who.member_id}
    await set({agent: {...agentState, task: task.kind}})
    const outcome = await chrome.tabs.sendMessage(tab.id, {type: 'run', task}).catch(e => ({ok: false, code: 'failed', error: e.message || 'Onglet Vinted fermé.'}))
    const report={task_id:task.id,lease:task.lease,member_id:who.member_id,...outcome}
    if(task.kind==='publish_item')await set({publication_result:report})
    const saved = await site('agent_result',report)
    if(task.kind==='publish_item')await set({publication_result:null})
    await journal({level: outcome.ok ? 'info' : 'warn', text: outcome.ok ? (saved.message || `${task.kind} : terminé`) : `${task.kind} : ${outcome.error || outcome.code}`})
    await set({agent: {...agentState, task: null, at: Date.now()}, agent_next: Date.now() + 1000})
  } finally { busyUntil = 0 }
}

// Bridge du profil : allumé ou coupé depuis le popup ou le bouton YlaVint de la page.
async function setBridge(on) {
  await set({bridge: on, agent_next: 0})
  await journal({level: on ? 'info' : 'warn', text: on ? 'Bridge YlaVint allumé.' : 'Bridge YlaVint coupé.'})
  if (on) await tick().catch(() => {})
  else await set({agent: {state: 'off', message: 'Bridge coupé dans ce profil.', at: Date.now()}})
}
// Panneau YlaVint dans la page : seules ces lectures et réglages du compte connecté passent par le site.
const PANEL_OPS = new Set(['overview', 'wardrobe', 'sales', 'save_settings', 'pause', 'resume', 'enqueue', 'item_unmask', 'item_reprice'])

// ---------- Messages des pages Vinted ----------
const LABEL_TYPES = /pdf|octet-stream/
chrome.runtime.onMessage.addListener((message, sender, reply) => {
  if (!sender.tab?.url?.startsWith('https://www.vinted.fr/')) return
  if (message?.type === 'observation') {
    const o = message.observation
    if (!o?.member_id) return // pas connecté, ou page sans données du compte
    ;(async () => {
      if (!(await bridgeOn())) return
      await report(o).catch(async e => set({last: {...((await get('last')) || {}), ok: false, error: e.message || 'Site injoignable', at: Date.now()}}))
      if (sender.tab.id === (await get('check_tab'))) chrome.tabs.remove(sender.tab.id).catch(() => {})
    })()
  }
  if (message?.type === 'progress') { busyUntil = Math.max(busyUntil, Date.now() + 60000); return }
  if (message?.type === 'seen') { remember(message.kind, message.recipe); return }
  if (message?.type === 'fetch_bytes') { download(message.url).then(reply, e => reply({error: e.message})); return true }
  if (message?.type === 'ylv_site') {
    if (!PANEL_OPS.has(message.op)) { reply({error: 'Action refusée.'}); return }
    ;(async () => {
      const who = message.member_id ? {member_id: message.member_id, login: message.login} : await identity(sender.tab.id)
      if (!who?.member_id) return reply({error: 'Compte Vinted pas encore reconnu : ouvre ton profil Vinted une fois dans ce profil AdsPower.'})
      return site('agent_self', {op: message.op, payload: message.payload || {}, member_id: who.member_id, login: who.login}).then(async result => {
        reply(result)
        if (['save_settings','resume','enqueue'].includes(message.op)) { await set({agent_next:0}); tick().catch(() => {}) }
      }, e => reply({error: e.message || 'Site injoignable.'}))
    })()
    return true
  }
  if (message?.type === 'ylv_bridge') { setBridge(message.on === true); return }
  if (message?.type === 'ylv_open') { chrome.tabs.create({url: `${SITE}/ylavint#${String(message.section || 'accueil').replace(/[^a-z]/g, '')}`}); return }
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
  if (!kind || !(await bridgeOn())) return
  const seen = (await get('seen')) || []
  const id = `${recipe.method} ${recipe.path}`
  await set({seen: [{id, kind, recipe, at: Date.now()}, ...seen.filter(s => s.id !== id)].slice(0, 25)})
  // Apprentissage automatique : une action déjà apprise n'est renvoyée au site qu'une fois par jour (pour suivre les changements de Vinted).
  const known = ((await get('learned')) || {})[kind]
  if (known && known.path === id && Date.now() - known.at < 864e5) return
  await learn(kind, recipe)
}
async function learn(kind, recipe) {
  const who = await vintedTab().then(t => identity(t?.id)).catch(() => null)
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
  if (message?.type === 'set_bridge') { setBridge(message.on === true).then(() => reply({ok: true})); return true }
  if (message?.type === 'tick_now') { set({agent_next: 0}).then(() => tick()).then(() => reply({ok: true}), e => reply({ok: false, error: e.message})); return true }
})
