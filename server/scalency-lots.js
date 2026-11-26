import {capacityResult} from './scalency-cadence.js'
import {lotSchedule} from '../src/lib/lotSchedule.js'
import {requireWorkspaceAccount} from './scalency-account-health.js'
import {createHash} from 'node:crypto'
import {remote,remoteId,ScalencyError} from './scalency-api.js'
import {isId} from './dotb.js'
import {ASSET_BUCKET,ownedAsset} from './resources.js'

const checked=result=>{if(result.error)throw result.error;return result.data}
const waitMessage='En attente de la confirmation de Scalency. Vérifie la file avant toute nouvelle tentative.'

export function lotKey(owner,account,entries,window=null){
  if(!Array.isArray(entries)||!entries.length||entries.length>100||entries.some(e=>!isId(e?.id)||!Number.isSafeInteger(e.version)||e.version<1)
    ||new Set(entries.map(e=>e.id)).size!==entries.length)throw new ScalencyError('Sélectionne entre 1 et 100 annonces prêtes de ce compte.')
  const versions=entries.map(e=>[e.id,e.version])
  const key=window?[owner,account,versions,window.day,window.from,window.to]:[owner,account,versions.sort((a,b)=>a[0].localeCompare(b[0]))]
  return createHash('sha256').update(JSON.stringify(key)).digest('hex')
}

export async function acceptPublicationLot(db,user,body){
  const account=remoteId(body.account),entries=body.entries
  const id=lotKey(user.id,account,entries,body.window)
  let plan
  if(body.window!=null){
    try{plan=lotSchedule(body.window,entries.length)}catch(error){throw new ScalencyError(error.message)}
  }
  try{await requireWorkspaceAccount(db,account)}
  catch(error){
    // A retry may arrive after its lot was already accepted, even if the account is now restricted.
    const existing=checked(await db.from('scalency_publication_lots').select('id').eq('id',id).eq('owner_id',user.id).maybeSingle())
    if(existing)return {id,count:entries.length}
    throw error
  }
  const accepted=await db.rpc('scalency_accept_limited_lot',{p_lot:id,p_owner:user.id,p_account:account,
    p_entries:entries.map(({id,version},i)=>plan?{id,version,at:plan.times[i],until:plan.end}:{id,version})})
  if(accepted.error?.message==='lot_window')throw new ScalencyError('Choisis un créneau futur dans les 30 prochains jours.',409)
  if(accepted.error?.code==='23505'||['lot_changed','lot_conflict'].includes(accepted.error?.message))throw new ScalencyError('Une fiche a changé ou appartient déjà à un lot. Actualise l’atelier pour relire la sélection.',409)
  capacityResult(accepted)
  return {id,count:entries.length}
}

export async function retryLotEntry(db,user,{id}){
  if(!isId(id))throw new ScalencyError('Annonce inconnue.')
  const item=checked(await db.from('scalency_lot_entries').select('draft_id,reviewed_version,status,scheduled_for,lot:scalency_publication_lots!inner(owner_id,account)')
    .eq('id',id).eq('lot.owner_id',user.id).maybeSingle())
  if(!item||item.status!=='failed')throw new ScalencyError('Cette annonce doit être vérifiée dans son suivi.',409)
  if(item.scheduled_for)throw new ScalencyError('Choisis un nouveau créneau depuis l’atelier.',409)
  return acceptPublicationLot(db,user,{account:item.lot.account,entries:[{id:item.draft_id,version:item.reviewed_version+2}]})
}

export function variantKey(sku,size){
  return sku&&size?JSON.stringify([String(sku).trim().toUpperCase(),String(size).trim().toUpperCase()]):null
}

export async function reviewDuplicates(db,user,{account,ids}){
  remoteId(account)
  if(!Array.isArray(ids)||!ids.length||ids.length>100||ids.some(id=>!isId(id)))throw new ScalencyError('Sélection invalide.')
  const selected=checked(await db.from('listing_drafts').select('id,fields').eq('owner_id',user.id).eq('state','draft')
    .eq('fields->>account_id',account).in('id',ids))
  const skus=[...new Set(selected.map(r=>r.fields.sku).filter(Boolean))]
  if(!skus.length)return {}
  const [history,inventory]=await Promise.all([
    db.from('listing_drafts').select('id,fields,state,payload,vinted_id').eq('owner_id',user.id).eq('fields->>account_id',account)
      .in('state',['preparing','scheduled','published','attention']).in('fields->>sku',skus),
    db.from('scalency_inventory').select('remote_id,size,payload').eq('account',account).eq('payload->>status','active')
      .eq('payload->>sold','false').is('payload->>replaced_by',null).in('payload->>sku',skus)
  ])
  const known=new Map()
  function add(key,notice){
    if(!key)return
    const entries=known.get(key)||[]
    if(!entries.some(e=>e.url===notice.url&&e.label===notice.label))entries.push(notice)
    known.set(key,entries)
  }
  for(const d of checked(history)){
    const link=d.vinted_id&&/^\d+$/.test(d.vinted_id)?'https://www.vinted.fr/items/'+d.vinted_id:
      d.payload?.scalency_job_id?'#publication?job='+encodeURIComponent(d.payload.scalency_job_id):'#publication?account='+encodeURIComponent(account)
    add(variantKey(d.fields.sku,d.fields.size_text),{label:d.state==='published'?'Déjà publiée depuis ce compte (même SKU et taille).':'Autre envoi enregistré pour ce SKU et cette taille.',url:link})
  }
  for(const item of checked(inventory))if(/^\d+$/.test(item.remote_id)){
    add(variantKey(item.payload.sku,item.size),{label:'Même SKU et taille dans le dressing de ce compte.',url:'https://www.vinted.fr/items/'+item.remote_id})
  }
  const matches={}
  for(const row of selected){
    const key=variantKey(row.fields.sku,row.fields.size_text)
    if(!key)continue
    const notices=[...(known.get(key)||[])]
    if(selected.some(r=>r.id!==row.id&&variantKey(r.fields.sku,r.fields.size_text)===key))notices.push({label:'Ce SKU et cette taille figurent deux fois dans ta sélection.'})
    if(notices.length)matches[row.id]=notices
  }
  return matches
}

export async function runLotEntry({prepare,authorizeSend,publish,finish,attempt=1}){
  let payload
  try{
    payload=await prepare()
  }catch(error){
    if(error.retryAfterSeconds||((!error.status||error.status>=500)&&attempt<5))
      return finish('pending',error.retryAfterSeconds?'Scalency demande une pause.':'Vérification temporairement indisponible.',error.retryAfterSeconds||60)
    return finish('failed',error instanceof ScalencyError?error.message:'Impossible de vérifier la fiche après plusieurs essais.')
  }
  if(!await authorizeSend())return
  let result
  try{
    result=await publish(payload)
  }catch(error){
    if(error.retryAfterSeconds)return finish('pending','Scalency demande une pause.',error.retryAfterSeconds)
    if(error instanceof ScalencyError&&error.status>=400&&error.status<500&&![408,409].includes(error.status))
      return finish('failed',error.message)
    return finish('uncertain',waitMessage)
  }
  if(!result?.job?.id)return finish('uncertain',waitMessage)
  // Persist the receipt separately from the network call. An ambiguous database error must never replay the POST.
  await finish('queued',null,0,String(result.job.id))
  return result.job
}

export async function consumeLotTicket(db,{id,ticket},preparePublication,saveRecords){
  if(!isId(id)||!isId(ticket))throw new ScalencyError('Accès refusé.',403)
  const entry=checked(await db.from('scalency_lot_entries').update({status:'working'})
    .eq('id',id).eq('token',ticket).eq('status','dispatched').gt('lease_until',new Date().toISOString())
    .select('draft_id,reviewed_version,lot_id,attempts,window_end').maybeSingle())
  if(!entry)return false
  function checkWindow(){
    if(entry.window_end&&Date.parse(entry.window_end)<=Date.now())
      throw new ScalencyError('Créneau terminé. Choisis un nouveau créneau pour ce brouillon.')
  }
  const finish=async(status,message,delay=60,job=null)=>{
    const saved=checked(await db.rpc('scalency_finish_lot_entry',{p_id:id,p_token:ticket,p_status:status,p_message:message,p_delay:delay,p_job:job}))
    if(!saved)throw new Error('lot_lease_expired')
  }
  const job=await runLotEntry({
    attempt:entry.attempts+1,finish,
    prepare:async()=>{
      checkWindow()
      checked(await db.from('scalency_lot_entries').update({attempts:entry.attempts+1}).eq('id',id).eq('token',ticket))
      const lot=checked(await db.from('scalency_publication_lots').select('owner_id,account').eq('id',entry.lot_id).single())
      const owner=checked(await db.from('profiles').select('role').eq('id',lot.owner_id).maybeSingle())
      if(owner?.role!=='admin')throw new ScalencyError('Le propriétaire du lot ne peut plus publier.',403)
      const row=checked(await db.from('listing_drafts').select('id,version,state,fields,photos,payload,stock_item_id,catalog_product_id')
        .eq('id',entry.draft_id).eq('owner_id',lot.owner_id).maybeSingle())
      if(!row||row.state!=='preparing'||row.version!==entry.reviewed_version+1||row.fields.account_id!==lot.account||row.payload?.batch?.status!=='ready')
        throw new ScalencyError('La fiche a changé depuis la validation du lot.',409)
      if(!row.photos?.length)throw new ScalencyError('Ajoute une photo avant de relancer cette annonce.')
      return (await preparePublication(db,row,{quick:true})).payload
    },
    authorizeSend:async()=>!!checked(await db.from('scalency_lot_entries').update({status:'sending',lease_until:new Date(Date.now()+150000).toISOString()})
      .eq('id',id).eq('token',ticket).eq('status','working').gt('lease_until',new Date().toISOString()).select('id').maybeSingle()),
    publish:body=>{checkWindow();return remote('items',{method:'POST',body})}
  })
  if(job)await saveRecords(db,'jobs',[job])
  return true
}

export async function publicationLots(db,user,q,saveRecords){
  const page=Math.max(0,parseInt(q.page,10)||0),pageSize=5
  let read=db.from('scalency_publication_lots').select('id,account,created_at,entries:scalency_lot_entries(id,position,draft_id,reviewed_version,sku,title,size_text,cover_path,status,job_id,message,next_attempt,scheduled_for,window_end)',{count:'exact'}).eq('owner_id',user.id)
  if(q.account)read=read.eq('account',remoteId(q.account))
  if(q.lot)read=read.eq('id',remoteId(q.lot))
  const result=await read.order('created_at',{ascending:false}).order('id').range(page*pageSize,(page+1)*pageSize-1)
  const lots=checked(result),items=lots.flatMap(l=>l.entries)
  const jobAccounts=new Map(lots.flatMap(l=>l.entries.filter(e=>e.job_id).map(e=>[String(e.job_id),l.account])))
  const ids=[...jobAccounts.keys()]
  const cached=ids.length?checked(await db.from('scalency_records').select('remote_id,payload,seen_at').eq('kind','jobs').in('remote_id',ids)):[]
  const byJob=new Map(cached.filter(c=>String(c.payload.account_id)===jobAccounts.get(String(c.remote_id))).map(c=>[String(c.remote_id),c]))
  const stale=ids.filter(id=>{
    const hit=byJob.get(id)
    return !hit||(!['done','failed','cancelled','skipped'].includes(hit.payload.status)&&Date.now()-Date.parse(hit.seen_at)>60000)
  }).sort((a,b)=>String(byJob.get(a)?.seen_at||'').localeCompare(String(byJob.get(b)?.seen_at||'')))
  // Bound remote reads on busy accounts. Least recently checked jobs are refreshed first.
  const batch=stale.slice(0,100)
  let jobs=[]
  if(batch.length){
    try{
      const page=await remote('jobs',{query:{ids:batch.join(','),limit:batch.length}})
      jobs=(page.data||[]).filter(j=>j.type==='publish'&&String(j.account_id)===jobAccounts.get(String(j.id))&&batch.includes(String(j.id)))
    }catch{/* Keep the last known receipt when Scalency is unavailable. */}
  }
  if(jobs.length){await saveRecords(db,'jobs',jobs);for(const job of jobs)byJob.set(String(job.id),{payload:job})}
  const covers=[...new Set(items.map(e=>e.cover_path).filter(p=>ownedAsset(p,user.id)))]
  const links=covers.length?await db.storage.from(ASSET_BUCKET).createSignedUrls(covers,900):{data:[]}
  const photos=new Map((links.data||[]).map(p=>[p.path,p.signedUrl]))
  const failedIds=items.filter(e=>e.status==='failed').map(e=>e.draft_id)
  const drafts=failedIds.length?checked(await db.from('listing_drafts').select('id,state,version').eq('owner_id',user.id).in('id',failedIds)):[]
  const byDraft=new Map(drafts.map(d=>[d.id,d]))
  const accounts=lots.length?checked(await db.from('scalency_records').select('remote_id,payload').eq('kind','accounts').in('remote_id',[...new Set(lots.map(l=>l.account))])):[]
  const logins=new Map(accounts.map(a=>[a.remote_id,a.payload.login]))
  return {lots:lots.map(l=>({...l,login:logins.get(l.account)||l.account,entries:l.entries.sort((a,b)=>a.position-b.position).map(e=>{
    const {cover_path,reviewed_version,...row}=e,d=byDraft.get(e.draft_id)
    return {...row,photo:photos.get(cover_path)||null,job:byJob.get(String(e.job_id))?.payload,
      editable:d?.state==='draft',retryable:!e.scheduled_for&&d?.state==='draft'&&d.version===reviewed_version+2}
  })})),total:result.count,pageSize}
}
