// Agent Vinted maison : remplace Dotb fonction par fonction.
// L'extension « Stock Vinted Agent » (profils AdsPower) prend ici une tâche à la fois par compte,
// dans les plafonds du compte, et le compte se met en pause dès qu'une alerte Vinted apparaît.
// Les actions qui modifient Vinted ne partent qu'avec une « recette » relevée sur le vrai site Vinted
// (mode apprentissage) : jamais de requête devinée.
import {AppError,isId} from './dotb.js'

export const BUCKET='creative-assets'
export const check=r=>{if(r.error)throw r.error;return r.data}
export const vid=v=>{const s=String(v??'');return /^[1-9]\d{0,17}$/.test(s)?s:null}
export const text=(v,max=300)=>typeof v==='string'?v.replace(/\s+/g,' ').trim().slice(0,max):''
export const money=v=>{const n=v&&typeof v==='object'?Number(v.amount):Number(v);return v!==null&&v!==''&&Number.isFinite(n)&&n>=0&&n<100000?Math.round(n*100)/100:null}
export const iso=v=>{if(v==null||v==='')return null;const t=typeof v==='number'?v*(v<1e12?1000:1):Date.parse(v);return Number.isFinite(t)?new Date(t).toISOString():null}
const minutes=n=>n*60000
// Minuit à Paris (les plafonds sont comptés par jour, heure de Paris).
export function parisDayStart(now=Date.now()){
  const p=Object.fromEntries(new Intl.DateTimeFormat('en-CA',{timeZone:'Europe/Paris',year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',second:'2-digit',hourCycle:'h23'}).formatToParts(new Date(now)).map(x=>[x.type,x.value]))
  const offset=Date.UTC(+p.year,+p.month-1,+p.day,+p.hour,+p.minute,+p.second)-Math.floor(now/1000)*1000
  return new Date(Date.UTC(+p.year,+p.month-1,+p.day)-offset).toISOString()
}

export {KINDS,DEFAULT_RECIPES,RECIPES,DEFAULTS,normalizeSettings,effectiveSettings} from './vinted-agent-config.js'
import {KINDS,DEFAULT_RECIPES,RECIPES,DEFAULTS,normalizeSettings,effectiveSettings} from './vinted-agent-config.js'

// Écart aléatoire pour ne pas enchaîner les modifications à heure fixe.
export const jitter=(min,max,rand=Math.random)=>Math.round(minutes(min+(max-min)*rand()))

// Lectures périodiques à programmer pour ce compte, selon les fonctions actives et la dernière lecture.
export function dueScans(settings,last={},now=Date.now()){
  const f=settings.features
  const every={scan_wardrobe:120,sync_orders:30,scan_likes:20,sync_inbox:settings.messaging?.sync_minutes||5}
  const want={scan_wardrobe:f.unmask||f.pricing||f.dressing,sync_orders:f.orders||f.labels||f.sales,scan_likes:f.likes,sync_inbox:f.inbox||f.ai}
  return Object.entries(want).filter(([kind,on])=>on&&(!last[kind]||Date.parse(last[kind])<now-minutes(every[kind]))).map(([kind])=>kind)
}
export const SCANS=['scan_wardrobe','sync_orders','scan_likes','sync_inbox']

// Démasquage : mêmes photos renvoyées, un point dans la description, baisse de prix bornée.
export function unmaskPlan(listing,cfg,now=Date.now()){
  if(listing.state!=='hidden'||listing.repairs>=cfg.max_repairs)return null
  if(listing.last_repair_at&&Date.parse(listing.last_repair_at)>now-cfg.wait_hours*3600000)return null
  const price=money(listing.price);if(price===null)return null
  const room=Math.max(0,cfg.max_drop-Number(listing.total_drop||0)),drop=Math.round(Math.max(0,Math.min(cfg.price_drop,room,price-cfg.floor))*100)/100
  return {new_price:Math.round((price-drop)*100)/100,drop}
}
// Cycle de prix : une annonce visible qui ne se vend pas baisse d'un cran à intervalle régulier, jamais sous le plancher.
export function repricePlan(listing,cfg,now=Date.now()){
  if(listing.state!=='visible')return null
  const listed=Date.parse(listing.listed_at||listing.first_seen_at),price=money(listing.price)
  if(price===null||!Number.isFinite(listed)||listed>now-cfg.after_days*86400000)return null
  if(listing.last_price_drop_at&&Date.parse(listing.last_price_drop_at)>now-cfg.every_days*86400000)return null
  if(Number(listing.total_drop||0)+cfg.step>cfg.max_drop||price-cfg.step<cfg.floor)return null
  return {new_price:Math.round((price-cfg.step)*100)/100,drop:cfg.step}
}

// --- Résultats envoyés par l'extension : tout est revalidé ici. ---
export function parseWardrobe(result){
  if(!result||!Array.isArray(result.items)||result.items.length>2000)throw new AppError('Dressing illisible.')
  const items=[],seen=new Set()
  for(const raw of result.items){
    const id=vid(raw?.id);if(!id||seen.has(id))continue;seen.add(id)
    const state=raw.is_draft?'draft':raw.is_closed||raw.is_sold?'sold':raw.is_hidden?'hidden':'visible'
    items.push({item_id:id,title:text(raw.title,200)||null,price:money(raw.price),currency:/^[A-Z]{3}$/.test(raw.currency||'')?raw.currency:'EUR',
      photo_url:typeof raw.photo_url==='string'&&/^https:\/\/[a-z0-9.-]+\.vinted\.net\//.test(raw.photo_url)?raw.photo_url.slice(0,500):null,state,listed_at:iso(raw.created_at)})
  }
  return {items,complete:result.complete===true}
}
export function parseOrders(result){
  if(!result||!Array.isArray(result.orders)||result.orders.length>500)throw new AppError('Ventes illisibles.')
  const orders=[],seen=new Set()
  for(const raw of result.orders){
    const id=vid(raw?.transaction_id);if(!id||seen.has(id))continue;seen.add(id)
    orders.push({transaction_id:id,status:text(raw.status,60)||null,title:text(raw.title,200)||null,price:money(raw.price),
      currency:/^[A-Z]{3}$/.test(raw.currency||'')?raw.currency:'EUR',item_ids:(Array.isArray(raw.item_ids)?raw.item_ids:[]).map(vid).filter(Boolean).slice(0,20),
      order_date:iso(raw.order_date),label_ready:raw.label_ready===true,shipment_id:vid(raw.shipment_id),conversation_id:vid(raw.conversation_id),
      photo_url:typeof raw.photo_url==='string'&&/^https:\/\/[a-z0-9.-]+\.vinted\.net\//.test(raw.photo_url)?raw.photo_url.slice(0,500):null})
  }
  return orders
}
export function parseLikes(result){
  if(!result||!Array.isArray(result.likes)||result.likes.length>500)throw new AppError('Likes illisibles.')
  const out=[],seen=new Set()
  for(const raw of result.likes){const item=vid(raw?.item_id),user=vid(raw?.user_id),key=`${item}:${user}`;if(item&&user&&!seen.has(key)){seen.add(key);out.push({item_id:item,user_id:user})}}
  return out
}
export function parseLabel(result){
  const bytes=typeof result?.pdf_base64==='string'&&result.pdf_base64.length<4.5e6?Buffer.from(result.pdf_base64,'base64'):null
  if(!bytes||bytes.length<100||bytes.subarray(0,5).toString()!=='%PDF-')throw new AppError('Vinted n’a pas renvoyé un bordereau PDF.')
  return bytes
}

// Recette : forme d'une requête du site Vinted. Jamais de cookie, de jeton CSRF ni d'identifiant de session.
const SECRET_HEADER=/^(cookie|authorization|x-csrf-token|x-anon-id|x-v-udt|x-datadome.*|x-client-id)$/i
export function sanitizeRecipe(kind,raw){
  if(!RECIPES[kind])throw new AppError('Recette inconnue.')
  if(!raw||typeof raw!=='object')throw new AppError('Recette invalide.')
  const method=String(raw.method||'').toUpperCase()
  if(!['GET','POST','PUT','PATCH'].includes(method))throw new AppError('Méthode non prise en charge.')
  const path=String(raw.path||'')
  if(!/^\/(api\/v2|web\/api)\/[A-Za-z0-9_\-/{}.]{1,200}$/.test(path)||path.includes('..'))throw new AppError('Chemin Vinted invalide.')
  const query=raw.query&&typeof raw.query==='object'?Object.fromEntries(Object.entries(raw.query).filter(([k,v])=>/^[a-z_\[\]0-9]{1,40}$/i.test(k)&&['string','number','boolean'].includes(typeof v)).slice(0,20).map(([k,v])=>[k,String(v).slice(0,100)])):{}
  const headers=raw.headers&&typeof raw.headers==='object'?Object.fromEntries(Object.entries(raw.headers).filter(([k,v])=>/^[a-z0-9-]{1,40}$/i.test(k)&&!SECRET_HEADER.test(k)&&typeof v==='string').slice(0,15).map(([k,v])=>[k.toLowerCase(),v.slice(0,200)])):{}
  const body=['json','form','none'].includes(raw.body)?raw.body:'none'
  const template=body==='json'?raw.template:null,fields=body==='form'&&Array.isArray(raw.fields)?raw.fields.filter(f=>typeof f==='string'&&/^[a-z_\[\]0-9]{1,60}$/i.test(f)).slice(0,30):[]
  if(body==='json'&&(!template||typeof template!=='object'||JSON.stringify(template).length>30000))throw new AppError('Modèle de requête invalide.')
  if(body==='form'&&!fields.length)throw new AppError('Champs du formulaire absents.')
  const response=Array.isArray(raw.response)?raw.response.filter(k=>typeof k==='string'&&k.length<=60).slice(0,40):[]
  return {method,path,query,headers,body,template,fields,response,status:Number.isSafeInteger(raw.status)?raw.status:null}
}

// --- Base de données ---
export async function agentLog(db,{account_id=null,task_id=null,level='info',event,message,details=null}){
  const r=await db.from('vinted_agent_log').insert({account_id,task_id,level,event:String(event).slice(0,60),message:String(message).slice(0,500),details})
  if(r.error)console.error('agent_log_failed',{code:r.error.code})
}
export async function enqueue(db,rows){
  let added=0
  for(const row of rows){
    const r=await db.from('vinted_agent_tasks').insert({...row,writes:KINDS[row.kind].writes})
    if(r.error?.code==='23505')continue
    check(r);added++
  }
  return added
}
export async function pauseAccount(db,accountId,reason,{event='paused',details=null}={}){
  const r=check(await db.from('vinted_agent_settings').update({paused:true,pause_reason:String(reason).slice(0,300),paused_at:new Date().toISOString()}).eq('account_id',accountId).eq('paused',false).select('account_id'))
  if(r?.length)await agentLog(db,{account_id:accountId,level:'warn',event,message:`Agent mis en pause : ${reason}`.slice(0,500),details})
  return !!r?.length
}
// Appelé par la veille du compte : un bandeau Vinted (restreint, bloqué) arrête l'agent de ce compte.
export async function pauseOnAlert(db,report){
  if(report.status==='ok')return false
  const account=check(await db.from('publication_accounts').select('id').eq('vinted_id',report.member_id).maybeSingle())
  if(!account)return false
  return pauseAccount(db,account.id,report.message||'alerte Vinted sur le compte',{event:'alert',details:{status:report.status,until:report.until_date}})
}
async function accountFor(db,body){
  const member=vid(body?.member_id)
  if(!member)throw new AppError('Compte Vinted inconnu : ouvre une page Vinted connectée.')
  const account=check(await db.from('publication_accounts').select('id,login,vinted_id').eq('vinted_id',member).maybeSingle())
  return {member,account}
}
export const learned=async db=>new Set(check(await db.from('vinted_agent_recipes').select('kind')).map(r=>r.kind))
const recipeRows=async(db,kinds)=>kinds.length?check(await db.from('vinted_agent_recipes').select('kind,recipe').in('kind',kinds)):[]
// Une fonction est prête quand toutes ses recettes indispensables ont été relevées.
export const ready=(kind,can)=>KINDS[kind].needs.every(k=>can.has(k))

// Ce que l'extension reçoit avec sa tâche : les recettes utiles et les données nécessaires (photos signées pour 30 min).
async function taskBundle(db,task,settings){
  const uses=KINDS[task.kind].uses||[]
  const recipes=Object.fromEntries((await recipeRows(db,[...KINDS[task.kind].needs,...uses])).map(r=>[r.kind,r.recipe]))
  for(const k of uses)if(!recipes[k]&&DEFAULT_RECIPES[k])recipes[k]=DEFAULT_RECIPES[k]
  const missing=KINDS[task.kind].needs.filter(k=>!recipes[k])
  const bundle={id:task.id,lease:task.lease,kind:task.kind,payload:task.payload,recipes,missing}
  if(task.kind==='publish_item'&&!missing.length){
    const draft=check(await db.from('listing_drafts').select('id,fields,photos,state,dotb_publish').eq('id',task.payload.draft_id).maybeSingle())
    if(!draft)return {...bundle,missing:['draft']}
    const paths=(draft.photos||[]).map(p=>p.path).filter(Boolean).slice(0,20)
    const signed=paths.length?check(await db.storage.from(BUCKET).createSignedUrls(paths,1800)):[]
    bundle.listing={fields:draft.fields,live:task.payload.live!==false&&draft.dotb_publish!==false,photos:signed.map(s=>s.signedUrl).filter(Boolean)}
  }
  if(task.kind==='like_message'){
    const item=check(await db.from('vinted_agent_listings').select('title,price').eq('account_id',task.account_id).eq('item_id',task.payload.item_id).maybeSingle())
    bundle.payload={...task.payload,message:(await import('./ylavint.js')).likeText(settings.likes.message,{title:item?.title,price:item?.price})}
  }
  if(task.kind==='sync_inbox')bundle.payload={...task.payload,known:await (await import('./ylavint.js')).knownConversations(db,task.account_id)}
  if(task.kind==='sync_orders'){
    const known=check(await db.from('vinted_agent_orders').select('transaction_id,item_ids').eq('account_id',task.account_id).order('first_seen_at',{ascending:false}).limit(60))
    bundle.payload={...task.payload,detailed:known.filter(o=>o.item_ids?.length).map(o=>o.transaction_id)}
  }
  return bundle
}

// L'extension demande du travail pour le compte connecté dans son profil.
export async function agentPoll(db,key,body,now=Date.now()){
  const {member,account}=await accountFor(db,body)
  if(!account){
    await agentLog(db,{level:'warn',event:'unknown_profile',message:`Profil non rattaché : ${text(body.login,80)||member}`,details:{member_id:member,login:text(body.login,80)}})
    return {state:'unknown',message:'Ce compte Vinted n’est pas encore connu du site.',wait_seconds:3600}
  }
  const version=text(body.version,20)
  const row=check(await db.from('vinted_agent_settings').select('*').eq('account_id',account.id).maybeSingle())
  // YlaVint coupé sur ce compte : simple signal de présence (Bridge connecté), nouvel appel dans 10 min.
  if(!row?.enabled){
    await db.from('vinted_agent_settings').upsert({account_id:account.id,last_seen_at:new Date(now).toISOString(),...(version?{extension_version:version}:{})},{onConflict:'account_id'})
    return {state:'disabled',account:account.login,wait_seconds:600}
  }
  if(version&&version!==row.extension_version)await db.from('vinted_agent_settings').update({extension_version:version}).eq('account_id',account.id)
  const settings=effectiveSettings(row)
  if(!row.paused){
    const recent=check(await db.from('vinted_agent_tasks').select('kind,created_at').eq('account_id',account.id).in('kind',SCANS).neq('state','cancelled').order('created_at',{ascending:false}).limit(40))
    const last={};for(const t of recent)last[t.kind]??=t.created_at
    const can=await learned(db),due=dueScans(settings,last,now).filter(kind=>ready(kind,can))
    if(due.length)await enqueue(db,due.map(kind=>({account_id:account.id,kind,dedupe_key:`${kind}:${account.id}`})))
  }
  const claimed=check(await db.rpc('claim_vinted_agent_task',{p_account:account.id}))
  const extra=await (await import('./ylavint.js')).pollExtras(db,account,settings,{paused:row.paused}).catch(e=>{console.error('ylavint_poll_extra_failed',{code:e.code||e.status||'unknown'});return {}})
  const idleWait=settings.features.inbox||settings.features.ai?60:120
  if(claimed?.state!=='task')return {state:claimed?.state||'idle',reason:claimed?.reason||null,account:account.login,...extra,wait_seconds:{paused:600,disabled:1800,busy:45}[claimed?.state]||idleWait}
  const bundle=await taskBundle(db,claimed.task,settings)
  if(bundle.missing.length){
    // Sans recette relevée, rien n'est envoyé à Vinted : la tâche attend l'apprentissage.
    await finish(db,claimed.task,'failed',null,`Action pas encore apprise : ${bundle.missing.map(k=>RECIPES[k]?.label||k).join(', ')}.`)
    await agentLog(db,{account_id:account.id,task_id:claimed.task.id,level:'warn',event:'no_recipe',message:`${KINDS[claimed.task.kind].label} : apprends d’abord ${bundle.missing.map(k=>RECIPES[k]?.label||k).join(', ')} (mode apprentissage).`})
    if(claimed.task.kind==='reply_message')await (await import('./ylavint.js')).replyFailed(db,claimed.task,'Envoi de message pas encore appris : envoie un message à la main avec le mode apprentissage.')
    return {state:'idle',account:account.login,...extra,wait_seconds:30}
  }
  return {state:'task',account:account.login,...extra,task:bundle}
}
const finish=(db,task,state,result,error)=>db.rpc('finish_vinted_agent_task',{p_task:task.id,p_lease:task.lease,p_state:state,p_result:result,p_error:error}).then(check)

const STOP={captcha:'vérification Vinted (captcha) à faire à la main dans ce profil',restricted:'Vinted signale une restriction sur le compte',
  logged_out:'le compte Vinted est déconnecté dans ce profil',rate_limited:'Vinted limite les requêtes de ce compte',forbidden:'Vinted a refusé l’action'}

// Résultat d'une tâche. Effets : annonces suivies, ventes, bordereaux, prochaines tâches.
export async function agentResult(db,key,body,{now=Date.now(),rand=Math.random}={}){
  if(!isId(body?.task_id)||!isId(body?.lease))throw new AppError('Tâche invalide.')
  const task=check(await db.from('vinted_agent_tasks').select('*').eq('id',body.task_id).eq('lease',body.lease).eq('state','running').maybeSingle())
  if(!task)throw new AppError('Cette tâche a expiré.',409)
  const {member,account}=await accountFor(db,body)
  if(!account||account.id!==task.account_id)throw new AppError('Cette tâche appartient à un autre compte.',409)
  const log=(level,event,message,details)=>agentLog(db,{account_id:task.account_id,task_id:task.id,level,event,message,details})
  const label=KINDS[task.kind].label
  if(body.ok!==true){
    const code=typeof body.code==='string'?body.code:'failed',detail=text(body.error,300)
    if(STOP[code]){
      await finish(db,task,task.writes?'failed':'queued',null,STOP[code])
      await pauseAccount(db,task.account_id,STOP[code],{event:code,details:{kind:task.kind,detail}})
      if(task.kind==='reply_message')await (await import('./ylavint.js')).replyFailed(db,task,`Non envoyé : ${STOP[code]}.`)
      return {saved:true,paused:true}
    }
    await finish(db,task,'failed',null,detail||`${label} : échec.`)
    await log('error','failed',`${label} : ${detail||'échec'}`,{code,status:Number.isSafeInteger(body.status)?body.status:null})
    if(task.kind==='publish_item')await markDraft(db,task.payload.draft_id,{state:'attention',message:`L’agent n’a pas pu publier : ${detail||'erreur Vinted'}. Vérifie le dressing avant de relancer.`})
    if(task.kind==='like_message')await db.from('vinted_agent_contacts').update({state:'failed'}).eq('account_id',task.account_id).eq('item_id',task.payload.item_id).eq('user_id',task.payload.user_id)
    if(task.kind==='reply_message')await (await import('./ylavint.js')).replyFailed(db,task,detail||'Vinted a refusé le message.')
    return {saved:true}
  }
  const settings=effectiveSettings(check(await db.from('vinted_agent_settings').select('*').eq('account_id',task.account_id).maybeSingle()))
  let summary={}
  if(task.kind==='scan_wardrobe')summary=await applyWardrobe(db,task,parseWardrobe(body.result),settings,{now,rand})
  if(task.kind==='sync_orders')summary=await applyOrders(db,task,parseOrders(body.result),settings,{rand})
  if(task.kind==='fetch_label')summary=await applyLabel(db,task,parseLabel(body.result))
  if(task.kind==='scan_likes')summary=await applyLikes(db,task,parseLikes(body.result),settings,{now,rand})
  if(task.kind==='unmask_item'||task.kind==='reprice_item')summary=await applyEdit(db,task,body.result,now)
  if(task.kind==='publish_item')summary=await applyPublish(db,task,body.result)
  if(task.kind==='sync_inbox')summary=await (await import('./ylavint.js')).applyInbox(db,task,body.result,{member,settings,now})
  if(task.kind==='reply_message')summary=await (await import('./ylavint.js')).applyReply(db,task,body.result,{now})
  if(task.kind==='like_message'){
    check(await db.from('vinted_agent_contacts').update({state:'sent',sent_at:new Date(now).toISOString()}).eq('account_id',task.account_id).eq('item_id',task.payload.item_id).eq('user_id',task.payload.user_id))
    summary={message:'Message envoyé après un like.'}
    await (await import('./ylavint.js')).recordLikeMessage(db,task,body.result,{now}).catch(()=>null)
  }
  await finish(db,task,'done',summary,null)
  await log('info','done',`${label} · ${summary.message||'terminé'}`,{member_id:member})
  return {saved:true,...summary}
}

async function applyWardrobe(db,task,{items,complete},settings,{now,rand}){
  const at=new Date(now).toISOString()
  const before=check(await db.from('vinted_agent_listings').select('*').eq('account_id',task.account_id))
  const known=new Map(before.map(r=>[r.item_id,r]))
  const rows=items.map(i=>{
    const old=known.get(i.item_id),state=i.state,wasHidden=['hidden','repairing'].includes(old?.state)
    return {account_id:task.account_id,item_id:i.item_id,title:i.title,price:i.price,currency:i.currency,photo_url:i.photo_url,state,
      hidden_since:state==='hidden'?(wasHidden&&old.hidden_since)||at:null,listed_at:i.listed_at||old?.listed_at||null,seen_at:at,
      original_price:old?.original_price??i.price,total_drop:old?.total_drop??0,repairs:old?.repairs??0,last_repair_at:old?.last_repair_at??null,
      last_price_drop_at:old?.last_price_drop_at??null,first_seen_at:old?.first_seen_at||at}
  })
  for(let i=0;i<rows.length;i+=200)check(await db.from('vinted_agent_listings').upsert(rows.slice(i,i+200),{onConflict:'account_id,item_id'}))
  if(complete){
    const present=new Set(items.map(i=>i.item_id)),gone=before.filter(r=>!present.has(r.item_id)&&r.state!=='gone').map(r=>r.item_id)
    if(gone.length)check(await db.from('vinted_agent_listings').update({state:'gone'}).eq('account_id',task.account_id).in('item_id',gone))
  }
  await (await import('./ylavint.js')).syncPublicationItems(db,task.account_id,rows,{now}).catch(e=>console.error('ylavint_publication_items_failed',{code:e.code||'unknown'}))
  const repaired=rows.filter(r=>r.state==='visible'&&known.get(r.item_id)?.state==='repairing').length
  const tasks=[],can=await learned(db)
  if(settings.features.unmask&&KINDS.unmask_item.needs.every(k=>can.has(k)))for(const r of rows){
    const plan=unmaskPlan(r,settings.unmask,now)
    if(plan)tasks.push({account_id:task.account_id,kind:'unmask_item',dedupe_key:`unmask:${r.item_id}`,not_before:new Date(now+jitter(5,90,rand)).toISOString(),payload:{item_id:r.item_id,price:r.price,new_price:plan.new_price,drop:plan.drop}})
  }
  if(settings.features.pricing&&KINDS.reprice_item.needs.every(k=>can.has(k)))for(const r of rows){
    const plan=repricePlan(r,settings.pricing,now)
    if(plan)tasks.push({account_id:task.account_id,kind:'reprice_item',dedupe_key:`reprice:${r.item_id}`,not_before:new Date(now+jitter(10,240,rand)).toISOString(),payload:{item_id:r.item_id,price:r.price,new_price:plan.new_price,drop:plan.drop}})
  }
  const queued=await enqueue(db,tasks)
  const hidden=rows.filter(r=>r.state==='hidden').length
  return {items:rows.length,hidden,repaired,queued,message:`${rows.length} annonce(s) lue(s), ${hidden} masquée(s)${repaired?`, ${repaired} de nouveau visible(s)`:''}, ${queued} action(s) prévue(s).`}
}

async function applyOrders(db,task,orders,settings,{rand}){
  const at=new Date().toISOString()
  // Une lecture de la liste ne connaît pas toujours les articles ni l'envoi : on garde ce qu'une lecture détaillée a déjà appris.
  const before=orders.length?new Map(check(await db.from('vinted_agent_orders').select('transaction_id,account_id,item_ids,shipment_id,conversation_id').in('transaction_id',orders.map(o=>o.transaction_id))).map(o=>[o.transaction_id,o])):new Map()
  orders=orders.filter(o=>!before.has(o.transaction_id)||before.get(o.transaction_id).account_id===task.account_id).map(o=>{const old=before.get(o.transaction_id)
    return {...o,item_ids:o.item_ids.length?o.item_ids:old?.item_ids||[],shipment_id:o.shipment_id||old?.shipment_id||null,conversation_id:o.conversation_id||old?.conversation_id||null}})
  if(orders.length)check(await db.from('vinted_agent_orders').upsert(orders.map(({label_ready,photo_url,...o})=>({...o,account_id:task.account_id,seen_at:at})),{onConflict:'transaction_id'}))
  let queued=0,pushed=0
  if(settings.features.sales&&orders.length)pushed=await (await import('./ylavint.js')).pushSales(db,task.account_id,orders)
  if(settings.features.labels&&orders.length&&(await learned(db)).has('order_label')){
    const ready=orders.filter(o=>o.label_ready&&!/annul|cancel|rembours|refund/i.test(o.status||'')),ids=ready.map(o=>o.transaction_id)
    const done=ids.length?new Set(check(await db.from('vinted_agent_orders').select('transaction_id,label_path').in('transaction_id',ids)).filter(o=>o.label_path).map(o=>o.transaction_id)):new Set()
    queued=await enqueue(db,ready.filter(o=>!done.has(o.transaction_id)).map(o=>({account_id:task.account_id,kind:'fetch_label',dedupe_key:`label:${o.transaction_id}`,not_before:new Date(Date.now()+jitter(1,10,rand)).toISOString(),payload:{transaction_id:o.transaction_id,shipment_id:o.shipment_id}})))
  }
  return {orders:orders.length,queued,pushed,message:`${orders.length} vente(s) lue(s)${pushed?`, ${pushed} envoyée(s) dans l’onglet Ventes`:''}${queued?`, ${queued} bordereau(x) à récupérer`:''}.`}
}

async function applyLabel(db,task,bytes){
  const id=vid(task.payload.transaction_id);if(!id)throw new AppError('Vente invalide.')
  const path=`agent-labels/${task.account_id}/${id}.pdf`
  check(await db.storage.from(BUCKET).upload(path,bytes,{contentType:'application/pdf',upsert:true}))
  const saved=check(await db.from('vinted_agent_orders').update({label_path:path,label_fetched_at:new Date().toISOString()}).eq('transaction_id',id).select('sales_order_id'))
  const sale=saved?.[0]?.sales_order_id
  if(sale)await db.from('sales_orders').update({label_url:`ylavint:${path}`}).eq('id',sale)
  return {path,message:sale?'Bordereau enregistré et ajouté à la vente.':'Bordereau enregistré.'}
}

async function applyLikes(db,task,likes,settings,{now,rand}){
  const can=await learned(db)
  if(!settings.features.likes||!likes.length||!KINDS.like_message.needs.every(k=>can.has(k)))return {likes:likes.length,queued:0,message:`${likes.length} like(s) lu(s).`}
  const known=new Set(check(await db.from('vinted_agent_contacts').select('item_id,user_id').eq('account_id',task.account_id).in('item_id',[...new Set(likes.map(l=>l.item_id))])).map(c=>`${c.item_id}:${c.user_id}`))
  const fresh=likes.filter(l=>!known.has(`${l.item_id}:${l.user_id}`)).slice(0,settings.limits.like_message_per_day)
  if(fresh.length)check(await db.from('vinted_agent_contacts').insert(fresh.map(l=>({account_id:task.account_id,...l}))))
  const queued=await enqueue(db,fresh.map(l=>({account_id:task.account_id,kind:'like_message',dedupe_key:`like:${task.account_id}:${l.item_id}:${l.user_id}`,
    not_before:new Date(now+minutes(settings.likes.wait_minutes)+jitter(0,30,rand)).toISOString(),payload:l})))
  return {likes:likes.length,queued,message:`${likes.length} like(s) lu(s), ${queued} message(s) prévu(s).`}
}

async function applyEdit(db,task,result,now){
  const id=vid(task.payload.item_id),price=money(result?.price)
  if(!id||vid(result?.item_id)!==id)throw new AppError('Vinted a renvoyé une autre annonce.')
  const row=check(await db.from('vinted_agent_listings').select('*').eq('account_id',task.account_id).eq('item_id',id).maybeSingle())
  const drop=Math.max(0,Number(row?.price??task.payload.price)-Number(price??task.payload.new_price))
  const at=new Date(now).toISOString()
  const patch=task.kind==='unmask_item'
    ?{state:'repairing',repairs:(row?.repairs||0)+1,last_repair_at:at,price:price??task.payload.new_price,total_drop:Math.round((Number(row?.total_drop||0)+drop)*100)/100}
    :{last_price_drop_at:at,price:price??task.payload.new_price,total_drop:Math.round((Number(row?.total_drop||0)+drop)*100)/100}
  if(row)check(await db.from('vinted_agent_listings').update(patch).eq('account_id',task.account_id).eq('item_id',id))
  return {item_id:id,price:patch.price,message:task.kind==='unmask_item'?`Annonce ${id} réparée (${patch.price} €). Vérification au prochain passage.`:`Prix de l’annonce ${id} passé à ${patch.price} €.`}
}

export async function markDraft(db,id,patch){
  if(!isId(id))return
  const row=check(await db.from('listing_drafts').select('id,version').eq('id',id).maybeSingle())
  if(row)check(await db.from('listing_drafts').update({...patch,version:row.version+1,updated_at:new Date().toISOString()}).eq('id',id).eq('version',row.version))
}
async function applyPublish(db,task,result){
  const item=vid(result?.vinted_id)
  if(!item)throw new AppError('Vinted n’a pas confirmé la création de l’annonce.')
  const live=result.draft!==true
  await markDraft(db,task.payload.draft_id,live
    ?{state:'published',vinted_id:item,published_at:new Date().toISOString(),message:'Annonce publiée sur Vinted par l’agent.'}
    :{state:'vinted_draft',vinted_id:item,message:'Brouillon créé sur Vinted par l’agent. Vérifie-le puis publie-le.'})
  return {vinted_id:item,message:live?`Annonce ${item} publiée.`:`Brouillon ${item} créé.`}
}

// Mode apprentissage : l'extension a vu le site Vinted faire cette requête.
export async function agentLearn(db,key,body){
  const kind=typeof body?.kind==='string'?body.kind:''
  const recipe=sanitizeRecipe(kind,body.recipe)
  const before=check(await db.from('vinted_agent_recipes').select('samples').eq('kind',kind).maybeSingle())
  check(await db.from('vinted_agent_recipes').upsert({kind,recipe,learned_at:new Date().toISOString(),learned_login:text(body.login,80)||null,samples:(before?.samples||0)+1},{onConflict:'kind'}))
  const {account}=await accountFor(db,body).catch(()=>({account:null}))
  await agentLog(db,{account_id:account?.id||null,event:'learned',message:`Recette apprise : ${RECIPES[kind].label} (${recipe.method} ${recipe.path}).`})
  return {saved:true,kind}
}

// --- Onglet Agent (administrateur) ---
const ACCOUNT_FIELDS='account_id,enabled,paused,pause_reason,paused_at,features,limits,unmask,pricing,likes,messaging,last_seen_at,extension_version,version,updated_at'
export async function agentOverview(db,user=null){
  const since=parisDayStart()
  const [accounts,settings,tasks,today,log,recipes,orders,listings,alerts,drafts]=await Promise.all([
    db.from('publication_accounts').select('id,login,vinted_id').order('login'),
    db.from('vinted_agent_settings').select(ACCOUNT_FIELDS),
    db.from('vinted_agent_tasks').select('id,account_id,kind,state,not_before,created_at,started_at,finished_at,error,result,payload').order('created_at',{ascending:false}).limit(80),
    db.from('vinted_agent_tasks').select('account_id,kind,writes').gte('started_at',since),
    db.from('vinted_agent_log').select('id,account_id,task_id,level,event,message,created_at').order('created_at',{ascending:false}).limit(150),
    db.from('vinted_agent_recipes').select('kind,learned_at,learned_login,samples,recipe'),
    db.from('vinted_agent_orders').select('transaction_id,account_id,status,title,price,currency,order_date,label_path,seen_at').order('order_date',{ascending:false,nullsFirst:false}).limit(40),
    db.from('vinted_agent_listings').select('account_id,item_id,title,price,photo_url,state,hidden_since,repairs,total_drop,last_repair_at').in('state',['hidden','repairing']).order('hidden_since',{ascending:true}).limit(100),
    db.from('account_health_alerts').select('account_id,status,title,until_date').eq('resolved',false),
    user?db.from('listing_drafts').select('id,state,fields,photos,planned_at,updated_at').eq('owner_id',user.id).in('state',['draft','attention']).is('dotb_item_id',null).order('updated_at',{ascending:false}).limit(60):Promise.resolve({data:[],error:null}),
  ]);[accounts,settings,tasks,today,log,recipes,orders,listings,alerts,drafts].forEach(check)
  const counts={};for(const t of today.data){const c=counts[t.account_id]||(counts[t.account_id]={writes:0});c[t.kind]=(c[t.kind]||0)+1;if(t.writes)c.writes++}
  const byAccount=new Map(settings.data.map(s=>[s.account_id,s])),alert=new Map(alerts.data.map(a=>[a.account_id,a]))
  return {
    accounts:accounts.data.map(a=>{const s=byAccount.get(a.id);return {...a,last_seen_at:s?.last_seen_at||null,extension_version:s?.extension_version||null,settings:s?{...effectiveSettings(s),enabled:s.enabled,paused:s.paused,pause_reason:s.pause_reason,paused_at:s.paused_at,last_seen_at:s.last_seen_at,extension_version:s.extension_version,version:s.version}:null,today:counts[a.id]||{writes:0},alert:alert.get(a.id)||null}}),
    tasks:tasks.data,log:log.data,orders:orders.data,hidden:listings.data,
    drafts:drafts.data.map(d=>({id:d.id,state:d.state,title:d.fields?.title||'Sans titre',account_id:String(d.fields?.account_id||'').toLowerCase()||null,price:d.fields?.price||null,photos:(d.photos||[]).length,planned_at:d.planned_at})),
    recipes:Object.entries(RECIPES).map(([kind,info])=>{const r=recipes.data.find(x=>x.kind===kind);return {kind,...info,default:!!DEFAULT_RECIPES[kind],learned_at:r?.learned_at||null,learned_login:r?.learned_login||null,samples:r?.samples||0,method:r?.recipe?.method||null,path:r?.recipe?.path||null}}),
    kinds:Object.fromEntries(Object.entries(KINDS).map(([k,v])=>[k,{label:v.label,writes:v.writes,needs:v.needs}])),defaults:DEFAULTS,
  }
}
export async function handleAgent(req,{db,user}){
  if(req.method==='GET'&&req.query?.view)return (await import('./ylavint.js')).ylavintView(req,{db,user})
  if(req.method==='GET'){
    const [overview,extra]=await Promise.all([agentOverview(db,user),(await import('./ylavint.js')).overviewExtras(db).catch(()=>({}))])
    return {...overview,...extra}
  }
  const body=req.body
  if(!body||typeof body!=='object')throw new AppError('Formulaire invalide.')
  const ylavint=await import('./ylavint.js')
  if(ylavint.YLAVINT_ACTIONS.has(body.action))return ylavint.handleYlavint(req,{db,user})
  const account=isId(body.account_id)?body.account_id.toLowerCase():null
  if(body.action==='save_settings'){
    if(!account)throw new AppError('Choisis un compte.')
    const exists=check(await db.from('publication_accounts').select('id').eq('id',account).maybeSingle());if(!exists)throw new AppError('Compte introuvable.',404)
    const settings=normalizeSettings(body.settings||{}),enabled=body.enabled===true
    const current=check(await db.from('vinted_agent_settings').select('version').eq('account_id',account).maybeSingle())
    if(current&&body.version!==current.version)throw new AppError('Ces réglages viennent d’être modifiés. Actualise avant d’enregistrer.',409)
    const row={account_id:account,enabled,...settings,updated_at:new Date().toISOString(),updated_by:user.id,version:(current?.version||0)+1}
    if(current)check(await db.from('vinted_agent_settings').update(row).eq('account_id',account).eq('version',current.version))
    else check(await db.from('vinted_agent_settings').insert(row))
    await agentLog(db,{account_id:account,event:'settings',message:enabled?'Réglages de l’agent enregistrés (agent actif).':'Réglages enregistrés (agent arrêté).'})
    return {saved:true,version:row.version}
  }
  if(body.action==='pause'||body.action==='resume'){
    if(!account)throw new AppError('Choisis un compte.')
    if(body.action==='pause')return {saved:await pauseAccount(db,account,'mise en pause depuis le site',{event:'manual_pause'})}
    check(await db.from('vinted_agent_settings').update({paused:false,pause_reason:null,paused_at:null}).eq('account_id',account))
    await agentLog(db,{account_id:account,event:'resumed',message:'Agent relancé depuis le site.'})
    return {saved:true}
  }
  if(body.action==='pause_all'){
    const rows=check(await db.from('vinted_agent_settings').select('account_id').eq('enabled',true).eq('paused',false))
    for(const r of rows)await pauseAccount(db,r.account_id,'arrêt général depuis le site',{event:'manual_pause'})
    return {paused:rows.length}
  }
  if(body.action==='enqueue'){
    if(!account||!SCANS.includes(body.kind))throw new AppError('Lecture inconnue.')
    const added=await enqueue(db,[{account_id:account,kind:body.kind,dedupe_key:`${body.kind}:${account}`,created_by:user.id,priority:3}])
    return {queued:added}
  }
  if(body.action==='cancel'){
    if(!isId(body.task_id))throw new AppError('Tâche invalide.')
    const r=check(await db.from('vinted_agent_tasks').update({state:'cancelled',finished_at:new Date().toISOString()}).eq('id',body.task_id).eq('state','queued').select('id,kind,payload'))
    if(r?.[0]?.kind==='publish_item')await markDraft(db,r[0].payload.draft_id,{state:'draft',scheduled_at:null,message:'Publication par l’agent annulée.'})
    return {cancelled:r?.length||0}
  }
  if(body.action==='publish_drafts')return publishDrafts(db,user,body)
  if(body.action==='forget_recipe'){
    if(!RECIPES[body.kind])throw new AppError('Recette inconnue.')
    check(await db.from('vinted_agent_recipes').delete().eq('kind',body.kind))
    await agentLog(db,{event:'recipe_forgotten',message:`Recette oubliée : ${RECIPES[body.kind].label}. Refais le geste en mode apprentissage.`})
    return {saved:true}
  }
  throw new AppError('Action inconnue.')
}

// Publication par l'agent : les fiches prêtes passent dans la file, au créneau prévu (ou réparties si aucun créneau).
async function publishDrafts(db,user,body,{now=Date.now(),rand=Math.random}={}){
  const ids=Array.isArray(body.ids)?body.ids.filter(isId).slice(0,25):[]
  if(!ids.length)throw new AppError('Choisis au moins une fiche.')
  const can=await learned(db),missing=KINDS.publish_item.needs.filter(k=>!can.has(k))
  if(missing.length)throw new AppError(`Apprends d’abord ${missing.map(k=>RECIPES[k].label.toLowerCase()).join(' et ')} (mode apprentissage de l’extension).`,409)
  const drafts=check(await db.from('listing_drafts').select('id,version,state,fields,photos,planned_at,dotb_item_id').in('id',ids).eq('owner_id',user.id))
  const accounts=new Map(check(await db.from('vinted_agent_settings').select('*').in('account_id',[...new Set(drafts.map(d=>String(d.fields?.account_id||'').toLowerCase()).filter(isId))])).map(s=>[s.account_id,s]))
  const refused=[],tasks=[];let offset=0
  for(const d of drafts){
    const acc=String(d.fields?.account_id||'').toLowerCase(),s=accounts.get(acc)
    if(!['draft','attention'].includes(d.state)||d.dotb_item_id){refused.push({id:d.id,reason:'déjà envoyée ou en cours'});continue}
    if(!s?.enabled||!effectiveSettings(s).features.publish){refused.push({id:d.id,reason:'publication par l’agent non activée pour ce compte'});continue}
    if(!d.fields?.title||!d.fields?.description||!money(d.fields?.price)||!d.fields?.catalog_id||!(d.photos||[]).length){refused.push({id:d.id,reason:'fiche incomplète'});continue}
    const planned=d.planned_at&&Date.parse(d.planned_at)>now?Date.parse(d.planned_at):now+(offset+=jitter(15,45,rand))
    tasks.push({draft:d,row:{account_id:acc,kind:'publish_item',dedupe_key:`publish:${d.id}`,not_before:new Date(planned).toISOString(),payload:{draft_id:d.id},created_by:user.id}})
  }
  let queued=0
  for(const t of tasks){
    if(!await enqueue(db,[t.row]))continue
    queued++
    await markDraft(db,t.draft.id,{state:'scheduled',scheduled_at:t.row.not_before,message:`Programmée par l’agent vers ${new Date(t.row.not_before).toLocaleTimeString('fr-FR',{timeZone:'Europe/Paris',hour:'2-digit',minute:'2-digit'})}. Garde le profil AdsPower ouvert.`})
  }
  return {queued,refused}
}
