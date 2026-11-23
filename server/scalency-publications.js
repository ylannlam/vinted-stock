import {remote,remoteId,ScalencyError} from './scalency-api.js'

const pageSize=20
const statuses=new Set(['queued','sent','done','failed','cancelled','skipped'])
function rows(result){
  if(result.error)throw result.error
  return result.data
}

export async function publicationTracking(db,user,q){
  const account=q.account?remoteId(q.account):null
  const jobId=q.job?remoteId(q.job):null
  const cursor=q.cursor?String(q.cursor):null
  if(cursor&&cursor.length>512)throw new ScalencyError('Page de publications invalide.')
  if(q.status&&!statuses.has(q.status))throw new ScalencyError('Filtre de publication invalide.')
  const draftPage=Math.max(0,Math.min(100000,parseInt(q.draftPage,10)||0))
  const accounts=rows(await db.from('scalency_records').select('remote_id,payload').eq('kind','accounts'))
  const logins=new Map(accounts.map(a=>[a.remote_id,a.payload?.login]))
  // Older Stock Vinted drafts predate the source marker. Match these editable
  // drafts by their Scalency account, without importing old providers' queues.
  const sources=['payload->>scalency_source.eq.stock-vinted']
  const known=accounts.map(a=>a.remote_id).filter(id=>/^[a-z0-9_-]+$/i.test(id))
  if(known.length)sources.push('and(state.eq.draft,fields->>account_id.in.('+known.join(',')+'))')
  sources.push('and(state.eq.preparing,message.eq.Transmission à Scalency)')
  let pending=db.from('listing_drafts').select('id,state,fields,updated_at,message',{count:'exact'})
    .eq('owner_id',user.id).in('state',['draft','preparing','attention'])
    .is('payload->>scalency_job_id',null).or(sources.join(','))
  if(account)pending=pending.eq('fields->>account_id',account)
  const [draftResult,jobResult]=await Promise.all([
    pending.order('updated_at',{ascending:false}).order('id').range(draftPage*pageSize,(draftPage+1)*pageSize-1),
    jobId?remote('jobs/'+jobId):remote('jobs',{query:{type:'publish',account_id:account,status:q.status,cursor,limit:pageSize}})
  ])
  const drafts=rows(draftResult).map(d=>({id:d.id,state:d.state,title:d.fields?.title,sku:d.fields?.sku,
    account:logins.get(d.fields?.account_id),updated_at:d.updated_at,message:d.message}))
  const jobs=(jobId?[jobResult]:jobResult.data).filter(j=>j.type==='publish'&&(!account||String(j.account_id)===account))
    .map(j=>({id:String(j.id),title:j.title,account:logins.get(String(j.account_id)),sku:j.refs?.sku,
      status:j.status,status_label:j.status_label,reason:j.reason,not_before:j.not_before,
      created_at:j.created_at,sent_at:j.sent_at,done_at:j.done_at,updated_at:j.updated_at,new_item_id:j.new_item_id}))
  return {drafts,draftTotal:draftResult.count,pageSize,jobs,nextCursor:jobId?null:jobResult.next_cursor||null,checkedAt:new Date().toISOString()}
}
