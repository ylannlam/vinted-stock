import {AppError,isId} from './dotb.js'
import {readBoardRows} from './team-board.js'
import {healthView,healthHasDeadline,parisHealthDay} from '../src/lib/accountHealth.js'

const check=r=>{if(r.error)throw r.error;return r.data}
const fold=v=>String(v||'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().replace(/[’']/g,' ')
const iso=v=>typeof v==='string'&&Number.isFinite(Date.parse(v))?new Date(v).toISOString():null
const validDate=v=>typeof v==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(v)&&iso(`${v}T12:00:00Z`)?.slice(0,10)===v
export function restrictionDate(text){
  const dates=[...fold(text).matchAll(/\bjusqu\s*(?:au|a|a la date du)\s+(\d{2})\/(\d{2})\/(\d{4})\b/g)].map(([,d,m,y])=>`${y}-${m}-${d}`)
  const unique=[...new Set(dates)];return unique.length===1&&validDate(unique[0])?unique[0]:null
}
export function normalizeHealthAlert(n,observedAt=new Date().toISOString()){
  if(!n||!isId(n.id)||!isId(n.vinted_account_id)||!iso(n.created_at)||typeof n.resolved!=='boolean')return null
  const title=typeof n.title==='string'?n.title.slice(0,500):'',body=typeof n.body==='string'?n.body.slice(0,1500):'',text=fold(`${title} ${body}`)
  let status
  if(n.group==='captchas')status='verification'
  else if(['vinted','dotb'].includes(n.group)){
    // No guesses from a 403, a disconnected bridge, a removed listing or a general warning.
    const recovered=/\b(?:restrictions?|limitations?) (?:ont ete |sont )?(?:levees?|supprimees?)\b|\b(?:restrictions?|limitations?) (?:have been |are )?(?:lifted|removed)\b|\b(?:aucune restriction|no restrictions?|n est plus (?:restreint|bloque)|no longer (?:restricted|blocked))\b/.test(text)
    if(recovered)return null
    const conditional=/\b(?:si|if|lorsque|when) (?:votre|ton|your) (?:compte|account)|\b(?:pourrait|pourraient|risque de|risquez de|may be|might be|could be|en cas de)\b/.test(text)
    const restricted=/\b(?:votre|ton|ce|le) compte(?: vinted)? (?:a ete |est |reste )?(?:temporairement |partiellement )?(?:restreint|limite)\b|\b(?:your|this) account (?:has been |is |remains )?(?:temporarily |partially )?(?:restricted|limited)\b|\bnous avons (?:temporairement |partiellement )?(?:restreint|limite) (?:votre|ton) compte\b|\b(?:certaines |les )?fonctionnalites (?:de votre compte |de ton compte )?(?:ont ete |sont )?(?:temporairement |partiellement )?(?:restreintes|limitees|suspendues)\b|\b(?:votre acces|your access) (?:a certaines fonctionnalites|to some features) (?:est |is )?(?:temporairement |temporarily )?(?:limite|restreint|limited|restricted)\b|\bvous ne pouvez (?:temporairement )?plus (?:publier|vendre|acheter|envoyer des messages)\b/.test(text)||/^(?:compte(?: vinted)?|account) (?:temporairement |partiellement |temporarily |partially )?(?:restreint|limite|restricted|limited)[.!]?$/.test(fold(title).trim())
    const accountBan=/(?:votre|ton|ce|le) compte(?: vinted)? (?:a ete|est) (?:[a-z]+ ){0,3}(?:banni|bloque|suspendu)\b|(?:your|this) account (?:is|has been) (?:[a-z]+ ){0,3}(?:banned|blocked|suspended)\b/.test(text)||/^(?:compte(?: vinted)?|account) (?:(?:temporairement|definitivement|temporarily|permanently) )?(?:banni|bloque|suspendu|banned|blocked|suspended)[.!]?$/.test(fold(title).trim())
    if(accountBan&&!conditional)status=/definitiv|permanent/.test(text)?'permanent':/temporair|temporar/.test(text)?'temporary':'blocked'
    else if(restricted&&!conditional)status='restricted'
    else if(n.severity==='blocking'&&!/\b(annonce|article|item|listing)\b/.test(text))status='review'
  }
  if(!status)return null
  return {id:n.id.toLowerCase(),account_id:n.vinted_account_id.toLowerCase(),status,title,body,resolved:n.resolved,created_at:iso(n.created_at),observed_at:observedAt,until_date:healthHasDeadline(status)?restrictionDate(`${title} ${body}`):null}
}
export function healthReportInput(body,now=Date.now()){
  if(!isId(body?.account_id)||!Number.isSafeInteger(body.version)||body.version<0||!['ok','temporary','restricted','permanent','blocked','review'].includes(body.status))throw new AppError('Compte ou statut invalide.')
  if(typeof body.reason!=='string'||body.reason.length>1000)throw new AppError('Le motif doit faire moins de 1 000 caractères.')
  const until=body.until_at==null||body.until_at===''?null:iso(body.until_at)
  const untilDate=body.until_date==null||body.until_date===''?null:body.until_date
  if(untilDate!==null&&(!validDate(untilDate)||!healthHasDeadline(body.status)||until||untilDate<parisHealthDay(now)||untilDate>parisHealthDay(now+366*86400000)))throw new AppError('Indique une date de fin valide, sans heure si Vinted n’en précise pas.')
  if(body.until_at&&!until||until&&!healthHasDeadline(body.status))throw new AppError('La date de fin concerne uniquement un blocage temporaire ou une restriction.')
  if(until&&(Date.parse(until)<=now||Date.parse(until)>now+366*86400000))throw new AppError('Indique la date de fin à venir affichée par Vinted, ou laisse ce champ vide.')
  return {status:body.status,reason:body.reason.trim(),until_at:until,until_date:untilDate,checked_at:new Date(now).toISOString()}
}
export async function readHealth(db){
  const [accounts,reports,alerts,native,sync]=await Promise.all([
    readBoardRows(()=>db.from('publication_accounts').select('id,login,source_present',{count:'exact'}).eq('source_present',true).order('id')),
    readBoardRows(()=>db.from('account_health_reports').select('account_id,status,reason,until_at,until_date,version,checked_at',{count:'exact'}).order('account_id')),
    readBoardRows(()=>db.from('account_health_alerts').select('id,account_id,status,title,body,resolved,created_at,observed_at,until_date',{count:'exact'}).eq('resolved',false).order('id')),
    readBoardRows(()=>db.from('vinted_accounts').select('id,pseudo,statut,creation_stage,deban_at,blocked_at,deleted_at,is_shadowbanned',{count:'exact'}).is('deleted_at',null).order('id')),
    db.from('account_health_sync').select('last_completed_at,last_attempt_at,next_allowed_at,error,partial').eq('id',true).single()
  ])
  return {accounts:accounts.map(a=>{
    const report=reports.find(r=>r.account_id===a.id)||null,matching=native.filter(n=>fold(n.pseudo).trim()===fold(a.login).trim())
    const signals=alerts.filter(n=>n.account_id===a.id)
    const legacy=matching.length===1?matching[0]:null
    return {id:a.id,login:a.login,source_present:a.source_present,report,alerts:signals,native:legacy,health:healthView({report,alerts:signals,native:legacy})}
  }),sync:check(sync)}
}
export async function syncHealth(db,{fetcher=fetch,token=process.env.DOTB_API_TOKEN,now=Date.now()}={}){
  const started=new Date(now).toISOString()
  const claimed=check(await db.from('account_health_sync').update({last_attempt_at:started,next_allowed_at:new Date(now+300000).toISOString()}).eq('id',true).lte('next_allowed_at',started).select('id').maybeSingle())
  if(!claimed)return {cached:true}
  try{
    if(!token)throw new AppError('La connexion Dotb reste à configurer.',503)
    let partial=false
    for(const group of ['vinted','captchas','dotb']){
      let cursor='';const seen=new Set()
      for(let page=0;page<3;page++){
        const query=new URLSearchParams({group,locale:'fr',limit:'100',...(cursor?{cursor}:{})})
        const response=await fetcher(`https://dotb.io/api/public/v1/notifications?${query}`,{headers:{Authorization:`Bearer ${token}`,Accept:'application/json'},redirect:'error',signal:AbortSignal.timeout(5000)})
        if(!response.ok){
          const messages={401:'La connexion Dotb doit être renouvelée.',402:'La lecture des alertes nécessite l’offre API Dotb.',403:'La clé Dotb doit autoriser la lecture des notifications (notifications_read).',429:'Dotb demande de patienter. Les statuts précédents sont conservés.'}
          throw new AppError(messages[response.status]||'Les alertes Dotb sont indisponibles. Les statuts précédents sont conservés.',502)
        }
        const data=await response.json()
        if(!Array.isArray(data?.data)||data.data.length>100||typeof data.has_more!=='boolean'||data.has_more&&(!data.data.length||typeof data.next_cursor!=='string'||!data.next_cursor||seen.has(data.next_cursor)))throw new AppError('La liste des alertes Dotb est incomplète.',502)
        const rows=data.data.map(n=>normalizeHealthAlert(n,started)).filter(Boolean)
        if(rows.length)check(await db.from('account_health_alerts').upsert(rows,{onConflict:'id'}))
        // A resolved alert can change its wording. Close its previous record by ID,
        // even when the new wording no longer looks like a restriction.
        const closed=new Map(data.data.filter(n=>n?.resolved===true&&isId(n.id)&&isId(n.vinted_account_id)).map(n=>[n.id.toLowerCase(),n.vinted_account_id.toLowerCase()]))
        if(closed.size){
          const existing=check(await db.from('account_health_alerts').select('id,account_id,status,title,body,created_at,until_date').in('id',[...closed.keys()]))||[]
          const resolved=existing.filter(n=>closed.get(n.id)===n.account_id).map(n=>({...n,resolved:true,observed_at:started}))
          if(resolved.length)check(await db.from('account_health_alerts').upsert(resolved,{onConflict:'id'}))
        }
        if(!data.has_more)break
        cursor=data.next_cursor;seen.add(cursor)
        if(page===2)partial=true
      }
    }
    check(await db.from('account_health_sync').update({last_completed_at:new Date().toISOString(),error:null,partial}).eq('id',true))
    return {refreshed:true}
  }catch(error){
    const message=error instanceof AppError?error.message:'La lecture des alertes a échoué. Les statuts précédents sont conservés.'
    check(await db.from('account_health_sync').update({error:message}).eq('id',true))
    return {refreshed:false,error:message}
  }
}
export async function handleAccountHealth(req,{db,user}){
  if(req.method==='GET')return readHealth(db)
  if(req.method!=='POST')throw new AppError('Méthode non autorisée.',405)
  if(req.body?.action==='sync'){await syncHealth(db);return readHealth(db)}
  if(req.body?.action!=='report')throw new AppError('Action inconnue.')
  const body=req.body,value=healthReportInput(body)
  if(!check(await db.from('publication_accounts').select('id').eq('id',body.account_id).maybeSingle()))throw new AppError('Compte introuvable.',404)
  const patch={...value,version:body.version+1,updated_by:user.id}
  const result=body.version===0?await db.from('account_health_reports').insert({...patch,account_id:body.account_id}).select().single():await db.from('account_health_reports').update(patch).eq('account_id',body.account_id).eq('version',body.version).select().maybeSingle()
  if(result.error?.code==='23505'||!result.error&&!result.data)throw new AppError('Ce statut a changé. Actualise avant de réessayer.',409)
  check(result)
  return readHealth(db)
}
