export const ORDER_LIST='https://fr.shein.com/user/orders/list?from=navTop'
export const orderState=()=>({enabled:false,needsConnection:false,phase:'idle',tabId:null,queue:[],seen:[],pages:0,done:0,total:0,outbox:null,nextAt:0,retryAt:0,message:'Active la lecture de tes commandes Shein.',lastCompletedAt:null})
const errors={login_required:'Connecte-toi à Shein dans l’onglet des commandes, puis reprends ici.',human_check:'Shein demande une vérification. Termine-la dans l’onglet puis reprends ici.',order_unreadable:'Une commande n’a pas pu être lue entièrement. Ouvre Shein puis reprends.',page_unavailable:'La page des commandes est indisponible. Ouvre Shein puis reprends.'}
export function createOrderEngine(port) {
  let s
  const load=async()=>s={...orderState(),...await port.load()}
  const save=async patch=>{Object.assign(s,patch);await port.save(s)}
  async function navigate(target,phase) {
    let tab=await port.tab(s.tabId)
    if(!tab)await save({tabId:await port.createTab()})
    await save({target,phase:'navigate',nextPhase:phase,since:port.now()})
    await port.navigate(s.tabId,target)
    await save({phase})
  }
  async function begin() {
    const context=await port.api({action:'orders_context'})
    if(!context.enabled)throw Error('Ce navigateur est en pause sur le site.')
    await save({sinceDate:context.since_date,queue:[],seen:[],pages:0,done:0,total:0,outbox:null,retryAt:0,message:'Recherche des commandes récentes…'})
    await navigate(ORDER_LIST,'list')
  }
  async function nextOrder() {
    if(s.done>=s.queue.length) {
      await save({phase:'finish',message:'Association des articles aux ventes…'})
      const r=await port.api({action:'orders_finish',count:s.done})
      await save({phase:'done',lastCompletedAt:port.now(),nextAt:port.now()+10*60000,message:`${s.done} commande(s) lue(s) · ${r.linked||0} vente(s) associée(s).`,retryAt:0})
    } else {
      await save({message:`Lecture de la commande ${s.done+1} sur ${s.total}…`})
      await navigate(`https://fr.shein.com/user/orders/detail/${encodeURIComponent(s.queue[s.done])}`,'detail')
    }
  }
  async function deliver() {
    await port.api({action:'orders_import',order:s.outbox})
    await save({outbox:null,done:s.done+1,retryAt:0})
    await nextOrder()
  }
  async function step() {
    if(s.outbox)return deliver()
    if(['idle','done'].includes(s.phase))return begin()
    if(s.phase==='finish')return nextOrder()
    const tab=await port.tab(s.tabId)
    if(!tab)return navigate(s.target||ORDER_LIST,s.phase==='detail'?'detail':'list')
    if(s.phase==='navigate')return navigate(s.target,s.nextPhase)
    if(tab.status!=='complete')return
    const result=await port.read(s.tabId)
    if(result?.error) {
      if(['page_unavailable','order_unreadable'].includes(result.error)&&port.now()-s.since<45000)return
      return save({phase:'blocked',resumePhase:s.phase,message:errors[result.error]||errors.page_unavailable})
    }
    if(s.phase==='list') {
      if(result.kind!=='list'||!result.orders?.length||result.orders.some(o=>!/^G[A-Z0-9]{7,39}$/.test(o.ref)||!/^20\d{2}-\d{2}-\d{2}$/.test(o.order_date||'')))return save({phase:'blocked',resumePhase:'list',message:'La liste des commandes a changé. Vérifie la page Shein avant de reprendre.'})
      const signature=result.orders.map(o=>o.ref).join(',')
      if(s.seen.includes(signature))return save({phase:'blocked',resumePhase:'list',message:'Shein n’a pas changé de page. Relance la synchronisation.'})
      const recent=result.orders.filter(o=>o.order_date>=s.sinceDate).map(o=>o.ref)
      const queue=[...new Set([...s.queue,...recent])]
      await save({queue,total:queue.length,pages:s.pages+1,seen:[...s.seen,signature]})
      if(result.has_next&&result.orders.every(o=>o.order_date>=s.sinceDate)) {
        if(s.pages>=20||queue.length>=200)return save({phase:'blocked',resumePhase:'list',message:'Plus de 200 commandes à lire. La récupération reste en attente pour éviter un import incomplet.'})
        const clicked=await port.read(s.tabId,'next')
        if(!clicked?.clicked)return save({phase:'blocked',resumePhase:'list',message:'Impossible de passer à la page suivante des commandes.'})
        await save({since:port.now(),phase:'list_wait'})
      } else await nextOrder()
    } else if(s.phase==='list_wait') {
      const signature=result.orders?.map(o=>o.ref).join(',')
      if(result.kind==='list'&&signature!==s.seen.at(-1)){await save({phase:'list'});return step()}
      if(port.now()-s.since>45000)await save({phase:'blocked',resumePhase:'list',message:'La page suivante Shein ne répond pas. Relance la synchronisation.'})
    } else if(s.phase==='detail') {
      if(result.kind!=='detail'||result.ref!==s.queue[s.done])return save({phase:'blocked',resumePhase:'detail',message:'La page ouverte ne correspond pas à la commande attendue.'})
      await save({outbox:result,phase:'sending'})
      await deliver()
    }
  }
  async function tick() {
    await load()
    if(!s.enabled||s.phase==='blocked'||s.retryAt>port.now()||s.phase==='done'&&s.nextAt>port.now())return
    try{await step()}catch(e){
      await save({retryAt:port.now()+30000,message:e.status===401?'L’association du navigateur a expiré. Reconnecte l’extension sur le site.':e.message||'Connexion interrompue. Nouvelle tentative dans 30 secondes.'})
      if([401,403].includes(e.status))await save({enabled:false,needsConnection:true})
      else if([400,409,413].includes(e.status))await save({phase:'blocked',resumePhase:'idle',outbox:null,retryAt:0})
    }
  }
  async function command(action) {
    await load()
    if(action==='pause')return save({enabled:false,message:'Lecture des commandes en pause.'})
    if(action==='start') {
      // Deliver a durable pending result before restarting discovery.
      await save({enabled:true,retryAt:0,nextAt:0,phase:s.outbox?'sending':'idle'})
    } else if(action==='resume')await save({enabled:true,retryAt:0,phase:s.resumePhase||s.phase,since:port.now()})
    await tick()
  }
  return {tick,command}
}
