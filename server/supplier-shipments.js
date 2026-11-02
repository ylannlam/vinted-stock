import {AppError,isId} from './dotb.js'
import {shipmentInput} from '../src/lib/shipments.js'
const fail=e=>{if(e)throw e}
const clean=(v,n=500)=>typeof v==='string'?v.replace(/<[^>]*>/g,'').trim().slice(0,n):''
const GOFO_URL='https://www.gofo.com/fr/open-api/official/track/queryTrackV2'
// Public GOFO tracking contract, checked against their tracking-results.js.
// Keep only parcel events; never retain recipient details, POD, phone or address.
export function parseGofo(payload,number){
  const rows=Array.isArray(payload)?payload:payload?.data
  if(!Array.isArray(rows))throw Error('invalid_tracking_response')
  const matching=rows.filter(r=>[r.trackingNumber,r.waybillNo].some(v=>typeof v==='string'&&v.toUpperCase()===number))
  if(matching.length!==1||matching[0].status==='Not Found')return null
  const r=matching[0],code=String(r.lastTrackEvent?.processCode??'')
  const status=({'100':'in_transit','200':'processing','201':'processing','202':'processing','203':'processing','208':'processing','205':'delivered','206':'exception','204':'exception','300':'exception','301':'exception','257':'returned','264':'returned'})[code]||'pending'
  const events=(Array.isArray(r.trackEventList)?r.trackEventList:[]).slice(0,50).map(e=>({date:clean(e.processDate,80),text:clean(e.processContent||e.mainContent)})).filter(e=>e.text)
  if(!events.length&&status==='pending')return null
  return {status,events}
}
export async function refreshShipment(db,id,{fetcher=fetch,now=Date.now}={}){
  if(!isId(id))throw new AppError('Colis invalide.')
  const stamp=new Date(now()).toISOString(),lease=crypto.randomUUID()
  const claim=await db.from('supplier_shipments').update({lease,refresh_after:new Date(now()+15*60000).toISOString()}).eq('id',id).eq('carrier','gofo').lte('refresh_after',stamp).select('*').maybeSingle();fail(claim.error)
  if(!claim.data)return {refreshed:false}
  let patch
  try{
    const response=await fetcher(GOFO_URL,{method:'POST',headers:{'Content-Type':'application/json',lang:'fr'},body:JSON.stringify({numberList:[claim.data.tracking_number]}),redirect:'error',signal:AbortSignal.timeout(8000)})
    if(!response.ok)throw Error('carrier_unavailable')
    const raw=await response.text();if(raw.length>250000)throw Error('response_too_large')
    const result=parseGofo(JSON.parse(raw),claim.data.tracking_number)
    patch=result?{...result,observed_at:stamp,last_error:null}:{last_error:'GOFO ne fournit pas encore de suivi pour ce numéro. Vérifie le numéro ou consulte Shein ; le dernier relevé est conservé.'}
  }catch{patch={last_error:'GOFO est indisponible pour le moment. Le dernier relevé est conservé ; nouvel essai dans 15 minutes.'}}
  const saved=await db.from('supplier_shipments').update({...patch,checked_at:stamp,updated_at:new Date(now()).toISOString(),lease:null}).eq('id',id).eq('lease',lease);fail(saved.error)
  return {refreshed:true}
}
export async function readShipments(db,query={}){
  if(query.line!=null&&(typeof query.line!=='string'||!query.line||query.line.length>80))throw new AppError('Vente invalide.')
  const page=Number(query.page||0);if(!Number.isSafeInteger(page)||page<0||page>10000)throw new AppError('Page invalide.')
  let q=db.from('workspace_supplier_shipments').select('*',{count:'exact'}).order('created_at',{ascending:false}).order('id')
  if(query.line)q=q.contains('line_ids',[query.line])
  const r=await q.range(page*30,page*30+29);fail(r.error)
  return {shipments:r.data,count:r.count,page,page_size:30}
}
export async function saveShipment(db,body,user){
  let fields;try{fields=shipmentInput(body)}catch(e){throw new AppError(e.message)}
  if(body.id!=null&&(!isId(body.id)||!Number.isFinite(Date.parse(body.updated_at))))throw new AppError('Colis périmé. Actualise la liste.')
  const lines=body.lines||[]
  if(!Array.isArray(lines)||lines.length>100||(!body.id&&!lines.length)||new Set(lines.map(l=>l?.id)).size!==lines.length||lines.some(l=>typeof l?.id!=='string'||!l.id||l.id.length>80||!Number.isFinite(Date.parse(l.updated_at))))throw new AppError('Sélection de ventes invalide. Actualise la liste.')
  const r=await db.rpc('save_supplier_shipment',{p_id:body.id||null,p_version:body.updated_at||null,p_fields:fields,p_lines:lines,p_user:user});fail(r.error)
  return {id:r.data,saved:true}
}
