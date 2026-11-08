// Réservation des annonces pour YlaVint, ou envoi par étapes vers Dotb.
// Il est piloté depuis le navigateur mais ne dépend d'aucun écran : changer d'onglet du site, ou d'onglet du
// navigateur, ne l'interrompt pas. Seule la fermeture de la page l'arrête ; ce qui est déjà réservé reste dans
// « En cours d'envoi » et se reprend d'un clic.

export const BATCH = 25
const initial = {running: false, progress: null, notice: '', error: '', failures: [], finished: 0}
let state = initial
let stopRequested = false
const listeners = new Set()

function set(patch) {
  state = {...state, ...patch}
  for (const listener of [...listeners]) listener()
}
export const getRunnerState = () => state
export function subscribeRunner(listener) {
  listeners.add(listener)
  return () => listeners.delete(listener)
}
export const stopRunner = () => { stopRequested = true }
export const dismissRunnerMessages = () => set({notice: '', error: '', failures: []})
export const resetRunner = () => { state = initial; stopRequested = false; listeners.clear() }

// Un onglet du navigateur en arrière-plan ralentit les minuteries de la page : l'attente passe par un petit
// worker, qui n'est pas ralenti. Sans worker (ou s'il ne répond pas), on retombe sur setTimeout.
let worker
function timerWorker() {
  if (worker !== undefined) return worker
  try {
    const url = URL.createObjectURL(new Blob(['onmessage=e=>setTimeout(()=>postMessage(e.data.id),e.data.ms)'], {type: 'text/javascript'}))
    worker = new Worker(url)
    worker.onerror = () => { worker = null }
  } catch { worker = null }
  return worker
}
let sequence = 0
export function sleep(ms) {
  const w = typeof Worker === 'function' && typeof document !== 'undefined' ? timerWorker() : null
  if (!w) return new Promise(resolve => setTimeout(resolve, ms))
  return new Promise(resolve => {
    const id = ++sequence
    let fallback
    const done = () => { clearTimeout(fallback); w.removeEventListener('message', onMessage); resolve() }
    const onMessage = e => { if (e.data === id) done() }
    w.addEventListener('message', onMessage)
    fallback = setTimeout(done, ms + 4000)
    try { w.postMessage({id, ms}) } catch { done() }
  })
}

// Tant que l'envoi tourne, le navigateur prévient avant de fermer la page.
const warnOnClose = event => { event.preventDefault(); event.returnValue = '' }
function begin() {
  stopRequested = false
  if (typeof window !== 'undefined') window.addEventListener('beforeunload', warnOnClose)
  set({running: true, error: '', notice: '', failures: [], progress: null})
}
function end() {
  if (typeof window !== 'undefined') window.removeEventListener('beforeunload', warnOnClose)
  set({running: false, progress: null, finished: state.finished + 1})
}
const plural = (n, one, many) => n > 1 ? many : one

// Pousse chaque fiche réservée vers Dotb, une étape à la fois.
// Renvoie les fiches qui n'ont pas abouti et le nombre de fiches réellement programmées.
async function drive(request, rows, step) {
  const done = []
  let scheduled = 0
  for (let i = 0; i < rows.length && !stopRequested; i++) {
    if(rows[i].publish_provider==='ylavint')continue
    let row = rows[i], waits = 0
    for (let guard = 0; guard < 30 && !stopRequested; guard++) {
      set({progress: {phase: 'dotb', index: i + 1, total: rows.length, title: row.title || 'Annonce', message: row.message}})
      let result
      try { result = (await request('POST', {action: 'step', id: row.id})).draft }
      catch (e) { done.push({...row, error: e.message}); break }
      row = {...row, state: result.state, message: result.message, last_error: result.last_error, version: result.version}
      if (result.state !== 'preparing') { if (result.state === 'attention') done.push({...row, error: result.message}); else scheduled++; break }
      if (result.last_error) {
        if (/Limite Dotb/i.test(result.last_error) && waits < 3) {
          waits++
          set({progress: {...state.progress, message: 'Limite Dotb atteinte : pause de 30 secondes…'}})
          await sleep(30000)
          continue
        }
        done.push({...row, error: result.last_error}); break
      }
      await sleep(step)
    }
  }
  return {stuck: done, scheduled}
}

// Réserve les créneaux du planning (par lots), puis envoie chaque fiche à Dotb.
export async function startPlanSend({request, items, mode, provider = 'dotb', step = 1800}) {
  if (state.running || !items?.length) return false
  begin()
  const reserved = [], refused = []
  try {
    for (let i = 0; i < items.length && !stopRequested; i += BATCH) {
      const batch = items.slice(i, i + BATCH)
      set({progress: {phase: 'reserve', index: Math.min(i + BATCH, items.length), total: items.length}})
      const {results} = await request('POST', {action: 'plan', mode, provider, items: batch.map(x => ({id: x.id, version: x.version, at: new Date(x.at).toISOString()}))})
      for (const r of results) {
        const item = batch.find(x => x.id === r.id)
        if (r.ok) reserved.push({...item, state: r.state, message: r.message, version: r.version})
        else refused.push({...item, error: r.error})
      }
    }
    const {stuck, scheduled: ok} = provider==='ylavint'?{stuck:[],scheduled:reserved.length}:await drive(request, reserved, step)
    const all = [...refused, ...stuck]
    set({
      failures: all,
      notice: stopRequested
        ? `Envoi arrêté. ${ok} annonce${plural(ok, '', 's')} programmée${plural(ok, '', 's')} ; les autres attendent dans « En cours d’envoi ».`
        : `${ok} annonce${plural(ok, '', 's')} programmée${plural(ok, '', 's')} ${provider==='ylavint'?'avec YlaVint':'chez Dotb'}.${all.length ? ` ${all.length} à revoir ci-dessous.` : ''}`
    })
  } catch (e) {
    set({error: e.message || 'L’envoi a été interrompu. Ce qui est déjà réservé reste dans « En cours d’envoi ».'})
  } finally { end() }
  return true
}

// Reprend les fiches restées « en cours d'envoi ».
export async function resumeSend({request, rows, step = 1800}) {
  if (state.running || !rows?.length) return false
  begin()
  try {
    const {stuck} = await drive(request, rows, step)
    set({failures: stuck, notice: stuck.length ? `${stuck.length} annonce${plural(stuck.length, '', 's')} attendent encore : lis le message de chacune.` : 'Envoi terminé.'})
  } catch (e) {
    set({error: e.message || 'L’envoi a été interrompu.'})
  } finally { end() }
  return true
}

// Annule des programmations (Dotb autorise jusqu'à 2 minutes avant l'heure prévue).
export async function cancelSchedules({request, rows}) {
  if (state.running || !rows?.length) return false
  begin()
  const errors = []
  let tried = 0
  try {
    for (let i = 0; i < rows.length && !stopRequested; i++) {
      tried++
      set({progress: {phase: 'cancel', index: i + 1, total: rows.length, title: rows[i].title}})
      try { await request('POST', {action: 'unschedule', id: rows[i].id, version: rows[i].version}) }
      catch (e) { errors.push({...rows[i], error: e.message}) }
      await sleep(1100)
    }
    const ok = tried - errors.length
    set({failures: errors, notice: `${ok} programmation${plural(ok, '', 's')} annulée${plural(ok, '', 's')}.`})
  } catch (e) {
    set({error: e.message || 'L’annulation a été interrompue.'})
  } finally { end() }
  return true
}
