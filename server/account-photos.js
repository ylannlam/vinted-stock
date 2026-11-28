import {createHash} from 'node:crypto'
import {AppError,isId} from './dotb.js'
import {accountBlock} from './scalency-account-health.js'
import {uploadTarget,ownedAsset,ASSET_BUCKET,checkAssetInfo,ensureAssetBucket} from './resources.js'

const checked=result=>{if(result.error)throw result.error;return result.data}
const fold=login=>String(login||'').trim().toLowerCase()
const profileSummary='id,login,version,background_id,photo_label'
const fields=profileSummary+',prompt_front,prompt_back'
const imageFields='id,title,image_path'

async function all(build){
  const result=[]
  for(let start=0;;start+=500){
    const rows=checked(await build().range(start,start+499))
    result.push(...rows)
    if(rows.length<500)return result
  }
}

// A few Scalency accounts have textual IDs. Map those deterministically into the UUID primary key.
function profileId(id){
  if(isId(id))return id
  const hex=createHash('sha256').update('scalency-photo-account/'+id).digest('hex')
  return [hex.slice(0,8),hex.slice(8,12),'5'+hex.slice(13,16),'8'+hex.slice(17,20),hex.slice(20,32)].join('-')
}
export function photoAccounts(remote,register,profiles,observations=[]){
  const bannedIds=new Set(observations.filter(r=>r.value?.status==='banned').map(r=>r.id.slice('profile-ban:'.length)))
  const sources=[remote.map(r=>({key:r.remote_id,login:r.payload.login,linked:r.payload.linked===true,banned:accountBlock(r.payload)?.kind==='banned'})),
    profiles.map(p=>({key:p.id,login:p.login,profile:p})),register.map(r=>({key:r.id,login:r.pseudo,banned:['banni_temp','banni_def'].includes(r.statut)}))]
  const ambiguous=new Set()
  for(const list of sources){
    const seen=new Set()
    for(const row of list){const login=fold(row.login);if(seen.has(login))ambiguous.add(login);seen.add(login)}
  }
  const groups=[],byName=new Map(),byKey=new Map()
  for(const [i,source] of sources.entries())for(const row of source){
    const login=fold(row.login),key=profileId(row.key)
    let g=byKey.get(key)||(!ambiguous.has(login)&&login&&byName.get(login))
    if(!g){g={id:key,login:row.login||row.key,aliases:new Set(),linked:false};groups.push(g)}
    if(i===0){g.remote=row.key;g.linked=row.linked}
    if(row.profile){g.id=row.key;g.profile=row.profile}
    if(row.banned||bannedIds.has(row.key))g.banned=true
    g.aliases.add(row.key);g.aliases.add(key);byKey.set(key,g)
    if(login&&!ambiguous.has(login))byName.set(login,g)
  }
  return groups.filter(g=>!g.banned).sort((a,b)=>Number(b.linked)-Number(a.linked)||a.login.localeCompare(b.login,'fr'))
}
async function directory(db,columns=profileSummary){
  const lists=await Promise.all([
    all(()=>db.from('scalency_records').select('remote_id,payload').eq('kind','accounts').order('remote_id')),
    all(()=>db.from('vinted_accounts').select('id,pseudo,statut').is('deleted_at',null).order('id')),
    all(()=>db.from('account_photo_profiles').select(columns).order('id')),
    all(()=>db.from('scalency_settings').select('id,value').like('id','profile-ban:%').order('id'))
  ])
  return photoAccounts(...lists)
}
function findAccount(groups,id){
  if(typeof id!=='string'||!id||id.length>150)throw new AppError('Compte invalide.')
  const exact=groups.find(g=>g.id===id||g.aliases.has(id))
  if(!exact)throw new AppError('Compte introuvable.',404)
  return exact
}
// Reusing an unexpired URL lets a browser reuse the original image after switching accounts.
const previewLinks=new Map()
async function signedImages(db,rows){
  const now=Date.now(),urls=new Map(),missing=[]
  for(const path of new Set(rows.map(row=>row.image_path))){
    const key=JSON.stringify([db.supabaseUrl,ASSET_BUCKET,path])
    const entry=previewLinks.get(key)
    if(entry&&entry.until>now)urls.set(path,entry.url)
    else missing.push(path)
  }
  if(missing.length){
    const links=checked(await db.storage.from(ASSET_BUCKET).createSignedUrls(missing,3600))
    for(const link of links){
      if(!link.signedUrl)continue
      urls.set(link.path,link.signedUrl)
      const key=JSON.stringify([db.supabaseUrl,ASSET_BUCKET,link.path])
      previewLinks.delete(key)
      previewLinks.set(key,{url:link.signedUrl,until:now+30*60000})
      if(previewLinks.size>500)previewLinks.delete(previewLinks.keys().next().value)
    }
  }
  return urls
}
async function backgrounds(db,ids){
  if(ids&&!ids.length)return []
  const rows=await all(()=>{
    let q=db.from('account_photo_backgrounds').select(imageFields).order('title').order('id')
    return ids?q.in('id',ids):q
  })
  if(!rows.length)return []
  const urls=await signedImages(db,rows)
  return rows.map(r=>({...r,image_url:urls.get(r.image_path)||''}))
}
function present(group,bg,detail=false){
  const p=group.profile||{},prompts={front:p.prompt_front||'',back:p.prompt_back||''}
  return {id:group.id,login:group.login,linked:group.linked,remote:group.remote||null,
    ...(!detail&&{aliases:[...group.aliases]}),
    name:p.photo_label||bg?.title||'',image:bg?.thumb_url||bg?.image_url||'',hasImage:!!bg?.image_path,hasPrompt:!!prompts.front.trim(),
    ...(detail?{version:p.version||0,label:p.photo_label||'',background_id:bg?.id||null,original:bg?.image_url||'',
      front:prompts.front,back:prompts.back,customFront:p.prompt_front??null,customBack:p.prompt_back??null}:{})}
}
export async function readPhotos(db,account,options=false){
  if(options)return {backgrounds:(await backgrounds(db)).map(b=>({id:b.id,title:b.title,image:b.image_url}))}
  if(account){
    const group=findAccount(await directory(db),account)
    if(!group.profile)return {account:present(group,null,true)}
    const backgroundId=group.profile.background_id
    const [details,images]=await Promise.all([
      db.from('account_photo_profiles').select(fields).eq('id',group.profile.id).maybeSingle(),
      backgrounds(db,backgroundId?[backgroundId]:[])
    ])
    const profile=checked(details)
    const [bg]=profile?.background_id===backgroundId?images:await backgrounds(db,profile?.background_id?[profile.background_id]:[])
    return {account:present({...group,profile},bg,true)}
  }
  const groups=await directory(db,profileSummary+',prompt_front')
  const ids=[...new Set(groups.map(r=>r.profile?.background_id).filter(Boolean))]
  const assets=new Map((await backgrounds(db,ids)).map(b=>[b.id,b]))
  return {accounts:groups.map(g=>present(g,assets.get(g.profile?.background_id)))}
}
export function photoPatch(body){
  if(!Number.isInteger(body.version)||body.version<0||typeof body.label!=='string'||body.label.length>120||
    (body.background_id!==null&&!isId(body.background_id)))throw new AppError('Vérifie le nom et le fond choisis.')
  for(const key of ['prompt_front','prompt_back'])if(body[key]!==null&&(typeof body[key]!=='string'||body[key].length>50000))throw new AppError('Chaque prompt peut contenir jusqu’à 50 000 caractères.')
  return {background_id:body.background_id,photo_label:body.label.trim()||null,prompt_front:body.prompt_front,prompt_back:body.prompt_back}
}
export async function savePhotos(db,body){
  const patch=photoPatch(body),g=findAccount(await directory(db),body.account)
  const stale=()=>new AppError('Cette fiche a changé. Rouvre-la avant de réessayer.',409)
  if((g.profile?.version||0)!==body.version)throw stale()
  let bg=null
  if(patch.background_id){
    bg=(await backgrounds(db,[patch.background_id]))[0]
    if(!bg?.image_path)throw new AppError('Ce fond est indisponible. Choisis un autre fond.',409)
  }
  const table=db.from('account_photo_profiles')
  const write=g.profile?table.update({...patch,version:body.version+1,updated_at:new Date().toISOString()}).eq('id',g.id).eq('version',body.version):
    table.insert({...patch,id:g.id,login:g.login})
  const result=await write.select(fields).maybeSingle()
  if(result.error?.code==='23505'||(!result.error&&!result.data))throw stale()
  return {account:present({...g,profile:checked(result)},bg,true)}
}
const slug=text=>String(text||'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().replace(/[^a-z0-9_-]+/g,'-').replace(/^-+|-+$/g,'').slice(0,95)
export function backgroundFilename(login,name,path){
  const ext=String(path).split('.').pop().toLowerCase()
  return (slug(login)||'compte')+'-'+(slug(name)||'fond')+'.'+(['jpg','jpeg','png','webp'].includes(ext)?ext:'jpg')
}
export async function downloadPhoto(db,body){
  const group=findAccount(await directory(db),body.account),p=group.profile
  if(!p?.background_id||p.background_id!==body.background_id||p.version!==body.version)throw new AppError('Le fond de ce compte a changé. Actualise sa fiche.',409)
  const bg=checked(await db.from('account_photo_backgrounds').select(imageFields).eq('id',p.background_id).maybeSingle())
  if(!bg?.image_path?.startsWith('account-photos/'))throw new AppError('Image indisponible.',404)
  const name=backgroundFilename(group.login,p.photo_label||bg.title,bg.image_path)
  const data=checked(await db.storage.from(ASSET_BUCKET).createSignedUrl(bg.image_path,120,{download:name}))
  return {url:data.signedUrl,name}
}

export async function photoUpload(db,user,body){
  const path='account-photos/'+uploadTarget(user.id,body)
  await ensureAssetBucket(db)
  const ticket=checked(await db.storage.from(ASSET_BUCKET).createSignedUploadUrl(path))
  return {path,token:ticket.token}
}
export async function addPhotoBackground(db,user,body){
  const {id,title,path}=body
  if(!isId(id)||typeof title!=='string'||!title.trim()||title.length>120||
    typeof path!=='string'||!path.startsWith('account-photos/')||!ownedAsset(path.slice('account-photos/'.length),user.id))
    throw new AppError('Importe un nouveau fond et donne-lui un nom.')
  const table=db.from('account_photo_backgrounds')
  const stored=checked(await table.select('id,image_path,created_by').eq('id',id).maybeSingle())
  if(stored){
    if(stored.created_by===user.id&&stored.image_path===path)return {id}
    throw new AppError('Le fond a changé. Réessaie avec une nouvelle image.',409)
  }
  const info=await db.storage.from(ASSET_BUCKET).info(path)
  if(info.error)throw new AppError('L’envoi de l’image n’est pas terminé.',409)
  checkAssetInfo(info.data)
  const result=await table.insert({id,title:title.trim(),image_path:path,created_by:user.id})
  if(result.error?.code==='23505'){
    const same=checked(await table.select('id').eq('id',id).eq('image_path',path).eq('created_by',user.id).maybeSingle())
    if(same)return {id}
  }
  checked(result)
  return {id}
}
