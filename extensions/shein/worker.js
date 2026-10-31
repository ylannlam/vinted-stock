import {createEngine,initialState,callApi,SITE,allowedPage,jobUrl,productId,resultError} from './engine.js'
import {readSheinPage,readSheinSearch} from './extract.mjs'
import {trustedSender,publicState} from './protocol.js'
import {expandProductSection} from './enrich.js'

const ready=(async()=>{
  await chrome.storage.local.setAccessLevel({accessLevel:'TRUSTED_CONTEXTS'})
  if(!await chrome.alarms.get('collect'))await chrome.alarms.create('collect',{periodInMinutes:0.5})
})()
let chain=Promise.resolve()
const serial=work=>{const next=chain.then(()=>ready).then(work);chain=next.catch(()=>{});return next}
const state=async()=>({...initialState(),...(await chrome.storage.local.get('state')).state})
const view=async()=>publicState(await state(),(await chrome.storage.local.get('token')).token,chrome.runtime.getManifest().version)
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
  await chrome.action.setBadgeText({text:s.phase==='blocked'?'!':s.enabled?'ON':''})
  await chrome.action.setBadgeBackgroundColor({color:s.phase==='blocked'?'#b45309':'#0f766e'})
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
chrome.alarms.onAlarm.addListener(a=>{if(a.name==='collect')serial(()=>engine.tick()).catch(()=>{})})
chrome.tabs.onUpdated.addListener((id,change)=>{if(change.status==='complete')serial(async()=>{
  const s=await state();if(s.tabId===id&&s.job&&s.enabled&&s.phase!=='blocked')await engine.tick()
}).catch(()=>{})})
chrome.runtime.onStartup.addListener(()=>serial(async()=>{
  const s=await state()
  // Browser tab IDs are not stable across restarts. Do not claim a restored user tab.
  const patch=s.outbox||s.phase==='blocked'?{}:{job:null,phase:'idle'}
  await chrome.storage.local.set({state:{...s,...patch,tabId:null}})
  if(s.enabled)await engine.tick()
}).catch(()=>{}))
chrome.runtime.onInstalled.addListener(()=>serial(async()=>{
  const s=await state()
  if(s.phase==='blocked'&&['color_unreadable','photos_unreadable','price_unreadable','selected_size','sku_mismatch','sku_not_found'].includes(s.blockedCode)&&!s.outbox)
    await chrome.storage.local.set({state:{...s,job:null,phase:'idle'}})
}).catch(()=>{}))
chrome.runtime.onMessage.addListener((message,sender,respond)=>{
  if(!trustedSender(sender,message,chrome.runtime))return false
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
      await chrome.storage.local.set({token,state:{...initialState(),message:'Association réussie. Clique sur Démarrer.'}})
    } else if(['start','pause','resume','skip'].includes(message.action))await engine.command(message.action)
    else if(message.action==='open') {
      const s=await state();let tab=await ownedTab(s.tabId)
      if(!tab&&s.job){const id=await createTab();await chrome.storage.local.set({state:{...s,tabId:id}});await chrome.tabs.update(id,{url:jobUrl(s.job)});tab=await chrome.tabs.get(id)}
      if(tab){await chrome.tabs.update(tab.id,{active:true});await chrome.windows.update(tab.windowId,{focused:true})}
    } else if(message.action==='disconnect') {
      await chrome.storage.local.remove('token')
      await chrome.storage.local.set({state:initialState()})
      await chrome.storage.session.remove('ownedTabId')
      await chrome.action.setBadgeText({text:''})
    } else if(message.action==='site')await chrome.tabs.create({url:SITE})
    const {token}=await chrome.storage.local.get('token')
    return {...await state(),connected:!!token}
  }).then(async()=>respond({ok:true,state:await view()})).catch(error=>respond({ok:false,error:error.message||'Opération impossible.'}))
  return true
})
