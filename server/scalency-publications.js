import {remote,remoteId,ScalencyError} from './scalency-api.js'
import {ownedAsset,ASSET_BUCKET} from './resources.js'
import {removalKey} from './scalency-publication-actions.js'
import {canMoveJob} from './scalency-reschedule.js'
const pageSize=20
const checked=r=>{if(r.error)throw r.error;return r.data||[]}
const activeStates=['queued','sent','waiting','pending','scheduled','planned','running','retry']
const matches=(value,term)=>String(value||'').toLocaleLowerCase('fr').includes(term)

async function covers(db,owner,paths){
  const keys=[...new Set(paths.filter(p=>p&&ownedAsset(p,owner)))]
  if(!keys.length)return new Map()
  const result=await db.storage.from(ASSET_BUCKET).createSignedUrls(keys,900)
  return new Map((result.data||[]).map(r=>[r.path,r.signedUrl]))
}

async function localRows(db,user,{account,accounts,tab,page,term,draft}){
  if(!['drafts','queue'].includes(tab))return {rows:[],total:0}
  const ids=accounts.map(a=>a.id).filter(id=>/^[a-z0-9_-]+$/i.test(id))
  const sources=['payload->>scalency_source.eq.stock-vinted','and(state.eq.preparing,message.eq.Transmission à Scalency)']
  if(ids.length)sources.push('and(state.eq.draft,fields->>account_id.in.('+ids.join(',')+'))')
  let read=db.from('listing_drafts').select('id,version,state,fields,photos,updated_at,payload,message',{count:'exact'})
    .eq('owner_id',user.id).in('state',tab==='queue'?['preparing']:['draft','attention']).is('payload->>scalency_job_id',null).or(sources.join(','))
  if(account)read=read.eq('fields->>account_id',account)
  if(draft)read=read.eq('id',draft)
  if(term){
    const literal='"%'+term.replace(/[\\"]/g,'\\$&').replace(/[%_]/g,'\\$&')+'%"'
    read=read.or('fields->>title.ilike.'+literal+',fields->>sku.ilike.'+literal)
  }
  const result=await read.order('updated_at',{ascending:false}).order('id').range(page*pageSize,(page+1)*pageSize-1)
  const drafts=checked(result),links=await covers(db,user.id,drafts.map(d=>d.photos?.[0]?.path))
  const preparing=drafts.filter(d=>d.state==='preparing')
  const entries=preparing.length?checked(await db.from('scalency_lot_entries').select('draft_id,reviewed_version,status,scheduled_for').in('draft_id',preparing.map(d=>d.id))):[]
  return {total:result.count,rows:drafts.map(d=>{
    const f=d.fields||{},batch=d.payload?.batch?.status
    const entry=entries.find(e=>e.draft_id===d.id&&e.reviewed_version===d.version-1)
    return {kind:'draft',id:d.id,version:d.version,account:f.account_id,title:f.title,sku:f.sku,size:f.size_text,
      date:d.updated_at,scheduled_for:entry?.scheduled_for||null,photo:links.get(d.photos?.[0]?.path),state:d.state,batch,reason:d.message,
      actions:d.state==='preparing'?(entry?.status==='pending'?['move','stop-local']:entry&&['working','dispatched'].includes(entry.status)?['stop-local']:[]):d.state==='draft'&&f.account_id?(batch==='ready'?['launch','discard']:['discard']):[]}
  })}
}

async function siteReceipts(db,user,jobs){
  if(!jobs.length)return []
  const ids=jobs.map(j=>String(j.id))
  const [drafts,entries]=await Promise.all([
    db.from('listing_drafts').select('account:fields->>account_id,receipt:payload->>scalency_job_id').eq('owner_id',user.id).in('payload->>scalency_job_id',ids),
    db.from('scalency_lot_entries').select('job_id,lot:scalency_publication_lots!inner(account,owner_id)').eq('lot.owner_id',user.id).in('job_id',ids)
  ])
  const keys=new Set([...checked(drafts).map(d=>d.account+'/'+d.receipt),
    ...checked(entries).map(e=>e.lot.account+'/'+e.job_id)])
  return jobs.filter(j=>keys.has(j.account_id+'/'+j.id))
}

async function jobPage(db,user,q){
  if(q.job){const j=await remote('jobs/'+remoteId(q.job));return {rows:j.type==='publish'&&(!q.account||String(j.account_id)===q.account)?[j]:[],next:null}}
  if(!['queue','live','history'].includes(q.tab)||q.draft)return {rows:[],next:null}
  let cursor=q.cursor||null,rows=[],next=null
  // Keep the provider cursor intact: don't discard matches at a page boundary.
  for(let i=0;i<4;i++){
    const res=await remote('jobs',{query:{type:'publish',scope:q.tab==='queue'?'active':'closed',account_id:q.account,cursor,limit:pageSize}})
    const matchesPage=(res.data||[]).filter(j=>j.type==='publish'&&(!q.account||String(j.account_id)===q.account)&&
      (q.tab==='queue'?activeStates.includes(j.status):q.tab==='live'?j.status==='done'&&j.new_item_id:!activeStates.includes(j.status)&&!(j.status==='done'&&j.new_item_id))&&
      (!q.term||[j.title,j.refs?.sku,j.id].some(x=>matches(x,q.term))))
    rows.push(...(q.stage==='site'?await siteReceipts(db,user,matchesPage):matchesPage))
    next=res.next_cursor||null
    if(rows.length||!next||next===cursor)break
    cursor=next
  }
  return {rows,next}
}

async function jobRows(db,user,jobs){
  if(!jobs.length)return []
  const items=jobs.map(j=>String(j.new_item_id||'')).filter(Boolean)
  const [drafts,stock,requests]=await Promise.all([
    db.from('listing_drafts').select('photos,payload,fields').eq('owner_id',user.id).in('payload->>scalency_job_id',jobs.map(j=>String(j.id))),
    items.length?db.from('scalency_records').select('remote_id,account,payload').eq('kind','items').in('remote_id',items):{data:[]},
    items.length?db.from('scalency_commands').select('request_id,result').in('request_id',jobs.filter(j=>j.new_item_id).map(j=>removalKey(j.account_id,j.new_item_id))):{data:[]}
  ])
  const byJob=new Map(checked(drafts).map(d=>[String(d.payload.scalency_job_id),d]))
  const byItem=new Map(checked(stock).map(d=>[removalKey(d.account,d.remote_id),d.payload]))
  const removals=new Map(checked(requests).map(r=>[r.request_id,r.result]))
  const links=await covers(db,user.id,[...byJob.values()].map(d=>d.photos?.[0]?.path))
  await Promise.all([...removals].filter(([,r])=>r.status==='removing').map(async([key,r])=>{
    try{
      const j=r.job?await remote('jobs/'+remoteId(r.job)):null
      let status=j?.status==='done'?'deleted':['failed','skipped','cancelled'].includes(j?.status)?'remove-failed':null
      if(!j){const [,account,id]=key.split(':');const item=await remote('items/'+remoteId(id),{query:{account_id:account}});if(item.status==='deleted')status='deleted'}
      if(status){const update={...r,status};checked(await db.from('scalency_commands').update({result:update}).eq('request_id',key).eq('result',JSON.stringify(r)));removals.set(key,update)}
    }catch{/* Keep the acknowledged request visible until its outcome is known. */}
  }))
  return jobs.map(j=>{
    const draft=byJob.get(String(j.id)),k=removalKey(j.account_id,j.new_item_id),stock=byItem.get(k),removal=removals.get(k)?.status
    const gone=stock?.status==='deleted'||removal==='deleted'
    return {...j,kind:'job',id:String(j.id),account:String(j.account_id),sku:j.refs?.sku||draft?.fields?.sku,size:draft?.fields?.size_text,
      photo:links.get(draft?.photos?.[0]?.path)||stock?.photo_url||j.photo_url||null,
      removal:gone?'deleted':removal,actions:canMoveJob(j)?['move','cancel']:['sent','queued','waiting','pending','scheduled'].includes(j.status)?['cancel']:activeStates.includes(j.status)?[]:
        j.status==='done'&&j.new_item_id&&!gone&&!stock?.sold&&removal!=='removing'?['remove']:[]}
  })
}

export async function publicationTracking(db,user,q){
  const account=q.account?remoteId(q.account):null,tab=q.tab||'queue',term=String(q.search||'').trim().toLocaleLowerCase('fr').slice(0,120)
  if(!['drafts','queue','live','history','lots'].includes(tab)||String(q.cursor||'').length>512)throw new ScalencyError('Filtre invalide.')
  const page=Math.max(0,Math.min(100000,parseInt(q.draftPage,10)||0))
  const accounts=checked(await db.from('scalency_records').select('remote_id,payload').eq('kind','accounts')).map(a=>({id:a.remote_id,login:a.payload?.login||a.remote_id})).sort((a,b)=>a.login.localeCompare(b.login))
  const stage=tab==='queue'&&!q.job&&!q.draft?q.stage:''
  const [drafts,jobs]=await Promise.all([q.job||['scalency','site'].includes(stage)?{rows:[],total:0}:localRows(db,user,{account,accounts,tab,page,term,draft:q.draft}),stage==='local'?{rows:[],next:null}:jobPage(db,user,{...q,tab,stage,account,term})])
  return {accounts,drafts:drafts.rows,draftTotal:drafts.total,pageSize,jobs:await jobRows(db,user,jobs.rows),nextCursor:jobs.next,checkedAt:new Date().toISOString()}
}
