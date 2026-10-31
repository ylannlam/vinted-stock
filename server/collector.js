import { createHash, randomBytes, randomUUID, timingSafeEqual } from 'node:crypto'
import { createClient } from '@supabase/supabase-js'
import { AppError, isId } from './dotb.js'
import { sheinProduct, parsePrice } from '../src/lib/catalog.js'

export const tokenHash = value => createHash('sha256').update(value).digest('hex')
export function newCollectorToken() {
  const id = randomUUID(), token = `svpc_${id}.${randomBytes(32).toString('base64url')}`
  return { id, token, token_hash: tokenHash(token) }
}
export function readCollectorToken(value) {
  const match = typeof value === 'string' && value.match(/^Bearer (svpc_([0-9a-f-]{36})\.[A-Za-z0-9_-]{43})$/)
  return match && isId(match[2]) ? { token: match[1], id: match[2] } : null
}
export function sameToken(token, hash) {
  return typeof hash === 'string' && /^[a-f0-9]{64}$/.test(hash) && timingSafeEqual(Buffer.from(tokenHash(token),'hex'), Buffer.from(hash,'hex'))
}
export async function authorizeCollector(req) {
  const parsed = readCollectorToken(req.headers.authorization)
  if (!parsed) throw new AppError('Association du PC invalide. Associez à nouveau ce PC depuis le site.',401)
  const url = process.env.VITE_SUPABASE_URL, key = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !key) throw new AppError('La connexion au serveur reste à configurer.',503)
  const db = createClient(url,key,{auth:{persistSession:false,autoRefreshToken:false}})
  const {data:device,error} = await db.from('catalog_collectors').select('*').eq('id',parsed.id).maybeSingle()
  if (error) throw error
  if (!device || device.revoked_at || Date.parse(device.expires_at)<Date.now() || !sameToken(parsed.token,device.token_hash)) throw new AppError('Ce PC n’est plus autorisé. Associez-le à nouveau depuis le site.',401)
  const {data:owner,error:ownerError} = await db.from('profiles').select('role').eq('id',device.created_by).maybeSingle()
  if (ownerError) throw ownerError
  if (owner?.role !== 'admin') throw new AppError('Le compte ayant associé ce PC n’est plus administrateur.',403)
  return {db,device}
}
const clean = (value,max,name) => {
  if (value == null) return ''
  if (typeof value !== 'string' || value.length > max) throw new AppError(`${name} invalide.`)
  return value.trim()
}
function photo(value) {
  try {const u=new URL(value);return u.protocol==='https:' && !u.username && !u.password && !u.port && /(^|\.)ltwebstatic\.com$/.test(u.hostname) && u.href.length<=2000 ? u.href : null} catch{return null}
}
export function validateCollection(body,job,now=Date.now()) {
  if (!body || typeof body!=='object' || JSON.stringify(body).length>100000) throw new AppError('Fiche récupérée trop volumineuse.')
  const product=sheinProduct(body.supplier_url)
  if (!product || job.expected_supplier_id && product.supplier_id!==job.expected_supplier_id) throw new AppError('La page récupérée ne correspond pas au produit attendu.',409)
  const sku=clean(body.supplier_sku,200,'SKU'), title=clean(body.title,500,'Nom')
  if (!sku || !title || job.expected_sku && sku.toLowerCase()!==job.expected_sku.toLowerCase()) throw new AppError('Le SKU de la fiche Shein ne correspond pas au SKU demandé.',409)
  const at=Date.parse(body.observed_at)
  if (!Number.isFinite(at) || at>now+60000 || at<now-15*60000) throw new AppError('La récupération a expiré. Vérifiez à nouveau le produit.',409)
  const price=parsePrice(body.price), shown=parsePrice(body.price_text)
  if (body.currency!=='EUR' || price==null || Number.isNaN(price) || price!==shown || !/€|EUR/i.test(body.price_text||'')) throw new AppError('Le prix affiché en euros n’a pas pu être confirmé. La fiche reste à vérifier.',409)
  const color=clean(body.color,100,'Couleur')
  if (!color) throw new AppError('La couleur de la fiche est illisible. La comparaison de prix reste suspendue.',409)
  const images=[...new Set((Array.isArray(body.photos)?body.photos:[]).map(photo).filter(Boolean))].slice(0,15)
  const sizes=(Array.isArray(body.sizes)?body.sizes:[]).slice(0,50).map(s=>({size:clean(s.size,80,'Taille'),availability:['available','unavailable'].includes(s.availability)?s.availability:'unknown'})).filter(s=>s.size)
  const details=(Array.isArray(body.details)?body.details:[]).slice(0,50).map(row=>({name:clean(row.name,100,'Détail'),value:clean(row.value,1000,'Valeur')}))
  return {...product,supplier_sku:sku,title,price,currency:'EUR',color,photos:images,sizes,details,
    description:clean(body.description,20000,'Description'),observed_at:new Date(at).toISOString(),price_scope:'product',
    note:'Prix affiché sur la fiche pour cette couleur, avant sélection de taille et hors coupons du panier.'}
}
