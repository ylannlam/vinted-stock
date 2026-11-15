import {AppError} from './dotb.js'
import {check,cid,vid,money,text,BUCKET,enqueue,parseLabel} from './vinted-agent.js'
import {visibleDeadline} from '../src/lib/ylavintOperations.js'

const photo=v=>typeof v==='string'&&/^https:\/\/[a-z0-9.-]+\.vinted\.net\//.test(v)?v.slice(0,500):null
export function parseWallet(result){
 if(!result||result.currency!=='EUR'||typeof result.available!=='number'||typeof result.pending!=='number'||[result.available,result.pending].some(v=>!Number.isFinite(v)||v<0||v>1000000||Math.abs(v*100-Math.round(v*100))>0.0001))throw new AppError('Les deux montants du porte-monnaie ne sont pas confirmés.')
 if(!['available','unavailable','unknown'].includes(result.withdrawal))throw new AppError('État du transfert illisible.')
 if(result.withdrawal==='available'&&result.available<=0)throw new AppError('Montant disponible incohérent.')
 return {available:result.available,pending:result.pending,currency:'EUR',withdrawal:result.withdrawal}
}
export async function applyWallet(db,task,result,now=Date.now()){
 const value=parseWallet(result)
 check(await db.from('ylavint_wallets').upsert({account_id:task.account_id,...value,checked_at:new Date(now).toISOString()},{onConflict:'account_id'}))
 return {...value,message:'Porte-monnaie lu : montants disponible et en attente actualisés.'}
}
export function parseDesktopOrders(result){
 if(!result||!Array.isArray(result.orders)||result.orders.length>100)throw new AppError('Liste des ventes visibles illisible.')
 const seen=new Set()
 return result.orders.map(o=>{
  const id=cid(o?.conversation_id)
  if(!id||seen.has(id)||!text(o.title,200)||!text(o.status,150))throw new AppError('Une vente visible est incomplète ou répétée.')
  seen.add(id)
  if(!['ready','waiting','unavailable'].includes(o.label_state))throw new AppError('État du bordereau inconnu.')
  return {conversation_id:id,title:text(o.title,200),status:text(o.status,150),price:money(o.price),currency:'EUR',photo_url:photo(o.photo_url),item_id:vid(o.item_id),carrier:text(o.carrier,60)||null,deadline_text:text(o.deadline_text,150)||null,label_state:o.label_state,label_note:text(o.label_note,200)||null,detail_read:o.detail_read===true,extension_state:['available','pending','accepted','declined','unavailable'].includes(o.extension_state)?o.extension_state:'unknown'}
 })
}
export async function applyDesktopOrders(db,task,result,settings,now=Date.now()){
 const rows=parseDesktopOrders(result),at=new Date(now).toISOString(),ids=rows.map(o=>o.conversation_id)
 const old=new Map((ids.length?check(await db.from('ylavint_desktop_orders').select('*').eq('account_id',task.account_id).in('conversation_id',ids)):[]).map(o=>[o.conversation_id,o]))
 const saved=rows.map(({detail_read,...o})=>{
  const before=old.get(o.conversation_id),closed=/annul|rembours|termin|finalis|livr|colis envoy|en transit/.test(o.status.normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase())
  return {...o,account_id:task.account_id,seen_at:at,item_id:o.item_id||before?.item_id||null,carrier:o.carrier||before?.carrier||null,deadline_text:o.deadline_text||before?.deadline_text||null,
   ship_deadline:detail_read&&o.deadline_text?visibleDeadline(o.deadline_text,now):before?.ship_deadline||null,
   extension_state:detail_read&&o.extension_state!=='unknown'?o.extension_state:before?.extension_state||'unknown',
   extension_checked_at:detail_read&&o.extension_state!=='unknown'?at:before?.extension_checked_at||null,
   ...(!detail_read&&before?{label_state:before.label_state,label_note:before.label_note}:{}),
   ...(closed?{label_state:'unavailable',label_note:null,extension_state:'unavailable',extension_checked_at:at}:{}),
   ...(before?.label_path?{label_state:'saved',label_note:null}:{})}
 })
 if(saved.length)check(await db.from('ylavint_desktop_orders').upsert(saved,{onConflict:'account_id,conversation_id'}))
 const ready=saved.filter(o=>o.label_state==='ready'&&!old.get(o.conversation_id)?.label_path&&!(Date.parse(old.get(o.conversation_id)?.label_checked_at)>now-2*3600000)&&!settings.order_flow.labels.ignore_carriers.some(c=>(o.carrier||'').toLowerCase().includes(c)))
 const queued=settings.features.labels?await enqueue(db,ready.map(o=>({account_id:task.account_id,kind:'fetch_label',priority:5,dedupe_key:`desktop-label:${task.account_id}:${o.conversation_id}`,payload:{desktop_order:true,conversation_id:o.conversation_id,item_id:o.item_id,title:o.title}}))):0
 return {orders:rows.length,queued,message:`${rows.length} vente(s) lue(s) sur les pages chargées ; ${queued} bordereau(x) à récupérer.`}
}
export async function desktopLabelPayload(db,task){
 const id=cid(task.payload?.conversation_id)
 if(task.payload?.desktop_order!==true||!id)return {skip:'Relis les ventes avec l’Assistant PC avant de récupérer ce bordereau.'}
 const row=check(await db.from('ylavint_desktop_orders').select('*').eq('account_id',task.account_id).eq('conversation_id',id).maybeSingle())
 if(!row)return {skip:'Vente non retrouvée sur ce compte.'}
 if(row.label_path)return {skip:'Bordereau déjà enregistré.'}
 return {...task.payload,item_id:row.item_id,title:row.title}
}
export async function applyDesktopLabel(db,task,result,now=Date.now()){
 const id=cid(task.payload?.conversation_id)
 if(!id||cid(result?.conversation_id)!==id)throw new AppError('Ce bordereau ne correspond pas à la vente demandée.')
 const row=check(await db.from('ylavint_desktop_orders').select('*').eq('account_id',task.account_id).eq('conversation_id',id).maybeSingle())
 if(!row)throw new AppError('Vente introuvable sur ce compte.')
 const at=new Date(now).toISOString(),filter=q=>q.eq('account_id',task.account_id).eq('conversation_id',id)
 if(result.pending===true){
  check(await filter(db.from('ylavint_desktop_orders').update({label_state:row.label_path?'saved':'waiting',label_note:text(result.reason,200)||'Bordereau indisponible sur la page.',label_checked_at:at})))
  return {pending:true,message:'Bordereau en attente sur Vinted ; commande conservée sans modification.'}
 }
 const bytes=parseLabel(result)
 if(!(bytes instanceof Uint8Array))throw new AppError('Bordereau incomplet.')
 if(row.label_path)return {path:row.label_path,message:'Bordereau déjà enregistré.'}
 const path=`agent-labels/${task.account_id}/visible-${id}.pdf`
 check(await db.storage.from(BUCKET).upload(path,bytes,{contentType:'application/pdf',upsert:true}))
 check(await filter(db.from('ylavint_desktop_orders').update({label_path:path,label_state:'saved',label_note:null,label_fetched_at:at,label_checked_at:at})))
 const {prepareDesktopThermal}=await import('./ylavint-thermal.js')
 const thermal=await prepareDesktopThermal(db,{...row,label_path:path},bytes)
 return {path,thermal_path:thermal.path||null,message:thermal.error?'Original récupéré ; format thermique à vérifier dans Commandes.':'Bordereau 100 × 150 mm préparé avec le titre de l’article dans Commandes.'}
}
export async function walletView(db,account){
 let query=db.from('ylavint_wallets').select('account_id,available,pending,currency,withdrawal,checked_at').order('checked_at',{ascending:false})
 if(account)query=query.eq('account_id',account)
 return {wallets:check(await query)}
}
export async function desktopOrdersView(db,account){
 let query=db.from('ylavint_desktop_orders').select('*').order('seen_at',{ascending:false}).limit(500)
 if(account)query=query.eq('account_id',account)
 return check(await query).map(o=>({...o,source:'desktop',transaction_id:`visible:${o.account_id}:${o.conversation_id}`,item_ids:o.item_id?[o.item_id]:[],order_date:null}))
}
export async function desktopLabelLink(db,account,conversation){
 if(!account||!cid(conversation))throw new AppError('Choisis le compte et la vente.')
 const o=check(await db.from('ylavint_desktop_orders').select('label_path').eq('account_id',account).eq('conversation_id',cid(conversation)).maybeSingle())
 if(!o?.label_path)throw new AppError('Bordereau pas encore récupéré.',404)
 return {url:check(await db.storage.from(BUCKET).createSignedUrl(o.label_path,300)).signedUrl}
}
