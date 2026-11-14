// Veille des comptes Vinted : l'extension installée dans les profils AdsPower signale le bandeau
// « Compte restreint jusqu'au … » ou « Compte bloqué » affiché par Vinted sur le compte connecté.
import {createHash,randomBytes,randomUUID,timingSafeEqual} from 'node:crypto'
import {readFileSync} from 'node:fs'
import {join} from 'node:path'
import {createClient} from '@supabase/supabase-js'
import {AppError,isId} from './dotb.js'
import {zipFiles} from '../src/lib/zip.js'

const check=r=>{if(r.error)throw r.error;return r.data}
const hash=value=>createHash('sha256').update(value).digest('hex')
// Depuis la version 2, l'extension téléchargée est l'agent complet (veille du compte comprise).
export const WATCH_FILES=['manifest.json','read.js','content.js','page.js','worker.js','form.js','form-worker.js','popup.html','popup.js','config.js','overlay.js','icons/16.png','icons/32.png','icons/48.png','icons/128.png']
export function newWatchToken(){const id=randomUUID(),token=`svwk_${id}.${randomBytes(32).toString('base64url')}`;return {id,token,token_hash:hash(token)}}
export function readWatchToken(value){
  const m=typeof value==='string'&&value.match(/^Bearer (svwk_([0-9a-f-]{36})\.[A-Za-z0-9_-]{43})$/)
  return m&&isId(m[2])?{token:m[1],id:m[2]}:null
}
const same=(token,stored)=>typeof stored==='string'&&/^[a-f0-9]{64}$/.test(stored)&&timingSafeEqual(Buffer.from(hash(token),'hex'),Buffer.from(stored,'hex'))

// Identifiant stable de l'alerte « bandeau » d'un compte : une seule ligne par compte, mise à jour à chaque relevé.
export function bannerAlertId(accountId){
  const h=hash(`vinted-page-banner:${accountId}`)
  return `${h.slice(0,8)}-${h.slice(8,12)}-4${h.slice(13,16)}-8${h.slice(17,20)}-${h.slice(20,32)}`
}
const validDay=v=>typeof v==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(v)&&new Date(`${v}T12:00:00Z`).toISOString().slice(0,10)===v
export function watchReport(body,now=Date.now()){
  const r=body?.report
  if(!r||typeof r!=='object')throw new AppError('Relevé invalide.')
  if(!/^\d{1,15}$/.test(String(r.member_id||'')))throw new AppError('Compte Vinted inconnu : ouvre une fois la page de profil du compte.')
  if(!['ok','restricted','blocked','permanent'].includes(r.status))throw new AppError('État du compte invalide.')
  const at=Date.parse(r.observed_at)
  if(!Number.isFinite(at)||at>now+120000||at<now-6*3600000)throw new AppError('Relevé trop ancien.',409)
  return {member_id:String(r.member_id),login:typeof r.login==='string'?r.login.trim().slice(0,80):'',status:r.status,
    until_date:r.status==='restricted'&&validDay(r.until_date)?r.until_date:null,message:typeof r.message==='string'?r.message.replace(/\s+/g,' ').trim().slice(0,500):'',
    observed_at:new Date(at).toISOString()}
}
export async function authorizeWatch(req){
  const parsed=readWatchToken(req.headers.authorization)
  if(!parsed)throw new AppError('Extension de veille non reconnue. Télécharge-la à nouveau depuis le site.',401)
  const url=process.env.VITE_SUPABASE_URL,key=process.env.SUPABASE_SERVICE_ROLE_KEY
  if(!url||!key)throw new AppError('Connexion indisponible.',503)
  const db=createClient(url,key,{auth:{persistSession:false,autoRefreshToken:false}})
  const k=check(await db.from('vinted_watch_keys').select('*').eq('id',parsed.id).maybeSingle())
  if(!k||k.revoked_at||!same(parsed.token,k.token_hash))throw new AppError('Cette extension de veille a été désactivée. Télécharge-la à nouveau depuis le site.',401)
  return {db,key:k}
}
// Le bandeau lu sur la page devient l'état du compte ; sans bandeau sur la page du compte, les blocages antérieurs sont levés.
export async function recordWatch(db,key,report){
  const account=check(await db.from('publication_accounts').select('id,login').eq('vinted_id',report.member_id).maybeSingle())
    ||(report.login?check(await db.from('publication_accounts').select('id,login').ilike('login',report.login).maybeSingle()):null)
  await db.from('vinted_watch_keys').update({last_seen_at:new Date().toISOString(),last_login:report.login||null}).eq('id',key.id)
  if(!account)return {saved:false,reason:'Compte absent de Dotb : il n’est pas suivi par le site.'}
  if(check(await db.from('publication_accounts').select('ylavint_unlinked_at').eq('id',account.id).maybeSingle())?.ylavint_unlinked_at)return {saved:false,reason:'Compte délié de YlaVint.'}
  const id=bannerAlertId(account.id)
  const before=check(await db.from('account_health_alerts').select('status,kind,until_date,created_at').eq('id',id).maybeSingle())
  const title=report.status==='ok'?'Aucun bandeau sur la page du compte':report.message.split(/(?<=\d{4})\s|\.\s/)[0]?.slice(0,200)||'Bandeau Vinted'
  const row=report.status==='ok'
    ?{id,account_id:account.id,status:'review',kind:'page_ok',title,body:'Vérifié sur la page Vinted du compte.',resolved:true,until_date:null,
      created_at:report.observed_at,observed_at:report.observed_at}
    :{id,account_id:account.id,status:report.status,kind:'page_banner',title,body:report.message,resolved:false,until_date:report.until_date,
      // Même bandeau qu'au relevé précédent : on garde sa date d'apparition (pas de nouvelle alerte).
      created_at:before?.kind==='page_banner'&&before.status===report.status&&before.until_date===report.until_date?before.created_at:report.observed_at,observed_at:report.observed_at}
  check(await db.from('account_health_alerts').upsert(row,{onConflict:'id'}))
  return {saved:true,account:account.login,status:report.status}
}

// Téléchargement : une clé neuve, intégrée dans config.js de l'archive.
export function watchArchive(token,read=name=>name.endsWith('.png')?new Uint8Array(readFileSync(join(process.cwd(),'extensions','ylavint',name))):readFileSync(join(process.cwd(),'extensions','ylavint',name),'utf8')){
  return zipFiles(WATCH_FILES.map(name=>({name,data:name==='config.js'?read(name).replace('__STOCK_VINTED_WATCH_TOKEN__',token):read(name)})))
}
export async function handleWatch(req,{db,user}){
  if(req.method==='POST'&&req.body?.action==='desktop_pair')return (await import('./ylavint-desktop.js')).pairDesktop(db,user,req.body,newWatchToken)
  if(req.method==='GET'){
    const keys=check(await db.from('vinted_watch_keys').select('id,created_at,last_seen_at,last_login,revoked_at').order('created_at',{ascending:false}).limit(20))
    return {keys}
  }
  if(req.body?.action==='download'){
    const t=newWatchToken()
    check(await db.from('vinted_watch_keys').insert({id:t.id,token_hash:t.token_hash,created_by:user.id}))
    return {filename:'ylavint.zip',zip_base64:Buffer.from(watchArchive(t.token)).toString('base64')}
  }
  if(req.body?.action==='revoke'){
    if(!isId(req.body.id))throw new AppError('Clé invalide.')
    check(await db.from('vinted_watch_keys').update({revoked_at:new Date().toISOString()}).eq('id',req.body.id))
    return {revoked:true}
  }
  throw new AppError('Action inconnue.')
}
