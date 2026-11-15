import path from 'node:path'
import {mkdir,writeFile} from 'node:fs/promises'
import {taskJournal} from './ylavint-journal.mjs'
import {VintedMessenger,review} from './ylavint-ui.mjs'
import {VisibleVinted,PACE} from './ylavint-visible.mjs'
import {browseMemory} from './ylavint-memory.mjs'
import {routineMemory,randomInt} from './ylavint-routine.mjs'
import {preparePublication,PublicationForm} from './ylavint-publication.mjs'
import {VisibleCommerce} from './ylavint-commerce.mjs'
import {requestVisibleExtension} from './ylavint-extension.mjs'
import {acceptVisibleOffer} from './ylavint-offers.mjs'

export const DESKTOP_KINDS=['scan_wardrobe','scan_likes','sync_inbox','like_message','reply_message','accept_offer','publish_item','scan_wallet','sync_orders','fetch_label','order_extension']
const writes=task=>['like_message','reply_message','accept_offer','publish_item','order_extension'].includes(task?.kind)
const SITE='https://vinted-stock.vercel.app'
const wait=(ms,signal)=>new Promise(resolve=>{if(signal.aborted)return resolve();const done=()=>{clearTimeout(timer);signal.removeEventListener('abort',done);resolve()};const timer=setTimeout(done,ms);signal.addEventListener('abort',done,{once:true})})
export async function desktopRequest(token,action,body,fetcher=fetch){
  const r=await fetcher(SITE+'/api/collector',{method:'POST',headers:{Authorization:`Bearer ${token}`,'Content-Type':'application/json'},body:JSON.stringify({...body,action,version:'pc-1.8.8'}),credentials:'omit',redirect:'error',signal:AbortSignal.timeout(30000)})
  const data=await r.json().catch(()=>null)
  if(!r.ok)throw Object.assign(Error(data?.error||'Le site ne répond pas.'),{status:r.status})
  if(!data||typeof data!=='object')throw Error('Réponse du site illisible.')
  return data
}

export async function runDesktop(binding,ads,{signal,update,dataDir,connect,request=desktopRequest,Reader=VisibleVinted,now=Date.now,random=Math.random,resumeBreak=()=>false,waitFor=ms=>wait(ms,signal)}={}){
  let deadline=Infinity
  const check=()=>{if(signal.aborted)throw review('Assistant arrêté. Vérifie l’action en cours avant de la relancer.');if(now()>deadline)throw review('Le délai de l’action est dépassé : vérifie Vinted.')}
  let browser,worker,reader,task,submitted=false,activeTimer,keepPage=false
  const summary={conversations_read:0,articles_read:0,likes_read:0,messages_sent:0,offers_sent:0,actions_cancelled:0,articles_browsed:0,photos_opened:0,favourites_added:0,feed_scrolls:0,tabs_reopened:0,wallets_read:0,orders_read:0,labels_saved:0}
  const publishSummary=()=>update({summary:{...summary,articles_browsed:reader?.browseCount||0,photos_opened:reader?.photoCount||0,favourites_added:reader?.favouriteCount||0,feed_scrolls:reader?.feedScrollCount||0}})
  const journal=taskJournal(path.join(dataDir,'ylavint',binding.account_id))
  const ownPages=[]
  const stopPages=()=>{if(signal.reason?.takeover||task?.kind==='publish_item'){keepPage=true;return}for(const page of ownPages)void page.close().catch(()=>{})}
  signal.addEventListener('abort',stopPages,{once:true})
  const api=(action,body={})=>request(binding.token,action,{member_id:binding.member_id,profile_id:binding.profile_id,login:binding.login,...body})
  const sleep=waitFor,control=()=>api('agent_status')
  async function acknowledge(payload){
    // Retry the report, never the Vinted interaction. If the server cannot confirm, stop.
    let last
    for(let i=0;i<3;i++){
      try{const r=await api('agent_result',payload);if(r.saved){if(writes(task))await journal.acknowledge(payload.task_id);return r}throw Error('Résultat non enregistré.')}
      catch(e){last=e;if(e.status&&e.status<500)break;await sleep(3000)}
    }
    throw review('Résultat conservé sur ce PC, mais non confirmé par le site. Vérifie le journal avant de reprendre.'+(last?.status===401?' Reconnecte cet assistant.':''))
  }
  try{
    check();update({state:'opening',message:'Ouverture du profil AdsPower'})
    const opened=await ads.start(binding.profile_id)
    check();const connector=connect||((address,options)=>import('playwright-core').then(({chromium})=>chromium.connectOverCDP(address,options)))
    browser=await connector(opened.address,{timeout:20000,noDefaults:true})
    const context=browser.contexts()[0];if(!context)throw review('Ce profil AdsPower est inaccessible.')
    const memory=await browseMemory(path.join(dataDir,'ylavint',binding.account_id))
    const routine=await routineMemory(path.join(dataDir,'ylavint',binding.account_id),{now,random})
    reader=new Reader({binding,check,sleep,update,control,memory,routine,now,random})
    const ensureWorker=async()=>{
      check()
      if(worker?.isClosed?.())throw review('L’onglet de l’assistant a été fermé. Reprends-le depuis le site pour continuer.')
      if(worker)return
      worker=await context.newPage();ownPages.push(worker);reader.page=worker;reader.verified=false
      await reader.open('/');await reader.identity(true)
      if(ownPages.length>1){summary.tabs_reopened++;publishSummary()}
    }
    let startupInbox=null,startupInboxAt=0
    const refreshInbox=async()=>{
      update({state:'reading',message:'Lecture des conversations avant les actions en attente'})
      const preview=await api('agent_preview');update({actions_preview:preview.actions})
      const inbox=await reader.inbox({conversation_ids:[...new Set((preview.actions||[]).filter(a=>a.kind==='reply_message').map(a=>a.conversation_id).filter(Boolean))].slice(0,4)})
      update({state:'reading',message:'Enregistrement des conversations lues sur le site'})
      await api('agent_context',{result:inbox})
      startupInbox=inbox;startupInboxAt=now()
      summary.conversations_read+=inbox.conversations.length;publishSummary()
      return inbox
    }
    if(binding.check_only===true||binding.rehearse===true){
      await ensureWorker()
      update({state:'opening',message:'Vérification des lectures visibles, sans envoi'})
      const wardrobe=await reader.wardrobe(),likes=await reader.likes()
      Object.assign(summary,{articles_read:wardrobe.items.length,likes_read:likes.likes.length});publishSummary()
      // Rehearse the actual startup path, including saving the read context.
      // Never poll/claim work, type in Vinted, or submit messages in this mode.
      const inbox=binding.rehearse===true?await refreshInbox():await reader.inbox()
      summary.conversations_read=inbox.conversations.length;summary.offers_read=inbox.conversations.reduce((n,c)=>n+(c.offers?.length||0),0);publishSummary()
      if(likes.likes.length&&reader.verifyFavourite){
        update({state:'reading',message:'Vérification de l’ouverture d’un favori et de la fermeture du formulaire vide, sans saisie ni envoi'})
        await reader.verifyFavourite(likes.likes[0]);summary.favourite_form_checked=true;publishSummary()
      }
      if(binding.rehearse===true){update({state:'rehearsed',message:'Répétition terminée : conversations lues et enregistrées sur le site, actions vérifiées. Aucun brouillon saisi, aucune tâche prise, aucun envoi.'});return}
      update({state:'checked',message:`Compte confirmé : ${wardrobe.items.length} annonce(s), ${likes.likes.length} favori(s) et ${inbox.conversations.length} conversation(s) lus sur les pages chargées. ${summary.favourite_form_checked?'Disponibilité de l’article, ouverture du favori et fermeture du formulaire vérifiées. ':''}Aucun message ni réduction envoyés.`});return
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
    let initialized=false,lastContextRefresh=0
    const browseRound=async()=>{
      const pace=reader.pace,total=pace.browse_variety?randomInt(1,pace.browse_items,random):pace.browse_items,started=now()
      await routine.browsed(pace)
      for(let i=0;i<total&&now()-started<120000;i++){
        if(!await reader.browseOne())break
        publishSummary()
      }
      publishSummary()
    }
    while(!signal.aborted){
      task=null;submitted=false;deadline=Infinity
      const status=await control()
      if(!status.allowed){update({state:'stopped',message:'Compte désactivé ou en pause sur le site.'});return}
      reader.pace={...PACE,...status.pace}
      if(!status.in_window){update({state:'waiting',message:'En attente du planning · jours, horaires et absences'});await sleep(20000);continue}
      if(!initialized){await routine.initialize(reader.pace);initialized=true}
      if(!routine.state.break_until&&now()>=routine.state.next_pause_at){
        if(worker)await reader.assertNoDraft()
        await routine.beginBreak(reader.pace)
      }
      if(routine.state.break_until){
        if(resumeBreak()){await routine.finishBreak(reader.pace);lastContextRefresh=0;update({resume_at:null,message:'Pause terminée à ta demande'})}
        if(now()<routine.state.break_until){
          if(routine.state.close_for_break&&worker){
            await reader.assertNoDraft();await worker.close();worker=null;reader.page=null;reader.verified=false
          }
          update({state:'break',message:(routine.state.close_for_break?'Onglet de l’assistant fermé. ':'')+'Pause jusqu’à '+new Date(routine.state.break_until).toLocaleTimeString('fr-FR',{hour:'2-digit',minute:'2-digit'}),resume_at:new Date(routine.state.break_until).toISOString(),current_action:null})
          await sleep(Math.min(15000,routine.state.break_until-now()));continue
        }
        await routine.finishBreak(reader.pace);lastContextRefresh=0;update({resume_at:null})
      }
      await ensureWorker()
      if(!lastContextRefresh){
        await refreshInbox();lastContextRefresh=now()
        continue
      }
      if(routine.due(reader.pace)){await browseRound();continue}
      await reader.identity()
      update({state:'running',message:'Lecture des actions prévues sur le site'})
      const next=await api('agent_poll')
      check()
      if(['other_executor','unknown','disabled','paused','update_required'].includes(next.state)){update({state:'stopped',message:next.reason||next.message||'Compte désactivé ou en pause sur le site.'});return}
      if(next.state!=='task'){
        if(next.state==='idle'&&routine.due(reader.pace,{idle:true})){await browseRound();continue}
        update({state:'waiting',message:next.reason||'En attente des prochains favoris et messages'});await sleep(Math.max(1,Math.min(20,Number(next.wait_seconds)||20))*1000);continue
      }
      task=next.task
      deadline=Math.min(now()+(task.kind==='publish_item'?25*60000:175000),(Date.parse(task.lease_until)||now()+180000)-5000)
      check();activeTimer=setTimeout(stopPages,Math.max(1,deadline-now()))
      if(!DESKTOP_KINDS.includes(task?.kind))throw review('Cette fonction attend encore son adaptation à l’assistant PC.')
      const before=writes(task)?await journal.read(task.id):null
      if(before){
        if(before.member!==binding.member_id)throw review('Compte différent dans le suivi local.')
        if(before.payload){await acknowledge({...before.payload,lease:task.lease});clearTimeout(activeTimer);continue}
        throw review('Cette action a déjà commencé sur ce PC. Vérifie Vinted avant de la reprendre.')
      }
      if(writes(task))await journal.begin(task,binding.member_id)
      const recheck=(conversation,options)=>reader.recheck(task,conversation,options)
      const authorize=async()=>{check();const r=await api('agent_guard',{task_id:task.id,lease:task.lease,settings_version:task.settings_version});if(r.allowed!==true)throw review('Cette action n’est plus autorisée par le site.');check()}
      const ui=new VintedMessenger({page:worker,identity:()=>reader.identity(),member:binding.member_id,journal,task,check,update,recheck,authorize,thread:()=>reader.thread(),confirm:p=>reader.confirm(p),navigate:url=>reader.open(url),pace:reader.pace,sleep})
      let value
      const p=task.payload||{}
      update({state:'reading',message:task.kind==='reply_message'?'Relecture de la conversation avant la réponse':task.kind==='like_message'?'Vérification du favori, de l’article et du prix':'Lecture des pages Vinted',current_action:{kind:task.kind,id:task.id}})
      if(p.skip)value={skipped:p.skip,context_changed:p.context_changed,review_required:p.review_required,extension_state:p.extension_state}
      else if(task.kind==='scan_likes')value=await reader.likes()
      else if(task.kind==='scan_wardrobe')value=await reader.wardrobe()
      else if(task.kind==='sync_inbox'){
        value=startupInbox&&now()-startupInboxAt<120000&&!p.conversation_ids?.length&&!p.force_details?startupInbox:await reader.inbox(p)
        startupInbox=null
      }
      else if(task.kind==='accept_offer')value=await acceptVisibleOffer({reader,ui,authorize,journal,task},p)
      else if(task.kind==='order_extension')value=await requestVisibleExtension({reader,authorize,journal,task},p)
      else if(['scan_wallet','sync_orders','fetch_label'].includes(task.kind)){
        const commerce=new VisibleCommerce({reader,authorize})
        value=await (task.kind==='scan_wallet'?commerce.wallet():task.kind==='sync_orders'?commerce.orders():commerce.label(p))
      }
      else if(task.kind==='publish_item'){
        const form=new PublicationForm({page:worker,reader,task,journal,check,authorize,update,pace:reader.pace,sleep,progress:progress=>api('agent_progress',{task_id:task.id,lease:task.lease,progress})})
        value=await preparePublication(task,form)
        if(value.prepared)keepPage=true
      }
      else{
        if((p.message||p.body||'').length*reader.pace.typing_delay_ms+60000>deadline-now())throw review('Ce texte est trop long pour la vitesse de saisie choisie. Raccourcis-le ou accélère la saisie dans les réglages.')
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
              value=offer?.desktop_cancelled&&!sent?{skipped:offer.desktop_cancelled,conversation_id:conversation}:{conversation_id:conversation,message:body||null,message_id:sent?.reply?.id||null,offer:offer===true,...(offer===true?{offer_price:p.offer_price,expected_price:p.expected_price}:{})}
            }
          }
        }
      }
      const result={ok:true,result:value}
      if(value?.skipped)summary.actions_cancelled++
      else if(task.kind==='sync_inbox')summary.conversations_read+=value.conversations?.length||0
      else if(task.kind==='scan_wardrobe')summary.articles_read+=value.items?.length||0
      else if(task.kind==='scan_likes')summary.likes_read+=value.likes?.length||0
      else if(task.kind==='scan_wallet')summary.wallets_read++
      else if(task.kind==='sync_orders')summary.orders_read+=value.orders?.length||0
      else{if(value?.message_id)summary.messages_sent++;if(value?.offer===true||value?.accepted===true)summary.offers_sent++}
      publishSummary()
      clearTimeout(activeTimer)
      // Desktop failures, including a partial message + offer, require review rather than replay.
      const payload={task_id:task.id,lease:task.lease,...result,...(!result.ok?{code:'desktop_review'}:{})}
      if(writes(task))await journal.complete(task.id,payload);submitted=true
      const saved=await acknowledge(payload)
      if(task.kind==='fetch_label'&&value?.pdf_base64){summary.labels_saved++;publishSummary()}
      if(!result.ok||saved.paused)throw review(result.error||'Vérifie ce compte sur Vinted avant de reprendre.')
      update({state:'waiting',message:saved.message||'Action terminée',current_action:null})
      if(task.kind==='publish_item'&&value.prepared){update({state:'manual',message:'Formulaire prêt dans Vinted. Tu as la main pour vérifier et publier ; aucune reprise automatique.',current_action:null});task=null;return}
      await routine.completed()
      task=null
      deadline=Infinity
      const pauseMs=Math.max(10,Number(reader.pace.action_pause_seconds)||20)*1000
      update({state:'waiting',message:`Action terminée · pause de ${pauseMs/1000} s avant la suivante`,resume_at:new Date(now()+pauseMs).toISOString()})
      await sleep(pauseMs);check();update({resume_at:null})
    }
  }catch(e){
    // Preserve the failing page for inspection instead of making the interruption
    // look like a successful session. An explicit stop still closes our own tabs.
    if(!signal.aborted||e.keep_page||task?.kind==='publish_item')keepPage=true
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

export function desktopFailure(error,stage){
  const raw=String(error?.message||''),location=String(error?.stack||'').match(/(ylavint[-\w]*\.mjs:\d+:\d+)/)?.[1]||null
  const code=error?.code==='desktop_review'?'desktop_review':error?.status?'site_response':/Timeout|timeout/i.test(error?.name+' '+raw)?'page_timeout':/fetch failed|ECONN|ENOTFOUND/i.test(raw)?'connection_lost':'reader_error'
  const message=code==='desktop_review'?raw:code==='site_response'?`Le site a refusé la demande (${error.status}). Actualise le site puis reprends l’assistant.`:code==='page_timeout'?'La page Vinted a mis trop de temps à répondre. Elle reste ouverte pour vérification.':code==='connection_lost'?'La connexion au site a été interrompue. L’onglet Vinted reste ouvert.':'La lecture de Vinted a été interrompue. L’onglet reste ouvert pour vérification.'
  // No page contents, URLs, credentials or arbitrary error strings in diagnostics.
  const detail=error?.name==='TypeError'&&/^Cannot read properties of (?:null|undefined) \(reading '[\w]+'\)$/.test(raw)?raw:null
  return {at:new Date().toISOString(),code,message,stage:String(stage||'').slice(0,200),location,detail}
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
    session.done=Promise.resolve().then(()=>this.run(input,this.getClient(),{signal:controller.signal,dataDir:this.dataDir,resumeBreak:()=>{const resume=session.resumeRequested;session.resumeRequested=false;return resume===true},update:patch=>Object.assign(session.public,patch)})).catch(async e=>{
      const failure=desktopFailure(e,session.public.message)
      Object.assign(session.public,{state:'review',message:failure.message,error_code:failure.code,failed_step:failure.stage})
      const folder=path.join(this.dataDir,'ylavint',input.account_id)
      await mkdir(folder,{recursive:true}).then(()=>writeFile(path.join(folder,'last-stop.json'),JSON.stringify(failure),{mode:0o600})).catch(()=>{})
    }).finally(()=>{session.active=false;if(controller.signal.aborted)Object.assign(session.public,{state:controller.signal.reason?.takeover?'manual':'stopped',message:controller.signal.reason?.takeover?'Tu as la main. L’onglet reste ouvert ; aucune reprise automatique.':'Assistant arrêté sur ce PC.'})})
    return this.snapshot()
  }
  stop(account,takeover=false){const s=this.sessions.get(account);if(s?.active){s.public.state='stopping';s.public.message='Arrêt de l’assistant en cours';s.controller.abort({takeover})}return this.snapshot()}
  resume(account){const s=this.sessions.get(account);if(!s?.active||s.public.state!=='break')throw review('Ce compte n’a pas de pause programmée en cours.');s.resumeRequested=true;s.public.message='Reprise demandée · vérification du compte en cours';return this.snapshot()}
  async close(){for(const s of this.sessions.values())s.controller.abort();await Promise.allSettled([...this.sessions.values()].map(s=>s.done))}
  get active(){return [...this.sessions.values()].some(s=>s.active)}
}
