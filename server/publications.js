import {randomUUID} from 'node:crypto'
import {AppError,isId} from './dotb.js'
import {parisDay,validDay} from '../src/lib/publications.js'

const check=r=>{if(r.error)throw r.error;return r.data}
const date=value=>typeof value==='string'&&Number.isFinite(Date.parse(value))?new Date(value).toISOString():null
const safeImage=value=>{try{const u=new URL(value);return u.protocol==='https:'&&!u.username&&!u.password?u.href:null}catch{return null}}
const states=new Set(['active','reserved','sold','hidden','draft','verification','processing'])
export function normalizeLiveItems(body,page,now=Date.now()){
  if(!body||!Array.isArray(body.data)||body.data.length>100||body.page!==page||!Number.isSafeInteger(body.total_pages)||body.total_pages<0||body.total_pages>10000||body.total_pages<page&&!(page===1&&body.total_pages===0&&body.data.length===0))throw new AppError('Le relevé Dotb est incomplet. L’historique précédent est conservé.',502)
  if(body.total_pages>page&&body.data.length===0)throw new AppError('La pagination Dotb est incomplète.',502)
  const ids=new Set()
  return {total_pages:body.total_pages,items:body.data.map(i=>{
    const id=String(i?.id||'')
    if(!/^\d{1,18}$/.test(id)||typeof i.id==='number'&&!Number.isSafeInteger(i.id)||ids.has(id)||!states.has(i.status))throw new AppError('Une annonce Dotb est invalide. Aucun relevé remplacé.',502)
    ids.add(id)
    let estimated_at=date(i.created_at)
    if(estimated_at&&(Date.parse(estimated_at)>now+300000||Date.parse(estimated_at)<Date.UTC(2000,0,1)))estimated_at=null
    return {item_id:id,title:typeof i.title==='string'?i.title.slice(0,500):'Annonce Vinted',status:i.status,estimated_at,
      photo_url:safeImage(i.photo_url),url:`https://www.vinted.fr/items/${id}`,
      price:i.price!=null&&Number.isFinite(Number(i.price))&&Number(i.price)>=0?String(i.price):null,
      currency:typeof i.currency==='string'&&/^[A-Z]{3}$/.test(i.currency)?i.currency:null,
      published:['active','reserved','sold'].includes(i.status)}
  })}
}
export function normalizePublicationAccounts(body){
  if(!body||!Array.isArray(body.data)||body.has_more===true||body.data.length>5000)throw new AppError('La liste des comptes Dotb est incomplète.',502)
  const ids=new Set()
  return body.data.map(a=>{
    if(!isId(a.id)||typeof a.login!=='string'||!a.login.trim()||ids.has(a.id.toLowerCase()))throw new AppError('Compte Dotb invalide.',502)
    ids.add(a.id.toLowerCase())
    return {id:a.id.toLowerCase(),login:a.login.trim().slice(0,200),vinted_id:a.vinted_id==null?null:String(a.vinted_id),bridge_connected:a.bridge?.connected===true}
  })
}
export async function readPublicationSource(path,{fetcher=fetch,token=process.env.DOTB_API_TOKEN}={}){
  if(!token)throw new AppError('La connexion Dotb du site reste à configurer.',503)
  let r
  try{r=await fetcher(`https://dotb.io/api/public/v1/${path}`,{headers:{Authorization:`Bearer ${token}`,Accept:'application/json'},redirect:'error',signal:AbortSignal.timeout(20000)})}
  catch{throw new AppError('Dotb met trop de temps à répondre. Le dernier relevé est conservé.',504)}
  if(!r.ok){
    const messages={401:'La connexion Dotb doit être renouvelée.',402:'La lecture des annonces nécessite l’offre API Dotb.',403:'La connexion Dotb ne permet pas de lire les annonces.',429:'Dotb demande de patienter avant le prochain relevé.',503:'Ouvre ce profil et active le Bridge Dotb pour relever ses annonces.'}
    const error=new AppError(messages[r.status]||'Le relevé Dotb a échoué. L’historique est conservé.',r.status===429?429:r.status===503?503:502)
    const retry=Number(r.headers?.get('retry-after'))
    error.retrySeconds=Number.isFinite(retry)&&retry>0?Math.min(3600,Math.max(60,retry)):60
    throw error
  }
  return r.json().catch(()=>{throw new AppError('Dotb a renvoyé une réponse illisible.',502)})
}
export async function handlePublications(req,auth,{read=readPublicationSource}={}){
  const {db,user}=auth,action=req.query?.action||req.body?.action
  if(req.method==='GET'&&action==='publications'){
    const day=req.query?.date||parisDay()
    if(!validDay(day))throw new AppError('Choisis une date valide.')
    return check(await db.rpc('publication_snapshot',{p_owner:user.id,p_day:day}))
  }
  if(req.method==='GET'&&action==='publication-details'){
    const {account_id,day='all'}=req.query||{},offset=Number(req.query?.offset||0)
    if(!isId(account_id)||!['all','undated'].includes(day)&&!validDay(day)||!Number.isSafeInteger(offset)||offset<0||offset>100000)throw new AppError('Sélection d’annonces invalide.')
    return check(await db.rpc('publication_details',{p_account:account_id,p_day:day,p_offset:offset}))
  }
  if(req.method!=='POST')throw new AppError('Demande de publications inconnue.')
  if(action==='publication-accounts'){
    const lease=randomUUID()
    const claimed=check(await db.rpc('publication_claim_directory',{p_lease:lease}))
    if(!claimed)return {waiting:true}
    try{
      const accounts=normalizePublicationAccounts(await read('accounts'))
      check(await db.rpc('publication_save_directory',{p_lease:lease,p_accounts:accounts}))
      return {refreshed:true}
    }catch(e){await db.rpc('publication_fail_directory',{p_lease:lease});throw e}
  }
  if(action==='publication-link'){
    const {profile_id,account_id}=req.body
    if(typeof profile_id!=='string'||!profile_id||profile_id.length>100||!isId(account_id))throw new AppError('Choisis le compte Vinted correspondant à ce profil.')
    const account=check(await db.from('publication_accounts').select('id').eq('id',account_id).eq('source_present',true).maybeSingle())
    if(!account)throw new AppError('Ce compte n’est pas disponible dans ta connexion Dotb.')
    check(await db.from('publication_profile_links').upsert({owner_id:user.id,profile_id,account_id},{onConflict:'owner_id,profile_id'}))
    return {saved:true}
  }
  if(action==='publication-sync'){
    const id=req.body.account_id
    if(!isId(id))throw new AppError('Compte invalide.')
    const lease=randomUUID()
    const job=check(await db.rpc('publication_claim_scan',{p_account:id,p_lease:lease,p_force:req.body.force===true}))
    if(!job)return {waiting:true}
    try{
      const result=normalizeLiveItems(await read(`accounts/${encodeURIComponent(id)}/live-items?page=${job.page}&per_page=100`),job.page)
      check(await db.rpc('publication_save_page',{p_account:id,p_lease:lease,p_items:result.items,p_total_pages:result.total_pages}))
      return {synced:true,complete:job.page>=result.total_pages,count:result.items.length}
    }catch(e){await db.rpc('publication_fail_scan',{p_account:id,p_lease:lease,p_message:e instanceof AppError?e.message:'Le relevé a échoué. L’historique est conservé.',p_retry:e.retrySeconds||60});throw e}
  }
  throw new AppError('Demande de publications inconnue.')
}
