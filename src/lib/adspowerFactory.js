// Règles de la section « Profils et proxys » de l'onglet AdsPower (sans accès réseau).
export const FACTORY_GROUP='Stock Vinted'
export const RECENT_CHANGE_DAYS=7

const control=/[\x00-\x1f\x7f]/
const HOST=/^(?:(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}|(?:(?:25[0-5]|2[0-4]\d|1?\d?\d)\.){3}(?:25[0-5]|2[0-4]\d|1?\d?\d))$/

export function providerOf(host){
  if(/(^|\.)oxylabs\.io$/.test(host))return 'Oxylabs'
  if(/(^|\.)(decodo|smartproxy)\.com$/.test(host))return 'Decodo'
  return null
}
// Oxylabs affiche « disp_xxxx » mais attend « user-disp_xxxx » côté proxy.
export function proxyUser(host,user){return providerOf(host)==='Oxylabs'&&/^disp_/i.test(user)?`user-${user}`:user}

function proxyFrom(host,port,user,password){
  host=String(host||'').trim().toLowerCase();port=Number(port);user=String(user||'').trim();password=String(password||'').trim()
  if(host.length>253||!HOST.test(host))return {error:'adresse invalide'}
  if(!/^\d{1,5}$/.test(String(port))||port<1||port>65535)return {error:'port invalide'}
  if(!user||user.length>200||control.test(user))return {error:'identifiant manquant ou invalide'}
  if(!password||password.length>200||control.test(password))return {error:'mot de passe manquant ou invalide'}
  return {proxy:{adresse:host,port,username:proxyUser(host,user),password,fournisseur:providerOf(host)}}
}
// Une ligne par proxy : « hôte:port:identifiant:motdepasse » (export AdsPower, Decodo, Oxylabs)
// ou « identifiant:motdepasse@hôte:port », avec ou sans « http:// ».
export function parseProxyLines(text){
  const proxies=[],errors=[],seen=new Set()
  String(text||'').split(/\r?\n/).forEach((raw,index)=>{
    const line=raw.trim();if(!line||line.startsWith('#'))return
    const bare=line.replace(/^(?:https?|socks5h?):\/\//i,'')
    // hôte:port d'abord : un mot de passe peut contenir « @ » ou « : ».
    const parts=bare.split(':'),at=bare.lastIndexOf('@')
    let parsed
    if(parts.length>=4&&HOST.test(parts[0].trim().toLowerCase())&&/^\d{1,5}$/.test(parts[1].trim()))parsed=proxyFrom(parts[0],parts[1],parts[2],parts.slice(3).join(':'))
    else if(at>0){const [host,port,...extra]=bare.slice(at+1).split(':'),credentials=bare.slice(0,at),colon=credentials.indexOf(':');parsed=extra.length||colon<1?{error:'format non reconnu'}:proxyFrom(host,port,credentials.slice(0,colon),credentials.slice(colon+1))}
    else parsed={error:'format attendu hôte:port:identifiant:motdepasse'}
    if(parsed.error){errors.push({line:index+1,message:parsed.error});return}
    const key=proxyKey(parsed.proxy)
    if(seen.has(key)){errors.push({line:index+1,message:'déjà présent plus haut'});return}
    seen.add(key);proxies.push(parsed.proxy)
  })
  return {proxies,errors}
}
export const proxyKey=p=>`${String(p.adresse).toLowerCase()}:${Number(p.port)}:${p.username}`
const liveProxyKey=p=>p?.host?`${p.host.toLowerCase()}:${Number(p.port)}:${p.user}`:null

// Qui utilise chaque proxy : comptes Vinted (base) et profils AdsPower (lus sur ce PC).
// Deux comptes, deux profils, ou un profil qui n'est pas celui du compte = proxy partagé.
export function proxyUsage(proxies,accounts,adsProfiles=[]){
  const byKey=new Map(),usage=new Map()
  for(const p of adsProfiles){const key=liveProxyKey(p.proxy);if(key)byKey.set(key,[...(byKey.get(key)||[]),{id:p.id,number:p.number}])}
  for(const proxy of proxies){
    const users=accounts.filter(a=>a.proxy_id===proxy.id&&!a.deleted_at).map(a=>({id:a.id,pseudo:a.pseudo,number:a.ads_power_num||''}))
    const profiles=byKey.get(proxyKey(proxy))||[]
    const mismatch=users.length===1&&profiles.length===1&&String(profiles[0].number)!==String(users[0].number)
    const state=users.length>1||profiles.length>1||mismatch?'shared':users.length||profiles.length?'used':'free'
    usage.set(proxy.id,{accounts:users,profiles,state})
  }
  return usage
}
export const freeProxies=(proxies,usage)=>proxies.filter(p=>usage.get(p.id)?.state==='free')

// Comptes à équiper : actifs, hors Shadowban, sans numéro AdsPower. Les comptes prêts d'abord.
export function creatableAccounts(accounts){
  return accounts.filter(a=>!a.deleted_at&&!a.is_shadowbanned&&!String(a.ads_power_num||'').trim())
    .sort((a,b)=>Number(b.creation_stage==='ready')-Number(a.creation_stage==='ready')||String(a.pseudo).localeCompare(String(b.pseudo),'fr'))
}
// Un compte qui a déjà un proxy le garde ; sinon on propose le premier proxy libre.
export function proxyChoices(account,proxies,usage){
  if(!account)return []
  if(account.proxy_id){const own=proxies.find(p=>p.id===account.proxy_id),u=usage.get(account.proxy_id);return own&&u&&u.state!=='shared'&&!u.profiles.length?[own]:[]}
  return freeProxies(proxies,usage)
}
export function profileName(pseudo){return String(pseudo||'').trim().replace(/^@+/,'').replace(/[\x00-\x1f\x7f]/g,'').slice(0,100)}
export function proxyLabel(proxy){return proxy?`${proxy.adresse}:${proxy.port} · ${proxy.username}`:''}

export function hardwareLabel(entry){
  if(!entry)return ''
  const gpu=String(entry.gpu||'').replace(/^NVIDIA GeForce /,''),screen=String(entry.resolution||'').replace('_','×')
  return [screen,gpu,entry.threads?`${entry.threads} threads`:'',entry.chrome||entry.chrome_major?`Chrome ${entry.chrome||entry.chrome_major}`:''].filter(Boolean).join(' · ')
}
export function latestFingerprints(log){
  const latest=new Map()
  for(const entry of [...log].sort((a,b)=>String(b.created_at).localeCompare(String(a.created_at))))if(!latest.has(entry.profile_id))latest.set(entry.profile_id,entry)
  return latest
}
export function recentChange(entry,now=Date.now()){
  const at=Date.parse(entry?.created_at)
  return Number.isFinite(at)&&now-at<RECENT_CHANGE_DAYS*86400000
}
export const accountForProfile=(profile,accounts)=>accounts.find(a=>!a.deleted_at&&String(a.ads_power_num||'').trim()===String(profile.number))||null
