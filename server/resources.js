import {randomUUID} from 'node:crypto'
import {AppError,isId} from './dotb.js'
import {IMAGE_TYPES,MAX_IMAGE_BYTES,validateImage} from '../src/lib/resources.js'
export {IMAGE_TYPES}
export const ASSET_BUCKET='creative-assets'
export const MAX_ASSET_BYTES=MAX_IMAGE_BYTES
export function resourceValue(body) {
  if(!body||!isId(body.id)||!['prompt','background'].includes(body.kind))throw new AppError('Ressource invalide.')
  const value=(key,max,trim=true)=>{
    const text=body[key]??''
    if(typeof text!=='string'||text.length>max)throw new AppError(`Le champ ${key==='content'?'prompt':key==='title'?'titre':key==='category'?'catégorie':'notes'} est trop long ou invalide.`)
    return trim?text.trim():text
  }
  const result={id:body.id,kind:body.kind,title:value('title',120),category:value('category',60),content:value('content',50000,false),notes:value('notes',3000,false)}
  if(!result.title)throw new AppError('Donne un titre à cette ressource.')
  if(result.kind==='prompt'&&!result.content.trim())throw new AppError('Ajoute le texte du prompt.')
  if(body.image_path!==null&&body.image_path!==undefined&&(typeof body.image_path!=='string'||body.image_path.length>300))throw new AppError('Image invalide.')
  if(result.kind==='background'&&!body.image_path)throw new AppError('Choisis l’image de fond à enregistrer.')
  return result
}
export function uploadTarget(userId,body) {
  if(!isId(userId))throw new AppError('Utilisateur invalide.')
  try{validateImage(body)}catch(e){throw new AppError(e.message)}
  return `${userId}/${randomUUID()}.${IMAGE_TYPES[body.type]}`
}
export function ownedAsset(path,userId) {
  if(typeof path!=='string'||!isId(userId))return false
  const pieces=path.split('/')
  return pieces.length===2&&pieces[0]===userId&&/^[0-9a-f-]{36}\.(jpg|png|webp)$/.test(pieces[1])&&isId(pieces[1].split('.')[0])
}
export function checkAssetInfo(info) {
  if(!info||!Object.hasOwn(IMAGE_TYPES,info.contentType)||!Number.isFinite(info.size)||info.size<1||info.size>MAX_ASSET_BYTES)throw new AppError('L’image envoyée est invalide ou dépasse 10 Mo.')
}
export async function ensureAssetBucket(db) {
  let found=await db.storage.getBucket(ASSET_BUCKET)
  if(found.error) {
    const created=await db.storage.createBucket(ASSET_BUCKET,{public:false,fileSizeLimit:MAX_ASSET_BYTES,allowedMimeTypes:Object.keys(IMAGE_TYPES)})
    if(created.error){found=await db.storage.getBucket(ASSET_BUCKET);if(found.error)throw created.error}
    else found=await db.storage.getBucket(ASSET_BUCKET)
  }
  if(found.error)throw found.error
  if(found.data.public)throw new AppError('Le stockage des images doit être privé avant l’envoi.',503)
}
export async function attachImages(db,rows) {
  const urls=new Map()
  await Promise.all([ASSET_BUCKET,'fonds'].map(async bucket=>{
    const paths=[...new Set(rows.filter(r=>r.image_bucket===bucket&&r.image_path).map(r=>r.image_path))]
    if(!paths.length)return
    const {data,error}=await db.storage.from(bucket).createSignedUrls(paths,3600)
    if(error)return
    for(const asset of data||[])if(asset.signedUrl)urls.set(`${bucket}/${asset.path}`,asset.signedUrl)
  }))
  return rows.map(r=>({...r,image_url:urls.get(`${r.image_bucket}/${r.image_path}`)||null}))
}
