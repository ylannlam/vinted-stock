import {remote, remoteId, ScalencyError} from './scalency-api.js'
import {capacityResult} from './scalency-cadence.js'
import {isId} from './dotb.js'
import {replacementWindow, reservedDay} from '../src/lib/publicationWindow.js'

export const canMoveJob = job => ['queued','waiting','planned','pending','scheduled'].includes(job.status) && !job.sent_at

export async function reschedulePublications(db, user, body, saveRecords, request = remote, now = Date.now()) {
  const {kind, entries, window} = body
  const account = remoteId(body.account)
  if (!['draft','job'].includes(kind) || !Array.isArray(entries) || !entries.length || entries.length > 100 ||
      entries.some(e => !e || typeof e.id !== 'string') || new Set(entries.map(e => e.id)).size !== entries.length)
    throw new ScalencyError('Sélection invalide.')
  let plan
  try { plan = replacementWindow(window, entries.length, now) }
  catch (e) { throw new ScalencyError(e.message) }

  if (kind === 'draft') {
    if (entries.some(e => !isId(e.id) || !Number.isSafeInteger(e.version) || e.version < 1 ||
        (e.previous != null && !Number.isFinite(Date.parse(e.previous))))) throw new ScalencyError('Fiche invalide.')
    const result = await db.rpc('scalency_move_pending', {p_owner:user.id, p_account:account, p_end:plan.end,
      p_entries:entries.map(({id,version,previous}, i) => ({id,version,previous,at:plan.times[i]}))})
    if (result.error?.message === 'lot_changed') throw new ScalencyError('La sélection a changé ou est déjà en transmission. Actualise le suivi.', 409)
    if (result.error?.message === 'lot_window') throw new ScalencyError('Le créneau doit être à venir.', 409)
    if (result.error?.message === 'daily_capacity') throw new ScalencyError('Le plafond de ce compte ne permet pas ce déplacement. Places disponibles ce jour-là : '+(Number(result.error.details)||0)+'.', 409)
    capacityResult(result)
    return {rows:entries.map(({id}, i) => ({id,at:plan.times[i]}))}
  }

  const ids = entries.map(e => e.id)
  if (ids.some(id => !/^[1-9]\d*$/.test(id) || !Number.isSafeInteger(Number(id)))) throw new ScalencyError('Demande Scalency invalide.')
  const current = await request('jobs', {query:{ids:ids.join(','), limit:ids.length}})
  const jobs = new Map((current.data || []).map(j => [String(j.id), j]))
  for (const entry of entries) {
    const job = jobs.get(entry.id)
    if (!job || job.type !== 'publish' || String(job.account_id) !== account || !canMoveJob(job) ||
        (job.not_before || entry.previous) && Date.parse(job.not_before) !== Date.parse(entry.previous))
      throw new ScalencyError('La sélection a changé. Actualise le suivi avant de déplacer les annonces.', 409)
    if (reservedDay(job, now) !== window.day) throw new ScalencyError('Après réception par Scalency, choisis un horaire sur le jour déjà réservé.', 409)
  }
  const reply = await request('jobs/schedule', {method:'POST', body:{
    job_ids:ids.map(Number), scheduled_at:plan.times[0], ...(ids.length > 1 ? {every_minutes:plan.everyMinutes} : {})
  }})
  const confirmed = new Map()
  if (reply.status === 'scheduled' && Array.isArray(reply.data)) {
    for (const j of reply.data) {
      if (jobs.has(String(j.id)) && Number.isFinite(Date.parse(j.not_before))) confirmed.set(String(j.id), j)
    }
  }
  if (confirmed.size) {
    try {
      const live = await request('jobs', {query:{ids:ids.join(','), limit:ids.length}})
      await saveRecords(db, 'jobs', (live.data || []).filter(j => confirmed.has(String(j.id)) && j.type === 'publish' && String(j.account_id) === account))
    } catch { /* The provider receipt is valid even if a cache refresh fails. */ }
  }
  return {rows:ids.map(id => ({id,at:confirmed.get(id)?.not_before || null,note:confirmed.get(id)?.note || null}))}
}
