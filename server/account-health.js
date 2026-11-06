import {AppError,isId} from './dotb.js'
import {readBoardRows,matchPublicationProfiles} from './team-board.js'
import {healthView,healthHasDeadline,parisHealthDay} from '../src/lib/accountHealth.js'

const check=r=>{if(r.error)throw r.error;return r.data}
const ENTITIES={amp:'&',lt:'<',gt:'>',quot:'"',apos:"'",nbsp:' ',rsquo:'’',lsquo:'‘',laquo:'«',raquo:'»',hellip:'…',eacute:'é',egrave:'è',ecirc:'ê',euml:'ë',agrave:'à',acirc:'â',ccedil:'ç',icirc:'î',iuml:'ï',ocirc:'ô',ucirc:'û',ugrave:'ù',Eacute:'É',Egrave:'È',Agrave:'À',Ccedil:'Ç',oelig:'œ'}
// Les messages Vinted relayés par Dotb contiennent parfois des entités HTML (« remarqu&eacute; »).
export const decodeEntities=v=>String(v||'').replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi,(m,e)=>e[0]==='#'?String.fromCodePoint(e[1]==='x'||e[1]==='X'?parseInt(e.slice(2),16):Number(e.slice(1))):ENTITIES[e]??m)
const fold=v=>String(v||'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().replace(/[’']/g,' ')
const iso=v=>typeof v==='string'&&Number.isFinite(Date.parse(v))?new Date(v).toISOString():null
const validDate=v=>typeof v==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(v)&&iso(`${v}T12:00:00Z`)?.slice(0,10)===v
const MONTHS=['janvier','fevrier','mars','avril','mai','juin','juillet','aout','septembre','octobre','novembre','decembre']
export function restrictionDate(text,params=null){
  const t=fold(text)
  const dates=[...t.matchAll(/\b(?:jusqu\s*(?:au|a|a la date du)|until)\s+(\d{1,2})\/(\d{1,2})\/(\d{4})\b/g)].map(([,d,m,y])=>`${y}-${m.padStart(2,'0')}-${d.padStart(2,'0')}`)
  for(const [,d,month,y] of t.matchAll(/\bjusqu\s*(?:au|a)\s+(?:(?:lundi|mardi|mercredi|jeudi|vendredi|samedi|dimanche)\s+)?(\d{1,2})(?:er)?\s+([a-z]+)\s+(\d{4})\b/g)){
    const m=MONTHS.indexOf(month);if(m>=0)dates.push(`${y}-${String(m+1).padStart(2,'0')}-${d.padStart(2,'0')}`)
  }
  // Paramètres structurés de Dotb (fin de restriction), quand ils existent.
  if(params&&typeof params==='object')for(const [key,value] of Object.entries(params)){
    if(/until|end|expir|lift|fin/i.test(key)&&typeof value==='string'&&Number.isFinite(Date.parse(value)))dates.push(parisHealthDay(Date.parse(value)))
  }
  const unique=[...new Set(dates)];return unique.length===1&&validDate(unique[0])?unique[0]:null
}
// Type d'alerte Dotb (kind, ex. « account_restricted ») : plus fiable que le texte quand il est explicite.
export function kindStatus(kind,text=''){
  const k=fold(String(kind||'').replace(/[_.:-]+/g,' '))
  text=fold(text)
  if(!k||/\b(?:item|items|listing|listings|annonce|article|order|orders|commande|publish|publication|photo|message|offer|offre)\b/.test(k))return null
  if(/\b(?:lifted|unbanned|unblocked|restored|reactivated|recovered|resolved|leve|levee|retabli)\b/.test(k))return 'recovered'
  if(/\b(?:ban|banned|suspend|suspended|suspension|deactivated|deactivation|disabled|terminated|closed|blocked|block)\b/.test(k))return /perman|definit/.test(k+' '+text)?'permanent':/temporar|temporair/.test(k+' '+text)?'temporary':'blocked'
  if(/\b(?:restrict|restricted|restriction|restrictions|limited)\b/.test(k))return 'restricted'
  if(/\b(?:captcha|captchas|verification|verify|challenge|otp|2fa)\b/.test(k))return 'verification'
  return null
}
// Formulations des messages Vinted observées sur tes comptes.
export function vintedNotice(title,body,createdAt){
  const t=fold(title).trim(),text=fold(`${title} ${body}`)
  if(/\b(?:ton|votre) compte a ete (?:debloque|reactive|retabli)\b|\b(?:la|les) restrictions? (?:de|sur) (?:ton|votre) compte (?:a|ont) ete levees?\b/.test(text))return {status:'recovered'}
  // Une annonce masquée ou supprimée ne bloque pas le compte.
  if(/^(?:important\s*:\s*)?(?:annonces?|articles?)(?:\s*\(s\))?\b/.test(t)&&!/\bcompte\b/.test(t))return null
  if(/\bdefinitivement bloque\b|\bbloque definitivement\b|\bcompte (?:a ete )?(?:ferme|supprime) definitivement\b/.test(text))return {status:'permanent'}
  if(/^compte bloque\b/.test(t))return {status:/automatis/.test(text)?'temporary':'blocked'}
  const days=text.match(/\brestriction (?:de vente |de publication |d achat )?(?:de|pendant) (\d{1,3}) jours?\b|\bpendant (\d{1,3}) jours?\b/)
  if(/^restriction\b|\bnous t imposons une restriction\b|\bnous vous imposons une restriction\b/.test(t+' '+text)){
    const n=Number(days?.[1]||days?.[2]),start=Date.parse(createdAt)
    const until=restrictionDate(`${title} ${body}`)||(n>0&&n<=365&&Number.isFinite(start)?parisHealthDay(start+n*86400000):null)
    return {status:'restricted',until_date:until}
  }
  return null
}
export function normalizeHealthAlert(n,observedAt=new Date().toISOString()){
  if(!n||!isId(n.id)||!isId(n.vinted_account_id)||!iso(n.created_at)||typeof n.resolved!=='boolean')return null
  const title=typeof n.title==='string'?decodeEntities(n.title).slice(0,500):'',body=typeof n.body==='string'?decodeEntities(n.body).slice(0,1500):'',text=fold(`${title} ${body}`)
  const kind=typeof n.kind==='string'?n.kind.slice(0,80):''
  let status
  const base={id:n.id.toLowerCase(),account_id:n.vinted_account_id.toLowerCase(),kind,title,body,created_at:iso(n.created_at),observed_at:observedAt}
  // Messages Vinted réels (relayés par Dotb) : déblocage, blocage pour automatisation, restriction de N jours.
  const notice=vintedNotice(title,body,n.created_at)
  if(notice?.status==='recovered')return {...base,status:'review',kind:'recovered',resolved:true,until_date:null}
  if(notice)return {...base,status:notice.status,resolved:n.resolved,until_date:notice.until_date||null}
  const byKind=['vinted','dotb','captchas'].includes(n.group)?kindStatus(kind,text):null
  if(byKind==='recovered')return {...base,status:'review',kind:'recovered',resolved:true,until_date:null}
  if(byKind)status=byKind
  else if(n.group==='captchas')status='verification'
  else if(['vinted','dotb'].includes(n.group)){
    // No guesses from a 403, a disconnected bridge, a removed listing or a general warning.
    const recovered=/\b(?:restrictions?|limitations?) (?:ont ete |sont )?(?:levees?|supprimees?)\b|\b(?:restrictions?|limitations?) (?:have been |are )?(?:lifted|removed)\b|\b(?:aucune restriction|no restrictions?|n est plus (?:restreint|bloque)|no longer (?:restricted|blocked))\b/.test(text)
    if(recovered)return null
    const conditional=/\b(?:si|if|lorsque|when) (?:votre|ton|your) (?:compte|account)|\b(?:pourrait|pourraient|risque de|risquez de|may be|might be|could be|en cas de)\b/.test(text)
    const restricted=/\b(?:votre|ton|ce|le|du) compte(?: vinted)?(?: [a-z0-9@._-]+){0,2}? (?:a ete |est |reste )?(?:temporairement |partiellement )?(?:restreint|limite)\b|\b(?:your|this) account (?:has been |is |remains )?(?:temporarily |partially )?(?:restricted|limited)\b|\bnous avons (?:temporairement |partiellement )?(?:restreint|limite) (?:votre|ton) compte\b|\b(?:certaines |les )?fonctionnalites (?:de votre compte |de ton compte )?(?:ont ete |sont )?(?:temporairement |partiellement )?(?:restreintes|limitees|suspendues)\b|\b(?:votre acces|your access) (?:a certaines fonctionnalites|to some features) (?:est |is )?(?:temporairement |temporarily )?(?:limite|restreint|limited|restricted)\b|\bvous ne pouvez (?:temporairement )?plus (?:publier|vendre|acheter|envoyer des messages)\b/.test(text)||/^(?:compte(?: vinted)?|account) (?:temporairement |partiellement |temporarily |partially )?(?:restreint|limite|restricted|limited)(?:[.!]|\s*[:-].*|\s+jusqu\b.*|\s+until\b.*)?$/.test(fold(title).trim())||/^(?:restriction|limitation)s? (?:temporaire |partielle )?(?:de|du|sur (?:le|votre|ton)) compte\b/.test(fold(title).trim())||/\b(?:votre|ton|ce|le) compte(?: [a-z0-9@._-]+){0,2}? fait l objet d une (?:restriction|limitation)\b/.test(text)
    const accountBan=/(?:votre|ton|ce|le|du) compte(?: vinted)?(?: [a-z0-9@._-]+){0,2}? (?:a ete|est) (?:[a-z]+ ){0,3}(?:banni|bloque|suspendu|desactive|ferme)\b|(?:your|this) account (?:is|has been) (?:[a-z]+ ){0,3}(?:banned|blocked|suspended)\b/.test(text)||/^(?:compte(?: vinted)?|account) (?:(?:temporairement|definitivement|temporarily|permanently) )?(?:banni|bloque|suspendu|desactive|banned|blocked|suspended|deactivated)(?:[.!]|\s*[:-].*)?$/.test(fold(title).trim())||/^(?:suspension|bannissement|blocage|desactivation) (?:temporaire |definitive? )?(?:de|du) compte\b/.test(fold(title).trim())
    if(accountBan&&!conditional)status=/definitiv|permanent/.test(text)?'permanent':/temporair|temporar/.test(text)?'temporary':'blocked'
    else if(restricted&&!conditional)status='restricted'
    else if(n.severity==='blocking'&&!/\b(annonce|article|item|listing)\b/.test(text))status='review'
  }
  if(!status)return null
  return {...base,status,resolved:n.resolved,until_date:healthHasDeadline(status)?restrictionDate(`${title} ${body}`,n.params):null}
}
// Archive brute (sans données acheteur) : ce que Dotb a réellement envoyé, pour vérifier et affiner la détection.
export function archiveRow(n,observedAt=new Date().toISOString()){
  if(!n||!isId(n.id)||!iso(n.created_at)||!['vinted','dotb','captchas'].includes(n.group))return null
  let params={}
  try{const text=JSON.stringify(n.params&&typeof n.params==='object'?n.params:{});params=text.length<=4000?JSON.parse(text):{truncated:true}}catch{}
  return {id:n.id.toLowerCase(),account_id:isId(n.vinted_account_id)?n.vinted_account_id.toLowerCase():null,grp:n.group,kind:typeof n.kind==='string'?n.kind.slice(0,80):'',
    severity:['info','warning','blocking'].includes(n.severity)?n.severity:'info',title:typeof n.title==='string'?n.title.slice(0,500):'',body:typeof n.body==='string'?n.body.slice(0,1500):'',
    params,resolved:n.resolved===true,created_at:iso(n.created_at),observed_at:observedAt}
}
async function archive(db,list,observedAt){
  const rows=list.map(n=>archiveRow(n,observedAt)).filter(Boolean)
  if(!rows.length)return
  const r=await db.from('dotb_notifications').upsert(rows,{onConflict:'id'})
  // L'archive est un plus : une base pas encore à jour ne bloque pas la détection.
  if(r.error&&!['42P01','PGRST205'].includes(r.error.code))throw r.error
}
async function saveAlerts(db,list,observedAt){
  const rows=list.map(n=>normalizeHealthAlert(n,observedAt)).filter(Boolean)
  if(rows.length){
    let r=await db.from('account_health_alerts').upsert(rows,{onConflict:'id'})
    if(r.error&&/kind/.test(r.error.message||''))r=await db.from('account_health_alerts').upsert(rows.map(({kind,...row})=>row),{onConflict:'id'})
    check(r)
  }
  // A resolved alert can change its wording. Close its previous record by ID,
  // even when the new wording no longer looks like a restriction.
  const closed=new Map(list.filter(n=>n?.resolved===true&&isId(n.id)&&isId(n.vinted_account_id)).map(n=>[n.id.toLowerCase(),n.vinted_account_id.toLowerCase()]))
  if(closed.size){
    const existing=check(await db.from('account_health_alerts').select('id,account_id,status,title,body,created_at,until_date').in('id',[...closed.keys()]))||[]
    const resolved=existing.filter(n=>closed.get(n.id)===n.account_id).map(n=>({...n,resolved:true,observed_at:observedAt}))
    if(resolved.length)check(await db.from('account_health_alerts').upsert(resolved,{onConflict:'id'}))
  }
  return rows
}
// Alerte reçue en direct par webhook (notification.created).
export async function receiveNotification(db,notification,now=Date.now()){
  const observed=new Date(now).toISOString()
  await archive(db,[notification],observed)
  const rows=await saveAlerts(db,[notification],observed)
  return {received:true,alert:rows[0]?.status||null}
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
export function healthNativeLink(account,profile,native){
  const number=String(profile?.number??'').trim(),active=native.filter(n=>!n.deleted_at)
  const byNumber=number?active.filter(n=>String(n.ads_power_num??'').trim()===number):[]
  const byPseudo=active.filter(n=>fold(n.pseudo).trim()===fold(account.login).trim())
  const matching=byNumber.length?byNumber:byPseudo
  // Never transfer a restriction when more than one live record matches.
  return {account:matching.length===1?matching[0]:null,by:matching.length===1?(byNumber.length?'profile_number':'pseudo'):null,profile_number:number||null,ambiguous:matching.length>1}
}
// Un message « Ton compte a été débloqué » efface les blocages et restrictions antérieurs du même compte.
// Un relevé de la page Vinted (extension de veille) fait foi : il remplace toutes les alertes Dotb plus anciennes.
// « Aucune restriction » ne vaut qu'un jour : au-delà, l'état redevient non vérifié.
export const PAGE_KINDS=['page_ok','page_banner']
const PAGE_OK_TTL=24*3600000
export function openAlerts(rows,now=Date.now()){
  const time=r=>Date.parse(r.created_at)
  const recovered=rows.filter(r=>r.kind==='recovered').map(time).filter(Number.isFinite)
  const page=rows.filter(r=>PAGE_KINDS.includes(r.kind)).sort((a,b)=>Date.parse(b.observed_at||b.created_at)-Date.parse(a.observed_at||a.created_at))[0]||null
  const pageAt=page?Date.parse(page.observed_at||page.created_at):null
  const last=Math.max(...recovered,pageAt??-Infinity)
  const dotb=rows.filter(r=>!PAGE_KINDS.includes(r.kind)&&r.kind!=='recovered'&&!r.resolved&&(!Number.isFinite(last)||time(r)>last))
  if(!page)return dotb
  if(page.kind==='page_ok')return now-pageAt<PAGE_OK_TTL?[...dotb,{...page,resolved:false,created_at:page.observed_at||page.created_at}]:dotb
  return [...dotb,page]
}
export async function readHealth(db,{ownerId}={}){
  const [accounts,reports,alerts,native,sync,links,prefs]=await Promise.all([
    readBoardRows(()=>db.from('publication_accounts').select('id,login,source_present',{count:'exact'}).eq('source_present',true).order('id')),
    readBoardRows(()=>db.from('account_health_reports').select('account_id,status,reason,until_at,until_date,version,checked_at',{count:'exact'}).order('account_id')),
    readBoardRows(()=>db.from('account_health_alerts').select('id,account_id,status,kind,title,body,resolved,created_at,observed_at,until_date',{count:'exact'}).or('resolved.eq.false,kind.in.(recovered,page_ok,page_banner)').order('id')),
    readBoardRows(()=>db.from('vinted_accounts').select('id,pseudo,statut,creation_stage,deban_at,blocked_at,deleted_at,is_shadowbanned,ads_power_num',{count:'exact'}).is('deleted_at',null).order('id')),
    db.from('account_health_sync').select('last_completed_at,last_attempt_at,next_allowed_at,error,partial').eq('id',true).single(),
    readBoardRows(()=>db.from('publication_profile_links').select('owner_id,profile_id,account_id',{count:'exact'}).order('owner_id').order('profile_id')),
    readBoardRows(()=>db.from('adspower_preferences').select('owner_id,profiles',{count:'exact'}).order('owner_id'))
  ])
  const profiles=matchPublicationProfiles({accounts,links,prefs},ownerId)
  return {accounts:accounts.map(a=>{
    const report=reports.find(r=>r.account_id===a.id)||null
    const signals=openAlerts(alerts.filter(n=>n.account_id===a.id))
    const {account:legacy,...native_link}=healthNativeLink(a,profiles.get(a.id)?.profile,native)
    return {id:a.id,login:a.login,source_present:a.source_present,report,alerts:signals,native:legacy,native_link,health:healthView({report,alerts:signals,native:legacy})}
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
        await archive(db,data.data,started)
        await saveAlerts(db,data.data,started)
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
  if(req.method==='GET')return readHealth(db,{ownerId:user.id})
  if(req.method!=='POST')throw new AppError('Méthode non autorisée.',405)
  if(req.body?.action==='sync'){await syncHealth(db);return readHealth(db,{ownerId:user.id})}
  if(req.body?.action!=='report')throw new AppError('Action inconnue.')
  const body=req.body,value=healthReportInput(body)
  if(!check(await db.from('publication_accounts').select('id').eq('id',body.account_id).maybeSingle()))throw new AppError('Compte introuvable.',404)
  const patch={...value,version:body.version+1,updated_by:user.id}
  const result=body.version===0?await db.from('account_health_reports').insert({...patch,account_id:body.account_id}).select().single():await db.from('account_health_reports').update(patch).eq('account_id',body.account_id).eq('version',body.version).select().maybeSingle()
  if(result.error?.code==='23505'||!result.error&&!result.data)throw new AppError('Ce statut a changé. Actualise avant de réessayer.',409)
  check(result)
  return readHealth(db,{ownerId:user.id})
}
