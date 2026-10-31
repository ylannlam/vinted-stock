import {createEngine,initialState,callApi,SITE,allowedPage,jobUrl} from './engine.js'
import {readSheinPage,readSheinSearch} from './extract.mjs'

const ready=(async()=>{
  await chrome.storage.local.setAccessLevel({accessLevel:'TRUSTED_CONTEXTS'})
  if(!await chrome.alarms.get('collect'))await chrome.alarms.create('collect',{periodInMinutes:0.5})
})()
let chain=Promise.resolve()
const serial=work=>{const next=chain.then(()=>ready).then(work);chain=next.catch(()=>{});return next}
const state=async()=>({...initialState(),...(await chrome.storage.local.get('state')).state})
async function ownedTab(id) {
  const {ownedTabId}=await chrome.storage.session.get('ownedTabId')
  if(ownedTabId!==id)return null
  try{return await chrome.tabs.get(id)}catch{return null}
}
async function createTab() {
  const tab=await chrome.tabs.create({url:'about:blank',active:true})
  await chrome.storage.session.set({ownedTabId:tab.id})
  return tab.id
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
},read:async(id,kind)=>{
  const tab=await ownedTab(id)
  if(!tab||!allowedPage(tab.url))throw Error('Onglet de récupération indisponible.')
  const [frame]=await chrome.scripting.executeScript({target:{tabId:id},func:kind==='product'?readSheinPage:readSheinSearch})
  return frame?.result||{error:'page_unavailable'}
}})

// Register all listeners synchronously so they wake a suspended service worker.
chrome.alarms.onAlarm.addListener(a=>{if(a.name==='collect')serial(()=>engine.tick()).catch(()=>{})})
chrome.tabs.onUpdated.addListener((id,change)=>{if(change.status==='complete')serial(async()=>{
  const s=await state();if(s.tabId===id&&s.job&&s.enabled&&s.phase!=='blocked')await engine.tick()
}).catch(()=>{})})
chrome.runtime.onStartup.addListener(()=>serial(async()=>{
  const s=await state()
  // Browser tab IDs are not stable across restarts. Do not claim a restored user tab.
  await chrome.storage.local.set({state:{...s,enabled:false,tabId:null,message:'Navigateur redémarré. Clique sur Démarrer pour reprendre.'}})
}).catch(()=>{}))
chrome.runtime.onMessage.addListener((message,sender,respond)=>{
  if(sender.id!==chrome.runtime.id||sender.url!==chrome.runtime.getURL('popup.html'))return false
  serial(async()=>{
    if(message.action==='status')return state()
    if(message.action==='connect') {
      const token=String(message.token||'').trim()
      if(!/^svpc_[0-9a-f-]{36}\.[A-Za-z0-9_-]{43}$/.test(token))throw Error('Copie le code d’association affiché sur ton site.')
      const current=await state()
      if(current.job||current.outbox)throw Error('Termine la fiche en cours ou déconnecte d’abord cet appareil.')
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
  }).then(async value=>{
    const {token}=await chrome.storage.local.get('token')
    respond({ok:true,state:{...value,connected:!!token}})
  }).catch(error=>respond({ok:false,error:error.message||'Opération impossible.'}))
  return true
})
