import {createHash} from 'node:crypto'
import {AppError} from './dotb.js'
import {sheinProduct} from '../src/lib/catalog.js'

const check=error=>{if(error)throw error}
const clean=(value,max=200)=>typeof value==='string'?value.trim().slice(0,max):''
export const orderStatus=value=>{
  const s=clean(value).normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase()
  if(/annul|rembours|retourne|retour en cours/.test(s))return 'exception'
  if(/non pay|attente de paiement|a payer/.test(s))return 'unpaid'
  if(/^(livre[es]*|recu[es]*|livraison effectuee|delivered)$/.test(s))return 'delivered'
  if(/^(expedie[es]*|en transit|shipped)$/.test(s))return 'shipped'
  if(/^(emballage|en traitement|en cours de traitement|traitement|en preparation|paye[es]*)$/.test(s))return 'processing'
  return 'unknown'
}
export function validateSheinOrder(body,now=Date.now()) {
  if(!body||JSON.stringify(body).length>150000||!/^G[A-Z0-9]{7,39}$/.test(body.ref||''))throw new AppError('Commande Shein illisible.')
  const at=Date.parse(body.observed_at)
  if(!Number.isFinite(at)||at>now+60000||at<now-24*3600000)throw new AppError('Le relevé a expiré. Relance la lecture des commandes.',409)
  if(!/^20\d{2}-\d{2}-\d{2}$/.test(body.order_date||'')||!Number.isFinite(Date.parse(body.order_date))||new Date(body.order_date).toISOString().slice(0,10)!==body.order_date||Date.parse(body.order_date)>now+86400000)throw new AppError('Date de commande illisible.')
  if(!Array.isArray(body.items)||!body.items.length||body.items.length>200)throw new AppError('Articles de la commande illisibles.')
  const grouped=new Map()
  for(const row of body.items) {
    const sku=clean(row.sku),product=sheinProduct(row.product_url),size=clean(row.size,80),color=clean(row.color,80)
    if(!/^[a-z0-9_-]{1,200}$/i.test(sku)||!product||!Number.isInteger(row.quantity)||row.quantity<1||row.quantity>100)throw new AppError('Quantité ou référence Shein illisible.')
    const status=orderStatus(row.status_text)
    const key=createHash('sha256').update(JSON.stringify([sku.toLowerCase(),product.supplier_id,size.toLowerCase(),color.toLowerCase()])).digest('hex')
    const id=body.ref+':'+key
    let photo=null;try{const u=new URL(row.photo);if(u.protocol==='https:'&&!u.username&&!u.password&&!u.port&&/(^|\.)ltwebstatic\.com$/.test(u.hostname))photo=u.href.slice(0,2000)}catch{}
    // The order column says "Montant". Only a one-unit row proves its unit cost.
    const unit_price=row.quantity===1&&typeof row.unit_price==='number'&&Number.isFinite(row.unit_price)&&row.unit_price>=0&&row.unit_price<=100000?row.unit_price:null
    const current=grouped.get(id)||{id,sku,product_url:product.supplier_url,supplier_id:product.supplier_id,title:clean(row.title,500),size,color,photo,eta:clean(row.eta,150),quantity:0,unit_price,paid_amounts:[],statuses:[],status_texts:[]}
    current.quantity+=row.quantity
    if(current.quantity>200)throw new AppError('Quantité de commande trop élevée.')
    if(current.unit_price!==unit_price)current.unit_price=null
    current.paid_amounts.push(...Array(row.quantity).fill(unit_price))
    current.statuses.push(status)
    current.status_texts.push(clean(row.status_text,200))
    grouped.set(id,current)
  }
  const items=[...grouped.values()].map(({statuses,status_texts,...item})=>({...item,status_text:[...new Set(status_texts)].join(' · ').slice(0,500),status:statuses.includes('exception')?'exception':statuses.every(s=>s==='delivered')?'delivered':statuses.every(s=>['shipped','delivered'].includes(s))?'shipped':statuses.every(s=>['processing','shipped','delivered'].includes(s))?'processing':statuses.includes('unpaid')?'unpaid':'unknown'}))
  const parcels=(Array.isArray(body.parcels)?body.parcels:[]).slice(0,30).filter(p=>/^[A-Z0-9-]{6,40}$/i.test(p.tracking_number||'')&&/\d/.test(p.tracking_number)).map(p=>({tracking_number:p.tracking_number.toUpperCase(),carrier:clean(p.carrier,60),status_text:clean(p.status_text,200),eta:clean(p.eta,150),skus:[...new Set((Array.isArray(p.skus)?p.skus:[]).filter(sku=>items.some(i=>i.sku===sku)))],observed_at:new Date(at).toISOString()}))
  const validMoney=n=>typeof n==='number'&&Number.isFinite(n)&&n>=0&&n<=100000&&Math.abs(n*100-Math.round(n*100))<1e-7
  const p=body.payment
  // A displayed total on an unpaid/unclear order is not evidence of payment.
  const payment=p?.source==='order_summary'&&p.currency==='EUR'&&validMoney(p.paid_total)&&items.every(i=>['processing','shipped','delivered'].includes(i.status))?{paid_total:p.paid_total,shipping:validMoney(p.shipping)?p.shipping:null,currency:'EUR',source:'order_summary',observed_at:new Date(at).toISOString()}:null
  return {ref:body.ref,order_date:body.order_date,observed_at:new Date(at).toISOString(),items,parcels,payment}
}
export async function importSheinOrder(db,device,body) {
  if(!device.enabled)throw new AppError('Ce navigateur est en pause sur le site.',409)
  const order=validateSheinOrder(body)
  const r=await db.rpc('import_shein_order_v2',{p_order:order,p_device:device.id})
  if(r.error?.message?.includes('order_outside_period'))throw new AppError('Cette commande est antérieure au début de ton suivi.',409)
  check(r.error)
  return {saved:true}
}
export async function readSheinOrders(db,query={}) {
  const page=Number(query.page||0)
  if(!Number.isSafeInteger(page)||page<0||page>10000)throw new AppError('Page invalide.')
  const [orders,meta,runs,tracking]=await Promise.all([
    db.from('shein_orders').select('ref,order_date,observed_at,updated_at,shipment_observations,payment,shein_order_items(*)',{count:'exact'}).order('order_date',{ascending:false}).order('ref').range(page*20,page*20+19),
    db.from('shein_sync_state').select('last_completed_at,orders_read,linked_count').eq('id',true).maybeSingle(),
    db.from('shein_sync_runs').select('id,mode,state,from_date,to_date,reference,discovered,read_count,errors,started_at,updated_at,finished_at').order('started_at',{ascending:false}).limit(10),
    db.from('dotb_tracking_period').select('starts_at,time_zone').limit(1).single()
  ]);[orders,meta,runs,tracking].forEach(r=>check(r.error))
  const ids=orders.data.flatMap(o=>o.shein_order_items.map(i=>i.id))
  const links=ids.length?await db.from('shein_order_links').select('line_id,item_id,origin,created_at').in('item_id',ids):{data:[]};check(links.error)
  const skus=[...new Set(orders.data.flatMap(o=>o.shein_order_items.map(i=>i.sku.toLowerCase())))].slice(0,200)
  const lines=skus.length?await db.rpc('shein_sale_choices',{p_skus:skus}):{data:[]};check(lines.error)
  const lineIds=(lines.data||[]).map(l=>l.id)
  const finances=lineIds.length?await db.from('workspace_sales').select('id,currency,actual_cost,fees_amount,refund_amount,source,supplier_order_ref').in('id',lineIds):{data:[]};check(finances.error)
  return {orders:orders.data.map(({shein_order_items,...o})=>({...o,items:shein_order_items.map(item=>({...item,links:links.data.filter(l=>l.item_id===item.id)}))})),lines:(lines.data||[]).map(l=>{const f=finances.data.find(f=>f.id===l.id);return {...l,order_ref:f?.supplier_order_ref,currency:f?.currency,actual_cost:f?.actual_cost,selling_price:f?.source?.selling_price,fees_amount:f?.fees_amount,refund_amount:f?.refund_amount}}),count:orders.count,sync:meta.data,runs:runs.data,tracking:tracking.data}
}
export async function reviewSheinOrder(db,body,user) {
  if(!['link','unlink','confirm_received'].includes(body.operation)||typeof body.line_id!=='string'||body.line_id.length>80||typeof body.item_id!=='string'||body.item_id.length>110||!Number.isFinite(Date.parse(body.updated_at)))throw new AppError('Association invalide.')
  if(body.operation==='link'&&body.confirm_variant!==true)throw new AppError('Confirme la taille et la couleur de cet article.')
  const r=await db.rpc('review_shein_order',{p_operation:body.operation,p_item:body.item_id,p_line:body.line_id,p_version:body.updated_at,p_user:user});check(r.error)
  return {saved:true}
}
