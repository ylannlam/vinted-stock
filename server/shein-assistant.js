import {AppError,isId} from './dotb.js'
import {readTrackingPeriod} from './tracking.js'
import {orderReference} from '../extensions/shein/orders-engine.js'
import {sheinAlerts} from '../src/lib/sheinAssistant.js'
import {readDailyPurchases} from './daily-purchases.js'
const check=r=>{if(r.error)throw r.error;return r.data}
const dateOK=s=>typeof s==='string'&&/^20\d{2}-\d{2}-\d{2}$/.test(s)&&Number.isFinite(Date.parse(s))&&new Date(s).toISOString().slice(0,10)===s
export async function sheinSyncContext(db,device,body,now=Date.now()) {
  const tracking=await readTrackingPeriod(db)
  const format=new Intl.DateTimeFormat('en-CA',{timeZone:tracking.time_zone,year:'numeric',month:'2-digit',day:'2-digit'})
  const start=format.format(new Date(tracking.starts_at)),today=format.format(new Date(now))
  if(!device.enabled)return {enabled:false,since_date:start}
  if(!body.run_id)return {enabled:device.enabled,since_date:start}
  if(!isId(body.run_id)||!['full','incremental','targeted','range'].includes(body.mode))throw new AppError('Synchronisation invalide.')
  const reference=body.mode==='targeted'?orderReference(body.reference):null
  if(body.mode==='targeted'&&!reference)throw new AppError('Numéro de commande invalide.')
  let from=body.mode==='incremental'?[start,format.format(new Date(now-7*86400000))].sort().at(-1):start,to=today
  if(body.mode==='range'){
    if(!dateOK(body.from_date)||!dateOK(body.to_date)||body.from_date<start||body.to_date>today||body.from_date>body.to_date)throw new AppError(`Choisis une période entre le ${start} et aujourd’hui.`)
    from=body.from_date;to=body.to_date
  }
  const existing=check(await db.from('shein_sync_runs').select('*').eq('id',body.run_id).maybeSingle())
  if(existing&&existing.collector_id!==device.id)throw new AppError('Synchronisation inaccessible.',403)
  if(existing?.finished_at)throw new AppError('Cette synchronisation est terminée. Relance-la.',409)
  if(!existing)check(await db.from('shein_sync_runs').insert({id:body.run_id,collector_id:device.id,mode:body.mode,from_date:from,to_date:to,reference}))
  const knownResult=body.mode==='incremental'?await db.from('shein_orders').select('ref,order_date,observed_at,shein_order_items(status,present)',{count:'exact'}).gte('order_date',start).order('order_date',{ascending:false}).limit(2000):{data:[],count:0}
  const knownRows=check(knownResult)||[]
  if(knownResult.count>knownRows.length)throw new AppError('Historique trop volumineux pour une lecture rapide. Lance une vérification complète.',409)
  const known=Object.fromEntries(knownRows.map(o=>[o.ref,{observed_at:o.observed_at,stable:o.shein_order_items.length>0&&o.shein_order_items.filter(i=>i.present).every(i=>['delivered','exception'].includes(i.status))}]))
  const pending=body.mode==='incremental'?knownRows.filter(o=>!known[o.ref].stable).map(o=>o.ref):[]
  return {enabled:device.enabled,since_date:existing?.from_date||from,until_date:existing?.to_date||to,known,pending_refs:pending}
}
export function syncReport(body) {
  const read=body.read??body.count,discovered=body.discovered??read
  if(!isId(body.run_id)||!Number.isInteger(read)||read<0||read>2000||!Number.isInteger(discovered)||discovered<read||discovered>2000||!Array.isArray(body.errors)||body.errors.length>200)throw new AppError('Bilan de synchronisation invalide.')
  return {read_count:read,discovered,errors:body.errors.map(e=>{
    if(e.ref!=null&&!orderReference(e.ref))throw new AppError('Référence du bilan invalide.')
    return {ref:e.ref||null,code:String(e.code||'unknown').slice(0,60),message:String(e.message||'Lecture à vérifier.').slice(0,300)}
  })}
}
export async function reportSheinSync(db,device,body) {
  const report=syncReport(body)
  if(!['running','blocked'].includes(body.state))throw new AppError('État de synchronisation invalide.')
  const row=check(await db.from('shein_sync_runs').update({...report,state:body.state,updated_at:new Date().toISOString()}).eq('id',body.run_id).eq('collector_id',device.id).is('finished_at',null).select('id').maybeSingle())
  if(!row)throw new AppError('Cette synchronisation est terminée.',409)
  return {saved:true}
}
export async function finishSheinSync(db,device,body) {
  if(!body.run_id){if(!Number.isInteger(body.count)||body.count<0||body.count>200)throw new AppError('Nombre de commandes invalide.');return {linked:check(await db.rpc('finish_shein_sync',{p_device:device.id,p_count:body.count}))}}
  const r=syncReport(body)
  return {linked:check(await db.rpc('finish_shein_sync_v2',{p_device:device.id,p_run:body.run_id,p_count:r.read_count,p_discovered:r.discovered,p_errors:r.errors,p_complete:body.complete===true}))}
}
export async function assistantSummary(db,query={}) {
  const [cart,runs]=await Promise.all([readDailyPurchases(db,query),db.from('shein_sync_runs').select('id,mode,state,discovered,read_count,errors,started_at,updated_at,finished_at').order('started_at',{ascending:false}).limit(5)])
  const history=check(runs)||[]
  return {cart,runs:history,alerts:sheinAlerts({cart,runs:history})}
}
