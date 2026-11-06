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
// Découpe une commande en mots comme un terminal : guillemets simples ou doubles, \ pour protéger un caractère.
function shellWords(text){
  const words=[];let cur='',started=false,quote=null
  for(let i=0;i<text.length;i++){
    const c=text[i]
    if(quote==="'"){if(c==="'")quote=null;else cur+=c;continue}
    if(quote==='"'){
      if(c==='"')quote=null
      else if(c==='\\'&&'"\\$`'.includes(text[i+1]??'\n'))cur+=text[++i]
      else cur+=c
      continue
    }
    if(/\s/.test(c)){if(started){words.push(cur);cur='';started=false}continue}
    started=true
    if(c==="'"||c==='"')quote=c
    else if(c==='\\'&&i+1<text.length)cur+=text[++i]
    else cur+=c
  }
  if(quote)return null
  if(started)words.push(cur)
  return words
}
const CURL=/^\s*(?:[$>]\s*)?curl(?:\.exe)?(?=\s|$)/i
const PROXY_USER_OPTION=/\s(?:-U|--proxy-user)(?:\s|=|["'])/
// Commande copiée depuis Oxylabs : curl -x hôte:port -U "identifiant:motdepasse" https://…
// On ne garde que le proxy (-x / --proxy) et ses identifiants (-U / --proxy-user).
function curlToLine(text){
  const words=shellWords(text.replace(/^\s*[$>]\s*/,''))
  if(!words)return {error:'guillemets non fermés'}
  let proxy='',credentials=''
  for(let i=0;i<words.length;i++){
    const word=words[i];let m
    if(word==='-x'||word==='--proxy')proxy=words[++i]??''
    else if((m=/^--proxy=([\s\S]*)$/.exec(word)))proxy=m[1]
    else if(/^-x[^-]/.test(word))proxy=word.slice(2)
    else if(word==='-U'||word==='--proxy-user')credentials=words[++i]??''
    else if((m=/^--proxy-user=([\s\S]*)$/.exec(word)))credentials=m[1]
    else if(/^-U./.test(word))credentials=word.slice(2)
  }
  // Collage coupé (« hôte:port -U … » sans « curl -x ») : on prend le premier mot hôte:port.
  if(!proxy)proxy=words.find(w=>/^(?:https?:\/\/)?[a-z0-9.-]+:\d{1,5}\/?$/i.test(w))||''
  if(!proxy)return {error:'adresse du proxy introuvable (option -x)'}
  if(proxy.includes('@'))return {line:proxy.replace(/\/+$/,'')}
  if(!credentials)return {error:'identifiant:motdepasse introuvable (option -U)'}
  return {line:`${proxy.replace(/^[a-z0-9]+:\/\//i,'').replace(/\/+$/,'')}:${credentials}`}
}
// Lignes à lire : une commande curl coupée par « \ » (ou « ^ » sous Windows) redevient une seule ligne.
function logicalLines(text){
  const raws=String(text||'').split(/\r?\n/),lines=[]
  let pending=null
  raws.forEach((raw,index)=>{
    pending=pending?{...pending,text:`${pending.text} ${raw.trim()}`}:{line:index+1,text:raw.trim().replace(/^PS\s+[^>]*>\s*(?=curl(?:\.exe)?\s)/i,'')}
    if(CURL.test(pending.text)&&/[\\^]$/.test(pending.text)&&index<raws.length-1){pending.text=pending.text.slice(0,-1).trim();return}
    lines.push(pending);pending=null
  })
  return lines
}
// Une ligne par proxy : « hôte:port:identifiant:motdepasse » (export AdsPower, Decodo, Oxylabs),
// « identifiant:motdepasse@hôte:port » (avec ou sans « http:// »), ou la commande curl d'Oxylabs.
export function parseProxyLines(text){
  const proxies=[],errors=[],seen=new Set()
  for(const {line:number,text:raw} of logicalLines(text)){
    let line=raw.trim();if(!line||line.startsWith('#'))continue
    if(CURL.test(line)||PROXY_USER_OPTION.test(line)){
      const converted=curlToLine(line)
      if(converted.error){errors.push({line:number,message:converted.error});continue}
      line=converted.line
    }
    const bare=line.replace(/^(?:https?|socks5h?):\/\//i,'')
    // hôte:port d'abord : un mot de passe peut contenir « @ » ou « : ».
    const parts=bare.split(':'),at=bare.lastIndexOf('@')
    let parsed
    if(parts.length>=4&&HOST.test(parts[0].trim().toLowerCase())&&/^\d{1,5}$/.test(parts[1].trim()))parsed=proxyFrom(parts[0],parts[1],parts[2],parts.slice(3).join(':'))
    else if(at>0){const [host,port,...extra]=bare.slice(at+1).split(':'),credentials=bare.slice(0,at),colon=credentials.indexOf(':');parsed=extra.length||colon<1?{error:'format non reconnu'}:proxyFrom(host,port,credentials.slice(0,colon),credentials.slice(colon+1))}
    else parsed={error:'format attendu hôte:port:identifiant:motdepasse'}
    if(parsed.error){errors.push({line:number,message:parsed.error});continue}
    const key=proxyKey(parsed.proxy)
    if(seen.has(key)){errors.push({line:number,message:'déjà présent plus haut'});continue}
    seen.add(key);proxies.push(parsed.proxy)
  }
  return {proxies,errors}
}
// AdsPower peut afficher l'identifiant Oxylabs avec ou sans « user- » : la clé ajoute toujours le préfixe
// (sans effet sur un identifiant qui l'a déjà), sinon le proxy du profil n'est jamais reconnu sur le site.
const keyOf=(host,port,user)=>{const h=String(host).toLowerCase();return `${h}:${Number(port)}:${proxyUser(h,String(user??'').trim())}`}
export const proxyKey=p=>keyOf(p.adresse,p.port,p.username)
const liveProxyKey=p=>p?.host?keyOf(p.host,p.port,p.user):null

// Qui utilise chaque proxy : comptes Vinted (base) et profils AdsPower (lus sur ce PC).
// Deux comptes, deux profils, ou un profil qui n'est pas celui du compte = proxy partagé.
export function proxyUsage(proxies,accounts,adsProfiles=[]){
  const byKey=new Map(),usage=new Map()
  for(const p of adsProfiles){const key=liveProxyKey(p.proxy);if(key)byKey.set(key,[...(byKey.get(key)||[]),{id:p.id,number:p.number}])}
  for(const proxy of proxies){
    const users=accounts.filter(a=>a.proxy_id===proxy.id&&!a.deleted_at).map(a=>({id:a.id,pseudo:a.pseudo,number:a.ads_power_num||''}))
    const profiles=byKey.get(proxyKey(proxy))||[]
    // Un compte pas encore relié dont le proxy sert à un seul profil n'est pas un partage : il reste à relier.
    const mismatch=users.length===1&&profiles.length===1&&users[0].number!==''&&String(profiles[0].number)!==String(users[0].number)
    const state=users.length>1||profiles.length>1||mismatch?'shared':users.length||profiles.length?'used':'free'
    usage.set(proxy.id,{accounts:users,profiles,state})
  }
  return usage
}
export const freeProxies=(proxies,usage)=>proxies.filter(p=>usage.get(p.id)?.state==='free')

// Comptes « en service » : ni corbeille, ni Shadowban, ni banni ou suspendu. Les profils des
// autres comptes ne sont pas à gérer au quotidien.
const OUT_OF_SERVICE=new Set(['banni_def','banni_temp','suspendu'])
export const inService=a=>!!a&&!a.deleted_at&&!a.is_shadowbanned&&!OUT_OF_SERVICE.has(a.statut)
export function serviceAccounts(accounts){
  return accounts.filter(inService).sort((a,b)=>Number(b.statut==='actif')-Number(a.statut==='actif')||String(a.pseudo).localeCompare(String(b.pseudo),'fr'))
}
const stateLabels={banni_def:'Banni',banni_temp:'Banni temporairement',suspendu:'Suspendu',en_preparation:'En préparation'}
// Compte affiché à côté d'un profil qui n'est pas celui d'un compte en service.
export function ownerLabel(account){
  if(!account)return 'Aucun compte relié'
  if(account.is_shadowbanned)return `${account.pseudo} · Shadowban`
  return stateLabels[account.statut]?`${account.pseudo} · ${stateLabels[account.statut]}`:account.pseudo
}
// Comptes à équiper : en service, sans numéro AdsPower. Les comptes prêts d'abord.
export function creatableAccounts(accounts){
  return accounts.filter(a=>inService(a)&&!String(a.ads_power_num||'').trim())
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
// Profils AdsPower qui portent déjà le pseudo du compte sans être reliés à un compte :
// il faut les relier (« N° AdsPower » du compte), pas en créer un deuxième.
export const linkedProfile=(account,profiles)=>{const number=String(account?.ads_power_num??'').trim();return number?profiles.find(p=>String(p.number)===number)||null:null}
export const liveProxyOf=(profile,adsProxies)=>adsProxies.find(r=>r.id===profile?.id)?.proxy||null
export const savedProxyFor=(live,proxies)=>{const key=liveProxyKey(live);return key?proxies.find(p=>proxyKey(p)===key)||null:null}
// Profils qu'on peut relier à ce compte : ceux qu'aucun autre compte n'utilise. En tête, le profil
// qui utilise déjà le proxy du compte (match 2), puis ceux qui portent son pseudo (match 1) :
// « lilou_lio/OUI » correspond au compte lilou_lio.
const baseName=name=>profileName(name).toLocaleLowerCase('fr').split(/\s*[/|]\s*/)[0]
export function profileChoices(account,profiles,accounts,adsProxies=[],proxies=[]){
  if(!account)return []
  const pseudo=profileName(account.pseudo).toLocaleLowerCase('fr'),own=proxies.find(p=>p.id===account.proxy_id)
  const match=p=>{const live=liveProxyKey(liveProxyOf(p,adsProxies));return own&&live===proxyKey(own)?2:pseudo&&baseName(p.name)===pseudo?1:0}
  return profiles.filter(p=>{const owner=accountForProfile(p,accounts);return !owner||owner.id===account.id})
    .map(p=>({...p,match:match(p)})).sort((a,b)=>b.match-a.match||(Number(b.number)||0)-(Number(a.number)||0))
}
// Le proxy suit le profil : en reliant un compte, on enregistre sur le compte le proxy que le profil
// utilise dans AdsPower, s'il est enregistré sur le site et qu'aucun autre compte ne l'a.
export function proxyForLink(account,profile,accounts,proxies,adsProxies){
  const saved=savedProxyFor(liveProxyOf(profile,adsProxies),proxies)
  return saved&&!accounts.some(a=>!a.deleted_at&&a.id!==account.id&&a.proxy_id===saved.id)?saved.id:null
}
export function unlinkedProfilesNamed(account,profiles,accounts){
  const wanted=profileName(account?.pseudo).toLocaleLowerCase('fr')
  if(!wanted)return []
  return profiles.filter(p=>profileName(p.name).toLocaleLowerCase('fr')===wanted&&!accountForProfile(p,accounts))
}
