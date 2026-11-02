import {AppError,isId} from './dotb.js'
import {dotbRequest} from './sales-automation.js'

const MAX_PDF_BYTES=8*1024*1024
const LABEL_HOST='dotb-storage.s3.eu-central-003.backblazeb2.com'
const blocked=new Set(['cancelled','returning','suspended'])

export function labelSource(value) {
  let url
  try{url=new URL(value)}catch{throw new AppError('Le lien du bordereau Dotb est invalide.',422)}
  if(url.protocol!=='https:'||url.hostname!==LABEL_HOST||url.port||url.username||url.password)throw new AppError('La source du bordereau Dotb n’est pas reconnue.',422)
  return url.href
}

export async function downloadLabel(url,fetcher=fetch) {
  let response
  try{response=await fetcher(labelSource(url),{redirect:'error',signal:AbortSignal.timeout(12000),headers:{Accept:'application/pdf'}})}
  catch(error){if(error instanceof AppError)throw error;throw new AppError('Le téléchargement du bordereau a été interrompu. Réessaie.',502)}
  if(!response.ok)throw new AppError('Le bordereau n’est plus accessible dans Dotb. Actualise la vente dans Dotb puis réessaie.',response.status===404||response.status===403?410:502)
  if(Number(response.headers.get('content-length'))>MAX_PDF_BYTES)throw new AppError('Ce bordereau est trop volumineux.',422)
  const chunks=[];let size=0
  for await(const chunk of response.body){size+=chunk.length;if(size>MAX_PDF_BYTES)throw new AppError('Ce bordereau est trop volumineux.',422);chunks.push(chunk)}
  const bytes=Buffer.concat(chunks)
  if(bytes.subarray(0,5).toString()!=='%PDF-')throw new AppError('Dotb n’a pas renvoyé un bordereau PDF.',422)
  return bytes
}

export async function shippingLabel(db,id,{fetcher=fetch,readOrder=dotbRequest,convert}={}) {
  if(typeof id!=='string'||id.length>80||!id)throw new AppError('Vente invalide.')
  const {data:line,error}=await db.from('workspace_sales').select('id,order_id,order').eq('id',id).maybeSingle()
  if(error)throw error
  if(!line||!isId(line.order_id))throw new AppError('Cette vente n’est plus disponible dans la période suivie.',404)
  if(blocked.has(line.order?.status))throw new AppError('Cette vente est annulée, suspendue ou en retour. Son bordereau ne doit pas être utilisé.',409)
  let url=line.order?.label_url
  async function refresh(){
    const order=await readOrder(`orders/${line.order_id}`,{fetcher})
    if(order?.id!==line.order_id)throw new AppError('Le bordereau ne correspond pas à cette vente.',502)
    if(blocked.has(order.normalized_status))throw new AppError('Cette vente est annulée, suspendue ou en retour. Son bordereau ne doit pas être utilisé.',409)
    if(!order.shipping_label_url)throw new AppError('Le bordereau n’est pas encore disponible dans Dotb. Dès qu’il sera généré, tu pourras le récupérer ici.',409)
    url=labelSource(order.shipping_label_url)
    const saved=await db.from('sales_orders').update({label_url:url}).eq('id',line.order_id)
    if(saved.error)throw saved.error
  }
  let refreshed=false
  if(!url){await refresh();refreshed=true}
  let bytes
  try{bytes=await downloadLabel(url,fetcher)}catch(error){
    if(error.status!==410||refreshed)throw error
    await refresh();bytes=await downloadLabel(url,fetcher)
  }
  const prepare=convert||(await import('./shipping-label-pdf.js')).thermalLabel
  const result=await prepare(bytes,{preview:true})
  if(result.bytes.length>3*1024*1024)throw new AppError('Le bordereau préparé est trop volumineux.',422)
  return {pdf:Buffer.from(result.bytes).toString('base64'),preview:result.preview?Buffer.from(result.preview).toString('base64'):undefined,filename:`bordereau-${line.order_id.slice(0,8)}-100x150.pdf`,format:'100 × 150 mm',carrier:result.carrier}
}
