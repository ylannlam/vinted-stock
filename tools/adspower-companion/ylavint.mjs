import path from 'node:path'
import {taskJournal} from './ylavint-journal.mjs'
import {VintedMessenger,review} from './ylavint-ui.mjs'
import {VisibleVinted,PACE} from './ylavint-visible.mjs'
import {browseMemory} from './ylavint-memory.mjs'
import {preparePublication,PublicationForm} from './ylavint-publication.mjs'

export const DESKTOP_KINDS=['scan_wardrobe','scan_likes','sync_inbox','like_message','reply_message','publish_item']
const writes=task=>['like_message','reply_message','publish_item'].includes(task?.kind)
const SITE='https://vinted-stock.vercel.app'
const wait=(ms,signal)=>new Promise(resolve=>{if(signal.aborted)return resolve();const done=()=>{clearTimeout(timer);signal.removeEventListener('abort',done);resolve()};const timer=setTimeout(done,ms);signal.addEventListener('abort',done,{once:true})})
export async function desktopRequest(token,action,body,fetcher=fetch){
  const r=await fetcher(SITE+'/api/collector',{method:'POST',headers:{Authorization:`Bearer ${token}`,'Content-Type':'application/json'},body:JSON.stringify({...body,action,version:'pc-1.5.0'}),credentials:'omit',redirect:'error',signal:AbortSignal.timeout(30000)})
  const data=await r.json().catch(()=>null)
  if(!r.ok)throw Object.assign(Error(data?.error||'Le site ne répond pas.'),{status:r.status})
  if(!data||typeof data!=='object')throw Error('Réponse du site illisible.')
  return data
}

export async function runDesktop(binding,ads,{signal,update,dataDir,connect,request=desktopRequest,Reader=VisibleVinted}={}){
  let deadline=Infinity
  const check=()=>{if(signal.aborted)throw review('Assistant arrêté. Vérifie l’action en cours avant de la relancer.');if(Date.now()>deadline)throw review('Le délai de l’action est dépassé : vérifie Vinted.')}
  let browser,worker,reader,task,submitted=false,activeTimer,keepPage=false
  const summary={conversations_read:0,articles_read:0,likes_read:0,messages_sent:0,offers_sent:0,actions_cancelled:0,articles_browsed:0,photos_opened:0}
  const publishSummary=()=>update({summary:{...summary,articles_browsed:reader?.browseCount||0,photos_opened:reader?.photoCount||0}})
  const journal=taskJournal(path.join(dataDir,'ylavint',binding.account_id))
  const ownPages=[]
  const stopPages=()=>{if(signal.reason?.takeover||task?.kind==='publish_item'){keepPage=true;return}for(const page of ownPages)void page.close().catch(()=>{})}
  signal.addEventListener('abort',stopPages,{once:true})
  const api=(action,body={})=>request(binding.token,action,{member_id:binding.member_id,profile_id:binding.profile_id,login:binding.login,...body})
  const sleep=ms=>wait(ms,signal),control=()=>api('agent_status')
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
    const memory=await browseMemory(path.join(dataDir,'ylavint',binding.account_id))
    reader=new Reader({page:worker,binding,check,sleep,update,control,memory})
    await reader.open('/')
    await reader.identity(true)
    if(binding.check_only===true||binding.rehearse===true){
      update({state:'opening',message:'Vérification des lectures visibles, sans envoi'})
      const wardrobe=await reader.wardrobe(),likes=await reader.likes(),inbox=await reader.inbox()
      Object.assign(summary,{articles_read:wardrobe.items.length,likes_read:likes.likes.length,conversations_read:inbox.conversations.length});publishSummary()
      if(binding.rehearse===true){const preview=await api('agent_preview');update({actions_preview:preview.actions,state:'rehearsed',message:'Répétition terminée : lectures visibles et aperçu des actions. Aucun brouillon saisi, aucune tâche prise, aucun envoi.'});return}
      update({state:'checked',message:`Compte confirmé : ${wardrobe.items.length} annonce(s), ${likes.likes.length} favori(s) et ${inbox.conversations.length} conversation(s) lus sur les pages chargées. Aucun message ni réduction envoyés.`});return
    }
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
    let sessionStarted=Date.now(),breakUntil=0,nextBrowse=Date.now(),browseRemaining=0,lastContextRefresh=0
    while(!signal.aborted){
      task=null;submitted=false;deadline=Infinity
      const status=await control()
      if(!status.allowed){update({state:'stopped',message:'Compte désactivé, en pause ou confié à l’extension sur le site.'});return}
      reader.pace={...PACE,...status.pace}
      if(!status.in_window){update({state:'waiting',message:'En attente du planning · jours, horaires et absences'});await sleep(20000);continue}
      if(!breakUntil&&Date.now()-sessionStarted>=reader.pace.session_minutes*60000)breakUntil=Date.now()+reader.pace.pause_minutes*60000
      if(breakUntil){if(Date.now()<breakUntil){update({state:'break',message:'Pause de navigation jusqu’à '+new Date(breakUntil).toLocaleTimeString('fr-FR',{hour:'2-digit',minute:'2-digit'})});await sleep(Math.min(15000,breakUntil-Date.now()));continue}breakUntil=0;sessionStarted=Date.now();lastContextRefresh=0}
      if(!lastContextRefresh||Date.now()-lastContextRefresh>15*60000){
        update({state:'reading',message:'Reprise : relecture des conversations avant les actions en attente'})
        const preview=await api('agent_preview');update({actions_preview:preview.actions})
        const inbox=await reader.inbox({conversation_ids:[...new Set((preview.actions||[]).filter(a=>a.kind==='reply_message').map(a=>a.conversation_id).filter(Boolean))].slice(0,4)})
        await api('agent_context',{result:inbox});summary.conversations_read+=inbox.conversations.length;publishSummary();lastContextRefresh=Date.now()
        continue
      }
      await reader.identity()
      update({state:'running',message:'Lecture des actions prévues sur le site'})
      const next=await api('agent_poll')
      check()
      if(['other_executor','unknown','disabled','paused','update_required'].includes(next.state)){update({state:'stopped',message:next.reason||next.message||'Compte désactivé ou en pause sur le site.'});return}
      if(next.state!=='task'){
        if(next.state==='idle'&&reader.pace.browse_enabled){
          if(!browseRemaining&&Date.now()>=nextBrowse)browseRemaining=reader.pace.browse_items
          if(browseRemaining){await reader.browseOne();publishSummary();browseRemaining--;if(!browseRemaining)nextBrowse=Date.now()+reader.pace.browse_every_minutes*60000;continue}
        }else browseRemaining=0
        update({state:'waiting',message:next.reason||'En attente des prochains favoris et messages'});await sleep(Math.max(1,Math.min(20,Number(next.wait_seconds)||20))*1000);continue
      }
      task=next.task
      deadline=Math.min(Date.now()+(task.kind==='publish_item'?25*60000:175000),(Date.parse(task.lease_until)||Date.now()+180000)-5000)
      check();activeTimer=setTimeout(stopPages,Math.max(1,deadline-Date.now()))
      if(!DESKTOP_KINDS.includes(task?.kind))throw review('Cette fonction attend encore son adaptation à l’assistant PC.')
      const before=writes(task)?await journal.read(task.id):null
      if(before){
        if(before.member!==binding.member_id)throw review('Compte différent dans le suivi local.')
        if(before.payload){await acknowledge({...before.payload,lease:task.lease});clearTimeout(activeTimer);continue}
        throw review('Cette action a déjà commencé sur ce PC. Vérifie Vinted avant de la reprendre.')
      }
      if(writes(task))await journal.begin(task,binding.member_id)
      const recheck=(conversation,options)=>reader.recheck(task,conversation,options)
      const authorize=async()=>{check();const r=await api('agent_guard',{task_id:task.id,lease:task.lease,settings_version:task.settings_version});if(r.allowed!==true)throw review('L’envoi n’est plus autorisé par le site.');check()}
      const ui=new VintedMessenger({page:worker,identity:()=>reader.identity(),member:binding.member_id,journal,task,check,update,recheck,authorize,thread:()=>reader.thread(),confirm:p=>reader.confirm(p),pace:reader.pace,sleep})
      let value
      const p=task.payload||{}
      update({state:'reading',message:task.kind==='reply_message'?'Relecture de la conversation avant la réponse':task.kind==='like_message'?'Vérification du favori, de l’article et du prix':'Lecture des pages Vinted',current_action:{kind:task.kind,id:task.id}})
      if(p.skip)value={skipped:p.skip,context_changed:p.context_changed,review_required:p.review_required}
      else if(task.kind==='scan_likes')value=await reader.likes()
      else if(task.kind==='scan_wardrobe')value=await reader.wardrobe()
      else if(task.kind==='sync_inbox')value=await reader.inbox(p)
      else if(task.kind==='publish_item'){
        const form=new PublicationForm({page:worker,reader,task,journal,check,authorize,update,pace:reader.pace,sleep,progress:progress=>api('agent_progress',{task_id:task.id,lease:task.lease,progress})})
        value=await preparePublication(task,form)
        if(value.prepared)keepPage=true
      }
      else{
        if((p.message||p.body||'').length*reader.pace.typing_delay_ms+60000>deadline-Date.now())throw review('Ce texte est trop long pour la vitesse de saisie choisie. Raccourcis-le ou accélère la saisie dans les réglages.')
        if(task.kind==='like_message'&&p.offer_requested&&!p.offer_price)throw review('Le prix de la réduction n’est pas connu. Relis d’abord le dressing.')
        const filter=task.kind==='like_message'?await reader.memberFilter(p):null
        if(filter)value={skipped:filter}
        else{
          if(task.kind==='like_message')await reader.availableItem(p.item_id)
          const conversation=task.kind==='like_message'?await reader.openLike(p):String(p.conversation_id)
          await ui.open(conversation)
          const initial=await recheck(conversation)
          if(initial.cancelled)value={skipped:initial.cancelled,conversation_id:conversation,buyer_engaged:initial.buyer_engaged===true,context_changed:initial.context_changed,review_required:initial.review_required}
          else{
            const body=p.message??p.body
            const sent=body?await ui.send({task_id:task.id,conversation_id:conversation,body}):null
            if(sent?.desktop_cancelled)value={skipped:sent.desktop_cancelled,conversation_id:conversation,context_changed:sent.context_changed,review_required:sent.review_required,buyer_engaged:sent.buyer_engaged}
            else{
              const offer=p.offer_price?await ui.offer({task_id:task.id,conversation_id:conversation,price:p.offer_price}):false
              value=offer?.desktop_cancelled&&!sent?{skipped:offer.desktop_cancelled,conversation_id:conversation}:{conversation_id:conversation,message:body||null,message_id:sent?.reply?.id||null,offer:offer===true}
            }
          }
        }
      }
      const result={ok:true,result:value}
      if(value?.skipped)summary.actions_cancelled++
      else if(task.kind==='sync_inbox')summary.conversations_read+=value.conversations?.length||0
      else if(task.kind==='scan_wardrobe')summary.articles_read+=value.items?.length||0
      else if(task.kind==='scan_likes')summary.likes_read+=value.likes?.length||0
      else{if(value?.message_id)summary.messages_sent++;if(value?.offer===true)summary.offers_sent++}
      publishSummary()
      clearTimeout(activeTimer)
      // Desktop failures, including a partial message + offer, require review rather than replay.
      const payload={task_id:task.id,lease:task.lease,...result,...(!result.ok?{code:'desktop_review'}:{})}
      if(writes(task))await journal.complete(task.id,payload);submitted=true
      const saved=await acknowledge(payload)
      if(!result.ok||saved.paused)throw review(result.error||'Vérifie ce compte sur Vinted avant de reprendre.')
      update({state:'waiting',message:saved.message||'Action terminée',current_action:null})
      if(task.kind==='publish_item'&&value.prepared){update({state:'manual',message:'Formulaire prêt dans Vinted. Tu as la main pour vérifier et publier ; aucune reprise automatique.',current_action:null});task=null;return}
      task=null
      await wait(1500,signal)
    }
  }catch(e){
    if(e.keep_page||task?.kind==='publish_item')keepPage=true
    if(task&&!submitted){
      const payload={task_id:task.id,lease:task.lease,ok:false,code:'desktop_review',error:e.code==='desktop_review'?e.message.slice(0,300):'Action interrompue ou non confirmée : vérifie Vinted avant de reprendre.'}
      // Keep the result if reporting fails. No write will be replayed by this worker.
      if(writes(task))await journal.complete(task.id,payload).catch(()=>{})
      await acknowledge(payload).catch(()=>{})
    }
    if(!signal.aborted)throw e
  }finally{
    clearTimeout(activeTimer);signal.removeEventListener('abort',stopPages)
    if(!keepPage)for(const page of ownPages)await page.close().catch(()=>{})
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
    if([...this.sessions.values()].some(s=>s.active))throw review('Un assistant pilote déjà ce PC. Arrête-le avant de choisir un autre profil pour garder une seule fenêtre sous contrôle.')
    const controller=new AbortController(),session={active:true,controller,public:{account_id:input.account_id,profile_id:input.profile_id,member_id:input.member_id,state:'opening',message:'Démarrage demandé'}}
    this.sessions.set(input.account_id,session)
    session.done=Promise.resolve().then(()=>this.run(input,this.getClient(),{signal:controller.signal,dataDir:this.dataDir,update:patch=>Object.assign(session.public,patch)})).catch(e=>Object.assign(session.public,{state:'review',message:e.code==='desktop_review'?e.message:'Assistant interrompu. Vérifie AdsPower et la connexion au site.'})).finally(()=>{session.active=false;if(controller.signal.aborted)Object.assign(session.public,{state:controller.signal.reason?.takeover?'manual':'stopped',message:controller.signal.reason?.takeover?'Tu as la main. L’onglet reste ouvert ; aucune reprise automatique.':'Assistant arrêté sur ce PC.'})})
    return this.snapshot()
  }
  stop(account,takeover=false){const s=this.sessions.get(account);if(s?.active){s.public.state='stopping';s.public.message='Arrêt de l’assistant en cours';s.controller.abort({takeover})}return this.snapshot()}
  async close(){for(const s of this.sessions.values())s.controller.abort();await Promise.allSettled([...this.sessions.values()].map(s=>s.done))}
  get active(){return [...this.sessions.values()].some(s=>s.active)}
}
