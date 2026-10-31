const $=id=>document.getElementById(id)
let busy=false
function render(s) {
  $('connect').hidden=s.connected;$('controls').hidden=!s.connected
  $('status').textContent=s.message
  $('reference').textContent=s.job?`En cours : ${s.job.expected_sku||s.job.input}`:''
  $('count').textContent=`${s.completed||0} fiche(s) enregistrée(s) par cette extension.`
  $('start').hidden=s.enabled||s.phase==='blocked';$('pause').hidden=!s.enabled
  $('resume').hidden=s.phase!=='blocked';$('open').hidden=!s.job&&!s.tabId
  $('skip').hidden=!s.connected||s.phase!=='blocked'||s.blockedCode==='human_check'
}
async function send(action,extra={}) {
  const reply=await chrome.runtime.sendMessage({action,...extra})
  if(!reply?.ok)throw Error(reply?.error||'Extension indisponible. Recharge-la dans la page des extensions.')
  render(reply.state)
}
async function act(action,extra={}) {
  if(busy)return;busy=true;$('error').textContent=''
  document.querySelectorAll('button').forEach(b=>b.disabled=true)
  try{await send(action,extra);if(action==='connect')$('code').value=''}catch(e){$('error').textContent=e.message}
  finally{busy=false;document.querySelectorAll('button').forEach(b=>b.disabled=false)}
}
$('connect').addEventListener('submit',e=>{e.preventDefault();act('connect',{token:$('code').value})})
for(const action of ['start','pause','resume','skip','open','site'])$(action).addEventListener('click',()=>act(action))
$('disconnect').addEventListener('click',()=>{
  if(confirm('Déconnecter cette extension ? Les fiches enregistrées sont conservées. Une récupération en cours devra être relancée depuis le site.'))act('disconnect')
})
act('status')
setInterval(()=>{if(!busy)send('status').catch(e=>{$('error').textContent=e.message})},1500)
