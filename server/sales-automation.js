import { createHmac, timingSafeEqual, randomUUID } from 'node:crypto'
import { AppError, isId, normalizeOrders } from './dotb.js'

export const WEBHOOK_URL = 'https://vinted-stock.vercel.app/api/dotb-webhook'
export const ORDER_EVENTS = ['order.created','order.status_changed','order.claim_opened']
const check = error => { if(error) throw error }

export function verifyDotbWebhook(raw, headers, secret, now = Date.now()) {
  const id=headers['webhook-id'], timestamp=headers['webhook-timestamp'], signatures=headers['webhook-signature']
  if(typeof id!=='string'||!id||id.length>200||typeof timestamp!=='string'||!/^\d+$/.test(timestamp)||
    Math.abs(now/1000-Number(timestamp))>300||typeof signatures!=='string'||signatures.length>2000||
    typeof secret!=='string'||!/^whsec_[A-Za-z0-9+/=]+$/.test(secret)) throw new AppError('Signature invalide.',401)
  const expected=createHmac('sha256',Buffer.from(secret.slice(6),'base64')).update(`${id}.${timestamp}.`).update(raw).digest()
  const valid=signatures.split(/\s+/).some(part=>{
    if(!part.startsWith('v1,'))return false
    const signature=Buffer.from(part.slice(3),'base64')
    return signature.length===expected.length&&timingSafeEqual(expected,signature)
  })
  if(!valid)throw new AppError('Signature invalide.',401)
  let event
  try { event=JSON.parse(raw.toString('utf8')) } catch { throw new AppError('Événement invalide.') }
  if(!isId(event?.id)||event.api_version!=='v1'||!Number.isFinite(Date.parse(event.created_at)))throw new AppError('Événement invalide.')
  if(event.type==='webhook.test')return {id:event.id,type:event.type,created_at:event.created_at,order_id:null}
  if(!ORDER_EVENTS.includes(event.type))throw new AppError('Événement non pris en charge.')
  const orderId=event.data?.order_id??event.data?.order?.id??event.data?.id
  if(!isId(orderId))throw new AppError('Identifiant de vente absent.')
  return {id:event.id,type:event.type,created_at:event.created_at,order_id:orderId}
}

export async function dotbRequest(path,{method='GET',body,fetcher=fetch,token=process.env.DOTB_API_TOKEN,timeout=5000}={}) {
  if(!token)throw new AppError('La connexion Dotb reste à activer.',503)
  let response
  try { response=await fetcher(`https://dotb.io/api/public/v1/${path}`,{method,headers:{Authorization:`Bearer ${token}`,Accept:'application/json',...(body?{'Content-Type':'application/json'}:{})},body:body?JSON.stringify(body):undefined,redirect:'error',signal:AbortSignal.timeout(timeout)}) }
  catch {throw new AppError('Dotb ne répond pas. La réception sera réessayée.',503)}
  if(!response.ok)throw new AppError(response.status===403?'La clé Dotb doit autoriser la lecture des ventes et la gestion des webhooks.':response.status===409?'Dotb a atteint sa limite de connexions automatiques.':response.status===429?'Dotb demande de patienter avant le prochain essai.':'La connexion automatique à Dotb a échoué.',response.status===429?429:502)
  if(response.status===204)return null
  return response.json()
}

export async function receiveOrderEvent(db,event,{fetcher=fetch,token=process.env.DOTB_API_TOKEN}={}) {
  const existing=await db.from('dotb_received_events').select('id').eq('id',event.id).maybeSingle();check(existing.error)
  if(existing.data)return {received:true,duplicate:true}
  const fetchedAt=new Date().toISOString()
  let normalized={orders:[],lines:[]}
  if(event.order_id){
    const order=await dotbRequest(`orders/${event.order_id}?include=items,account`,{fetcher,token})
    if(order?.id!==event.order_id)throw new AppError('La vente reçue ne correspond pas à la vente demandée.',502)
    normalized=normalizeOrders([order],fetchedAt)
  }
  const saved=await db.rpc('receive_dotb_order_event',{p_event:event,p_orders:normalized.orders,p_lines:normalized.lines});check(saved.error)
  return {received:true,duplicate:!saved.data}
}

export async function automationStatus(db) {
  const r=await db.from('dotb_sales_automation').select('endpoint_id,enabled,last_received_at,last_error').eq('id',true).single();check(r.error)
  return {enabled:!!r.data.enabled,configured:!!r.data.endpoint_id,last_received_at:r.data.last_received_at,error:r.data.last_error}
}

export async function enableSalesAutomation(db,options={}) {
  const lease=randomUUID(),now=new Date().toISOString()
  const locked=await db.from('dotb_sales_automation').update({lease,locked_until:new Date(Date.now()+30000).toISOString()})
    .eq('id',true).lt('locked_until',now).select('*').maybeSingle();check(locked.error)
  if(!locked.data)throw new AppError('La connexion est en cours. Réessaie dans quelques secondes.',409)
  const current=locked.data
  let created=null,saved=false
  try{
    const list=await dotbRequest('webhook-endpoints',options)
    if(!Array.isArray(list?.data))throw new AppError('Réponse Dotb inattendue.',502)
    let endpoint=list.data.find(e=>e.id===current.endpoint_id&&e.url===WEBHOOK_URL)
    if(endpoint&&current.signing_secret){
      endpoint=await dotbRequest(`webhook-endpoints/${endpoint.id}`,{...options,method:'PATCH',body:{status:'enabled',event_types:ORDER_EVENTS}})
    }else{
      if(list.data.some(e=>e.url===WEBHOOK_URL))throw new AppError('Une connexion existe déjà pour ce site. Son association doit être réparée.',409)
      endpoint=await dotbRequest('webhook-endpoints',{...options,method:'POST',body:{url:WEBHOOK_URL,event_types:ORDER_EVENTS,description:'Stock Vinted · réception automatique des ventes'}})
      if(!isId(endpoint?.id)||!/^whsec_[A-Za-z0-9+/=]+$/.test(endpoint.secret||''))throw new AppError('Association Dotb incomplète.',502)
      created=endpoint
    }
    const result=await db.from('dotb_sales_automation').update({endpoint_id:endpoint.id,signing_secret:created?.secret||current.signing_secret,enabled:true,last_error:null}).eq('id',true).eq('lease',lease).select('id').single();check(result.error);saved=true
    return {enabled:true}
  }catch(error){
    if(created&&!saved)await dotbRequest(`webhook-endpoints/${created.id}`,{...options,method:'DELETE'}).catch(()=>{})
    await db.from('dotb_sales_automation').update({last_error:error instanceof AppError?error.message:'La connexion automatique doit être réessayée.'}).eq('id',true).eq('lease',lease)
    throw error
  }finally{
    await db.from('dotb_sales_automation').update({lease:null,locked_until:new Date(0).toISOString()}).eq('id',true).eq('lease',lease)
  }
}
