import {authorize} from '../server/auth.js'
import {AppError,isId} from '../server/dotb.js'
import {resourceValue,uploadTarget,ownedAsset,checkAssetInfo,ensureAssetBucket,attachImages,ASSET_BUCKET} from '../server/resources.js'
import {readPage} from '../server/pagination.js'
export const config={maxDuration:30}
const check=e=>{if(e)throw e}
export function resourcesHandler(authorizer=authorize) {
return async function handler(req,res) {
  res.setHeader('Cache-Control','no-store')
  if(!['GET','POST','PATCH'].includes(req.method)){res.setHeader('Allow','GET, POST, PATCH');return res.status(405).end()}
  try {
    const auth=await authorizer(req,res,['admin']);if(!auth)return
    const {db,user}=auth
    if(req.method==='GET') {
      const offset=Number(req.query?.offset||0)
      if(!Number.isSafeInteger(offset)||offset<0||offset>100000)throw new AppError('Page invalide.')
      const page=await readPage(head=>db.from('creative_resources').select('*',{count:'exact',head}).order('updated_at',{ascending:false}).order('id'),offset,50)
      return res.json({resources:await attachImages(db,page.data),count:page.count,page_size:50})
    }
    const body=req.body
    if(!body||typeof body!=='object')throw new AppError('Formulaire invalide.')
    if(body.action==='upload') {
      const path=uploadTarget(user.id,body)
      await ensureAssetBucket(db)
      const r=await db.storage.from(ASSET_BUCKET).createSignedUploadUrl(path);check(r.error)
      return res.json({path,token:r.data.token})
    }
    if(!isId(body.id))throw new AppError('Ressource invalide.')
    const existing=await db.from('creative_resources').select('*').eq('id',body.id).maybeSingle();check(existing.error)
    const current=existing.data
    if(body.action==='download') {
      if(!current?.image_path)throw new AppError('Image introuvable.',404)
      const name=current.title.replace(/[^\p{L}\p{N} _-]/gu,'').slice(0,100)||'fond'
      const r=await db.storage.from(current.image_bucket).createSignedUrl(current.image_path,300,{download:`${name}.${current.image_path.split('.').pop()}`});check(r.error)
      return res.json({url:r.data.signedUrl})
    }
    // A create request may have succeeded before its network response was lost.
    if(current&&body.action==='save'&&body.version==null&&current.created_by===user.id) {
      const value=resourceValue(body)
      if(['kind','title','category','content','notes'].every(k=>value[k]===current[k])&&(body.image_path||null)===current.image_path)
        return res.json({saved:true,resource:(await attachImages(db,[current]))[0]})
    }
    if(current && (!Number.isInteger(body.version)||body.version!==current.version))throw new AppError('Cette ressource a changé. Actualise avant de réessayer ; ton texte reste dans le formulaire.',409)
    if(!current && body.version!=null)throw new AppError('Ressource introuvable. Actualise la bibliothèque.',404)
    let patch
    if(body.action==='save') {
      const value=resourceValue(body);delete value.id
      const path=body.image_path||null
      let bucket=null
      if(path && path===current?.image_path)bucket=current.image_bucket
      else if(path) {
        if(!ownedAsset(path,user.id))throw new AppError('Cette image n’appartient pas à cet envoi.')
        const info=await db.storage.from(ASSET_BUCKET).info(path);check(info.error);checkAssetInfo(info.data);bucket=ASSET_BUCKET
      }
      patch={...value,image_path:path,image_bucket:bucket}
    } else if(body.action==='favorite'&&current&&typeof body.favorite==='boolean')patch={favorite:body.favorite}
    else if(body.action==='archive'&&current&&typeof body.archived==='boolean')patch={archived_at:body.archived?new Date().toISOString():null}
    else throw new AppError('Action inconnue.')
    const r=current?await db.from('creative_resources').update({...patch,version:current.version+1,updated_at:new Date().toISOString()}).eq('id',body.id).eq('version',body.version).select().maybeSingle():await db.from('creative_resources').insert({...patch,id:body.id,created_by:user.id}).select().single()
    if(r.error?.code==='23505'||!r.error&&!r.data)throw new AppError('Cette ressource a déjà changé ou été enregistrée. Actualise la bibliothèque.',409)
    check(r.error)
    return res.json({saved:true,resource:(await attachImages(db,[r.data]))[0]})
  }catch(error) {
    console.error('resources_request_failed',{code:error.code||'unknown',status:error.status||500})
    return res.status(error.status||500).json({error:error instanceof AppError?error.message:'Impossible d’enregistrer pour le moment. Ton formulaire et les ressources existantes sont conservés.'})
  }
}
}
export default resourcesHandler()
