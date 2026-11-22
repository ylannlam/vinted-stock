import { createClient } from '@supabase/supabase-js'
import { AppError } from '../server/dotb.js'

export const config={api:{bodyParser:false},maxDuration:15}

export default async function handler(req,res){
  res.setHeader('Cache-Control','no-store')
  if(req.method!=='POST'){res.setHeader('Allow','POST');return res.status(405).end()}
  if(req.query?.provider!=='scalency')return res.status(204).end()
  try{
    if(!req.headers['x-scalency-signature'])return res.status(401).end()
    const url=process.env.VITE_SUPABASE_URL,key=process.env.SUPABASE_SERVICE_ROLE_KEY
    if(!url||!key)throw new AppError('Connexion indisponible.',503)
    const db=createClient(url,key,{auth:{persistSession:false,autoRefreshToken:false}})
    const {receiveScalency}=await import('../server/scalency-webhook.js')
    return res.json(await receiveScalency(req,db))
  }catch(error){
    console.error('dotb_webhook_failed',{code:error.code||'unknown',status:error.status||500})
    return res.status(error.status||503).json({error:error instanceof AppError?error.message:'Réception à réessayer.'})
  }
}
