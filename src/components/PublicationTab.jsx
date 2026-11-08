import ListingPublisher from './ListingPublisher'
import {syncListingStatuses} from '../lib/listingStatusSync'
import {useEffect,useMemo,useRef,useState,useSyncExternalStore} from 'react'
import {PLAN_DEFAULTS,planPublications,parisDate,dayLabel,timeLabel,SKU_GAP_MINUTES} from '../lib/publicationPlan'
import {buttonClass,primaryClass,fieldClass} from './WorkspaceUI'
import {getRunnerState,subscribeRunner,startPlanSend,resumeSend,cancelSchedules,stopRunner,dismissRunnerMessages} from '../lib/publicationRunner'

const defaultRequest=(...args)=>import('../lib/api').then(m=>m.listingStudioRequest(...args))
const STORE='vs-publication-plan'
const healthLabels={temporary:'Bloqué temporairement',restricted:'Restreint',permanent:'Bloqué définitivement',blocked:'Bloqué',review:'En vérification'}
const unusable=a=>['permanent','blocked'].includes(a?.health?.status)
function stored(){try{return JSON.parse(localStorage.getItem(STORE))||{}}catch{return {}}}
function keep(value){try{localStorage.setItem(STORE,JSON.stringify(value))}catch{/* stockage indisponible : réglages gardés pour cette visite */}}
const shortDate=v=>v?new Date(v).toLocaleString('fr-FR',{weekday:'short',day:'2-digit',month:'2-digit',hour:'2-digit',minute:'2-digit',timeZone:'Europe/Paris'}):'—'

function Stat({value,label,tone='slate'}){
 const tones={teal:'text-teal-700',amber:'text-amber-700',rose:'text-rose-700',slate:'text-slate-700'}
 return <div className="rounded-2xl border border-slate-200 bg-white px-4 py-3"><p className={`text-2xl font-bold ${tones[tone]}`}>{value}</p><p className="text-xs text-slate-500 mt-0.5">{label}</p></div>
}
function Section({title,children,aside}){
 return <section className="rounded-2xl border border-slate-200 bg-white p-4 sm:p-5 space-y-4"><div className="flex flex-wrap items-center justify-between gap-2"><h2 className="text-xs font-semibold uppercase tracking-widest text-slate-500">{title}</h2>{aside}</div>{children}</section>
}
function Thumb({row}){return row.photo?<img src={row.photo} alt="" className="h-10 w-8 rounded-md object-cover bg-slate-100 shrink-0"/>:<span className="h-10 w-8 rounded-md bg-slate-100 shrink-0"/>}

export default function PublicationTab({request=defaultRequest,onOpenListings,step=1800}){
 const [data,setData]=useState(null),[loading,setLoading]=useState(true),[loadError,setLoadError]=useState('')
 const run=useSyncExternalStore(subscribeRunner,getRunnerState)
 const {progress,notice,failures}=run,error=loadError||run.error
 const saved=useMemo(stored,[])
 const [settings,setSettings]=useState({...PLAN_DEFAULTS,...(saved.settings||{})})
 const [excluded,setExcluded]=useState(()=>new Set(saved.excluded||[])),[onlyConnected,setOnlyConnected]=useState(!!saved.onlyConnected)
 const [provider,setProvider]=useState(saved.provider==='dotb'?'dotb':'ylavint')
 const connected=a=>provider==='ylavint'?a?.ylavint?.online:a?.connected
 const [plan,setPlan]=useState(null),[planError,setPlanError]=useState('')
 const [picked,setPicked]=useState(()=>new Set())
 const alive=useRef(true),seenRuns=useRef(run.finished),loadingRef=useRef(false),pollLatest=useRef(null)
 useEffect(()=>{alive.current=true;load();return()=>{alive.current=false}},[])
 // L'envoi vit hors de cet écran : quand il se termine, on relit les fiches.
 useEffect(()=>{if(run.finished!==seenRuns.current){seenRuns.current=run.finished;setPlan(null);setPicked(new Set());load()}},[run.finished])
 useEffect(()=>{keep({settings,excluded:[...excluded],onlyConnected,provider})},[settings,excluded,onlyConnected,provider])
 useEffect(()=>setPlan(null),[settings,excluded,onlyConnected,data,provider])

 pollLatest.current=()=>{if(!plan&&!run.running)load(true)}
 useEffect(()=>{
  const check=()=>{if(document.visibilityState!=='hidden')pollLatest.current?.()}
  const timer=setInterval(check,30000)
  window.addEventListener('focus',check);document.addEventListener('visibilitychange',check)
  return()=>{clearInterval(timer);window.removeEventListener('focus',check);document.removeEventListener('visibilitychange',check)}
 },[])
 async function load(background=false){
  if(loadingRef.current)return
  loadingRef.current=true
  setLoading(true);setLoadError('')
  try{
   let value=await request('GET',undefined,'action=planner')
   const errors=[];let checked=false
   await syncListingStatuses([...(value.scheduled||[]),...(value.queue||[])],request,{active:()=>alive.current,onDraft:()=>{checked=true},onError:(_row,e)=>errors.push(e.message)})
   if(checked&&alive.current)value=await request('GET',undefined,'action=planner')
   if(alive.current){setData(value);if(errors.length)setLoadError('Certains statuts restent à vérifier : '+errors[0])}
  }
  catch(e){if(alive.current)setLoadError(e.message||'Impossible de charger la publication.')}
  finally{loadingRef.current=false;if(alive.current)setLoading(false)}
 }
 const accounts=useMemo(()=>new Map((data?.accounts||[]).map(a=>[a.id,a])),[data])
 const login=id=>accounts.get(id)?.login||'Compte non sélectionné'
 const ready=(data?.drafts||[]).filter(d=>!d.issues.length)
 const incomplete=(data?.drafts||[]).filter(d=>d.issues.length)
 const readyAccounts=[...new Set(ready.map(d=>d.account_id))]
 // Pourquoi un compte ne peut pas être planifié (null = il peut l'être).
 function blocker(id){
  const a=accounts.get(id)
  if(!a)return 'Absent de ta sélection AdsPower'
  if(provider==='ylavint'&&!a.ylavint?.ready)return a.ylavint?.reason||'Publication YlaVint non activée'
  if(provider==='dotb'&&!a.dotb)return 'Publication Dotb coupée pour ce compte'
  if(unusable(a))return healthLabels[a.health.status]
  if(onlyConnected&&!connected(a))return 'Bridge fermé'
  return null
 }
 const eligible=ready.filter(d=>!blocker(d.account_id)&&!excluded.has(d.account_id))
 const closedBridges=readyAccounts.filter(id=>accounts.get(id)&&!connected(accounts.get(id))).length
 const spacingByAccount=Object.fromEntries((data?.accounts||[]).map(a=>[a.id,a.spacing]))
 const occupied=(data?.occupied||[]).map(o=>({...o,at:Number(o.at)}))

 function calculate(){
  setPlanError('');dismissRunnerMessages()
  try{setPlan(planPublications({drafts:eligible,occupied,settings,spacingByAccount}))}
  catch(e){setPlan(null);setPlanError(e.message)}
 }
 function set(key,value){setSettings(s=>({...s,[key]:value}))}

 function send(){
  if(!plan?.items.length)return
  const label=settings.mode==='draft'?'brouillons Vinted':'annonces'
  if(!window.confirm(`Programmer ${plan.items.length} ${label} du ${dayLabel(plan.items[0].date)} au ${dayLabel(plan.items.at(-1).date)} ?\n\nL’envoi continue même si tu changes d’onglet. Garde simplement le site ouvert jusqu’à la fin.`))return
  setLoadError('');startPlanSend({request,items:plan.items,mode:settings.mode,provider,step})
 }
 function resume(){setLoadError('');resumeSend({request,rows:(data?.queue||[]).filter(r=>r.state==='preparing'&&r.publish_provider!=='ylavint'),step})}
 function cancelPicked(){
  const rows=(data?.scheduled||[]).filter(r=>picked.has(r.id))
  if(!rows.length||!window.confirm(`Annuler ${rows.length} programmation${rows.length>1?'s':''} ? Les fiches redeviennent prêtes à planifier.`))return
  setLoadError('');cancelSchedules({request,rows})
 }

 const busy=run.running
 const scheduled=data?.scheduled||[]
 const scheduledDays=[...new Set(scheduled.map(r=>parisDate(Date.parse(r.scheduled_at||r.planned_at))))]
 const preparing=(data?.queue||[]).filter(r=>r.state==='preparing'&&r.publish_provider!=='ylavint')

 return <main className="workspace-page max-w-5xl mx-auto p-4 sm:p-6 space-y-5 text-slate-800">
  <header className="flex flex-wrap items-end justify-between gap-3">
   <div><p className="text-xs font-semibold tracking-widest text-teal-700 uppercase mb-1">Planification</p><h1 className="text-2xl font-bold">Publication</h1>
    <p className="text-sm text-slate-500 mt-1 max-w-2xl">Répartis tes fiches prêtes sur plusieurs jours : le service choisi les traite à partir de l’heure prévue. Toujours actif : jamais le même SKU à moins de {SKU_GAP_MINUTES} minutes, tous comptes confondus, et l’écart de chaque compte est respecté.</p></div>
   <button className={buttonClass} disabled={loading||busy} onClick={load}>{loading?'Chargement…':'Actualiser'}</button>
  </header>
  {error&&<p role="alert" className="rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-800">{error}</p>}
  {notice&&<p role="status" className="flex items-start justify-between gap-3 rounded-xl border border-teal-200 bg-teal-50 p-3 text-sm text-teal-900"><span>{notice}</span><button type="button" className="shrink-0 text-xs underline" onClick={dismissRunnerMessages}>Fermer</button></p>}
  <ListingPublisher value={provider} onChange={setProvider} disabled={busy} dotb={data?.dotb_publish_enabled}/>
  {provider==='dotb'&&data&&!data.dotb_publish_enabled&&<p className="rounded-xl border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">L’envoi par Dotb est coupé sur le serveur : tu peux préparer le planning, mais pas l’envoyer.</p>}
  {loading&&!data?<p role="status" className="py-16 text-center text-slate-500">Lecture de tes fiches et de tes comptes…</p>:data&&<>
   <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
    <Stat tone="teal" value={ready.length} label={`fiche${ready.length>1?'s':''} prête${ready.length>1?'s':''} sur ${readyAccounts.length} compte${readyAccounts.length>1?'s':''}`}/>
    <Stat tone={incomplete.length?'amber':'slate'} value={incomplete.length} label="à compléter dans Annonces"/>
    <Stat tone={closedBridges?'amber':'slate'} value={closedBridges} label="compte(s) au Bridge fermé"/>
    <Stat value={scheduled.length} label="déjà programmée(s)"/>
   </div>

   {incomplete.length>0&&<details className="rounded-2xl border border-amber-200 bg-amber-50/60 p-4 text-sm"><summary className="cursor-pointer font-medium text-amber-900">{incomplete.length} fiche{incomplete.length>1?'s':''} à compléter avant de pouvoir les planifier</summary>
    <ul className="mt-3 space-y-2">{incomplete.map(d=><li key={d.id} className="flex items-center gap-3"><Thumb row={d}/><div className="min-w-0"><p className="truncate">{d.title||d.sku||'Fiche sans titre'} · <span className="text-slate-500">{login(d.account_id)}</span></p><p className="text-xs text-amber-800">Manque : {d.issues.join(', ')}</p></div></li>)}</ul>
    {onOpenListings&&<button className={`${buttonClass} mt-3`} onClick={onOpenListings}>Ouvrir Annonces</button>}
   </details>}

   <Section title="Comptes à planifier" aside={<label className="flex items-center gap-2 text-xs text-slate-600"><input type="checkbox" className="accent-teal-700" checked={onlyConnected} onChange={e=>setOnlyConnected(e.target.checked)}/>Seulement les comptes au Bridge ouvert</label>}>
    {readyAccounts.length?<ul className="divide-y divide-slate-100">{readyAccounts.map(id=>{
     const a=accounts.get(id),why=blocker(id),count=ready.filter(d=>d.account_id===id).length
     return <li key={id} className="flex flex-wrap items-center gap-3 py-2.5">
      <input type="checkbox" aria-label={`Planifier ${login(id)}`} className="accent-teal-700" disabled={!!why||busy} checked={!why&&!excluded.has(id)} onChange={e=>setExcluded(s=>{const n=new Set(s);e.target.checked?n.delete(id):n.add(id);return n})}/>
      <span className="font-medium text-sm min-w-32">{login(id)}</span>
      <span className="text-xs text-slate-500">{count} prête{count>1?'s':''}{a?` · écart ${a.spacing} min`:''}</span>
      <span className="ml-auto flex flex-wrap gap-1.5 text-[11px]">
       {a&&<span className={`rounded-full px-2 py-0.5 ${connected(a)?'bg-teal-50 text-teal-800':'bg-amber-50 text-amber-800'}`}>{connected(a)?'Bridge ouvert':'Bridge fermé'}</span>}
       {a?.health&&a.health.status!=='ok'&&<span className="rounded-full bg-rose-50 px-2 py-0.5 text-rose-800">{healthLabels[a.health.status]||a.health.status}{a.health.until?` jusqu’au ${new Date(a.health.until).toLocaleDateString('fr-FR')}`:''}</span>}
       {why&&why!=='Bridge fermé'&&!a?.health?.status?.match(/permanent|blocked/)&&<span className="rounded-full bg-slate-100 px-2 py-0.5 text-slate-600">{why}</span>}
      </span>
     </li>})}</ul>:<p className="text-sm text-slate-500">Aucune fiche prête. Prépare tes annonces dans l’onglet Annonces : elles apparaîtront ici.</p>}
    <p className="text-xs text-slate-500">{provider==='ylavint'?'Le profil AdsPower et son Bridge YlaVint doivent être ouverts. Si le profil est fermé, l’annonce attend sa réouverture. Les horaires, plafonds et écarts YlaVint du compte peuvent décaler la publication.':'Le Bridge Dotb du compte doit être ouvert pendant l’envoi et à l’heure de publication.'}</p>
   </Section>

   <Section title="Ta logique de publication">
    <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4 text-sm">
     <label className="block">Articles par jour et par compte<input type="number" min="1" max="60" className={`${fieldClass} mt-1`} value={settings.perDay} onChange={e=>set('perDay',e.target.value)}/></label>
     <label className="block">Écart minimum entre 2 articles d’un compte (min)<input type="number" min="5" max="720" className={`${fieldClass} mt-1`} value={settings.spacing} onChange={e=>set('spacing',e.target.value)}/></label>
     <label className="block">Mode<select className={`${fieldClass} mt-1`} value={settings.mode} onChange={e=>set('mode',e.target.value)}><option value="live">En ligne directement</option><option value="draft">Brouillon Vinted</option></select></label>
     <div className="block">Heures de publication<div className="mt-1 flex items-center gap-2"><input type="time" aria-label="Début" className={fieldClass} value={settings.from} onChange={e=>set('from',e.target.value)}/><span className="text-slate-400">à</span><input type="time" aria-label="Fin" className={fieldClass} value={settings.to} onChange={e=>set('to',e.target.value)}/></div></div>
     <label className="block">Sur combien de jours<input type="number" min="1" max="30" className={`${fieldClass} mt-1`} value={settings.days} onChange={e=>set('days',e.target.value)}/></label>
     <label className="block">À partir de<select className={`${fieldClass} mt-1`} value={settings.start} onChange={e=>set('start',e.target.value)}><option value="today">Aujourd’hui</option><option value="tomorrow">Demain</option></select></label>
     <label className="block">Première annonce dans (min)<input type="number" min="5" max="720" className={`${fieldClass} mt-1 disabled:opacity-50`} value={settings.firstIn} disabled={settings.start==='tomorrow'} onChange={e=>set('firstIn',e.target.value)}/><span className="mt-1 block text-xs text-slate-500">{settings.start==='tomorrow'?'Demain, la première part au début de la plage horaire.':'Délai entre ton clic sur « Calculer » et la première publication (5 min minimum).'}</span></label>
    </div>
    <p className="text-xs text-slate-500">L’écart réglé sur un compte dans Annonces s’applique s’il est plus grand. Les annonces déjà prévues comptent dans le total du jour.</p>
   </Section>

   <Section title="Aperçu avant d’envoyer">
    {planError&&<p role="alert" className="text-sm text-red-700">{planError}</p>}
    {plan&&<>
     <p className={`rounded-xl p-3 text-sm ${plan.conflicts.length?'bg-rose-50 text-rose-800':'bg-teal-50 text-teal-900'}`}>{plan.items.length} annonce{plan.items.length>1?'s':''} programmée{plan.items.length>1?'s':''}{settings.mode==='draft'?' en brouillon Vinted':''} · {plan.conflicts.length?`${plan.conflicts.length} conflit(s) détecté(s) : recalcule.`:`aucun SKU en double à moins de ${SKU_GAP_MINUTES} min`}{plan.unplanned.length?` · ${plan.unplanned.length} sans créneau`:''}</p>
     <div className="flex flex-wrap gap-x-5 gap-y-2 text-sm">{plan.byDay.map(d=><span key={d.date}>{d.label} : <strong className="text-lg">{d.count}</strong></span>)}</div>
     {plan.unplanned.length>0&&<p className="text-xs text-amber-800">{plan.unplanned.length} fiche{plan.unplanned.length>1?'s':''} sans créneau : augmente le nombre de jours ou d’articles par jour.</p>}
     <details className="text-sm"><summary className="cursor-pointer text-slate-600">Voir le détail ({plan.items.length})</summary>
      <div className="mt-3 max-h-96 overflow-y-auto divide-y divide-slate-100">{plan.items.map(i=>{const d=ready.find(x=>x.id===i.id);return <div key={i.id} className="flex items-center gap-3 py-2"><span className="w-28 shrink-0 text-xs text-slate-500">{dayLabel(i.date)} · {timeLabel(i.at)}</span>{d&&<Thumb row={d}/>}<div className="min-w-0"><p className="truncate">{i.title||'Sans titre'}</p><p className="text-xs text-slate-500">{login(i.account_id)}{i.sku?` · ${i.sku}`:''}</p></div></div>})}</div>
     </details>
    </>}
    {progress&&<div className="space-y-2" role="status"><div className="h-2 rounded-full bg-slate-100 overflow-hidden"><div className="h-full bg-teal-600 transition-all" style={{width:`${Math.round(progress.index/progress.total*100)}%`}}/></div>
     <p className="text-sm text-slate-600">{progress.phase==='reserve'?`Réservation des créneaux… ${progress.index}/${progress.total}`:progress.phase==='cancel'?`Annulation ${progress.index}/${progress.total} : ${progress.title}`:`Envoi à Dotb ${progress.index}/${progress.total} : ${progress.title}${progress.message?` · ${progress.message}`:''}`}</p>
     <button className={buttonClass} onClick={stopRunner}>Arrêter après l’étape en cours</button></div>}
    <div className="flex flex-wrap gap-2">
     <button className={primaryClass} disabled={busy||!eligible.length} onClick={calculate}>Calculer le planning</button>
     <button className={buttonClass} disabled={busy||!plan?.items.length||!!plan?.conflicts.length||(provider==='dotb'&&!data.dotb_publish_enabled)} onClick={send}>Programmer {plan?.items.length||''} annonce{plan?.items.length>1?'s':''} avec {provider==='ylavint'?'YlaVint':'Dotb'}</button>
    </div>
    {!eligible.length&&ready.length>0&&<p className="text-xs text-slate-500">Aucun compte coché ne peut être planifié pour l’instant.</p>}
    {failures.length>0&&<div className="rounded-xl border border-amber-200 bg-amber-50 p-3 text-sm"><p className="font-medium text-amber-900 mb-2">{failures.length} annonce{failures.length>1?'s':''} à revoir</p>
     <ul className="space-y-1.5">{failures.map(f=><li key={f.id} className="flex flex-wrap gap-x-3 text-amber-900"><span className="font-medium">{f.title||'Annonce'}</span><span className="text-xs">{login(f.account_id)}{f.sku?` · ${f.sku}`:''}</span><span className="text-xs w-full">{f.error}</span></li>)}</ul></div>}
   </Section>

   {(data.queue||[]).length>0&&<Section title="En cours d’envoi" aside={preparing.length>0&&<button className={buttonClass} disabled={busy} onClick={resume}>Continuer l’envoi ({preparing.length})</button>}>
    <ul className="divide-y divide-slate-100">{data.queue.map(r=><li key={r.id} className="flex items-center gap-3 py-2 text-sm"><Thumb row={r}/><div className="min-w-0 flex-1"><p className="truncate">{r.title||'Annonce'} · <span className="text-slate-500">{login(r.account_id)}</span></p><p className={`text-xs ${r.last_error||r.state==='attention'?'text-amber-800':'text-slate-500'}`}>{r.last_error||r.message||'En attente'}</p></div><span className="text-xs text-slate-500 shrink-0">{shortDate(r.planned_at)}</span></li>)}</ul>
   </Section>}

   <Section title="Déjà programmées" aside={scheduled.length>0&&<div className="flex flex-wrap gap-2"><button className={buttonClass} disabled={busy} onClick={()=>setPicked(picked.size===scheduled.length?new Set():new Set(scheduled.map(r=>r.id)))}>{picked.size===scheduled.length?'Tout décocher':'Tout cocher'}</button><button className={`${buttonClass} text-rose-700`} disabled={busy||!picked.size} onClick={cancelPicked}>Annuler la sélection ({picked.size})</button></div>}>
    {scheduled.length?scheduledDays.map(day=><div key={day}><p className="text-xs font-semibold text-slate-500 mb-1">{dayLabel(day)}</p><ul className="divide-y divide-slate-100">{scheduled.filter(r=>parisDate(Date.parse(r.scheduled_at||r.planned_at))===day).map(r=><li key={r.id} className="flex items-center gap-3 py-2 text-sm">
     <input type="checkbox" aria-label={`Sélectionner ${r.title}`} className="accent-teal-700" disabled={busy} checked={picked.has(r.id)} onChange={e=>setPicked(s=>{const n=new Set(s);e.target.checked?n.add(r.id):n.delete(r.id);return n})}/>
     <span className="w-12 shrink-0 text-xs text-slate-500">{timeLabel(Date.parse(r.scheduled_at||r.planned_at))}</span><Thumb row={r}/>
     <div className="min-w-0 flex-1"><p className="truncate">{r.title||'Annonce'}</p><p className="text-xs text-slate-500">{login(r.account_id)}{r.sku?` · ${r.sku}`:''}</p></div>
     <span className={`rounded-full px-2 py-0.5 text-[11px] ${r.live?'bg-teal-50 text-teal-800':'bg-slate-100 text-slate-600'}`}>{r.publish_provider==='ylavint'?'YlaVint':'Dotb'} · {r.live?'en ligne':'brouillon'}</span></li>)}</ul></div>)
    :<p className="text-sm text-slate-500">Aucune annonce programmée pour l’instant.</p>}
   </Section>
  </>}
 </main>
}
