// Browser-independent state machine. Persist before navigation or sending a result.
export const SITE = 'https://vinted-stock.vercel.app'
export const initialState = () => ({enabled:false,phase:'idle',job:null,tabId:null,outbox:null,message:'Associe ton navigateur pour commencer.',completed:0})
export function allowedPage(value) {
  try { const u=new URL(value);return u.protocol==='https:'&&!u.username&&!u.password&&!u.port&&['fr.shein.com','www.shein.com'].includes(u.hostname) } catch { return false }
}
export function productId(value) {
  return allowedPage(value) ? new URL(value).pathname.match(/-p-(\d{1,20})\.html$/i)?.[1] : null
}
export function jobUrl(job) {
  if(productId(job.input))return job.input
  if(/^[a-z0-9_-]{1,200}$/i.test(job.expected_sku||''))return `https://fr.shein.com/pdsearch/${encodeURIComponent(job.expected_sku)}/`
  throw Error('La demande ne contient pas de lien ou de SKU utilisable.')
}
export function resultError(result,job) {
  if(result?.error)return result.error
  if(!result || !productId(result.supplier_url))return 'page_unavailable'
  if(job.expected_supplier_id&&productId(result.supplier_url)!==job.expected_supplier_id)return 'sku_mismatch'
  if(!result.supplier_sku || job.expected_sku&&result.supplier_sku.toLowerCase()!==job.expected_sku.toLowerCase())return 'sku_mismatch'
  if(result.selected_size)return 'selected_size'
  if(!result.color)return 'color_unreadable'
  if(!result.photos?.length)return 'photos_unreadable'
  return null
}
const messages={human_check:'Vérification Shein requise. Termine-la dans l’onglet, puis clique sur Reprendre.',
  sku_mismatch:'Le SKU ne correspond pas. Ouvre la bonne fiche dans l’onglet, puis reprends.',
  sku_not_found:'Aucun résultat exact confirmé. Ouvre le produit recherché dans l’onglet, puis reprends.',
  selected_size:'Une taille est sélectionnée. Désélectionne-la avant de reprendre le relevé du prix de fiche.',
  color_unreadable:'La couleur est illisible. Vérifie la fiche avant de reprendre.',
  photos_unreadable:'Les photos ne sont pas encore lisibles. Vérifie la fiche avant de reprendre.',
  price_unreadable:'Le prix en euros est illisible. Vérifie la fiche avant de reprendre.',
  page_unavailable:'La fiche est inaccessible. Ouvre le produit dans l’onglet, puis reprends.'}

export async function callApi(token,body,fetcher=fetch) {
  const response=await fetcher(`${SITE}/api/collector`,{method:'POST',redirect:'error',credentials:'omit',
    headers:{'Content-Type':'application/json',Authorization:`Bearer ${token}`},body:JSON.stringify(body),signal:AbortSignal.timeout(12000)})
  let data;try{data=await response.json()}catch{throw Error('Réponse du site illisible. Nouvelle tentative dans 30 secondes.')}
  if(!response.ok){const e=Error(data.error||'Le site est momentanément indisponible.');e.status=response.status;throw e}
  return data
}

export function createEngine(port) {
  let s
  const load=async()=>s={...initialState(),...await port.load()}
  const save=async patch=>{Object.assign(s,patch);await port.save(s)}
  const api=body=>port.api(body)
  const jobBody=action=>({action,job_id:s.job.id,lease:s.job.lease})
  async function tab() {return s.tabId==null?null:port.tab(s.tabId)}
  async function navigate(url,phase) {
    if(!allowedPage(url))throw Error('Adresse Shein non autorisée.')
    const owned=await tab()
    if(!owned)await save({tabId:await port.createTab()})
    await save({phase:'navigate',nextPhase:phase,target:url,since:port.now(),message:'Ouverture de la fiche Shein…'})
    await port.navigate(s.tabId,url)
    await save({phase})
  }
  async function deliver() {
    const out=s.outbox
    await api(out)
    if(out.action==='complete')await save({outbox:null,job:null,phase:'idle',completed:s.completed+1,message:'Fiche ajoutée à la bibliothèque. Recherche de la suivante…'})
    else if(['human_check','page_unavailable'].includes(out.code))await save({outbox:null,phase:'blocked'})
    else await save({outbox:null,job:null,phase:'idle',reviewed:(s.reviewed||0)+1,
      message:'Une fiche reste à vérifier dans le catalogue. Les autres demandes continuent.'})
  }
  async function block(code) {
    await save({phase:'blocked',blockedCode:code,message:messages[code]||messages.page_unavailable,
      outbox:{...jobBody('fail'),status:'blocked',code}})
    await deliver()
  }
  async function handleError(error) {
    if([401,403].includes(error.status))await save({enabled:false,needsConnection:true,message:'Association expirée ou retirée. Reconnecte ce navigateur depuis le catalogue.'})
    else if(error.status===409) {
      // Never submit an old result using a new lease or replay an excluded job.
      await save({enabled:false,job:null,outbox:null,phase:'idle',message:error.message+' Relance depuis la file du site, puis clique sur Démarrer.'})
    } else await save({message:error.message||'Connexion interrompue. La demande reste conservée.'})
  }
  async function tick() {
    await load()
    if(!s.enabled)return s
    try {
      if(s.outbox){await deliver();return s}
      if(s.phase==='blocked')return s // No navigation, refresh or repeated CAPTCHA attempts.
      if(!s.job) {
        const response=await api({action:'claim'})
        if(response.paused){await save({enabled:false,message:'Cet appareil est en pause sur le site.'});return s}
        if(!response.job){await save({message:'En attente de tes liens ou SKU dans la bibliothèque.'});return s}
        await save({job:response.job,phase:'claimed',candidates:[],candidate:0})
      }
      const alive=await api(jobBody('heartbeat'))
      if(!alive.enabled){await save({enabled:false,message:'Cet appareil est en pause sur le site.'});return s}
      if(s.phase==='claimed'){await navigate(jobUrl(s.job),productId(s.job.input)?'product':'search');return s}
      const current=await tab()
      if(!current){await block('page_unavailable');return s}
      if(s.phase==='navigate') {
        // Recover after suspension between persisting the target and navigating.
        if(current.url==='about:blank'){await port.navigate(s.tabId,s.target);await save({phase:s.nextPhase});return s}
        if(current.url===s.target)await save({phase:s.nextPhase})
        else {await block('page_unavailable');return s}
      }
      if(current.status==='loading'&&port.now()-s.since<90000)return s
      if(!allowedPage(current.url)){await block('page_unavailable');return s}
      const isProduct=!!productId(current.url)
      let result=await port.read(s.tabId,isProduct?'product':'search')
      if(result?.error==='human_check'){await block('human_check');return s}
      if(s.phase==='search'&&!isProduct) {
        const candidates=(result?.urls||[]).filter(productId).slice(0,5)
        if(!candidates.length){if(port.now()-s.since<60000)return s;await block('sku_not_found');return s}
        await save({candidates,candidate:0});await navigate(candidates[0],'product');return s
      }
      let problem=resultError(result,s.job)
      // Single-color products expose the color only inside their description.
      // Identity and the absence of a selected size must already be confirmed.
      if(port.enrich&&(!problem||['color_unreadable','photos_unreadable'].includes(problem))) {
        await save({message:'Lecture de la description et des détails…'})
        result=await port.enrich(s.tabId,result,s.job)
        problem=resultError(result,s.job)
      }
      if(problem) {
        if(problem==='sku_mismatch'&&s.candidates?.[s.candidate+1]) {
          await save({candidate:s.candidate+1});await navigate(s.candidates[s.candidate],'product');return s
        }
        if(['page_unavailable','price_unreadable','color_unreadable','photos_unreadable'].includes(problem)&&port.now()-s.since<60000)return s
        await block(problem);return s
      }
      await save({phase:'submit',outbox:{...jobBody('complete'),result},message:'Enregistrement dans la bibliothèque…'})
      await deliver()
    } catch(error) {await handleError(error)}
    return s
  }
  async function command(action) {
    await load()
    if(action==='pause'){await save({enabled:false,message:'Récupération arrêtée. Clique sur Démarrer pour reprendre.'});return s}
    if(action==='start') {
      await save({enabled:true})
      // A blocked job always needs explicit recovery, never automatic navigation.
      return s.phase==='blocked'?s:tick()
    }
    if(action==='skip'&&s.phase==='blocked'&&s.blockedCode!=='human_check') {
      try {
        if(s.outbox)await deliver()
        await save({job:null,phase:'idle',enabled:true,message:'La fiche reste à vérifier sur le site. Passage à la suivante.'})
        return tick()
      } catch(error){await handleError(error)}
    }
    if(action==='resume') {
      try {
        if(s.outbox)await deliver()
        if(s.phase!=='blocked'||!s.job)return s
        const current=await tab()
        if(!current||!allowedPage(current.url))throw Error('Rouvre l’onglet Shein de l’extension avant de reprendre.')
        // Read the existing page first. Resuming never reloads it.
        const isProduct=!!productId(current.url)
        const value=await port.read(s.tabId,isProduct?'product':'search')
        const problem=isProduct?resultError(value,s.job):value?.error||(!value?.urls?.length?'sku_not_found':null)
        if(problem&&!['color_unreadable','photos_unreadable'].includes(problem)){await save({message:messages[problem]||messages.page_unavailable});return s}
        const response=await api({...jobBody('resume_blocked'),keep_page:true})
        await save({job:response.job,phase:isProduct?'product':'search',since:port.now(),enabled:true,message:'Reprise de la fiche ouverte…'})
        return tick()
      } catch(error){await handleError(error)}
    }
    return s
  }
  return {tick,command}
}
