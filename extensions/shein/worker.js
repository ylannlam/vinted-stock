import {createEngine,initialState,callApi,SITE,allowedPage,jobUrl,productId,resultError} from './engine.js'
import {readSheinPage,readSheinSearch} from './extract.mjs'
import {trustedSender,publicState} from './protocol.js'
import {expandProductSection} from './enrich.js'
import {createOrderEngine,orderState} from './orders-engine.js'
import {readSheinOrders} from './orders-dom.js'

const ready=(async()=>{
  await chrome.storage.local.setAccessLevel({accessLevel:'TRUSTED_CONTEXTS'})
  if(!await chrome.alarms.get('collect'))await chrome.alarms.create('collect',{periodInMinutes:0.5})
})()
let chain=Promise.resolve()
const serial=work=>{const next=chain.then(()=>ready).then(work);chain=next.catch(()=>{});return next}
const state=async()=>({...initialState(),...(await chrome.storage.local.get('state')).state})
const orders=async()=>{const saved=(await chrome.storage.local.get('orders')).orders||{};return {...orderState(),...saved,cursor:saved.cursor??saved.done??0}}
const humanHold=s=>s.phase==='blocked'&&['human_check','login_required'].includes(s.blockedCode)
async function badge() {
  const [s,o]=await Promise.all([state(),orders()])
  const warning=s.needsConnection||o.needsConnection||s.phase==='blocked'||o.phase==='blocked'||o.phase==='partial'
  await chrome.action.setBadgeText({text:warning?'!':s.retryAt||o.retryAt?'…':s.enabled||o.enabled?'ON':''})
  await chrome.action.setBadgeBackgroundColor({color:warning?'#b45309':'#0f766e'})
}
async function tickBoth(){if(!humanHold(await orders()))await engine.tick();if(!humanHold(await state()))await orderEngine.tick()}
const view=async()=>{
  const o=await orders()
  const safe=publicState(await state(),(await chrome.storage.local.get('token')).token,chrome.runtime.getManifest().version)
  return {...safe,connected:safe.connected&&!o.needsConnection,
    orders:{enabled:o.enabled,phase:o.phase,message:o.message,done:o.done,total:o.total,cursor:o.cursor,errors:o.errors||[],mode:o.mode,retryAt:o.retryAt,blockedCode:o.blockedCode,lastCompletedAt:o.lastCompletedAt,lastFullAt:o.lastFullAt,hasTab:o.tabId!=null}}
}
async function ownedOrdersTab(id) {
  if(id==null||(await chrome.storage.session.get('ownedOrdersTabId')).ownedOrdersTabId!==id)return null
  try{return await chrome.tabs.get(id)}catch{return null}
}
const orderEngine=createOrderEngine({load:orders,save:async s=>{await chrome.storage.local.set({orders:s});await badge()},now:()=>Date.now(),tab:ownedOrdersTab,
  createTab:async()=>{const tab=await chrome.tabs.create({url:'about:blank',active:false});await chrome.storage.session.set({ownedOrdersTabId:tab.id});return tab.id},
  navigate:async(id,url)=>{if(!await ownedOrdersTab(id)||!allowedPage(url))throw Error('Onglet des commandes indisponible.');await chrome.tabs.update(id,{url})},
  read:async(id,action='read')=>{
    const tab=await ownedOrdersTab(id)
    if(!tab||!allowedPage(tab.url))return {error:'page_unavailable'}
    const [frame]=await chrome.scripting.executeScript({target:{tabId:id},func:readSheinOrders,args:[action]})
    return frame?.result||{error:'page_unavailable'}
  },api:async body=>callApi((await chrome.storage.local.get('token')).token,body)})
async function ownedTab(id) {
  const {ownedTabId}=await chrome.storage.session.get('ownedTabId')
  if(ownedTabId!==id)return null
  try{return await chrome.tabs.get(id)}catch{return null}
}
async function createTab() {
  const tab=await chrome.tabs.create({url:'about:blank',active:false})
  await chrome.storage.session.set({ownedTabId:tab.id})
  return tab.id
}
async function read(id,kind) {
  const tab=await ownedTab(id)
  if(!tab||!allowedPage(tab.url))throw Error('Onglet de récupération indisponible.')
  const [frame]=await chrome.scripting.executeScript({target:{tabId:id},func:kind==='product'?readSheinPage:readSheinSearch})
  return frame?.result||{error:'page_unavailable'}
}
const engine=createEngine({load:state,save:async s=>{
  await chrome.storage.local.set({state:s})
  await badge()
},now:()=>Date.now(),api:async body=>{
  const {token}=await chrome.storage.local.get('token');return callApi(token,body)
},tab:ownedTab,createTab,navigate:async(id,url)=>{
  if(!await ownedTab(id)||!allowedPage(url))throw Error('Onglet de récupération indisponible.')
  await chrome.tabs.update(id,{url})
},read,enrich:async(id,original,job)=>{
  let collected=original
  for(const section of ['description','measurements']) {
    const tab=await ownedTab(id)
    if(!tab||!allowedPage(tab.url))return {error:'page_unavailable'}
    const [reply]=await chrome.scripting.executeScript({target:{tabId:id},func:expandProductSection,args:[section,productId(original.supplier_url),original.supplier_sku]})
    if(reply?.result?.error)return reply.result
    if(!reply?.result?.opened)continue
    const current=await read(id,'product'),problem=resultError(current,job)
    if(problem)return {error:problem}
    if(collected.color&&current.color!==collected.color)return {error:'sku_mismatch'}
    collected={...current,description:current.description||collected.description,
      details:[...new Map([...(collected.details||[]),...(current.details||[])].map(d=>[JSON.stringify([d.name,d.value]),d])).values()].slice(0,50)}
  }
  return collected
}})

// Register all listeners synchronously so they wake a suspended service worker.
chrome.alarms.onAlarm.addListener(a=>{if(a.name==='collect')serial(tickBoth).catch(()=>{})})
chrome.tabs.onUpdated.addListener((id,change)=>{if(change.status==='complete')serial(async()=>{
  const s=await state(),o=await orders();if(s.tabId===id&&s.job&&s.enabled&&s.phase!=='blocked'&&!humanHold(o))await engine.tick()
  if(o.tabId===id&&!humanHold(await state()))await orderEngine.tick()
}).catch(()=>{})})
chrome.runtime.onStartup.addListener(()=>serial(async()=>{
  const s=await state()
  // Browser tab IDs are not stable across restarts. Do not claim a restored user tab.
  const patch=s.outbox||s.phase==='blocked'?{}:{job:null,phase:'idle'}
  await chrome.storage.local.set({state:{...s,...patch,tabId:null}})
  const o=await orders()
  await chrome.storage.local.set({orders:{...o,tabId:null}})
  await tickBoth()
}).catch(()=>{}))
chrome.runtime.onInstalled.addListener(()=>serial(async()=>{
  const s=await state()
  if(s.phase==='blocked'&&['color_unreadable','photos_unreadable','price_unreadable','selected_size','sku_mismatch','sku_not_found'].includes(s.blockedCode)&&!s.outbox)
    await chrome.storage.local.set({state:{...s,job:null,phase:'idle'}})
}).catch(()=>{}))
chrome.runtime.onMessage.addListener((message,sender,respond)=>{
  if(!trustedSender(sender,message,chrome.runtime))return false
  if(message.action==='assistant_summary'){
    ready.then(async()=>callApi((await chrome.storage.local.get('token')).token,{action:'assistant_summary',day:message.day,include_earlier:true})).then(assistant=>respond({ok:true,assistant})).catch(e=>respond({ok:false,error:e.message||'Panier indisponible.'}))
    return true
  }
  if(message.action==='status') {
    ready.then(view).then(s=>respond({ok:true,state:s})).catch(()=>respond({ok:false,error:'Connexion indisponible.'}))
    return true
  }
  serial(async()=>{
    if(message.action==='connect') {
      const token=String(message.token||'').trim()
      if(!/^svpc_[0-9a-f-]{36}\.[A-Za-z0-9_-]{43}$/.test(token))throw Error('Copie le code d’association affiché sur ton site.')
      const current=await state()
      if(!current.needsConnection&&(current.job||current.outbox))throw Error('Termine la fiche en cours ou déconnecte d’abord cet appareil.')
      const reply=await callApi(token,{action:'heartbeat'})
      if(!reply.enabled)throw Error('Cet appareil est en pause sur le site. Réactive-le avant de l’associer.')
      await chrome.storage.local.set({token,state:{...initialState(),lastContactAt:Date.now(),message:'Navigateur connecté. Tu peux démarrer les imports.'}})
      await chrome.storage.local.set({orders:orderState()})
    } else if(['orders_start','orders_pause','orders_resume'].includes(message.action)){
      if(['orders_start','orders_resume'].includes(message.action)&&humanHold(await state()))throw Error('Une fiche Shein attend ta vérification. Reprends-la depuis Fiches avant de lancer les commandes.')
      await orderEngine.command(message.action.slice(7),message.options||{})
    }
    else if(message.action==='orders_open') {
      const o=await orders(),tab=await ownedOrdersTab(o.tabId)
      if(!tab)throw Error('Lance d’abord la lecture des commandes.')
      await chrome.tabs.update(tab.id,{active:true});await chrome.windows.update(tab.windowId,{focused:true})
    } else if(['start','pause','resume','skip'].includes(message.action)){
      if(['start','resume','skip'].includes(message.action)&&humanHold(await orders()))throw Error('Les commandes Shein attendent ta vérification. Reprends-les avant les fiches.');await engine.command(message.action)
    }
    else if(message.action==='open') {
      const s=await state();let tab=await ownedTab(s.tabId)
      if(!tab&&s.job){const id=await createTab();await chrome.storage.local.set({state:{...s,tabId:id}});await chrome.tabs.update(id,{url:jobUrl(s.job)});tab=await chrome.tabs.get(id)}
      if(tab){await chrome.tabs.update(tab.id,{active:true});await chrome.windows.update(tab.windowId,{focused:true})}
      else throw Error('Aucune fiche ouverte. Reprends les imports ou consulte le catalogue.')
    } else if(message.action==='disconnect') {
      await chrome.storage.local.remove('token')
      await chrome.storage.local.set({state:initialState()})
      await chrome.storage.local.set({orders:orderState()})
      await chrome.storage.session.remove('ownedTabId')
      await chrome.storage.session.remove('ownedOrdersTabId')
      await chrome.action.setBadgeText({text:''})
    } else if(message.action==='site')await chrome.tabs.create({url:SITE})
    const {token}=await chrome.storage.local.get('token')
    return {...await state(),connected:!!token}
  }).then(async()=>respond({ok:true,state:await view()})).catch(error=>respond({ok:false,error:error.message||'Opération impossible.'}))
  return true
})
