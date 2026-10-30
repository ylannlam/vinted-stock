import { authorize } from '../server/auth.js'
import { validateTracker } from '../server/drop-tracker.js'

export default async function handler(req, res) {
  if (!['GET', 'PUT'].includes(req.method)) { res.setHeader('Allow', 'GET, PUT'); return res.status(405).end() }
  try {
    const auth = await authorize(req, res, ['admin'])
    if (!auth) return
    if (req.method === 'GET') {
      const { data, error } = await auth.db.from('drop_tracker').select('payload,revision').eq('id', true).single()
      if (error) throw error
      return res.json(data)
    }
    const { revision, payload } = req.body || {}
    if (!Number.isSafeInteger(revision) || revision < 0) return res.status(400).json({error: 'Version invalide.'})
    let clean
    try { clean = validateTracker(payload) } catch (e) { return res.status(400).json({error: e.message}) }
    const { data, error } = await auth.db.from('drop_tracker')
      .update({ payload: clean, revision: revision + 1, updated_at: new Date().toISOString() })
      .eq('id', true).eq('revision', revision).select('revision').maybeSingle()
    if (error) throw error
    if (!data) return res.status(409).json({error: 'Un autre appareil a modifié le suivi. Rechargez les données avant de recommencer.'})
    return res.json(data)
  } catch (error) {
    console.error('drop_tracker_failed', { code: error.code || 'unknown' })
    return res.status(500).json({error: 'Impossible de joindre la sauvegarde. Réessayez.'})
  }
}
