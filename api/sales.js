import { readPage } from '../server/pagination.js'
import { randomUUID } from 'node:crypto'
import { authorize } from '../server/auth.js'
import { AppError, normalizeOrders, readDotbPage, validateEdit, validateSaleSku } from '../server/dotb.js'
import { STAGES } from '../src/lib/fulfillment.js'
import {readTrackingPeriod} from '../server/tracking.js'
import {automationStatus,enableSalesAutomation} from '../server/sales-automation.js'
import {salesFilters,financeValues,batchValues,saleVariant} from '../server/workspace.js'
import {enrichSoldSizes} from '../server/sold-sizes.js'
import {readShipments,saveShipment,refreshShipment} from '../server/supplier-shipments.js'
import {isId} from '../server/dotb.js'
import {shippingLabel} from '../server/shipping-labels.js'
import {readSheinOrders,reviewSheinOrder} from '../server/shein-orders.js'
import {refreshSalePhotos} from '../server/sale-photos.js'
import {readDailyPurchases} from '../server/daily-purchases.js'
import {assistantSummary} from '../server/shein-assistant.js'
import {readIncompleteOrders} from '../server/incomplete-orders.js'
import {syncDotbCosts} from '../server/dotb-costs.js'

export const config = { maxDuration: 60 }
const fail = error => { if (error) throw error }
const errorMessages = {
  shein_item_unavailable:'Cet article Shein est annulé, non payé ou à vérifier. Aucune vente n’a été modifiée.',
  shein_quantity_used:'Tous les exemplaires de cet article sont déjà associés à des ventes.',
  shein_already_linked:'Cette vente est déjà associée à une commande Shein.',
  shein_already_ordered:'Cette vente porte déjà un autre numéro de commande. Corrige sa fiche avant de l’associer.',
  shein_sale_mismatch:'Le SKU ne correspond pas ou la vente n’est plus disponible pour cet achat.',
  shein_link_missing:'Cette association n’existe plus. Actualise la liste.',
  shein_link_changed:'La fiche a été modifiée ou préparée depuis l’association. Vérifie ses informations avant de corriger la commande.',
  stale_version: 'Cet article a changé. Actualisez la liste avant de recommencer.',
  order_blocked: 'Cette vente est annulée, en retour, suspendue ou déjà expédiée. Actualisez la liste.',
  invalid_transition: 'Cette étape n’est plus disponible. Actualisez la liste.',
  purchase_details_required: 'Renseignez le SKU, le lien fournisseur et le numéro de commande Shein avant de continuer.',
  bundle_not_ready: 'Préparez tous les articles de cette vente en lot avant de confirmer le dépôt.',
  line_not_found: 'Cet article n’est plus disponible.', sync_lease_expired: 'La synchronisation a expiré. Vous pouvez la reprendre.',
  invalid_sku: 'Colle le SKU Shein seul, sans lien ni espaces.',
}

export default async function handler(req, res) {
  if (!['GET', 'POST', 'PATCH'].includes(req.method)) { res.setHeader('Allow', 'GET, POST, PATCH'); return res.status(405).end() }
  try {
    const auth = await authorize(req, res, ['admin','stock'])
    if (!auth) return
    const { db, role, user } = auth
    if (req.method === 'GET') {
      if(req.query?.view==='incomplete')return res.json(await readIncompleteOrders(db,req.query.page??0))
      if(req.query?.view==='shein_assistant')return res.json(await assistantSummary(db,req.query))
      if(req.query?.view==='daily_cart')return res.json(await readDailyPurchases(db,req.query))
      if(req.query?.view==='shein_orders')return res.json(await readSheinOrders(db,req.query))
      if(req.query?.view==='shipments')return res.json(await readShipments(db,req.query))
      if(req.query?.view==='detail'){
        const id=req.query.id
        if(typeof id!=='string'||!id||id.length>80)throw new AppError('Vente invalide.')
        const {data:line,error}=await db.from('workspace_sales').select('*').eq('id',id).maybeSingle();fail(error)
        if(!line)throw new AppError('Cette vente n’est plus disponible dans la période suivie.',404)
        const {data:catalog,error:catalogError}=await db.from('sales_supplier_details').select('*').eq('sku',line.resolved_sku);fail(catalogError)
        const parcels=await readShipments(db,{line:id})
        return res.json({line:{...line,shipments:parcels.shipments},catalog})
      }
      if(req.query?.view==='page'){
        const filters=salesFilters(req.query)
        const prefix='incomplete-orders-v1:'
        const known=typeof req.query.revision==='string'&&req.query.revision.startsWith(prefix)?req.query.revision.slice(prefix.length):null
        const pendingPage=db.rpc('sales_workspace_page',{p_filters:filters,p_known_revision:known})
        const conditional=known?await pendingPage:null
        if(conditional){fail(conditional.error);if(conditional.data.unchanged)return res.json({...conditional.data,revision:prefix+conditional.data.revision})}
        const [pageResult,tracking,syncState,automation,incomplete]=await Promise.all([
          conditional||pendingPage,
          readTrackingPeriod(db),
          db.from('dotb_sync_state').select('cursor,last_completed_at,processed').eq('id',true).single(),
          automationStatus(db),
          readIncompleteOrders(db),
        ])
        fail(pageResult.error);fail(syncState.error)
        const data=pageResult.data
        return res.json({...data,revision:prefix+data.revision,incomplete,tracking,automation,connected:!!process.env.DOTB_API_TOKEN,
          last_sync:syncState.data.last_completed_at,resume:!!syncState.data.cursor,processed:syncState.data.processed})
      }
      const offset = Number(req.query?.offset || 0)
      if (!Number.isSafeInteger(offset) || offset < 0 || offset > 1000000) throw new AppError('Page invalide.')
      const { data: state, error: stateError } = await db.from('dotb_sync_state').select('cursor,last_completed_at,processed').eq('id',true).single()
      if (stateError && !['42P01','PGRST205'].includes(stateError.code)) throw stateError
      if (stateError) return res.json({ setup_required: true, connected: !!process.env.DOTB_API_TOKEN, lines: [], catalog: [], count: 0 })
      const [linesPage,catalogPage,tracking]=await Promise.all([readPage(head => db.from('workspace_sales')
        .select('*', { count: 'exact', head })
        .eq('source_active', true).order('id'), offset),
        readPage(head => db.from('sales_supplier_details').select('*', { count: 'exact', head }).order('sku'), offset),readTrackingPeriod(db)])
      const {data,count}=linesPage,{data:catalog,count:catalogCount}=catalogPage
      return res.json({ lines: data, catalog, count, tracking, automation:await automationStatus(db),catalog_count: catalogCount, connected: !!process.env.DOTB_API_TOKEN,
        last_sync: state.last_completed_at, resume: !!state.cursor, processed: state.processed })
    }
    if (req.method === 'POST') {
      if(req.body?.action==='refresh_photos')return res.json(await refreshSalePhotos(db,req.body.ids))
      if(req.body?.action==='shipping_label')return res.json(await shippingLabel(db,req.body.id))
      if(req.body?.action==='shipment_refresh')return res.json(await refreshShipment(db,req.body.id))
      if (role !== 'admin') throw new AppError('Seul un administrateur peut importer les ventes.',403)
      if(req.body?.action==='automation')return res.json(await enableSalesAutomation(db))
      if(req.body?.action==='dotb_costs'){if(role!=='admin')throw new AppError('Réservé à l’administrateur.',403);return res.json(await syncDotbCosts(db))}
      if (!process.env.DOTB_API_TOKEN) throw new AppError('La connexion Dotb reste à activer dans les réglages du serveur.',503)
      const tracking=await readTrackingPeriod(db)
      const lease = randomUUID(), now = new Date().toISOString()
      const { data: state, error } = await db.from('dotb_sync_state')
        .update({ lease, locked_until: new Date(Date.now()+45000).toISOString() })
        .eq('id',true).lt('locked_until',now).lte('next_allowed_at',now).select().maybeSingle()
      fail(error)
      if (!state) throw new AppError('Une synchronisation est déjà en cours, ou vient de terminer. Réessayez dans quelques secondes.',409)
      try {
        if (!state.cursor) { const { error: resetError } = await db.from('dotb_sync_state').update({ processed: 0 }).eq('lease',lease); fail(resetError) }
        const fetchedAt=new Date().toISOString()
        const page = await readDotbPage(state.cursor,fetch,process.env.DOTB_API_TOKEN,tracking.starts_at)
        const { orders, lines } = await enrichSoldSizes(normalizeOrders(page.data,fetchedAt))
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
    if(body.action==='shein_review')return res.json(await reviewSheinOrder(db,body,user.id))
    if(body.action==='shipment')return res.json(await saveShipment(db,body,user.id))
    if(body.action==='shipment_unlink'){
      if(!isId(body.id)||typeof body.line!=='string'||body.line.length>80||!Number.isFinite(Date.parse(body.updated_at)))throw new AppError('Association invalide.')
      const {error}=await db.rpc('unlink_supplier_shipment',{p_id:body.id,p_line:body.line,p_version:body.updated_at,p_user:user.id});fail(error)
      return res.json({saved:true})
    }
    if(body.action==='batch'){
      const batch=batchValues(body)
      const {error}=await db.rpc('save_sales_batch',{p_lines:batch.lines,p_action:batch.operation,p_value:batch.value,p_user:user.id});fail(error)
      return res.json({saved:true,count:batch.lines.length})
    }
    if (body.action === 'sku') {
      const sku = validateSaleSku(body)
      const { error } = await db.rpc('save_sales_sku', { p_id: body.id, p_version: body.updated_at, p_sku: sku, p_user: user.id })
      fail(error)
      return res.json({ saved: true, sku })
    }
    let edit = null, product = null, stage = null
    if (body.action === 'advance') {
      if (!STAGES.some(s=>s.id===body.stage) || typeof body.id !== 'string' || body.id.length>80 || !Number.isFinite(Date.parse(body.updated_at))) throw new AppError('Étape invalide.')
      stage = body.stage
    } else if (body.action === 'edit') {
      ({ edit, product } = validateEdit(body))
      if(body.finance_confirmed!==undefined){
        const finance=financeValues(body)
        const hasVariant=body.supplier_size!==undefined||body.supplier_color!==undefined
        const {error}=await db.rpc(hasVariant?'save_sale_details':'save_sales_workspace',{p_id:body.id,p_version:body.updated_at,p_edit:edit,p_product:product,p_fees:finance.fees,p_refund:finance.refund,p_confirmed:finance.confirmed,...(hasVariant?{p_variant:saleVariant(body)}:{}),p_user:user.id});fail(error)
        return res.json({saved:true})
      }
    }
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
