import { createClient } from '@supabase/supabase-js'
import { AppError } from '../server/dotb.js'
import { verifyDotbWebhook, receiveOrderEvent } from '../server/sales-automation.js'
import { receiveNotification } from '../server/account-health.js'

export const config={api:{bodyParser:false},maxDuration:15}

export default async function handler(req,res){
  res.setHeader('Cache-Control','no-store')
  if(req.method!=='POST'){res.setHeader('Allow','POST');return res.status(405).end()}
  try{
    if(!req.headers['webhook-signature'])throw new AppError('Signature requise.',401)
    const chunks=[];let size=0
    for await(const chunk of req){size+=Buffer.byteLength(chunk);if(size>262144)throw new AppError('Événement trop volumineux.',413);chunks.push(Buffer.from(chunk))}
    const url=process.env.VITE_SUPABASE_URL,key=process.env.SUPABASE_SERVICE_ROLE_KEY
    if(!url||!key)throw new AppError('Connexion indisponible.',503)
    const db=createClient(url,key,{auth:{persistSession:false,autoRefreshToken:false}})
    const state=await db.from('dotb_sales_automation').select('enabled,signing_secret').eq('id',true).single()
    if(state.error)throw state.error
    if(!state.data.enabled||!state.data.signing_secret)throw new AppError('Connexion inactive.',503)
    const event=verifyDotbWebhook(Buffer.concat(chunks),req.headers,state.data.signing_secret)
    if(event.type==='notification.created')return res.json(await receiveNotification(db,event.notification))
    return res.json(await receiveOrderEvent(db,event))
  }catch(error){
    console.error('dotb_webhook_failed',{code:error.code||'unknown',status:error.status||500})
    return res.status(error.status||503).json({error:error instanceof AppError?error.message:'Réception à réessayer.'})
  }
}
