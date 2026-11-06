import {SITE, TOKEN} from './config.js'

const EVERY = 45 // minutes entre deux vérifications
const get = async key => (await chrome.storage.local.get(key))[key]
const set = values => chrome.storage.local.set(values)
const schedule = () => chrome.alarms.create('watch', {delayInMinutes: 2, periodInMinutes: EVERY})
chrome.runtime.onInstalled.addListener(schedule)
chrome.runtime.onStartup.addListener(schedule)

// Toutes les 45 minutes : ouvre Vinted en arrière-plan, laisse l'extension lire l'état du compte, referme l'onglet.
chrome.alarms.onAlarm.addListener(async alarm => {
  if (alarm.name !== 'watch') return
  const tab = await chrome.tabs.create({url: 'https://www.vinted.fr/', active: false})
  await set({check_tab: tab.id})
  setTimeout(() => chrome.tabs.remove(tab.id).catch(() => {}), 60000)
})

async function report(o) {
  const last = (await get('last')) || {}
  const key = `${o.status}|${o.until_date || ''}`
  // On n'écrit au site que si l'état change, ou au plus une fois toutes les 40 minutes.
  if (last.key === key && last.member_id === o.member_id && last.ok && Date.now() - (last.at || 0) < 40 * 60000) return
  const response = await fetch(`${SITE}/api/collector`, {method: 'POST', headers: {'Content-Type': 'application/json', Authorization: `Bearer ${TOKEN}`},
    body: JSON.stringify({action: 'watch_report', report: {...o, observed_at: new Date().toISOString(), version: chrome.runtime.getManifest().version}})})
  const result = await response.json().catch(() => ({}))
  await set({last: {key, member_id: o.member_id, login: o.login, at: Date.now(), ok: response.ok && result.saved !== false,
    error: !response.ok ? result.error || `Erreur ${response.status}` : result.saved === false ? result.reason : null}})
}

chrome.runtime.onMessage.addListener((message, sender) => {
  if (message?.type !== 'observation' || !sender.tab?.url?.startsWith('https://www.vinted.fr/')) return
  const o = message.observation
  if (!o?.member_id) return // pas connecté, ou page sans données du compte
  ;(async () => {
    await report(o).catch(async e => set({last: {...((await get('last')) || {}), ok: false, error: e.message || 'Site injoignable', at: Date.now()}}))
    if (sender.tab.id === (await get('check_tab'))) chrome.tabs.remove(sender.tab.id).catch(() => {})
  })()
})
