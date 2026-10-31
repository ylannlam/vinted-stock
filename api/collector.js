import { authorize } from '../server/auth.js'
import { AppError, isId } from '../server/dotb.js'
import { authorizeCollector, newCollectorToken, validateCollection, resumeOpenCollection } from '../server/collector.js'
import { collectionReferences } from '../src/lib/collector.js'

export const config={maxDuration:30}
const check=error=>{if(error)throw error}
const deviceActions=new Set(['claim','heartbeat','complete','fail','resume_blocked'])

export default async function handler(req,res) {
  res.setHeader('Cache-Control','no-store')
  if(!['GET','POST'].includes(req.method)){res.setHeader('Allow','GET, POST');return res.status(405).end()}
  try {
    if(req.headers.authorization?.startsWith('Bearer svpc_')) {
      if(req.method!=='POST' || !deviceActions.has(req.body?.action))throw new AppError('Ce PC ne peut accéder qu’à ses récupérations Shein.',403)
      const {db,device}=await authorizeCollector(req), body=req.body
      if(body.action==='claim') {
        const {data,error}=await db.rpc('claim_catalog_collection',{p_device:device.id});check(error)
        return res.json(data)
      }
      const seen=await db.from('catalog_collectors').update({last_seen_at:new Date().toISOString()}).eq('id',device.id);check(seen.error)
      if(body.action==='heartbeat') {
        if(body.job_id) {
          if(!isId(body.job_id)||!isId(body.lease))throw new AppError('Récupération invalide.')
          const r=await db.from('catalog_collection_jobs').update({lease_expires_at:new Date(Date.now()+180000).toISOString()})
            .eq('id',body.job_id).eq('collector_id',device.id).eq('lease',body.lease).eq('status','running').gt('lease_expires_at',new Date().toISOString()).select('id').maybeSingle()
          check(r.error);if(!r.data)throw new AppError('Cette récupération a expiré.',409)
        }
        return res.json({enabled:device.enabled})
      }
      if(!isId(body.job_id)||!isId(body.lease))throw new AppError('Récupération invalide.')
      const {data:job,error}=await db.from('catalog_collection_jobs').select('*').eq('id',body.job_id).eq('collector_id',device.id).eq('lease',body.lease).maybeSingle()
      check(error);if(!job)throw new AppError('Cette récupération a expiré.',409)
      if(body.action==='resume_blocked') {
        if(job.status!=='blocked')throw new AppError('Cette récupération n’est plus bloquée.',409)
        if(body.keep_page===true)return res.json({job:await resumeOpenCollection(db,device,job)})
        const r=await db.rpc('enqueue_catalog_collection',{p_refs:[{reference_key:job.reference_key,input:job.input,expected_sku:job.expected_sku,expected_supplier_id:job.expected_supplier_id}]});check(r.error)
        return res.json({queued:r.data})
      }
      if(job.status==='completed')return res.json({saved:true,product_id:job.product_id})
      let result=null,failure=null,message=null
      if(body.action==='complete')result=validateCollection(body.result,job)
      else {
        failure=body.status==='blocked'?'blocked':'failed'
        const messages={human_check:'Récupération en pause : vérification Shein à terminer sur le PC. Si elle reste bloquée, utilise le navigateur habituel ci-dessous.',
          sku_not_found:'Aucun produit correspondant exactement à ce SKU n’a été confirmé.',
          price_unreadable:'Le prix affiché en euros n’a pas pu être lu. Aucun ancien prix n’a été remplacé.',
          sku_mismatch:'La fiche ne porte pas le SKU attendu. Vérifie le lien et le SKU.',
          page_unavailable:'La fiche Shein est inaccessible. Avec le programme à jour, la page reste ouverte : vérifie-la sur le PC ou utilise le navigateur habituel.'}
        message=messages[body.code]||'La récupération a échoué. Le programme sur ton PC donne le détail.'
      }
      const r=await db.rpc('finish_catalog_collection',{p_job:job.id,p_device:device.id,p_lease:job.lease,p_result:result,p_failure:failure,p_message:message});check(r.error)
      return res.json({saved:true,product_id:r.data})
    }
    const auth=await authorize(req,res,['admin','stock']);if(!auth)return
    const {db,user,role}=auth
    if(req.method==='GET') {
      const [devices,jobs,counts]=await Promise.all([
        db.from('catalog_collectors').select('id,name,created_at,last_seen_at,enabled,revoked_at,expires_at').is('revoked_at',null).order('created_at',{ascending:false}),
        db.from('catalog_collection_jobs').select('id,input,expected_sku,product_id,status,created_at,started_at,finished_at,message').neq('status','excluded').order('created_at',{ascending:false}).limit(100),
        db.from('catalog_collection_jobs').select('id',{count:'exact',head:true}).in('status',['queued','running'])
      ]);[devices,jobs,counts].forEach(x=>check(x.error))
      return res.json({devices:devices.data,jobs:jobs.data,pending:counts.count})
    }
    if(role!=='admin')throw new AppError('Seul un administrateur peut piloter la récupération.',403)
    const body=req.body
    if(!body||typeof body!=='object')throw new AppError('Formulaire invalide.')
    if(body.action==='enqueue') {
      let refs;try{refs=collectionReferences(body.references)}catch(e){throw new AppError(e.message)}
      const {data,error}=await db.rpc('enqueue_catalog_collection',{p_refs:refs});check(error);return res.json({queued:data})
    }
    if(body.action==='queue_due') {
      const {data,error}=await db.rpc('queue_catalog_sources');check(error);return res.json({queued:data})
    }
    if(body.action==='retry') {
      if(!isId(body.id))throw new AppError('Récupération invalide.')
      const {data:job,error}=await db.from('catalog_collection_jobs').select('*').eq('id',body.id).maybeSingle();check(error)
      if(!job)throw new AppError('Récupération introuvable.',404)
      const r=await db.rpc('enqueue_catalog_collection',{p_refs:[{reference_key:job.reference_key,input:job.input,expected_sku:job.expected_sku,expected_supplier_id:job.expected_supplier_id}]});check(r.error)
      return res.json({queued:r.data})
    }
    if(body.action==='create_device') {
      const name=typeof body.name==='string'?body.name.trim():''
      if(!name||name.length>80)throw new AppError('Donne un nom à ce PC.')
      const existing=await db.from('catalog_collectors').select('id',{count:'exact',head:true}).is('revoked_at',null).gt('expires_at',new Date().toISOString());check(existing.error)
      if(existing.count>=5)throw new AppError('Cinq PC sont déjà associés. Déconnecte un ancien PC pour en ajouter un autre.')
      const credential=newCollectorToken()
      const r=await db.from('catalog_collectors').insert({id:credential.id,name,token_hash:credential.token_hash,created_by:user.id});check(r.error)
      return res.json({token:credential.token,id:credential.id})
    }
    if(['pause_device','revoke_device'].includes(body.action)) {
      if(!isId(body.id)||body.action==='pause_device'&&typeof body.enabled!=='boolean')throw new AppError('PC invalide.')
      const patch=body.action==='revoke_device'?{revoked_at:new Date().toISOString(),enabled:false}:{enabled:body.enabled}
      const r=await db.from('catalog_collectors').update(patch).eq('id',body.id).is('revoked_at',null);check(r.error)
      return res.json({saved:true})
    }
    throw new AppError('Action inconnue.')
  } catch(error) {
    console.error('collector_request_failed',{code:error.code||'unknown',status:error.status||500})
    const conflict=/collection_lease_expired|collection_product_mismatch|device_revoked/.test(error.message||'')
    return res.status(conflict?409:error.status||500).json({error:conflict?'Cette récupération ou l’association du PC a expiré. Actualisez le site.':error instanceof AppError?error.message:'La récupération est momentanément indisponible. Les fiches existantes sont conservées.'})
  }
}
