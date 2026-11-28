import {remote,remoteId,ScalencyError} from './scalency-api.js'

import {readBoardRows} from './team-board.js'

const unavailable='État du compte indisponible. Actualise pour réessayer avant de préparer une annonce.'
const labels={banned:'Compte banni',restricted:'Compte restreint',blocked:'Compte bloqué',publication:'Publication suspendue',unlinked:'Compte non relié',unknown:'État indisponible'}
const normalize=value=>String(value??'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().replace(/[_-]+/g,' ').trim()
const date=value=>{
  if(!value)return null
  const stamp=typeof value==='number'?value*(value<1e11?1000:1):Date.parse(value)
  return Number.isFinite(stamp)?stamp:null
}
function signal(value,fallbackUntil,now){
  if(!value)return null
  const fields=typeof value==='object'?value:{reason:value}
  if(fields.active===false||fields.enabled===false||fields.paused===false)return null
  const reason=[fields.reason,fields.reason_code,fields.code,fields.type,fields.kind,fields.status,fields.message,fields.label]
    .filter(v=>typeof v==='string').map(normalize).join(' ')
  if(/\b(?:cleared|resolved|expired|inactive|unbanned|unrestricted|lifted|disabled|unpaused|false|off|none)\b|\b(?:aucune?|sans|pas de) (?:restriction|blocage|bannissement)|\b(?:restriction|suspension|pause) (?:levee|terminee|expiree)/.test(reason))return null
  const standaloneEnd=typeof value==='number'||(typeof value==='string'&&/^\d{4}-\d\d-\d\dT/.test(value))?value:null
  const end=date(fields.until||fields.paused_until||fields.expires_at||fields.ends_at||standaloneEnd||fallbackUntil)
  if(end!==null&&end<=now)return null
  return {reason,until:end===null?null:new Date(end).toISOString()}
}
const ban=/\b(?:ban|banned|banni(?:e|s|es)?|bannissement)\b|\b(?:permanent(?:ly)? blocked|definitivement bloque)\b/
const restriction=/\b(?:restrict(?:ed|ion|ions)|restreint(?:e)?|suspend(?:ed|u|ue))\b/
const routine=/\b(?:manual|manuelle?|rest|repos|night|nuit|schedule|quota|rate limit|cooldown|rythme|horaire|limit reached|daily limit)\b/
const publication=/\b(?:publish|publication|publier|create listing|listing create|item create)\b/
function block(kind,until=null){return {kind,label:labels[kind],until}}
export function accountBlock(row,now=Date.now()){
  const agent=row.agent||{}
  const profileBan=row.agent?.state?.vinted_ban||row.state?.vinted_ban
  if(profileBan?.status==='banned')return block('banned')
  const signals=[signal(row.status,null,now),signal(agent.paused,agent.paused_until,now),signal(agent.publication_pause,null,now)].filter(Boolean)
  if(row.banned===true||row.is_banned===true)return block('banned')
  const banned=signals.find(s=>ban.test(s.reason)&&!(/\b(?:chat|listing|item|buyer)\b/.test(s.reason)&&!(/\b(?:compte|account)\b/.test(s.reason))))
  if(banned)return block('banned',banned.until)
  if(row.restricted===true||row.is_restricted===true)return block('restricted')
  const restricted=signals.find(s=>restriction.test(s.reason)&&!routine.test(s.reason)&&!(/\b(?:chat|messages?|messaging)\b/.test(s.reason)&&!publication.test(s.reason)))
  if(restricted)return block('restricted',restricted.until)
  const blocked=signals.find(s=>/\b(?:account (?:is )?blocked|compte bloque|vinted blocked|blocked account)\b/.test(s.reason))
  if(blocked)return block('blocked',blocked.until)
  if(!row.linked)return block('unlinked')
  if(!row.agent||!['paused','publication_pause','paused_actions'].some(key=>Object.hasOwn(agent,key)))return block('unknown')
  const pause=signal(agent.publication_pause,null,now)
  if(pause&&!routine.test(pause.reason))return block('publication',pause.until)
  for(const item of Array.isArray(agent.paused_actions)?agent.paused_actions:[]){
    const action=typeof item==='string'?item:item?.action||item?.name||item?.type
    const detail=signal(item,null,now)
    if(detail&&publication.test(normalize(action))&&!routine.test(detail.reason))return block('publication',detail.until)
  }
  return null
}

// Share one complete read across parallel photo transfers and requests on this instance.
export function createHealthReader(request=remote,clock=Date.now){
  let cached=null,expires=0,pending=null
  async function read(){
    const accounts=[],cursors=new Set()
    let cursor=null
    do{
      const page=await request('accounts',{query:{limit:100,cursor}})
      if(!Array.isArray(page?.data))throw Error('Invalid account list')
      for(const item of page.data){
        if(item?.id==null||typeof item.linked!=='boolean')throw Error('Invalid account')
        const restriction=accountBlock(item,clock())
        accounts.push({id:String(item.id),login:item.login||String(item.id),linked:item.linked,block:restriction})
      }
      cursor=page.has_more?page.next_cursor:null
      if(page.has_more&&(!cursor||cursors.has(cursor)))throw Error('Incomplete account list')
      if(cursor)cursors.add(cursor)
    }while(cursor)
    return {checkedAt:new Date(clock()).toISOString(),accounts}
  }
  return async function(){
    if(cached&&clock()<expires)return cached
    if(!pending)pending=read().then(value=>{cached=value;expires=clock()+8000;return value})
      .catch(()=>{throw new ScalencyError(unavailable,503)}).finally(()=>{pending=null})
    return pending
  }
}
const readPublicAccounts=createHealthReader()

// Public account pauses can be empty even when Scalency Desktop saw Vinted's block page.
export async function readAccountHealth(db,read=readPublicAccounts){
  const getRecords=prefix=>db.from('scalency_settings').select('id,value').like('id',prefix+':%')
  const registeredBans=readBoardRows(()=>db.from('vinted_accounts').select('id,pseudo',{count:'exact'})
    .eq('statut','banni_def').is('deleted_at',null).order('id'))
  const [report,bans,restrictions,permanent]=await Promise.all([read(),getRecords('profile-ban'),getRecords('profile-restriction'),registeredBans])
  if(bans.error||restrictions.error)throw new ScalencyError(unavailable,503)
  const observations=new Map([...bans.data,...restrictions.data].map(row=>[row.id,row.value]))
  const username=value=>String(value||'').trim().toLowerCase()
  const bannedIds=new Set(permanent.map(row=>row.id))
  const bannedNames=new Set(permanent.map(row=>username(row.pseudo)).filter(Boolean))
  const now=Date.now()
  return {...report,accounts:report.accounts.map(account=>{
    const ban=observations.get('profile-ban:'+account.id)
    if(ban?.status==='banned')return {...account,block:{...block('banned'),observedAt:ban.checked_at}}
    if(bannedIds.has(account.id)||bannedNames.has(username(account.login)))return {...account,block:block('banned')}
    const restriction=observations.get('profile-restriction:'+account.id)
    if(account.block?.kind==='banned'||restriction?.status!=='restricted')return account
    const end=date(restriction.until)
    if(end!==null&&end<=now)return account
    return {...account,block:{...block('restricted',restriction.until||null),observedAt:restriction.checked_at}}
  })}
}

export function requireWorkspaceAccount(db,value){
  return requireListingAccount(value,()=>readAccountHealth(db))
}
export async function requireListingAccount(value,read){
  if(!value)throw new ScalencyError('Choisis le compte de publication.',409)
  const id=remoteId(value)
  const report=await read()
  const account=report.accounts.find(a=>a.id===id)
  if(!account)throw new ScalencyError('Compte introuvable dans Scalency. Préparation suspendue.',409)
  if(account.block){
    if(account.block.kind==='unknown')throw new ScalencyError(unavailable,503)
    throw new ScalencyError(account.login+' · '+account.block.label+'. Préparation et mise en file bloquées.',423)
  }
  return {checkedAt:report.checkedAt}
}
