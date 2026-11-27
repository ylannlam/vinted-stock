import {remoteId,ScalencyError} from './scalency-api.js'
import {accountBrand} from './scalency-quick.js'
import {quickIssues,vintedCondition,withBioCondition} from '../src/lib/scalencyQuick.js'
import {ASSET_BUCKET,ownedAsset} from './resources.js'
import {listingCovers} from './listing-covers.js'
import {makeThumbnail} from './resource-thumbnails.js'

const checked=r=>{if(r.error)throw r.error;return r.data}
export async function batchImages(db,userId,photos){
  const compact=photos.reduce((sum,photo)=>sum+Number(photo.size||8000000),0)>12000000
  if(photos.some(photo=>!ownedAsset(photo.path,userId)))throw new ScalencyError('Cette photo ne fait pas partie de ton envoi.',403)
  async function read(photo){
    const file=checked(await db.storage.from(ASSET_BUCKET).download(photo.path))
    let bytes=Buffer.from(await file.arrayBuffer()),type=photo.type
    const required=compact||bytes.length>5*1024*1024
    if(required||bytes.length>512*1024){
      try{
        const preview=await makeThumbnail(bytes,1152)
        if(required||preview.length<bytes.length){bytes=preview;type='image/webp'}
      }catch(error){if(required)throw error}
    }
    return 'data:'+type+';base64,'+bytes.toString('base64')
  }
  const images=[]
  for(let i=0;i<photos.length;i+=2)images.push(...await Promise.all(photos.slice(i,i+2).map(read)))
  return images
}
export function reviewMetadata(options,missing,fields){
  return {status:missing.length?'review':'ready',missing,category:options?.catalog?.title||options?.ancestors?.at(-1)?.title||'',
    condition:options?.conditions?.find(c=>c.id===fields?.status_id)?.title||''}
}
export async function reviewEditedDraft(db,fields,photos,options){
  const missing=quickIssues(fields,options)
  if(!photos.length)missing.push('Photos')
  if(fields.account_id){
    try{if(fields.brand_id||fields.brand_title!==await accountBrand(db,fields.account_id))missing.push('Marque du compte')}
    catch(e){if(!(e instanceof ScalencyError)||e.status!==409)throw e;missing.push(e.message)}
  }
  return reviewMetadata(options,missing,fields)
}
export function checkBatchSubmission(row,account){
  if(!account||row.fields.account_id!==account)throw new ScalencyError('Cette annonce appartient à un autre compte.',409)
  if(row.payload?.batch?.status!=='ready')throw new ScalencyError('Vérifie cette fiche avant de l’ajouter au lot.',409)
}
export async function batchDrafts(db,user,q){
  const page=Math.max(0,parseInt(q.page,10)||0),readyOnly=q.ready==='1'&&!!q.account,pageSize=readyOnly?100:36
  let read=db.from('listing_drafts').select('id,version,state,fields,photos,payload,updated_at',{count:'exact'}).eq('owner_id',user.id).eq('state','draft')
  if(q.account)read=read.eq('fields->>account_id',remoteId(q.account))
  if(readyOnly)read=read.eq('payload->batch->>status','ready').is('payload->>scalency_job_id',null).is('published_at',null)
    .is('vinted_id',null).is('publication_task_id',null).is('inflight',null).is('dotb_item_id',null)
  const [result,counts]=await Promise.all([
    read.order('updated_at',{ascending:false}).order('id').range(page*pageSize,(page+1)*pageSize-1),
    q.withCounts==='1'?db.rpc('scalency_draft_counts',{p_owner:user.id}):null
  ])
  const drafts=checked(result)
  const covers=await listingCovers(db,user.id,drafts.map(d=>d.photos?.[0]?.path))
  return {...(counts?{draftCounts:counts.error?null:counts.data}:{}),rows:drafts.map(d=>({id:d.id,version:d.version,fields:d.payload?.batch?.status==='ready'?withBioCondition(d.fields):d.fields,updated_at:d.updated_at,
    photo: covers.get(d.photos?.[0]?.path)?.preview||covers.get(d.photos?.[0]?.path)?.original||null,count:d.photos?.length||0,batch:d.payload?.batch?.status==='ready'?{...d.payload.batch,condition:vintedCondition}:d.payload?.batch||null})),page,pageSize,total:result.count}
}
