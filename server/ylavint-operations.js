import {createHash} from 'node:crypto'
import {AppError,isId} from './dotb.js'
import {check,cid,BUCKET} from './vinted-agent.js'
import {ordersView,orderStatus} from './ylavint.js'
import {isDesktop} from '../src/lib/ylavintExecution.js'
import {orderKey,orderIdentity,toPrepare,todayItems,resultMetrics,visibleDeadline} from '../src/lib/ylavintOperations.js'

const time=v=>Date.parse(v)||0
const clean=(v,max=200)=>typeof v==='string'?v.trim().slice(0,max):null
const chunks=async(values,read)=>{const rows=[];for(let i=0;i<values.length;i+=80)rows.push(...check(await read(values.slice(i,i+80))));return rows}
export async function enrichOrders(db,orders){
 if(!orders.length)return []
 const accounts=[...new Set(orders.map(o=>o.account_id))],saleIds=orders.map(o=>o.sales_order_id).filter(Boolean)
 const [prep,tasks,lines]=await Promise.all([
  chunks([...new Set(orders.map(orderKey))],keys=>db.from('ylavint_order_preparation').select('*').in('account_id',accounts).in('order_key',keys)),
  db.from('vinted_agent_tasks').select('id,account_id,state,payload,error,created_at,finished_at,result').eq('kind','order_extension').in('account_id',accounts).order('created_at',{ascending:false}).limit(1000).then(check),
  chunks([...new Set(saleIds)],ids=>db.from('sales_lines').select('order_id,source,sku_override,location,source_active').in('order_id',ids).eq('source_active',true)),
 ])
 const map=new Map(prep.map(p=>[`${p.account_id}|${p.order_key}`,p]))
 return orders.map(o=>{
  const p=map.get(orderIdentity(o)),items=lines.filter(l=>l.order_id===o.sales_order_id)
  const task=tasks.find(t=>t.account_id===o.account_id&&t.payload?.conversation_id===o.conversation_id)
  const observed=o.extension_state||'unknown'
  let extension={state:observed,checked_at:o.extension_checked_at||null}
  if(task){const state=['queued','running','failed','cancelled'].includes(task.state)?task.state:task.result?.extension_state||observed
   extension={state,task_id:task.id,days:task.payload?.days,error:task.error,checked_at:task.finished_at||task.created_at}
   if(time(o.extension_checked_at)>time(task.finished_at||task.created_at)&&['pending','accepted','declined'].includes(observed))extension.state=observed
  }
  return {...o,order_key:orderKey(o),ship_deadline:o.ship_deadline||visibleDeadline(o.deadline_text,time(o.seen_at)||Date.now()),extension,
   preparation:{sku:p?.sku??items.map(l=>l.sku_override||l.source?.sku).filter(Boolean).join(' / '),location:p?.location??items.map(l=>l.location||l.source?.location).filter(Boolean).join(' / '),prepared_at:p?.prepared_at||null,updated_at:p?.updated_at||null},
   picking_items:items.map(l=>({title:l.source?.title,photo_url:l.source?.thumbnail_url,sku:l.sku_override||l.source?.sku||'',location:l.location||l.source?.location||''}))}
 })
}

async function paged(make,max=20000){
 const rows=[]
 for(let offset=0;offset<max;offset+=1000){const part=check(await make().range(offset,offset+999));rows.push(...part);if(part.length<1000)return {rows,truncated:false}}
 return {rows,truncated:true}
}
export async function operationsView(db,view,{account=null,days=7,now=Date.now()}={}){
 const orders=await enrichOrders(db,await ordersView(db,account)),accountFilter=q=>account?q.eq('account_id',account):q
 const names=new Map(check(await db.from('publication_accounts').select('id,login')).map(a=>[a.id,a.login]))
 const coverage={orders_limited:orders.length>=500,as_of:new Date(now).toISOString()}
 if(view==='preparation')return {orders:orders.filter(toPrepare),coverage}
 if(view==='today'){
  const [convs,tasks]=await Promise.all([
   accountFilter(db.from('ylavint_conversations').select('account_id,conversation_id,other_login,item_title,item_photo,last_message,ai_state,ai_reason,needs_human').or('needs_human.eq.true,ai_state.in.(drafted,error)').order('last_message_at',{ascending:false}).limit(500)).then(check),
   accountFilter(db.from('vinted_agent_tasks').select('id,account_id,kind,state,error').eq('state','failed').gte('finished_at',new Date(now-864e5).toISOString()).order('finished_at',{ascending:false}).limit(100)).then(check),
  ])
  const name=r=>({...r,login:names.get(r.account_id)||null})
  return {items:todayItems(orders,convs.map(name),tasks.map(name),now),coverage:{...coverage,limited:coverage.orders_limited||convs.length>=500||tasks.length>=100}}
 }
 days=[1,7,30].includes(Number(days))?Number(days):7
 const from=now-days*864e5,start=new Date(from).toISOString(),end=new Date(now).toISOString()
 const [messages,offers]=await Promise.all([
  paged(()=>accountFilter(db.from('ylavint_messages').select('id,account_id,conversation_id,from_me,kind,state,source,sent_at').gte('sent_at',start).lte('sent_at',end).order('id'))),
  paged(()=>accountFilter(db.from('vinted_agent_tasks').select('id,account_id,finished_at,result').eq('kind','like_message').eq('state','done').gte('finished_at',start).lte('finished_at',end).order('id'))),
 ])
 const metric=a=>resultMetrics({messages:messages.rows.filter(m=>!a||m.account_id===a),offers:offers.rows.filter(m=>!a||m.account_id===a),orders:orders.filter(o=>!a||o.account_id===a),from,to:now})
 return {days,from:start,to:end,totals:metric(account),accounts:[...names].filter(([id])=>!account||id===account).map(([id,login])=>({account_id:id,login,...metric(id)})),coverage:{...coverage,limited:coverage.orders_limited||messages.truncated||offers.truncated},method:'Messages confirmés pendant la période. Réponses et ventes datées dans les 7 jours suivant un message, dans la même conversation et sur le même compte. Une vente ne prouve pas qu’elle a été causée par l’assistant. Les remises affichées sont proposées, pas nécessairement acceptées.'}
}

export function selectedOrders(orders,selection){
 if(!Array.isArray(selection)||!selection.length||selection.length>20)throw new AppError('Sélectionne de 1 à 20 colis.')
 const seen=new Set(),out=[]
 for(const s of selection){if(!isId(s?.account_id)||typeof s.order_key!=='string')throw new AppError('Sélection invalide.')
  const identity=`${s.account_id}|${s.order_key}`;if(seen.has(identity))throw new AppError('La sélection contient un doublon.');seen.add(identity)
  const o=orders.find(o=>orderIdentity(o)===identity);if(!o)throw new AppError('Une vente sélectionnée n’est plus disponible. Actualise la liste.',409)
  if(!toPrepare(o))throw new AppError(`Vente à vérifier avant préparation : ${o.title}`,409)
  out.push(o)
 }
 return out.sort((a,b)=>(a.carrier||'Transporteur non lu').localeCompare(b.carrier||'Transporteur non lu')||(a.login||'').localeCompare(b.login||'')||orderIdentity(a).localeCompare(orderIdentity(b)))
}
export async function mergeLabelPdfs(files){
 const {PDFDocument,PrintScaling}=await import('pdf-lib'),out=await PDFDocument.create(),width=100*72/25.4,height=150*72/25.4
 out.catalog.getOrCreateViewerPreferences().setPrintScaling(PrintScaling.None)
 for(const bytes of files){const doc=await PDFDocument.load(bytes);if(doc.getPageCount()!==1)throw new AppError('Chaque colis doit correspondre à une seule étiquette.',422)
  const p=doc.getPage(0),size=p.getSize();if(Math.abs(size.width-width)>.5||Math.abs(size.height-height)>.5||p.getRotation().angle%360!==0)throw new AppError('Une étiquette n’est pas au format 100 × 150 mm.',422)
  out.addPage((await out.copyPages(doc,[0]))[0])
 }
 return out.save()
}
export async function batchLabels(db,orders){
 if(orders.some(o=>!o.label_path))throw new AppError('Il manque un bordereau dans la sélection. Aucun lot incomplet n’a été créé.',409)
 const download=async path=>new Uint8Array(await check(await db.storage.from(BUCKET).download(path)).arrayBuffer()),files=[]
 const {thermalLabel}=await import('./shipping-label-pdf.js')
 for(const o of orders){
  if(!o.title)throw new AppError('Un article n’a pas de titre confirmé.',422)
  if(o.thermal_path&&o.thermal_title===o.title&&o.label_source!=='extension')files.push(await download(o.thermal_path))
  else files.push((await thermalLabel(await download(o.label_path),{note:o.title,preview:false})).bytes)
 }
 const bytes=await mergeLabelPdfs(files)
 if(bytes.length>25*1024*1024)throw new AppError('Ce lot est trop volumineux. Sélectionne moins de colis.',422)
 const hash=createHash('sha256').update(JSON.stringify(orders.map(o=>[orderIdentity(o),o.title,o.label_path,o.label_fetched_at]))).digest('hex')
 const path=`agent-labels/batches/${hash}.pdf`
 check(await db.storage.from(BUCKET).upload(path,bytes,{contentType:'application/pdf',upsert:true}))
 const {renderLabelPreview}=await import('./shipping-label-pdf.js')
 return {url:check(await db.storage.from(BUCKET).createSignedUrl(path,300)).signedUrl,preview:Buffer.from(await renderLabelPreview(files[0])).toString('base64'),filename:'colis-100x150.pdf',count:orders.length,manifest:orders.map((o,i)=>({...o,label_number:i+1}))}
}
export async function operationsAction(db,b,user){
 const account=isId(b.account_id)?b.account_id.toLowerCase():null
 if(b.action==='request_extension')return queueExtension(db,{...b,account_id:account},user)
 const orders=await enrichOrders(db,await ordersView(db,b.action==='labels_batch'?null:account))
 if(b.action==='labels_batch')return batchLabels(db,selectedOrders(orders,b.selection))
 const [o]=selectedOrders(orders,[{account_id:account,order_key:b.order_key}])
 const before=check(await db.from('ylavint_order_preparation').select('*').eq('account_id',account).eq('order_key',o.order_key).maybeSingle())
 const row={...before,account_id:account,order_key:o.order_key,updated_by:user.id,updated_at:new Date().toISOString()}
 for(const key of ['sku','location'])if(Object.hasOwn(b,key)){if(typeof b[key]!=='string'||b[key].length>200)throw new AppError('Référence ou emplacement trop long.');row[key]=clean(b[key])}
 if(Object.hasOwn(b,'prepared')){if(typeof b.prepared!=='boolean')throw new AppError('État de préparation invalide.');row.prepared_at=b.prepared?(before?.prepared_at||new Date().toISOString()):null}
 check(await db.from('ylavint_order_preparation').upsert(row,{onConflict:'account_id,order_key'}))
 return {saved:true,message:'Préparation enregistrée. Le statut d’expédition Vinted reste géré par Vinted.'}
}
export async function queueExtension(db,b,user){
 const id=cid(b.conversation_id),days=Number(b.days),reason=clean(b.reason,200)||''
 if(!b.account_id||!id||![3,5].includes(days)||typeof b.reason!=='string'||b.reason.length>200)throw new AppError('Choisis la vente et 3 ou 5 jours ouvrés. Le motif est facultatif (200 caractères maximum).')
 const row=check(await db.from('ylavint_desktop_orders').select('*').eq('account_id',b.account_id).eq('conversation_id',id).maybeSingle())
 if(!row||!toPrepare({normalized:orderStatus(row.status)})||!row.item_id)throw new AppError('Relis cette vente à expédier avec l’Assistant PC avant de demander un délai.',409)
 if(['pending','accepted','declined','unavailable'].includes(row.extension_state))throw new AppError('Cette vente a déjà une demande ou ne propose pas de prolongation. Relis-la sur Vinted.',409)
 const settings=check(await db.from('vinted_agent_settings').select('enabled,messaging,extension_version').eq('account_id',b.account_id).maybeSingle())
 if(!settings?.enabled||!isDesktop(settings))throw new AppError('Active l’Assistant PC sur ce compte.',409)
 if(!/^pc-1\.(?:[8-9]|[1-9]\d)\./.test(settings.extension_version||''))throw new AppError('Mets à jour le connecteur 1.8 puis démarre ce compte avant de demander un délai.',409)
 const r=await db.from('vinted_agent_tasks').insert({account_id:b.account_id,kind:'order_extension',writes:true,priority:8,dedupe_key:`desktop-extension:${b.account_id}:${id}`,created_by:user.id,payload:{desktop_order:true,conversation_id:id,item_id:row.item_id,title:row.title,days,reason,manual:true}}).select('id').single()
 if(r.error?.code==='23505')throw new AppError('Une demande a déjà été préparée pour cette vente. Consulte son état avant toute autre action.',409)
 const task=check(r);return {task_id:task.id,message:'Demande mise en file. L’assistant vérifiera le bouton Vinted, les jours disponibles et la vente avant l’envoi. L’acheteur devra accepter.'}
}
export async function extensionPayload(db,task){
 const p=task.payload||{},id=cid(p.conversation_id)
 if(p.desktop_order!==true||!id||![3,5].includes(p.days))return {skip:'Demande de prolongation invalide.'}
 const row=check(await db.from('ylavint_desktop_orders').select('*').eq('account_id',task.account_id).eq('conversation_id',id).maybeSingle())
 if(!row||row.item_id!==p.item_id||!toPrepare({normalized:orderStatus(row.status)}))return {...p,skip:'Cette vente a changé : demande non envoyée.'}
 if(['pending','accepted','declined','unavailable'].includes(row.extension_state))return {...p,skip:'Prolongation déjà traitée ou indisponible.',extension_state:row.extension_state}
 return p
}
export async function extensionResult(db,task,value,now=Date.now()){
 const id=cid(task.payload?.conversation_id)
 if(value?.skipped)return {skipped:true,extension_state:['pending','accepted','declined','unavailable'].includes(value.extension_state)?value.extension_state:'unavailable',message:clean(value.skipped,300)}
 if(!id||value?.conversation_id!==id||value?.requested!==true||value.days!==task.payload.days||value.extension_state!=='pending')throw new AppError('La demande de prolongation n’est pas confirmée sur Vinted.',409)
 check(await db.from('ylavint_desktop_orders').update({extension_state:'pending',extension_checked_at:new Date(now).toISOString()}).eq('account_id',task.account_id).eq('conversation_id',id))
 return {extension_state:'pending',days:value.days,conversation_id:id,message:`Demande de ${value.days} jours ouvrés envoyée. Réponse de l’acheteur attendue.`}
}
