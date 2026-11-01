import { authorize } from '../server/auth.js'
import { AppError, isId } from '../server/dotb.js'
import { validateObservation, validateSupplierAssociation } from '../server/catalog.js'
import { readPage } from '../server/pagination.js'
import {readTrackingPeriod} from '../server/tracking.js'

export const config = { maxDuration: 60 }
const check = error => { if (error) throw error }
export default async function handler(req, res) {
  if (!['GET','POST','PATCH'].includes(req.method)) { res.setHeader('Allow','GET, POST, PATCH'); return res.status(405).end() }
  try {
    const auth = await authorize(req,res,['admin','stock'])
    if (!auth) return
    const { db,user,role } = auth
    const tracking=await readTrackingPeriod(db)
    if (req.method === 'GET') {
      if (req.query?.product_id) {
        if (!isId(req.query.product_id)) throw new AppError('Produit invalide.')
        const { data,error,count } = await db.from('catalog_observations').select('*',{count:'exact'})
          .eq('product_id',req.query.product_id).order('observed_at',{ascending:false}).order('created_at',{ascending:false}).order('id',{ascending:false}).limit(200)
        check(error); return res.json({ observations:data,count })
      }
      const offset=Number(req.query?.offset || 0)
      if (!Number.isSafeInteger(offset) || offset<0 || offset>1000000) throw new AppError('Page invalide.')
      const [products,items,links,sales] = await Promise.all([
        readPage(head=>db.from('catalog_tracked_products').select('*',{count:'exact',head}).order('created_at',{ascending:false}).order('id'),offset),
        readPage(head=>db.from('catalog_sales_items').select('*',{count:'exact',head}).order('id'),offset),
        readPage(head=>db.from('catalog_tracked_links').select('*',{count:'exact',head}).order('sku'),offset),
        readPage(head=>db.from('catalog_sales_by_sku').select('*',{count:'exact',head}).order('sku').order('currency'),offset),
      ])
      return res.json({products:products.data,items:items.data,links:links.data,sales:sales.data,tracking,sales_count:sales.count,product_count:products.count,item_count:items.count,link_count:links.count,
        connected:!!process.env.DOTB_API_TOKEN,sales_only:true})
    }
    if (role!=='admin') throw new AppError('Seul un administrateur peut modifier le catalogue.',403)
    const body=req.body
    if (!body || typeof body!=='object') throw new AppError('Formulaire invalide.')
    if(req.method==='POST' && body.action==='supplier') {
      const product=validateSupplierAssociation(body)
      const {data,error}=await db.rpc('create_catalog_product_for_sku',{p_sku:product.sku,p_supplier_id:product.supplier_id,p_supplier_url:product.supplier_url,p_updated:body.updated_at})
      if(error?.message?.includes('link_conflict'))throw new AppError('Cette association a changé. Actualisez avant de recommencer.',409)
      if(error?.message?.includes('sku_missing'))throw new AppError('Ce SKU ne correspond à aucune vente suivie.',409)
      check(error);return res.json({saved:true,product_id:data})
    }
    if (req.method==='POST' && body.action==='observe') {
      const {product,observation}=validateObservation(body)
      const {data,error}=await db.rpc('record_catalog_observation',{p_product:product,p_observation:observation,p_user:user.id})
      check(error); return res.json({saved:true,product_id:data})
    }
    if (req.method==='POST' && body.action==='sync') throw new AppError('Le catalogue se remplit automatiquement à partir des ventes. L’import de toutes les annonces a été retiré.',410)
    if (req.method==='PATCH' && body.action==='link') {
      if (typeof body.sku!=='string' || !body.sku.trim() || body.sku.length>200 || (body.product_id!==null && !isId(body.product_id)) ||
        (body.updated_at!==null && !Number.isFinite(Date.parse(body.updated_at)))) throw new AppError('Association invalide.')
      const {error}=await db.rpc('link_catalog_sku',{p_sku:body.sku.trim(),p_product:body.product_id,p_updated:body.updated_at})
      if (error?.message?.includes('link_conflict')) throw new AppError('Cette association a changé. Actualisez avant de recommencer.',409)
      if (error?.message?.includes('sku_missing')) throw new AppError('Ce SKU ne correspond à aucune vente suivie.',409)
      check(error)
      return res.json({saved:true})
    }
    throw new AppError('Action inconnue.')
  } catch (error) {
    if(error.message?.includes('unsold_reference'))return res.status(409).json({error:'Seuls les articles ayant une vente depuis le début du suivi peuvent être enregistrés.'})
    const setup=['42P01','PGRST202','PGRST205'].includes(error.code)
    console.error('catalog_request_failed',{code:error.code||'unknown',status:error.status||500})
    return res.status(setup?503:error.status||500).json({error:setup?'Le catalogue est en cours d’activation. Réessayez dans un instant.':error instanceof AppError?error.message:'Impossible d’enregistrer. Vos données existantes sont conservées.'})
  }
}
