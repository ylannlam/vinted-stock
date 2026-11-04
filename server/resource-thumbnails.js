import {AppError,isId} from './dotb.js'
import {ASSET_BUCKET,MAX_ASSET_BYTES,THUMB_MAX,thumbPath,attachImages,ensureAssetBucket} from './resources.js'

// Some PNG provenance manifests contain an embedded SVG. The native decoder
// mistakes that metadata for the image itself. Remove only that ancillary chunk
// from the temporary decoding buffer; the stored original is never rewritten.
function pngDecodeBuffer(bytes) {
  if(!bytes.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10])))return bytes
  const parts=[bytes.subarray(0,8)];let offset=8,changed=false
  while(offset+12<=bytes.length){
    const end=offset+12+bytes.readUInt32BE(offset)
    if(end>bytes.length)return bytes
    if(bytes.toString('ascii',offset+4,offset+8)==='caBX')changed=true
    else parts.push(bytes.subarray(offset,end))
    offset=end
  }
  return changed&&offset===bytes.length?Buffer.concat(parts):bytes
}

// Loaded on demand so the native image library only starts when thumbnails are made.
export async function makeThumbnail(bytes,max=THUMB_MAX) {
  const {createCanvas,loadImage}=await import('@napi-rs/canvas')
  const image=await loadImage(pngDecodeBuffer(Buffer.from(bytes)))
  if(!image.width||!image.height)throw new AppError('Image illisible.')
  const scale=Math.min(1,max/Math.max(image.width,image.height))
  const width=Math.max(1,Math.round(image.width*scale)),height=Math.max(1,Math.round(image.height*scale))
  const canvas=createCanvas(width,height)
  canvas.getContext('2d').drawImage(image,0,0,width,height)
  return canvas.encode('webp',80)
}

const exists=error=>error&&(String(error.statusCode)==='409'||/exist|duplicate/i.test(error.message||''))

// Creates missing previews for a few resources. Originals are only read, never changed.
export async function generateThumbnails(db,ids,{make=makeThumbnail}={}) {
  if(!Array.isArray(ids)||!ids.length||ids.length>4||!ids.every(isId)||new Set(ids).size!==ids.length)throw new AppError('Sélection d’images invalide.')
  const {data:rows,error}=await db.from('creative_resources').select('*').in('id',ids)
  if(error)throw error
  const paths=rows.filter(row=>row.image_bucket&&row.image_path).map(row=>thumbPath(row.image_bucket,row.image_path))
  const existing=paths.length?await db.storage.from(ASSET_BUCKET).createSignedUrls(paths,3600):{data:[]}
  if(existing.error)throw existing.error
  const ready=new Set((existing.data||[]).filter(asset=>asset.signedUrl).map(asset=>asset.path))
  if(paths.some(path=>!ready.has(path)))await ensureAssetBucket(db)
  const failed=[]
  for(const row of rows) {
    if(!row.image_bucket||!row.image_path||ready.has(thumbPath(row.image_bucket,row.image_path)))continue
    try {
      const file=await db.storage.from(row.image_bucket).download(row.image_path)
      if(file.error)throw file.error
      if(!file.data||file.data.size>MAX_ASSET_BYTES)throw new AppError('Image trop lourde.')
      const thumbnail=await make(new Uint8Array(await file.data.arrayBuffer()))
      const sent=await db.storage.from(ASSET_BUCKET).upload(thumbPath(row.image_bucket,row.image_path),thumbnail,{contentType:'image/webp',cacheControl:'31536000',upsert:false})
      if(sent.error&&!exists(sent.error))throw sent.error
    }catch{failed.push(row.id)}
  }
  const signed=await attachImages(db,rows)
  return {thumbnails:signed.map(r=>({id:r.id,thumb_url:r.thumb_url,thumb_path:r.thumb_path})),failed}
}
