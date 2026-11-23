import {remote,remoteId,ScalencyError} from './scalency-api.js'
import {accountBrand} from './scalency-quick.js'
import {quickIssues} from '../src/lib/scalencyQuick.js'
import {ASSET_BUCKET,ownedAsset} from './resources.js'

const checked=r=>{if(r.error)throw r.error;return r.data}
export function reviewMetadata(options,missing){
  return {status:missing.length?'review':'ready',missing,category:options?.catalog?.title||options?.ancestors?.at(-1)?.title||''}
}
export async function reviewEditedDraft(db,fields,photos){
  const options=fields.catalog_id?await remote('catalogs/'+remoteId(fields.catalog_id)):null
  const missing=quickIssues(fields,options)
  if(!photos.length)missing.push('Photos')
  if(fields.account_id){
    try{if(fields.brand_id||fields.brand_title!==await accountBrand(db,fields.account_id))missing.push('Marque du compte')}
    catch(e){if(!(e instanceof ScalencyError)||e.status!==409)throw e;missing.push(e.message)}
  }
  return reviewMetadata(options,missing)
}
export function checkBatchSubmission(row,account){
  if(!account||row.fields.account_id!==account)throw new ScalencyError('Cette annonce appartient à un autre compte.',409)
  if(row.payload?.batch?.status!=='ready')throw new ScalencyError('Vérifie cette fiche avant de l’ajouter au lot.',409)
}
export async function batchDrafts(db,user,q){
  const page=Math.max(0,parseInt(q.page,10)||0),pageSize=36
  let read=db.from('listing_drafts').select('id,version,state,fields,photos,payload,updated_at',{count:'exact'}).eq('owner_id',user.id).eq('state','draft')
  if(q.account)read=read.eq('fields->>account_id',remoteId(q.account))
  const result=await read.order('updated_at',{ascending:false}).order('id').range(page*pageSize,(page+1)*pageSize-1)
  const drafts=checked(result)
  const paths=[...new Set(drafts.map(d=>d.photos?.[0]?.path).filter(p=>p&&ownedAsset(p,user.id)))]
  const urls=paths.length?checked(await db.storage.from(ASSET_BUCKET).createSignedUrls(paths,1800)):[]
  const covers=new Map(urls.map(r=>[r.path,r.signedUrl]))
  return {rows:drafts.map(d=>({id:d.id,version:d.version,fields:d.fields,updated_at:d.updated_at,
    photo: covers.get(d.photos?.[0]?.path)||null,count:d.photos?.length||0,batch:d.payload?.batch||null})),page,pageSize,total:result.count}
}
