import {readFile} from 'node:fs/promises'
import path from 'node:path'
import {fileURLToPath} from 'node:url'
import {taskJournal} from './ylavint-journal.mjs'
import {VintedMessenger,review} from './ylavint-ui.mjs'

export const DESKTOP_KINDS=['scan_wardrobe','scan_likes','sync_inbox','like_message','reply_message']
const writes=task=>['like_message','reply_message'].includes(task?.kind)
const BASE='https://www.vinted.fr',SITE='https://vinted-stock.vercel.app'
const ROOT=path.dirname(fileURLToPath(import.meta.url))
const wait=(ms,signal)=>new Promise(resolve=>{if(signal.aborted)return resolve();const done=()=>{clearTimeout(timer);signal.removeEventListener('abort',done);resolve()};const timer=setTimeout(done,ms);signal.addEventListener('abort',done,{once:true})})
export async function desktopRequest(token,action,body,fetcher=fetch){
  const r=await fetcher(SITE+'/api/collector',{method:'POST',headers:{Authorization:`Bearer ${token}`,'Content-Type':'application/json'},body:JSON.stringify({...body,action,version:'pc-1.2.0'}),credentials:'omit',redirect:'error',signal:AbortSignal.timeout(30000)})
  const data=await r.json().catch(()=>null)
  if(!r.ok)throw Object.assign(Error(data?.error||'Le site ne répond pas.'),{status:r.status})
  if(!data||typeof data!=='object')throw Error('Réponse du site illisible.')
  return data
}

export async function runDesktop(binding,ads,{signal,update,dataDir,connect,request=desktopRequest,sources}={}){
  let deadline=Infinity
  const check=()=>{if(signal.aborted)throw review('Assistant arrêté. Vérifie l’action en cours avant de la relancer.');if(Date.now()>deadline)throw review('Le délai de l’action est dépassé : vérifie Vinted.')}
  let browser,worker,messenger,task,submitted=false,activeTimer
  const journal=taskJournal(path.join(dataDir,'ylavint',binding.account_id))
  const ownPages=[]
  const stopPages=()=>{for(const page of ownPages)void page.close().catch(()=>{})}
  signal.addEventListener('abort',stopPages,{once:true})
  const api=(action,body={})=>request(binding.token,action,{member_id:binding.member_id,profile_id:binding.profile_id,login:binding.login,...body})
  const source=sources||{
    read:await readFile(path.join(ROOT,'ylavint-read.js'),'utf8'),
    agent:await readFile(path.join(ROOT,'ylavint-page.js'),'utf8')
  }
  async function identity(page){
    if(![BASE,BASE.replace('www.','')].includes(new URL(page.url()).origin))throw review('La page ouverte n’est plus Vinted.')
    await page.evaluate(source.read)
    return page.evaluate(async()=>{
      let who=globalThis.readVintedAccount()
      if(who?.member_id)return who
      const response=await fetch('/',{credentials:'include',signal:AbortSignal.timeout(10000)})
      if(!response.ok)return null
      const doc=new DOMParser().parseFromString(await response.text(),'text/html')
      return globalThis.readVintedAccount(doc,'https://www.vinted.fr/')
    })
  }
  const verifyIdentity=async()=>{
    check();const who=await identity(worker)
    if(String(who?.member_id)!==binding.member_id||who?.status!=='ok')throw review('Le profil AdsPower ne présente pas le compte attendu, ou Vinted demande une vérification.')
    check()
  }
  async function acknowledge(payload){
    // Retry the report, never the Vinted interaction. If the server cannot confirm, stop.
    let last
    for(let i=0;i<3;i++){
      try{const r=await api('agent_result',payload);if(r.saved){if(writes(task))await journal.acknowledge(payload.task_id);return r}throw Error('Résultat non enregistré.')}
      catch(e){last=e;if(e.status&&e.status<500)break;await wait(3000,signal)}
    }
    throw review('Résultat conservé sur ce PC, mais non confirmé par le site. Vérifie le journal avant de reprendre.'+(last?.status===401?' Reconnecte cet assistant.':''))
  }
  try{
    check();update({state:'opening',message:'Ouverture du profil AdsPower'})
    const opened=await ads.start(binding.profile_id)
    check();const connector=connect||((address,options)=>import('playwright-core').then(({chromium})=>chromium.connectOverCDP(address,options)))
    browser=await connector(opened.address,{timeout:20000,noDefaults:true})
    const context=browser.contexts()[0];if(!context)throw review('Ce profil AdsPower est inaccessible.')
    worker=await context.newPage();ownPages.push(worker)
    await worker.goto(BASE+'/',{waitUntil:'domcontentloaded',timeout:30000})
    await verifyIdentity()
    if(binding.check_only===true){update({state:'checked',message:'Compte Vinted confirmé dans ce profil. Aucun message ni aucune réduction envoyés.'});return}
    // Recover reports after a crash before claiming anything new; never repeat a Vinted write.
    for(const pending of await journal.pending()){
      if(pending.member!==binding.member_id)throw review('Compte différent dans le suivi local.')
      task={id:pending.task_id,lease:pending.lease,kind:pending.kind};submitted=true
      const payload=pending.payload||{task_id:task.id,lease:task.lease,ok:false,code:'desktop_review',error:'Assistant interrompu pendant un envoi : vérifie la conversation sur Vinted.'}
      if(!pending.payload)await journal.complete(task.id,payload)
      const saved=await acknowledge(payload)
      if(saved.paused||!payload.ok)throw review('Une action interrompue a été signalée au site. Vérifie Vinted puis reprends ce compte dans les réglages.')
    }
    task=null;submitted=false
    messenger=await context.newPage();ownPages.push(messenger)
    let ui
    await worker.exposeFunction('__ylavintDesktopSend',payload=>{check();if(!ui)throw review('Aucune tâche autorisée.');return ui.send(payload)})
    await worker.exposeFunction('__ylavintDesktopOffer',payload=>{check();if(!ui)throw review('Aucune tâche autorisée.');return ui.offer(payload)})
    while(!signal.aborted){
      task=null;submitted=false;deadline=Infinity
      await verifyIdentity()
      update({state:'running',message:'Lecture des actions prévues sur le site'})
      const next=await api('agent_poll')
      check()
      if(['other_executor','unknown','disabled','paused'].includes(next.state)){update({state:'stopped',message:next.reason||next.message||'Compte désactivé ou en pause sur le site.'});return}
      if(next.state!=='task'){update({state:'waiting',message:next.reason||'En attente des prochains favoris et messages'});await wait(Math.max(1,Math.min(120,Number(next.wait_seconds)||20))*1000,signal);continue}
      task=next.task
      deadline=Math.min(Date.now()+175000,(Date.parse(task.lease_until)||Date.now()+180000)-5000)
      check();activeTimer=setTimeout(stopPages,Math.max(1,deadline-Date.now()))
      if(!DESKTOP_KINDS.includes(task?.kind))throw review('Cette fonction attend encore son adaptation à l’assistant PC.')
      const before=writes(task)?await journal.read(task.id):null
      if(before){
        if(before.member!==binding.member_id)throw review('Compte différent dans le suivi local.')
        if(before.payload){await acknowledge({...before.payload,lease:task.lease});clearTimeout(activeTimer);continue}
        throw review('Cette action a déjà commencé sur ce PC. Vérifie Vinted avant de la reprendre.')
      }
      if(writes(task))await journal.begin(task,binding.member_id)
      const destination=task.kind==='scan_likes'?'/member/notifications':task.kind==='sync_inbox'?'/inbox':task.kind==='scan_wardrobe'?'/member/'+binding.member_id:'/'
      await worker.goto(BASE+destination,{waitUntil:'domcontentloaded',timeout:30000})
      await verifyIdentity()
      await worker.evaluate(()=>{globalThis.__ylavintDesktopMode=true})
      await worker.evaluate(source.agent)
      const recheck=(conversation,options={})=>worker.evaluate(({t,conversation,options})=>globalThis.__svAgent.recheck(t,conversation,options),{t:{...task,member_id:binding.member_id},conversation,options})
      ui=new VintedMessenger({page:messenger,identity,member:binding.member_id,journal,task,check,update,recheck})
      const result=await worker.evaluate(t=>globalThis.__svAgent.run(t),{...task,member_id:binding.member_id,desktop:true})
      clearTimeout(activeTimer);ui=null
      // Desktop failures, including a partial message + offer, require review rather than replay.
      const payload={task_id:task.id,lease:task.lease,...result,...(!result.ok?{code:'desktop_review'}:{})}
      if(writes(task))await journal.complete(task.id,payload);submitted=true
      const saved=await acknowledge(payload)
      if(!result.ok||saved.paused)throw review(result.error||'Vérifie ce compte sur Vinted avant de reprendre.')
      update({state:'waiting',message:saved.message||'Action terminée'})
      task=null
      await wait(1500,signal)
    }
  }catch(e){
    if(task&&!submitted){
      const payload={task_id:task.id,lease:task.lease,ok:false,code:'desktop_review',error:'Action interrompue ou non confirmée : vérifie Vinted avant de reprendre.'}
      // Keep the result if reporting fails. No write will be replayed by this worker.
      if(writes(task))await journal.complete(task.id,payload).catch(()=>{})
      await acknowledge(payload).catch(()=>{})
    }
    if(!signal.aborted)throw e
  }finally{
    clearTimeout(activeTimer);signal.removeEventListener('abort',stopPages)
    for(const page of ownPages)await page.close().catch(()=>{})
    if(browser)await browser.close().catch(()=>{}) // CDP disconnect; the AdsPower profile stays open.
  }
}

export class DesktopAssistants{
  constructor({getClient,dataDir,run=runDesktop}){Object.assign(this,{getClient,dataDir,run});this.sessions=new Map()}
  snapshot(){return [...this.sessions.values()].map(s=>({...s.public}))}
  start(input){
    if(!input||!/^svwk_[a-f0-9-]{36}\.[A-Za-z0-9_-]{43}$/.test(input.token)||!/^[-a-zA-Z0-9_]{1,100}$/.test(input.profile_id)||!/^\d{1,18}$/.test(input.member_id)||!/^[a-f0-9-]{36}$/i.test(input.account_id))throw review('Connexion de l’assistant invalide.')
    if(!this.getClient())throw review('Configure d’abord la connexion AdsPower.')
    const existing=this.sessions.get(input.account_id)
    if(existing?.active)return this.snapshot()
    if([...this.sessions.values()].some(s=>s.active&&(s.public.profile_id===input.profile_id||s.public.member_id===input.member_id)))throw review('Ce profil ou ce compte a déjà un assistant actif.')
    const controller=new AbortController(),session={active:true,controller,public:{account_id:input.account_id,profile_id:input.profile_id,member_id:input.member_id,state:'opening',message:'Démarrage demandé'}}
    this.sessions.set(input.account_id,session)
    session.done=Promise.resolve().then(()=>this.run(input,this.getClient(),{signal:controller.signal,dataDir:this.dataDir,update:patch=>Object.assign(session.public,patch)})).catch(e=>Object.assign(session.public,{state:'review',message:e.code==='desktop_review'?e.message:'Assistant interrompu. Vérifie AdsPower et la connexion au site.'})).finally(()=>{session.active=false;if(controller.signal.aborted)Object.assign(session.public,{state:'stopped',message:'Assistant arrêté sur ce PC.'})})
    return this.snapshot()
  }
  stop(account){const s=this.sessions.get(account);if(s?.active){s.public.state='stopping';s.public.message='Arrêt de l’assistant en cours';s.controller.abort()}return this.snapshot()}
  async close(){for(const s of this.sessions.values())s.controller.abort();await Promise.allSettled([...this.sessions.values()].map(s=>s.done))}
  get active(){return [...this.sessions.values()].some(s=>s.active)}
}
