// Relais entre l'extension et la page Vinted :
// - à chaque page, lit l'état du compte (bandeau, restriction) et le transmet ;
// - transmet les tâches à exécuter et les requêtes relevées en mode apprentissage.
(() => {
  const send = () => { try { const r = globalThis.readVintedAccount(); if (r) chrome.runtime.sendMessage({type: 'observation', observation: r}).catch(() => {}) } catch {} }
  send()
  setTimeout(send, 4000) // le bandeau peut s'afficher après le chargement

  // Compte connecté : lu dans la page ; certaines pages (messagerie, commandes) n'en portent pas les données,
  // on relit alors la page d'accueil Vinted (une seule fois par onglet).
  let home = null
  async function identity() {
    let r = null
    try { r = globalThis.readVintedAccount() } catch {}
    if (r?.member_id) return r
    if (!home) home = fetch('/', {credentials: 'include'}).then(x => x.ok ? x.text() : '').then(html => {
      const doc = new DOMParser().parseFromString(html, 'text/html')
      const found = globalThis.readVintedAccount(doc, 'https://www.vinted.fr/')
      return found?.member_id ? {...found, status: r?.status && r.status !== 'ok' ? r.status : found.status} : null
    }).catch(() => null)
    return (await home) || r
  }
  globalThis.ylvIdentity = identity
  const toPage = msg => window.postMessage({source: 'sva-ext', ...msg}, location.origin)
  const pending = new Map()
  window.addEventListener('message', e => {
    if (e.source !== window || e.origin !== location.origin || e.data?.source !== 'sva-page') return
    const d = e.data
    if (d.type === 'result') { const reply = pending.get(d.id); if (reply) { pending.delete(d.id); reply(d.payload) } }
    if (d.type === 'progress') chrome.runtime.sendMessage({type: 'progress'}).catch(() => {})
    if (d.type === 'seen' && d.recipe) chrome.runtime.sendMessage({type: 'seen', kind: d.kind, recipe: d.recipe}).catch(() => {})
    if (d.type === 'need_bytes' && typeof d.url === 'string') chrome.runtime.sendMessage({type: 'fetch_bytes', url: d.url})
      .then(payload => toPage({type: 'bytes', id: d.id, payload}), () => toPage({type: 'bytes', id: d.id, payload: {error: 'Téléchargement impossible.'}}))
  })
  chrome.runtime.onMessage.addListener((msg, _sender, reply) => {
    if (msg?.type === 'identity') { identity().then(reply, () => reply(null)); return true }
    if (msg?.type === 'learning') { toPage({type: 'learning', on: msg.on === true}); return }
    if (msg?.type === 'run' && msg.task) {
      const id = crypto.randomUUID()
      pending.set(id, reply)
      toPage({type: 'run', id, task: msg.task})
      setTimeout(() => { if (pending.has(id)) { pending.delete(id); reply({ok: false, code: 'timeout', error: 'Le délai de la tâche est dépassé. Consulte le suivi.'}) } }, msg.task.kind==='publish_item'?590000:180000)
      return true
    }
  })
  chrome.storage.local.get('learning').then(({learning}) => { if (learning) toPage({type: 'learning', on: true}) })
})()
