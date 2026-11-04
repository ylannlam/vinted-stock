import {AppError,isId} from './dotb.js'
import {directionReady} from '../src/lib/workspace.js'
import {parisDay,publicationAccount} from '../src/lib/publications.js'

const check=result=>{if(result.error)throw result.error;return result.data}
const lower=value=>String(value??'').trim().toLowerCase()
const domains=new Set(['fr','be','nl','de','es','it','pt','at','lu','ie','com','co.uk','pl','cz','sk','lt','se','dk','fi','hr','hu','ro','gr','si','ee','lv'].map(tld=>`vinted.${tld}`))
const itemNumber=value=>/^\d{1,18}$/.test(value)&&BigInt(value)>0n?BigInt(value).toString():null

// Read every page, including when the API has a lower row cap than requested.
export async function readBoardRows(query){
  const rows=[]
  for(;;){const page=await query().range(rows.length,rows.length+499);const data=check(page)||[];rows.push(...data);if(!data.length||rows.length>=page.count)return rows}
}

// Lien ou numéro d'annonce Vinted → numéro (ex. https://www.vinted.fr/items/123456-robe → 123456).
export function vintedItemId(value) {
  if(typeof value!=='string')return null
  const text=value.trim()
  if(/^\d{1,18}$/.test(text))return itemNumber(text)
  try {
    const url=new URL(text)
    if(url.protocol!=='https:'||url.username||url.password||url.port||!domains.has(url.hostname.replace(/^www\./,'')))return null
    return itemNumber(url.pathname.match(/^\/items\/(\d{1,18})(?:-[^/]+)?\/?$/)?.[1]||'')
  }catch{return null}
}
export const vintedItemUrl=id=>/^\d{1,18}$/.test(id||'')?`https://www.vinted.fr/items/${id}`:null

// Une ligne par compte Vinted relié (compte Dotb), avec tout ce qu'il faut pour décider
// où poster. Aucun appel à Dotb ni à AdsPower : uniquement ce qui est déjà enregistré.
export async function readTeamBoard(db,user,{now=new Date()}={}) {
  const day=parisDay(now)
  const [accounts,links,prefs,styles,vinted,people,counts,mine,backgrounds]=await Promise.all([
    readBoardRows(()=>db.from('publication_accounts').select('id,login,source_present',{count:'exact'}).eq('source_present',true).order('login').order('id')),
    readBoardRows(()=>db.from('publication_profile_links').select('owner_id,profile_id,account_id',{count:'exact'}).order('owner_id').order('profile_id')),
    readBoardRows(()=>db.from('adspower_preferences').select('owner_id,profiles',{count:'exact'}).order('owner_id')),
    readBoardRows(()=>db.from('creative_accounts').select('id,enabled,background_id,prompt_front,prompt_back',{count:'exact'}).order('id')),
    readBoardRows(()=>db.from('vinted_accounts').select('id,pseudo,statut,creation_stage,creation_next_at,is_ready,is_shadowbanned,deleted_at,blocked_at,deban_at,ready_at,password_changed_at,ads_power_num',{count:'exact'}).order('id')),
    readBoardRows(()=>db.from('profiles').select('id,pseudo',{count:'exact'}).order('id')),
    db.rpc('team_board_counts',{p_day:day}),
    readBoardRows(()=>db.from('listing_drafts').select('id,version,fields,updated_at',{count:'exact'}).eq('owner_id',user.id).eq('state','draft').is('dotb_item_id',null).order('updated_at',{ascending:false}).order('id')),
    readBoardRows(()=>db.from('creative_resources').select('id,content,content_back,archived_at',{count:'exact'}).eq('kind','background').order('id'))
  ])
  const data={accounts,links,prefs,styles,vinted,people,counts:check(counts)||{},mine,backgrounds}
  const names=new Map(data.people.map(p=>[p.id,p.pseudo||'Quelqu’un']))
  const matches=new Map()
  for(const pref of [...data.prefs].sort((a,b)=>(b.owner_id===user.id)-(a.owner_id===user.id))){
    for(const profile of Array.isArray(pref.profiles)?pref.profiles:[]){
      const account=publicationAccount(profile,data.accounts,data.links.filter(l=>l.owner_id===pref.owner_id))
      if(account&&!matches.has(account.id))matches.set(account.id,{profile,own:pref.owner_id===user.id})
    }
  }
  const byKey=(rows,key)=>new Map((rows||[]).map(r=>[r[key],r]))
  const stats=byKey(data.counts.stats,'account_id'),drafts=byKey(data.counts.drafts,'account_id'),recent=byKey(data.counts.recent,'account_id'),style=byKey(data.styles,'id'),background=byKey(data.backgrounds,'id')
  const vintedByNumber=new Map(),vintedByPseudo=new Map()
  // Prefer a live record if an older archived record uses the same name/number.
  for(const v of [...data.vinted].sort((a,b)=>Number(!!b.deleted_at)-Number(!!a.deleted_at))){if(String(v.ads_power_num??'').trim())vintedByNumber.set(String(v.ads_power_num).trim(),v);if(lower(v.pseudo))vintedByPseudo.set(lower(v.pseudo),v)}
  const rows=data.accounts.map(account=>{
    // Le profil AdsPower de la personne connectée d'abord, sinon celui d'un autre membre.
    const match=matches.get(account.id),profile=match?.profile||null
    const number=String(profile?.number??'').trim()
    const vintedAccount=(number&&vintedByNumber.get(number))||vintedByPseudo.get(lower(account.login))||null
    const s=style.get(account.id),bg=background.get(s?.background_id),stat=stats.get(account.id)
    return {
      account_id:account.id,login:account.login,
      profile:profile?{id:profile.id,number:number||null,name:profile.name||null}:null,
      can_create:!!match?.own,
      vinted:vintedAccount?(({ads_power_num,...rest})=>rest)(vintedAccount):null,
      style:s?{ready:!!(s.enabled&&directionReady(s,bg)),background:!!bg&&!bg.archived_at,front:!!(s.prompt_front??bg?.content)?.trim(),back:!!(s.prompt_back??bg?.content_back)?.trim()}:null,
      today:Number(stat?.today||0),week:Number(stat?.week||0),last_at:stat?.last_at||null,
      drafts:Number(drafts.get(account.id)?.drafts||0),
      recent:(recent.get(account.id)?.items||[]).map(r=>({id:r.id,title:r.title,url:vintedItemUrl(r.vinted_id),published_at:r.published_at,author:names.get(r.owner_id)||'Quelqu’un',mine:r.owner_id===user.id})),
      mine:data.mine.filter(d=>d.fields?.account_id===account.id).map(d=>({id:d.id,version:d.version,title:d.fields?.title||'Fiche sans titre',updated_at:d.updated_at}))
    }
  })
  return {day,accounts:rows,me:names.get(user.id)||null}
}

// Après une publication manuelle sur Vinted : la fiche passe « Publiée » avec son lien.
export async function markPublished(db,row,url,update) {
  if(row.state!=='draft'||row.dotb_item_id)throw new AppError('Cette fiche a déjà été transmise ou publiée.',409)
  const id=vintedItemId(url)
  if(!id)throw new AppError('Colle le lien de l’annonce Vinted (il contient /items/ suivi d’un numéro).')
  if(!isId(row.fields?.account_id)||!check(await db.from('publication_accounts').select('id').eq('id',row.fields.account_id).maybeSingle()))throw new AppError('Choisis le compte de cette fiche avant de noter sa publication.')
  const otherAccount=check(await db.from('publication_items').select('account_id').eq('item_id',id).neq('account_id',row.fields.account_id).limit(1))
  if(otherAccount?.length)throw new AppError('Cette annonce est déjà connue sur un autre compte. Vérifie le lien et le compte choisi.',409)
  const taken=check(await db.from('listing_drafts').select('id').eq('vinted_id',id).neq('id',row.id).limit(1))
  if(taken?.length)throw new AppError('Ce lien est déjà enregistré sur une autre fiche.',409)
  try{return await update(db,row,{state:'published',vinted_id:id,published_at:new Date().toISOString(),message:'Publiée à la main sur Vinted.',last_error:null,lease:null,lease_until:null,inflight:null})}
  catch(error){if(error.code==='23505')throw new AppError('Ce lien est déjà enregistré sur une autre fiche.',409);throw error}
}
