import {useEffect,useMemo,useRef,useState} from 'react'
import {PLAN_DEFAULTS,planPublications,parisDate,dayLabel,timeLabel,SKU_GAP_MINUTES} from '../lib/publicationPlan'
import {buttonClass,primaryClass,fieldClass} from './WorkspaceUI'

const defaultRequest=(...args)=>import('../lib/api').then(m=>m.listingStudioRequest(...args))
const STORE='vs-publication-plan'
const sleep=ms=>new Promise(r=>setTimeout(r,ms))
const BATCH=25
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
 const [data,setData]=useState(null),[loading,setLoading]=useState(true),[error,setError]=useState(''),[notice,setNotice]=useState('')
 const saved=useMemo(stored,[])
 const [settings,setSettings]=useState({...PLAN_DEFAULTS,...(saved.settings||{})})
 const [excluded,setExcluded]=useState(()=>new Set(saved.excluded||[])),[onlyConnected,setOnlyConnected]=useState(!!saved.onlyConnected)
 const [plan,setPlan]=useState(null),[planError,setPlanError]=useState('')
 const [progress,setProgress]=useState(null),[failures,setFailures]=useState([]),[picked,setPicked]=useState(()=>new Set())
 const stop=useRef(false),alive=useRef(true)
 useEffect(()=>{alive.current=true;load();return()=>{alive.current=false;stop.current=true}},[])
 useEffect(()=>{keep({settings,excluded:[...excluded],onlyConnected})},[settings,excluded,onlyConnected])
 useEffect(()=>setPlan(null),[settings,excluded,onlyConnected,data])

 async function load(){
  setLoading(true);setError('')
  try{const value=await request('GET',undefined,'action=planner');if(alive.current)setData(value)}
  catch(e){if(alive.current)setError(e.message||'Impossible de charger la publication.')}
  finally{if(alive.current)setLoading(false)}
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
  if(!a.dotb)return 'Publication Dotb coupée pour ce compte'
  if(unusable(a))return healthLabels[a.health.status]
  if(onlyConnected&&!a.connected)return 'Bridge fermé'
  return null
 }
 const eligible=ready.filter(d=>!blocker(d.account_id)&&!excluded.has(d.account_id))
 const closedBridges=readyAccounts.filter(id=>accounts.get(id)&&!accounts.get(id).connected).length
 const spacingByAccount=Object.fromEntries((data?.accounts||[]).map(a=>[a.id,a.spacing]))
 const occupied=(data?.occupied||[]).map(o=>({...o,at:Number(o.at)}))

 function calculate(){
  setPlanError('');setFailures([])
  try{setPlan(planPublications({drafts:eligible,occupied,settings,spacingByAccount}))}
  catch(e){setPlan(null);setPlanError(e.message)}
 }
 function set(key,value){setSettings(s=>({...s,[key]:value}))}

 // Pousse chaque fiche réservée vers Dotb (création, photos, programmation), une étape à la fois.
 async function drive(rows){
  const done=[]
  for(let i=0;i<rows.length&&!stop.current;i++){
   let row=rows[i],waits=0
   for(let guard=0;guard<30&&!stop.current;guard++){
    setProgress({phase:'dotb',index:i+1,total:rows.length,title:row.title||'Annonce',message:row.message})
    let result
    try{result=(await request('POST',{action:'step',id:row.id})).draft}
    catch(e){done.push({...row,error:e.message});break}
    row={...row,state:result.state,message:result.message,last_error:result.last_error,version:result.version}
    if(result.state!=='preparing'){if(result.state==='attention')done.push({...row,error:result.message});break}
    if(result.last_error){
     if(/Limite Dotb/i.test(result.last_error)&&waits<3){waits++;setProgress(p=>({...p,message:'Limite Dotb atteinte : pause de 30 secondes…'}));await sleep(30000);continue}
     done.push({...row,error:result.last_error});break
    }
    await sleep(step)
   }
  }
  return done
 }
 async function send(){
  if(!plan?.items.length)return
  const label=settings.mode==='draft'?'brouillons Vinted':'annonces'
  if(!window.confirm(`Programmer ${plan.items.length} ${label} du ${dayLabel(plan.items[0].date)} au ${dayLabel(plan.items.at(-1).date)} ?`))return
  stop.current=false;setError('');setNotice('');setFailures([])
  const reserved=[],refused=[]
  try{
   for(let i=0;i<plan.items.length&&!stop.current;i+=BATCH){
    const batch=plan.items.slice(i,i+BATCH)
    setProgress({phase:'reserve',index:Math.min(i+BATCH,plan.items.length),total:plan.items.length})
    const {results}=await request('POST',{action:'plan',mode:settings.mode,items:batch.map(x=>({id:x.id,version:x.version,at:new Date(x.at).toISOString()}))})
    for(const r of results){const item=batch.find(x=>x.id===r.id);if(r.ok)reserved.push({...item,state:r.state,message:r.message,version:r.version});else refused.push({...item,error:r.error})}
   }
   const stuck=await drive(reserved)
   const all=[...refused,...stuck]
   setFailures(all)
   const ok=reserved.length-stuck.length
   setNotice(stop.current?`Envoi arrêté. ${ok} annonce${ok>1?'s':''} programmée${ok>1?'s':''} ; les autres attendent dans « En cours d’envoi ».`:`${ok} annonce${ok>1?'s':''} programmée${ok>1?'s':''} chez Dotb.${all.length?` ${all.length} à revoir ci-dessous.`:''}`)
  }catch(e){setError(e.message||'L’envoi a été interrompu. Ce qui est déjà réservé reste dans « En cours d’envoi ».')}
  finally{if(alive.current){setProgress(null);setPlan(null);load()}}
 }
 async function resume(){
  stop.current=false;setError('');setNotice('')
  try{const stuck=await drive((data?.queue||[]).filter(r=>r.state==='preparing'));setFailures(stuck);setNotice(stuck.length?`${stuck.length} annonce${stuck.length>1?'s':''} attendent encore : lis le message de chacune.`:'Envoi terminé.')}
  finally{if(alive.current){setProgress(null);load()}}
 }
 async function cancelPicked(){
  const rows=(data?.scheduled||[]).filter(r=>picked.has(r.id))
  if(!rows.length||!window.confirm(`Annuler ${rows.length} programmation${rows.length>1?'s':''} ? Les fiches redeviennent prêtes à planifier.`))return
  stop.current=false;setError('');setNotice('')
  const errors=[]
  for(let i=0;i<rows.length&&!stop.current;i++){
   setProgress({phase:'cancel',index:i+1,total:rows.length,title:rows[i].title})
   try{await request('POST',{action:'unschedule',id:rows[i].id,version:rows[i].version})}catch(e){errors.push({...rows[i],error:e.message})}
   await sleep(1100)
  }
  setFailures(errors);setPicked(new Set());setNotice(`${rows.length-errors.length} programmation${rows.length-errors.length>1?'s':''} annulée${rows.length-errors.length>1?'s':''}.`)
  setProgress(null);load()
 }

 const busy=!!progress
 const scheduled=data?.scheduled||[]
 const scheduledDays=[...new Set(scheduled.map(r=>parisDate(Date.parse(r.scheduled_at||r.planned_at))))]
 const preparing=(data?.queue||[]).filter(r=>r.state==='preparing')

 return <main className="workspace-page max-w-5xl mx-auto p-4 sm:p-6 space-y-5 text-slate-800">
  <header className="flex flex-wrap items-end justify-between gap-3">
   <div><p className="text-xs font-semibold tracking-widest text-teal-700 uppercase mb-1">Planification</p><h1 className="text-2xl font-bold">Publication</h1>
    <p className="text-sm text-slate-500 mt-1 max-w-2xl">Répartis tes fiches prêtes sur plusieurs jours : Dotb les publie à l’heure prévue. Toujours actif : jamais le même SKU à moins de {SKU_GAP_MINUTES} minutes, tous comptes confondus, et l’écart de chaque compte est respecté.</p></div>
   <button className={buttonClass} disabled={loading||busy} onClick={load}>{loading?'Chargement…':'Actualiser'}</button>
  </header>
  {error&&<p role="alert" className="rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-800">{error}</p>}
  {notice&&<p role="status" className="rounded-xl border border-teal-200 bg-teal-50 p-3 text-sm text-teal-900">{notice}</p>}
  {data&&!data.dotb_publish_enabled&&<p className="rounded-xl border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">L’envoi par Dotb est coupé sur le serveur : tu peux préparer le planning, mais pas l’envoyer.</p>}
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
       {a&&<span className={`rounded-full px-2 py-0.5 ${a.connected?'bg-teal-50 text-teal-800':'bg-amber-50 text-amber-800'}`}>{a.connected?'Bridge ouvert':'Bridge fermé'}</span>}
       {a?.health&&a.health.status!=='ok'&&<span className="rounded-full bg-rose-50 px-2 py-0.5 text-rose-800">{healthLabels[a.health.status]||a.health.status}{a.health.until?` jusqu’au ${new Date(a.health.until).toLocaleDateString('fr-FR')}`:''}</span>}
       {why&&why!=='Bridge fermé'&&!a?.health?.status?.match(/permanent|blocked/)&&<span className="rounded-full bg-slate-100 px-2 py-0.5 text-slate-600">{why}</span>}
      </span>
     </li>})}</ul>:<p className="text-sm text-slate-500">Aucune fiche prête. Prépare tes annonces dans l’onglet Annonces : elles apparaîtront ici.</p>}
    <p className="text-xs text-slate-500">Le Bridge Dotb du compte doit être ouvert au moment de l’envoi (juste après « Programmer ») et à l’heure de publication. Sinon la fiche attend dans « En cours d’envoi » et tu pourras reprendre.</p>
   </Section>

   <Section title="Ta logique de publication">
    <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4 text-sm">
     <label className="block">Articles par jour et par compte<input type="number" min="1" max="60" className={`${fieldClass} mt-1`} value={settings.perDay} onChange={e=>set('perDay',e.target.value)}/></label>
     <label className="block">Écart minimum entre 2 articles d’un compte (min)<input type="number" min="5" max="720" className={`${fieldClass} mt-1`} value={settings.spacing} onChange={e=>set('spacing',e.target.value)}/></label>
     <label className="block">Mode<select className={`${fieldClass} mt-1`} value={settings.mode} onChange={e=>set('mode',e.target.value)}><option value="live">En ligne directement</option><option value="draft">Brouillon Vinted</option></select></label>
     <div className="block">Heures de publication<div className="mt-1 flex items-center gap-2"><input type="time" aria-label="Début" className={fieldClass} value={settings.from} onChange={e=>set('from',e.target.value)}/><span className="text-slate-400">à</span><input type="time" aria-label="Fin" className={fieldClass} value={settings.to} onChange={e=>set('to',e.target.value)}/></div></div>
     <label className="block">Sur combien de jours<input type="number" min="1" max="30" className={`${fieldClass} mt-1`} value={settings.days} onChange={e=>set('days',e.target.value)}/></label>
     <label className="block">À partir de<select className={`${fieldClass} mt-1`} value={settings.start} onChange={e=>set('start',e.target.value)}><option value="today">Aujourd’hui</option><option value="tomorrow">Demain</option></select></label>
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
     <button className={buttonClass} onClick={()=>{stop.current=true}}>Arrêter après l’étape en cours</button></div>}
    <div className="flex flex-wrap gap-2">
     <button className={primaryClass} disabled={busy||!eligible.length} onClick={calculate}>Calculer le planning</button>
     <button className={buttonClass} disabled={busy||!plan?.items.length||!!plan?.conflicts.length||!data.dotb_publish_enabled} onClick={send}>Programmer {plan?.items.length||''} annonce{plan?.items.length>1?'s':''} chez Dotb</button>
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
     <span className={`rounded-full px-2 py-0.5 text-[11px] ${r.live?'bg-teal-50 text-teal-800':'bg-slate-100 text-slate-600'}`}>{r.live?'en ligne':'brouillon'}</span></li>)}</ul></div>)
    :<p className="text-sm text-slate-500">Aucune annonce programmée pour l’instant.</p>}
   </Section>
  </>}
 </main>
}
