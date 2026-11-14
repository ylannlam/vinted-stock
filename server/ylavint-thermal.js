import {AppError} from './dotb.js'
import {check,cid,BUCKET} from './vinted-agent.js'

const update=(db,row,value)=>db.from('ylavint_desktop_orders').update(value).eq('account_id',row.account_id).eq('conversation_id',row.conversation_id)
export async function prepareDesktopThermal(db,row,bytes,{convert}={}){
 let prepared
 try{
  if(!row.title?.trim())throw new AppError('Le titre de l’article doit être confirmé avant de préparer l’étiquette.',422)
  const prepare=convert||(await import('./shipping-label-pdf.js')).thermalLabel
  prepared=await prepare(bytes,{note:row.title,preview:false})
  if(prepared.bytes.length>3*1024*1024)throw new AppError('Le bordereau préparé est trop volumineux.',422)
 }catch(error){
  if(!(error instanceof AppError))throw error
  const message=error.message.slice(0,300)
  check(await update(db,row,{thermal_error:message}))
  return {error:message}
 }
 const path=`agent-labels/${row.account_id}/visible-${row.conversation_id}-100x150.pdf`
 check(await db.storage.from(BUCKET).upload(path,prepared.bytes,{contentType:'application/pdf',upsert:true}))
 check(await update(db,row,{thermal_path:path,thermal_title:row.title,thermal_error:null}))
 return {path,bytes:prepared.bytes,carrier:prepared.carrier}
}
export async function desktopLabelPrint(db,account,conversation){
 if(!account||!cid(conversation))throw new AppError('Choisis le compte et la vente.')
 const row=check(await db.from('ylavint_desktop_orders').select('*').eq('account_id',account).eq('conversation_id',cid(conversation)).maybeSingle())
 if(!row?.label_path)throw new AppError('Bordereau pas encore récupéré.',404)
 if(/annul|rembours|litige|retour|suspend/i.test(row.status))throw new AppError('Cette commande doit être vérifiée sur Vinted avant impression.',409)
 const download=async path=>new Uint8Array(await check(await db.storage.from(BUCKET).download(path)).arrayBuffer())
 let bytes,carrier=row.carrier
 if(row.thermal_path&&row.thermal_title===row.title)bytes=await download(row.thermal_path)
 else{
  const result=await prepareDesktopThermal(db,row,await download(row.label_path))
  if(result.error)throw new AppError(result.error,422)
  bytes=result.bytes;carrier=result.carrier
 }
 const {renderLabelPreview}=await import('./shipping-label-pdf.js')
 const preview=await renderLabelPreview(bytes)
 return {pdf:Buffer.from(bytes).toString('base64'),preview:Buffer.from(preview).toString('base64'),filename:`bordereau-${row.conversation_id}-100x150.pdf`,format:'100 × 150 mm',carrier:carrier||'Bordereau Vinted'}
}
