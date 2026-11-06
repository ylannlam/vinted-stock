// Onglet Publication : les fiches prêtes, les comptes, les annonces déjà prévues, et la programmation par lots.
import {AppError,isId} from './dotb.js'
import {ASSET_BUCKET} from './resources.js'
import {listingAccounts} from './listing-studio-core.js'
import {selectedListingAccounts} from './adspower-selection.js'
import {allListingSettings,dotbAccounts} from './listing-settings.js'
import {readBoardRows} from './team-board.js'
import {listingIssues} from '../src/lib/listingStudio.js'

const TABLE='listing_drafts'
const check=r=>{if(r.error)throw r.error;return r.data}
const BUSY=['preparing','scheduled','published','vinted_draft']
export const MAX_PLAN_BATCH=25

// Ce qu'il manque pour envoyer la fiche (la catégorie est revérifiée avec ses options au moment de l'envoi).
export function draftIssues(row){
 const f=row.fields||{}
 return listingIssues(f,row.photos,null).filter(i=>!(i.key==='category'&&f.catalog_id)).map(i=>i.label)
}
const at=row=>Math.max(...[row.planned_at,row.scheduled_at,row.published_at].map(v=>Date.parse(v)).filter(Number.isFinite),-Infinity)

export async function readPlanner(db,user,{read,allowDotb}){
 const since=new Date(Date.now()-2*86400000).toISOString()
 const [accountsBody,rows,busy,health,presets,dotb]=await Promise.all([
  read('accounts'),
  readBoardRows(()=>db.from(TABLE).select('id,version,state,fields,photos,dotb_item_id,planned_at,scheduled_at,published_at,message,last_error,inflight,lease_until,dotb_publish,created_at,updated_at',{count:'exact'}).eq('owner_id',user.id).in('state',['draft','preparing','scheduled','attention']).order('created_at').order('id')),
  // Toutes les annonces prévues ou publiées récemment (tous utilisateurs) : écart du compte et règle du SKU.
  readBoardRows(()=>db.from(TABLE).select('id,fields,planned_at,scheduled_at,published_at',{count:'exact'}).in('state',BUSY).not('planned_at','is',null).or(`planned_at.gt.${since},scheduled_at.gt.${since},published_at.gt.${since}`).order('id')),
  db.from('account_health_reports').select('account_id,status,until_at,until_date'),
  allListingSettings(db),
  allowDotb?dotbAccounts(db):new Set()
 ])
 const selected=await selectedListingAccounts(db,user.id,listingAccounts(accountsBody))
 const healthBy=new Map((health.error?[]:health.data||[]).map(h=>[String(h.account_id).toLowerCase(),h]))
 const photoPaths=rows.map(r=>r.photos?.[0]?.path).filter(Boolean)
 const signed=photoPaths.length?check(await db.storage.from(ASSET_BUCKET).createSignedUrls(photoPaths,3600)):[]
 const thumbs=new Map(signed.map(x=>[x.path,x.signedUrl]))
 const view=r=>({id:r.id,version:r.version,state:r.state,account_id:r.fields?.account_id||null,title:r.fields?.title||'',sku:r.fields?.sku||null,size:r.fields?.size_text||'',price:r.fields?.price||null,
  photo:thumbs.get(r.photos?.[0]?.path)||null,photos:r.photos?.length||0,planned_at:r.planned_at,scheduled_at:r.scheduled_at,message:r.message,last_error:r.last_error,
  busy:!!(r.lease_until&&Date.parse(r.lease_until)>Date.now()),live:r.dotb_publish!==false,created_at:r.created_at,issues:r.state==='draft'?draftIssues(r):[]})
 const accounts=selected.accounts.map(a=>{
  const h=healthBy.get(a.id),settings=presets.effective(a.id)
  return {id:a.id,login:a.login,country:a.country,connected:a.connected,dotb:allowDotb&&dotb.has(a.id),spacing:settings.spacing_minutes,health:h?{status:h.status,until:h.until_at||h.until_date||null}:null}
 })
 return {
  accounts,dotb_publish_enabled:allowDotb,selection_configured:!!selected.selection,
  drafts:rows.filter(r=>r.state==='draft').map(view),
  queue:rows.filter(r=>['preparing','attention'].includes(r.state)).map(view),
  scheduled:rows.filter(r=>r.state==='scheduled').map(view).sort((a,b)=>Date.parse(a.scheduled_at||a.planned_at)-Date.parse(b.scheduled_at||b.planned_at)),
  occupied:busy.map(r=>({account_id:r.fields?.account_id||null,sku:r.fields?.sku||null,at:at(r)})).filter(o=>o.account_id&&Number.isFinite(o.at))
 }
}

// Programmation d'un lot : chaque fiche est validée puis réservée à l'heure choisie ; une erreur n'arrête pas les autres.
export async function planListings(db,user,body,{read,queue}){
 if(!Array.isArray(body.items)||!body.items.length||body.items.length>MAX_PLAN_BATCH)throw new AppError(`Envoie entre 1 et ${MAX_PLAN_BATCH} annonces à la fois.`)
 if(!['live','draft'].includes(body.mode))throw new AppError('Choisis « en ligne » ou « brouillon Vinted ».')
 const ids=new Set()
 for(const item of body.items){
  if(!item||!isId(item.id)||ids.has(item.id)||!Number.isInteger(item.version)||item.version<1)throw new AppError('Planning invalide : recalcule-le.')
  const when=Date.parse(item.at)
  if(!Number.isFinite(when)||when<Date.now()-10*60000||when>Date.now()+31*86400000)throw new AppError('Une heure du planning est passée ou trop lointaine : recalcule le planning.')
  ids.add(item.id)
 }
 const accounts=listingAccounts(await read('accounts'))
 const rows=check(await db.from(TABLE).select('*').eq('owner_id',user.id).in('id',[...ids]))
 const byId=new Map(rows.map(r=>[r.id,r])),results=[]
 for(const item of body.items){
  const row=byId.get(item.id)
  try{
   if(!row)throw new AppError('Fiche introuvable.',404)
   if(row.state!=='draft'||row.version!==item.version)throw new AppError('Cette fiche a changé ou est déjà envoyée. Recalcule le planning.',409)
   const draft=await queue(row,{mode:body.mode,notBefore:new Date(Date.parse(item.at)).toISOString(),accounts})
   results.push({id:item.id,ok:true,state:draft.state,version:draft.version,planned_at:draft.planned_at,message:draft.message})
  }catch(e){
   if(!(e instanceof AppError))throw e
   results.push({id:item.id,ok:false,error:e.message})
  }
 }
 return {results}
}
