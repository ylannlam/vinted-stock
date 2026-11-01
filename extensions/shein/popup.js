import {presentation,stepFor,reviewLabels,diagnostic} from './dashboard.js'
const $=id=>document.getElementById(id)
let busy=false,polling=false,currentState=null,historyKey='',request=0
const time=value=>new Date(value).toLocaleTimeString('fr-FR',{hour:'2-digit',minute:'2-digit'})
function showError(message='') {$('error').textContent=message;$('error').hidden=!message}
function render(s) {
  currentState=s
  const view=presentation(s),connected=s.connected,blocked=s.phase==='blocked'
  $('version').textContent=`v${s.version||chrome.runtime.getManifest().version}`
  $('overview').dataset.tone=view.tone;$('state-label').textContent=view.label
  $('live-label').hidden=!connected||!s.enabled||blocked||!!s.retryAt
  $('status').textContent=s.message
  $('connect').hidden=connected;$('onboarding').hidden=connected;$('controls').hidden=!connected
  $('dashboard').hidden=!connected;$('disconnect').hidden=!connected
  $('completed').textContent=s.completed||0;$('reviewed').textContent=s.reviewed||0
  $('start').hidden=s.enabled||blocked;$('pause').hidden=!s.enabled||blocked
  $('resume').hidden=!blocked;$('open').hidden=!s.job&&!s.hasTab
  $('skip').hidden=!connected||!blocked||s.blockedCode==='human_check'
  $('current').hidden=!s.job;$('reference').textContent=s.job?.expected_sku||s.job?.input||''
  const step=stepFor(s)
  $('step-label').textContent=blocked?'À vérifier':step<0?'':`Étape ${step+1} / 4`
  ;[...$('steps').children].forEach((el,index)=>{el.className=index<step?'done':index===step?'active':'';if(index===step)el.setAttribute('aria-current','step');else el.removeAttribute('aria-current')})
  $('retry').hidden=!s.retryAt||!s.enabled
  $('retry').textContent=s.retryAt?`Nouvelle tentative dans ${Math.max(0,Math.ceil((s.retryAt-Date.now())/1000))} s` : ''
  $('contact').textContent=s.lastContactAt?`Dernier contact avec le site : ${new Date(s.lastContactAt).toLocaleString('fr-FR')}`:'Pas encore de contact confirmé avec le site.'
  const key=JSON.stringify(s.history||[])
  if(key!==historyKey){historyKey=key;renderHistory(s.history||[])}
}
function renderHistory(entries) {
  $('history').replaceChildren();$('empty-history').hidden=entries.length>0
  for(const entry of entries){
    const li=document.createElement('li'),icon=document.createElement('span'),copy=document.createElement('div'),title=document.createElement('span'),detail=document.createElement('span'),at=document.createElement('time')
    const done=entry.kind==='completed'
    icon.className=`history-icon ${done?'':'review'}`;icon.textContent=done?'✓':'!';icon.setAttribute('aria-hidden','true')
    copy.className='history-copy';title.className='history-title';title.textContent=entry.title||entry.reference||'Fiche Shein';title.title=title.textContent
    detail.className='history-detail';detail.textContent=done?`Ajouté · ${entry.photoCount||0} photos · ${entry.sizeCount||0} tailles`:reviewLabels[entry.code]||'À vérifier dans le catalogue'
    if(done&&entry.missing?.length)detail.textContent+=` · Manque : ${entry.missing.join(', ')}`
    at.textContent=time(entry.at);at.dateTime=new Date(entry.at).toISOString();at.title=new Date(entry.at).toLocaleString('fr-FR')
    copy.append(title,detail);li.append(icon,copy,at);$('history').append(li)
  }
}
async function send(action,extra={}) {
  const sequence=++request
  const reply=await chrome.runtime.sendMessage({action,...extra})
  if(!reply?.ok)throw Error(reply?.error||'Extension indisponible. Recharge-la dans la page des extensions.')
  if(sequence===request)render(reply.state)
}
async function act(action,extra={}) {
  if(busy)return;busy=true;showError()
  document.querySelectorAll('button').forEach(b=>b.disabled=true)
  try{await send(action,extra);if(action==='connect')$('code').value=''}catch(e){showError(e.message)}
  finally{busy=false;document.querySelectorAll('button').forEach(b=>b.disabled=false)}
}
$('connect').addEventListener('submit',e=>{e.preventDefault();act('connect',{token:$('code').value})})
for(const action of ['start','pause','resume','skip','open','site'])$(action).addEventListener('click',()=>act(action))
$('connect-site').addEventListener('click',()=>act('site'))
$('disconnect').addEventListener('click',()=>{
  if(confirm('Déconnecter cette extension ? Les fiches enregistrées sont conservées. Une récupération en cours devra être relancée depuis le site.'))act('disconnect')
})
$('diagnostic').addEventListener('click',()=>{
  if(!currentState)return
  const link=document.createElement('a'),url=URL.createObjectURL(new Blob([JSON.stringify(diagnostic(currentState),null,2)],{type:'application/json'}))
  link.href=url;link.download='diagnostic-shein.json';link.click();setTimeout(()=>URL.revokeObjectURL(url),1000)
})
act('status')
setInterval(async()=>{if(busy||polling||document.hidden)return;polling=true;try{await send('status')}catch(e){showError(e.message)}finally{polling=false}},2000)
