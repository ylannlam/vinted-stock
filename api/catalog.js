import { randomUUID } from 'node:crypto'
import { authorize } from '../server/auth.js'
import { AppError, isId } from '../server/dotb.js'
import { validateObservation, normalizeDotbItems, readDotbItems } from '../server/catalog.js'
import { readPage } from '../server/pagination.js'

export const config = { maxDuration: 60 }
const check = error => { if (error) throw error }
export default async function handler(req, res) {
  if (!['GET','POST','PATCH'].includes(req.method)) { res.setHeader('Allow','GET, POST, PATCH'); return res.status(405).end() }
  try {
    const auth = await authorize(req,res,['admin','stock'])
    if (!auth) return
    const { db,user,role } = auth
    if (req.method === 'GET') {
      if (req.query?.product_id) {
        if (!isId(req.query.product_id)) throw new AppError('Produit invalide.')
        const { data,error,count } = await db.from('catalog_observations').select('*',{count:'exact'})
          .eq('product_id',req.query.product_id).order('observed_at',{ascending:false}).order('created_at',{ascending:false}).order('id',{ascending:false}).limit(200)
        check(error); return res.json({ observations:data,count })
      }
      const offset=Number(req.query?.offset || 0)
      if (!Number.isSafeInteger(offset) || offset<0 || offset>1000000) throw new AppError('Page invalide.')
      const { data:state,error } = await db.from('catalog_sync_state').select('cursor,processed,last_completed_at').eq('id',true).single()
      check(error)
      const [products,items,links] = await Promise.all([
        readPage(head=>db.from('catalog_product_summary').select('*',{count:'exact',head}).order('created_at',{ascending:false}).order('id'),offset),
        readPage(head=>db.from('catalog_dotb_items').select('*',{count:'exact',head}).order('id'),offset),
        readPage(head=>db.from('catalog_sku_links').select('*',{count:'exact',head}).order('sku'),offset),
      ])
      return res.json({products:products.data,items:items.data,links:links.data,product_count:products.count,item_count:items.count,link_count:links.count,
        connected:!!process.env.DOTB_API_TOKEN,resume:!!state.cursor,processed:state.processed,last_sync:state.last_completed_at})
    }
    if (role!=='admin') throw new AppError('Seul un administrateur peut modifier le catalogue.',403)
    const body=req.body
    if (!body || typeof body!=='object') throw new AppError('Formulaire invalide.')
    if (req.method==='POST' && body.action==='observe') {
      const {product,observation}=validateObservation(body)
      const {data,error}=await db.rpc('record_catalog_observation',{p_product:product,p_observation:observation,p_user:user.id})
      check(error); return res.json({saved:true,product_id:data})
    }
    if (req.method==='POST' && body.action==='sync') {
      if (!process.env.DOTB_API_TOKEN) throw new AppError('La connexion Dotb reste à configurer.',503)
      const lease=randomUUID(),now=new Date().toISOString()
      const {data:state,error}=await db.from('catalog_sync_state').update({lease,locked_until:new Date(Date.now()+45000).toISOString()})
        .eq('id',true).lt('locked_until',now).lte('next_allowed_at',now).select().maybeSingle()
      check(error)
      if (!state) throw new AppError('Un import est en cours. Réessayez dans quelques secondes.',409)
      try {
        if (!state.cursor) { const r=await db.from('catalog_sync_state').update({processed:0}).eq('lease',lease); check(r.error) }
        const page=await readDotbItems(state.cursor),items=normalizeDotbItems(page.data)
        const r=await db.rpc('import_catalog_dotb_page',{p_items:items,p_cursor:page.has_more?page.next_cursor:null,p_lease:lease})
        check(r.error)
        return res.json({has_more:page.has_more,processed:(state.cursor?state.processed:0)+items.length})
      } finally {
        await db.from('catalog_sync_state').update({lease:null,locked_until:new Date(0).toISOString(),next_allowed_at:new Date(Date.now()+1700).toISOString()}).eq('id',true).eq('lease',lease)
      }
    }
    if (req.method==='PATCH' && body.action==='link') {
      if (typeof body.sku!=='string' || !body.sku.trim() || body.sku.length>200 || (body.product_id!==null && !isId(body.product_id)) ||
        (body.updated_at!==null && !Number.isFinite(Date.parse(body.updated_at)))) throw new AppError('Association invalide.')
      const {error}=await db.rpc('link_catalog_sku',{p_sku:body.sku.trim(),p_product:body.product_id,p_updated:body.updated_at})
      if (error?.message?.includes('link_conflict')) throw new AppError('Cette association a changé. Actualisez avant de recommencer.',409)
      if (error?.message?.includes('sku_missing')) throw new AppError('Ce SKU n’est plus présent. Synchronisez les articles Dotb.',409)
      check(error)
      return res.json({saved:true})
    }
    throw new AppError('Action inconnue.')
  } catch (error) {
    const setup=['42P01','PGRST202','PGRST205'].includes(error.code)
    console.error('catalog_request_failed',{code:error.code||'unknown',status:error.status||500})
    return res.status(setup?503:error.status||500).json({error:setup?'Le catalogue est en cours d’activation. Réessayez dans un instant.':error instanceof AppError?error.message:'Impossible d’enregistrer. Vos données existantes sont conservées.'})
  }
}
