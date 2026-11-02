import {authorize} from '../server/auth.js'
import {AppError} from '../server/dotb.js'
import {readPage} from '../server/pagination.js'
import {workspaceErrors} from '../server/workspace.js'
const check=r=>{if(r.error)throw r.error;return r.data}
export function workspaceHandler(authorizer=authorize) {
 return async(req,res)=>{
  if(!['GET','PATCH'].includes(req.method)){res.setHeader('Allow','GET, PATCH');return res.status(405).end()}
  try {
   const auth=await authorizer(req,res,['admin','stock']);if(!auth)return
   const {db,role,user}=auth,view=req.query?.view||'overview'
   if(req.method==='PATCH'){
    const {kind,id}=req.body||{}
    if(req.body?.action!=='restore'||!['items','commandes','vinted_accounts'].includes(kind)||typeof id!=='string'||!/^[0-9a-f-]{36}$/i.test(id))throw new AppError('Restauration invalide.')
    if(kind==='vinted_accounts'&&role!=='admin')throw new AppError('Action réservée aux administrateurs.',403)
    // Execute through the user's JWT so the same RLS policies protect the RPC.
    const {createClient}=await import('@supabase/supabase-js')
    const client=createClient(process.env.VITE_SUPABASE_URL,process.env.VITE_SUPABASE_ANON_KEY||process.env.SUPABASE_SERVICE_ROLE_KEY,{global:{headers:{Authorization:req.headers.authorization}},auth:{persistSession:false,autoRefreshToken:false}})
    if(kind==='vinted_accounts'){
     const result=await client.from(kind).update({deleted_at:null}).eq('id',id).not('deleted_at','is',null).select('id').maybeSingle();check(result)
     return res.json({restored:!!result.data})
    }
    const data=check(await client.rpc('set_stock_trash',{p_kind:kind,p_id:id,p_restore:true}))
    return res.json({...data,restored:true})
   }
   if(view==='overview'){
    const data=check(await db.rpc('workspace_overview'))
    if(role!=='admin')delete data.directions
    return res.json(data)
   }
   if(view==='actions'){
    const category=req.query?.category||'all',page=Number(req.query?.page||0)
    if(!['all','missing_sku','shein','purchase','receive','prepare','ship','review'].includes(category)||!Number.isSafeInteger(page)||page<0||page>20000)throw new AppError('Filtre invalide.')
    return res.json(check(await db.rpc('workspace_actions',{p_category:category,p_page:page})))
   }
   if(view==='finance'){
    if(role!=='admin')throw new AppError('Action réservée aux administrateurs.',403)
    const month=req.query?.month||'',page=Number(req.query?.page||0)
    if(!Number.isSafeInteger(page)||page<0||page>20000||typeof month!=='string'||!/^$|^\d{4}-(0[1-9]|1[0-2])$/.test(month))throw new AppError('Période invalide.')
    return res.json(check(await db.rpc('workspace_finance',{p_month:month,p_page:page})))
   }
   const page=Number(req.query?.page||0)
   if(!Number.isSafeInteger(page)||page<0||page>20000)throw new AppError('Page invalide.')
   if(view==='activity'){
    const result=await readPage(head=>{
     let q=db.from('workspace_events').select('id,entity,entity_id,label,action,actor_name,changes,created_at',{count:'exact',head})
     if(role!=='admin')q=q.in('entity',['items','commandes','sales_lines'])
     return q.order('id',{ascending:false})
    },page*50,50)
    return res.json({rows:result.data,count:result.count,page,page_size:50})
   }
   if(view==='trash'){
    const kind=req.query?.kind||'items'
    if(!['items','commandes','vinted_accounts'].includes(kind))throw new AppError('Corbeille invalide.')
    if(kind==='vinted_accounts'&&role!=='admin')throw new AppError('Action réservée aux administrateurs.',403)
    const columns={items:'id,size,emplacement,status,photo_url,deleted_at,commande_id',commandes:'id,tracking_number,status,deleted_at',vinted_accounts:'id,pseudo,deleted_at'}[kind]
    const result=await readPage(head=>db.from(kind).select(columns,{count:'exact',head}).not('deleted_at','is',null).order('deleted_at',{ascending:false}).order('id'),page*50,50)
    return res.json({rows:result.data,count:result.count,page,page_size:50})
   }
   throw new AppError('Vue inconnue.')
  }catch(e){
   console.error('workspace_failed',{code:e.code||'unknown',status:e.status||500})
   const key=Object.keys(workspaceErrors).find(k=>e.message?.includes(k))
   return res.status(key?409:e.status||500).json({error:key?workspaceErrors[key]:e instanceof AppError?e.message:'Impossible de charger ou enregistrer ces données. Réessaie.'})
  }
 }
}
export default workspaceHandler()
