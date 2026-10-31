import { readPage } from '../server/pagination.js'
import { randomUUID } from 'node:crypto'
import { authorize } from '../server/auth.js'
import { AppError, normalizeOrders, readDotbPage, validateEdit } from '../server/dotb.js'
import { STAGES } from '../src/lib/fulfillment.js'
import {readTrackingPeriod} from '../server/tracking.js'

export const config = { maxDuration: 60 }
const fail = error => { if (error) throw error }
const errorMessages = {
  stale_version: 'Cet article a changé. Actualisez la liste avant de recommencer.',
  order_blocked: 'Cette vente est annulée, en retour, suspendue ou déjà expédiée. Actualisez la liste.',
  invalid_transition: 'Cette étape n’est plus disponible. Actualisez la liste.',
  purchase_details_required: 'Renseignez le SKU, le lien fournisseur et le numéro de commande Shein avant de continuer.',
  bundle_not_ready: 'Préparez tous les articles de cette vente en lot avant de confirmer le dépôt.',
  line_not_found: 'Cet article n’est plus disponible.', sync_lease_expired: 'La synchronisation a expiré. Vous pouvez la reprendre.',
}

export default async function handler(req, res) {
  if (!['GET', 'POST', 'PATCH'].includes(req.method)) { res.setHeader('Allow', 'GET, POST, PATCH'); return res.status(405).end() }
  try {
    const auth = await authorize(req, res, ['admin','stock'])
    if (!auth) return
    const { db, role, user } = auth
    const tracking=await readTrackingPeriod(db)
    if (req.method === 'GET') {
      const offset = Number(req.query?.offset || 0)
      if (!Number.isSafeInteger(offset) || offset < 0 || offset > 1000000) throw new AppError('Page invalide.')
      const { data: state, error: stateError } = await db.from('dotb_sync_state').select('cursor,last_completed_at,processed').eq('id',true).single()
      if (stateError && !['42P01','PGRST205'].includes(stateError.code)) throw stateError
      if (stateError) return res.json({ setup_required: true, connected: !!process.env.DOTB_API_TOKEN, lines: [], catalog: [], count: 0 })
      const { data, count } = await readPage(head => db.from('sales_lines_in_period')
        .select('*', { count: 'exact', head })
        .eq('source_active', true).order('id'), offset)
      const { data: catalog, count: catalogCount } = await readPage(head => db.from('sales_catalog_resolved')
        .select('*', { count: 'exact', head }).order('sku'), offset)
      return res.json({ lines: data, catalog, count, tracking, catalog_count: catalogCount, connected: !!process.env.DOTB_API_TOKEN,
        last_sync: state.last_completed_at, resume: !!state.cursor, processed: state.processed })
    }
    if (req.method === 'POST') {
      if (role !== 'admin') throw new AppError('Seul un administrateur peut importer les ventes.',403)
      if (!process.env.DOTB_API_TOKEN) throw new AppError('La connexion Dotb reste à activer dans les réglages du serveur.',503)
      const lease = randomUUID(), now = new Date().toISOString()
      const { data: state, error } = await db.from('dotb_sync_state')
        .update({ lease, locked_until: new Date(Date.now()+45000).toISOString() })
        .eq('id',true).lt('locked_until',now).lte('next_allowed_at',now).select().maybeSingle()
      fail(error)
      if (!state) throw new AppError('Une synchronisation est déjà en cours, ou vient de terminer. Réessayez dans quelques secondes.',409)
      try {
        if (!state.cursor) { const { error: resetError } = await db.from('dotb_sync_state').update({ processed: 0 }).eq('lease',lease); fail(resetError) }
        const page = await readDotbPage(state.cursor,fetch,process.env.DOTB_API_TOKEN,tracking.starts_at)
        const { orders, lines } = normalizeOrders(page.data)
        const { error: importError } = await db.rpc('import_dotb_page', {
          p_orders: orders, p_lines: lines, p_cursor: page.has_more ? page.next_cursor : null, p_lease: lease,
        })
        fail(importError)
        return res.json({ has_more: page.has_more, processed: (state.cursor ? state.processed : 0) + orders.length })
      } finally {
        // A failed page retains its cursor. A successful RPC already released this lease.
        await db.from('dotb_sync_state').update({ locked_until: new Date(0).toISOString(), lease: null,
          next_allowed_at: new Date(Date.now()+1500).toISOString() }).eq('id',true).eq('lease',lease)
      }
    }
    const body = req.body
    if (!body || typeof body !== 'object') throw new AppError('Formulaire invalide.')
    let edit = null, product = null, stage = null
    if (body.action === 'advance') {
      if (!STAGES.some(s=>s.id===body.stage) || typeof body.id !== 'string' || body.id.length>80 || !Number.isFinite(Date.parse(body.updated_at))) throw new AppError('Étape invalide.')
      stage = body.stage
    } else if (body.action === 'edit') { ({ edit, product } = validateEdit(body)) }
    else throw new AppError('Action inconnue.')
    const { error } = await db.rpc('save_sales_line', { p_id: body.id, p_version: body.updated_at,
      p_edit: edit, p_product: product, p_stage: stage, p_user: user.id })
    fail(error)
    return res.json({ saved: true })
  } catch (error) {
    console.error('sales_request_failed', { method: req.method, code: error.code || 'unknown', status: error.status || 500 })
    const key = Object.keys(errorMessages).find(key => error.message?.includes(key))
    const setup = ['42P01','PGRST202','PGRST205'].includes(error.code)
    return res.status(key ? 409 : setup ? 503 : error.status || 500).json({ error: key ? errorMessages[key] : setup ? 'Le suivi des ventes reste à activer dans la base de données.' : error instanceof AppError ? error.message : 'Impossible de terminer l’opération. Vos données restent conservées.' })
  }
}
