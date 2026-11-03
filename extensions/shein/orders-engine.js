export const ORDER_LIST='https://fr.shein.com/user/orders/list?from=navTop'
export const orderState=()=>({enabled:false,needsConnection:false,phase:'idle',tabId:null,queue:[],seen:[],pages:0,cursor:0,done:0,total:0,errors:[],outbox:null,nextAt:0,retryAt:0,failures:0,message:'Active la lecture de tes commandes Shein.',lastCompletedAt:null,lastFullAt:null})
const errors={login_required:'Connecte-toi à Shein, puis reprends ici.',human_check:'Shein demande une vérification. Termine-la dans l’onglet puis reprends ici.',order_unreadable:'Commande incomplète ou illisible.',page_unavailable:'Page indisponible.',reference_mismatch:'La page ne correspond pas à la commande attendue.'}
export function orderReference(value) {
  const input=String(value||'').trim()
  if(/^G[A-Z0-9]{7,39}$/i.test(input))return input.toUpperCase()
  try{const u=new URL(input);if(u.protocol==='https:'&&['fr.shein.com','www.shein.com'].includes(u.hostname)&&!u.username&&!u.password&&!u.port)return u.pathname.match(/^\/user\/orders\/detail\/(G[A-Z0-9]{7,39})\/?$/i)?.[1].toUpperCase()||null}catch{}
  return null
}
export function createOrderEngine(port) {
  let s
  const load=async()=>{const old=await port.load();s={...orderState(),...old};if(old.cursor==null)s.cursor=old.done||0}
  const save=async patch=>{Object.assign(s,patch);await port.save(s)}
  const report=async(state='running')=>{if(s.runId)await port.api({action:'orders_report',run_id:s.runId,state,discovered:s.total,read:s.done,errors:s.errors,mode:s.mode})}
  async function navigate(target,phase) {
    if(!await port.tab(s.tabId))await save({tabId:await port.createTab()})
    await save({target,phase:'navigate',nextPhase:phase,since:port.now()})
    await port.navigate(s.tabId,target);await save({phase})
  }
  async function begin() {
    const mode=s.request?.mode||(!s.lastFullAt||port.now()-s.lastFullAt>86400000?'full':'incremental')
    if(!s.runId)await save({runId:port.uuid?.()||crypto.randomUUID()})
    const context=await port.api({action:'orders_context',...s.request,mode,run_id:s.runId})
    if(!context.enabled)return save({enabled:false,message:'Ce navigateur est en pause sur le site.'})
    const queue=[...new Set(context.pending_refs||[])]
    await save({mode,sinceDate:context.since_date,untilDate:context.until_date||'2099-12-31',known:context.known||{},queue,seen:[],pages:0,cursor:0,done:0,total:queue.length,errors:[],outbox:null,retryAt:0,failures:0,listComplete:true,message:'Recherche des commandes…'})
    if(mode==='targeted'){const ref=orderReference(s.request?.reference);if(!ref)throw Error('Colle un numéro ou un lien de commande Shein valide.');await save({queue:[ref],total:1});return nextOrder()}
    await navigate(ORDER_LIST,'list')
  }
  async function nextOrder() {
    if(s.cursor>=s.queue.length) {
      await save({phase:'finish',message:'Vérification des associations…'})
      const complete=s.listComplete&&!s.errors.length
      const r=await port.api({action:'orders_finish',count:s.done,run_id:s.runId,discovered:s.total,errors:s.errors,complete,mode:s.mode})
      await save({phase:complete?'done':'partial',lastCompletedAt:port.now(),lastFullAt:complete&&s.mode==='full'?port.now():s.lastFullAt,nextAt:port.now()+600000,
        message:`${s.done} commande(s) lue(s), ${s.errors.length} à vérifier · ${r.linked||0} vente(s) associée(s).`,retryAt:0,failures:0,runId:null,request:null})
    } else {
      await save({message:`Lecture ${s.cursor+1} / ${s.total} · ${s.done} enregistrée(s)…`})
      await navigate(`https://fr.shein.com/user/orders/detail/${encodeURIComponent(s.queue[s.cursor])}`,'detail')
    }
  }
  async function skip(code,message) {
    const ref=['detail','sending'].includes(s.phase)?s.queue[s.cursor]:null
    const entry={ref:ref||null,code,message:message||errors[code]||'Lecture à vérifier.'}
    await save({errors:[...s.errors.filter(e=>e.ref!==entry.ref),entry].slice(-200),outbox:null,...(ref?{cursor:s.cursor+1}:{listComplete:false}),retryAt:0,phase:'advance',reportPending:true})
    await report();await save({reportPending:false});await nextOrder()
  }
  async function deliver() {
    await port.api({action:'orders_import',order:s.outbox,run_id:s.runId})
    await save({outbox:null,done:s.done+1,cursor:s.cursor+1,retryAt:0,failures:0,phase:'advance'})
    await nextOrder()
  }
  async function step() {
    if(s.outbox)return deliver()
    if(s.phase==='advance'){if(s.reportPending){await report();await save({reportPending:false})}return nextOrder()}
    if(['idle','done','partial'].includes(s.phase))return begin()
    if(s.phase==='finish')return nextOrder()
    if(s.phase==='navigate')return navigate(s.target,s.nextPhase)
    const tab=await port.tab(s.tabId)
    if(!tab)return navigate(s.target||ORDER_LIST,s.phase==='detail'?'detail':'list')
    if(tab.status!=='complete'){if(port.now()-s.since>90000)return skip('page_unavailable');return}
    const result=await port.read(s.tabId)
    if(result?.error) {
      if(['login_required','human_check'].includes(result.error)){
        await save({phase:'blocked',blockedCode:result.error,resumePhase:s.phase,message:errors[result.error]});await report('blocked');return
      }
      if(port.now()-s.since<45000)return
      return skip(result.error)
    }
    if(s.phase==='list_wait') {
      const signature=result.orders?.map(o=>o.ref).join(',')
      if(result.kind==='list'&&signature!==s.seen.at(-1)){await save({phase:'list'});return step()}
      if(port.now()-s.since>45000)return skip('pagination','La page suivante ne répond pas. Les commandes déjà trouvées sont conservées.')
      return
    }
    if(s.phase==='list') {
      if(result.kind!=='list'||!Array.isArray(result.orders)||!result.orders.length&&!result.empty)return skip('list_unreadable','La liste ne permet pas de confirmer que toutes les commandes sont présentes.')
      const valid=result.orders.filter(o=>/^G[A-Z0-9]{7,39}$/.test(o.ref)&&/^20\d{2}-\d{2}-\d{2}$/.test(o.order_date||''))
      const signature=valid.map(o=>o.ref).join(',')
      if(s.seen.includes(signature))return skip('pagination','La page est répétée. Certaines commandes peuvent manquer.')
      const recent=valid.filter(o=>o.order_date>=s.sinceDate&&o.order_date<=s.untilDate).filter(o=>s.mode!=='incremental'||!s.known[o.ref]?.stable||port.now()-Date.parse(s.known[o.ref].observed_at)>86400000).map(o=>o.ref)
      const queue=[...new Set([...s.queue,...recent])]
      await save({queue,total:queue.length,pages:s.pages+1,seen:[...s.seen,signature]})
      if(valid.length!==result.orders.length||result.incomplete)return skip('list_incomplete','Une ligne de la liste est illisible. Relance une vérification complète après contrôle sur Shein.')
      if(result.has_next&&valid.length&&valid.every(o=>o.order_date>=s.sinceDate)) {
        if(s.pages>=100||queue.length>=1000)return skip('limit','Limite de lecture atteinte. Choisis une période plus courte pour terminer.')
        const clicked=await port.read(s.tabId,'next')
        if(!clicked?.clicked)return skip('pagination','Impossible de passer à la page suivante.')
        await save({since:port.now(),phase:'list_wait'})
      } else await nextOrder()
    } else if(s.phase==='detail') {
      if(result.kind!=='detail'||result.ref!==s.queue[s.cursor])return skip('reference_mismatch')
      await save({outbox:result,phase:'sending'});await deliver()
    }
  }
  async function tick() {
    await load()
    if(!s.enabled||s.phase==='blocked'||s.retryAt>port.now()||['done','partial'].includes(s.phase)&&s.nextAt>port.now())return
    try{await step()}catch(e){
      if([401,403].includes(e.status))return save({enabled:false,needsConnection:true,retryAt:0,message:'L’association a expiré. Reconnecte l’extension sur le site.'})
      if([400,409,413,422].includes(e.status)&&s.outbox){try{await skip('import_rejected',e.message);return}catch(next){e=next}}
      if([400,404,409,413,422].includes(e.status))return save({phase:'blocked',blockedCode:'request_rejected',resumePhase:'idle',runId:null,retryAt:0,message:e.message+' Relance la synchronisation.'})
      const failures=s.failures+1,delay=Math.min(300000,30000*2**Math.min(failures-1,4))
      await save({failures,retryAt:port.now()+delay,message:`${e.message||'Connexion interrompue.'} Reprise dans ${Math.ceil(delay/1000)} s ; la progression est conservée.`})
    }
  }
  async function command(action,options={}) {
    await load()
    if(action==='pause')return save({enabled:false,message:'Lecture des commandes en pause.'})
    if(action==='start') {
      if(s.phase==='blocked'&&['human_check','login_required'].includes(s.blockedCode))throw Error('Termine la vérification dans l’onglet Shein, puis clique sur Reprendre.')
      if(s.outbox||!['idle','done','partial','blocked'].includes(s.phase)){await save({enabled:true,retryAt:0});return tick()}
      if(options.mode==='targeted'&&!orderReference(options.reference))throw Error('Colle un numéro ou un lien de commande Shein valide.')
      await save({enabled:true,retryAt:0,nextAt:0,phase:'idle',runId:null,request:options})
    } else if(action==='resume')await save({enabled:true,retryAt:0,phase:s.resumePhase||s.phase,since:port.now(),blockedCode:null})
    await tick()
  }
  return {tick,command}
}
