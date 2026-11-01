import {authorize} from '../server/auth.js'
import {AppError} from '../server/dotb.js'
import {readPage} from '../server/pagination.js'
import {readDotbAccounts,selectionValue,directionValue} from '../server/creative-accounts.js'
export const config={maxDuration:30}
const check=error=>{if(error)throw error}
export function creativeAccountsHandler(authorizer=authorize,readAccounts=readDotbAccounts) {
 return async function handler(req,res) {
  res.setHeader('Cache-Control','no-store')
  if(!['GET','POST','PATCH'].includes(req.method)){res.setHeader('Allow','GET, POST, PATCH');return res.status(405).end()}
  try {
   const auth=await authorizer(req,res,['admin']);if(!auth)return
   const {db}=auth
   if(req.method==='GET'){
    const offset=Number(req.query?.offset||0)
    if(!Number.isSafeInteger(offset)||offset<0||offset>100000)throw new AppError('Page invalide.')
    const page=await readPage(head=>db.from('creative_accounts').select('*',{count:'exact',head}).order('login').order('id'),offset,250)
    return res.json({accounts:page.data,count:page.count,page_size:250})
   }
   const body=req.body
   if(!body||typeof body!=='object')throw new AppError('Formulaire invalide.')
   if(req.method==='POST'&&body.action==='sync'){
    const accounts=await readAccounts()
    const result=await db.rpc('sync_creative_accounts',{p_accounts:accounts});check(result.error)
    return res.json({synced:true,count:accounts.length})
   }
   if(req.method==='PATCH'&&body.action==='select'){
    const changes=selectionValue(body.changes)
    const result=await db.rpc('select_creative_accounts',{p_changes:changes});check(result.error)
    return res.json({saved:true})
   }
   if(req.method==='PATCH'&&body.action==='save'){
    const patch=directionValue(body)
    if(patch.background_id){
     const bg=await db.from('creative_resources').select('id,kind,archived_at').eq('id',patch.background_id).maybeSingle();check(bg.error)
     if(!bg.data||bg.data.kind!=='background'||bg.data.archived_at)throw new AppError('Ce fond est supprimé ou archivé. Choisis un autre fond.')
    }
    const result=await db.from('creative_accounts').update({...patch,version:body.version+1,updated_at:new Date().toISOString()}).eq('id',body.id).eq('version',body.version).select().maybeSingle();check(result.error)
    if(!result.data)throw new AppError('Ce compte a changé. Actualise avant de réessayer ; tes textes restent dans le formulaire.',409)
    return res.json({saved:true,account:result.data})
   }
   throw new AppError('Action inconnue.')
  }catch(error){
   const stale=error.message?.includes('stale_account')
   console.error('creative_accounts_failed',{code:error.code||'unknown',status:error.status||500})
   return res.status(stale?409:error.status||500).json({error:stale?'La sélection a changé dans un autre onglet. Actualise avant de réessayer.':error instanceof AppError?error.message:'Impossible d’enregistrer pour le moment. Tes choix et tes DA sont conservés.'})
  }
 }
}
export default creativeAccountsHandler()
