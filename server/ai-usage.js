// Onglet « Dépenses IA » de l'atelier : coût des rédactions d'annonces, calculé avec les tarifs enregistrés.
import {AppError} from './dotb.js'
import {readBoardRows} from './team-board.js'
import {summarizeAiUsage} from '../src/lib/aiUsage.js'
const check=r=>{if(r.error)throw r.error;return r.data}
const missing=e=>['42P01','PGRST205'].includes(e?.code)
export const AI_PERIODS=[7,30,90]

export async function readAiUsage(db,query){
 const days=Number(query?.days||30)
 if(!AI_PERIODS.includes(days))throw new AppError('Période invalide.')
 const since=new Date(Date.now()-days*86400000).toISOString()
 let rows,prices
 try{
  ;[rows,prices]=await Promise.all([
   readBoardRows(()=>db.from('ai_usage').select('created_at,model,input_tokens,output_tokens,account_id',{count:'exact'}).gte('created_at',since).order('id')),
   db.from('ai_prices').select('*').order('model').then(check)
  ])
 }catch(e){if(missing(e))return {ready:false,...summarizeAiUsage([],[],{days})};throw e}
 const ids=[...new Set(rows.map(r=>r.account_id).filter(Boolean))]
 const accounts=ids.length?check(await db.from('publication_accounts').select('id,login').in('id',ids)):[]
 return {ready:true,...summarizeAiUsage(rows,prices,{days,logins:new Map(accounts.map(a=>[a.id,a.login]))})}
}

export async function saveAiPrice(db,body){
 const model=typeof body?.model==='string'?body.model.trim():''
 const value=v=>{const n=Number(String(v).replace(',','.'));return Number.isFinite(n)&&n>=0&&n<1000?n:null}
 const input=value(body?.input_per_million),output=value(body?.output_per_million)
 if(!model||model.length>100||input==null||output==null)throw new AppError('Indique un modèle et deux tarifs en dollars par million de jetons (entre 0 et 1000).')
 return check(await db.from('ai_prices').upsert({model,input_per_million:input,output_per_million:output,updated_at:new Date().toISOString()}).select().single())
}
