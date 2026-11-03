import {useEffect,useRef,useState} from 'react'
import {adsPowerRequest,COMPANION,isLaunching} from '../lib/adspower'
import {activityView,freshCheck} from '../lib/adspowerStatus'
import {usePublicationTracking,publicationRequest} from '../lib/usePublicationTracking'
import {PublicationSummary,PublicationBadge,PublicationDetails,PublicationOfflineList} from './PublicationTracking'
import AdsPowerVisibility from './AdsPowerVisibility'
import {readProfileVisibility,displayedProfiles,visibleLaunchIds} from '../lib/adspowerVisibility'

const secondary='rounded-xl border border-slate-200 bg-white px-4 py-2.5 text-sm font-semibold text-slate-600 hover:bg-slate-50 disabled:opacity-40'
const primary='rounded-xl bg-teal-700 px-5 py-3 text-sm font-semibold text-white hover:bg-teal-800 disabled:opacity-40'
export default function AdsPowerTab({request=adsPowerRequest,owner='preview',publications=publicationRequest}){
  const storageKey=`adspower-selection:${owner}`,visibilityKey=`adspower-visible:${owner}`
  const [profiles,setProfiles]=useState([]),[state,setState]=useState(null),[connected,setConnected]=useState(false)
  const [shownIds,setShownIds]=useState(()=>readProfileVisibility(localStorage,visibilityKey)),[chooseVisible,setChooseVisible]=useState(false)
  const displayed=displayedProfiles(profiles,shownIds)
  const tracking=usePublicationTracking(profiles,publications)
  const [publicationProfile,setPublicationProfile]=useState(null)
  const [selected,setSelected]=useState(()=>{try{const ids=JSON.parse(localStorage.getItem(storageKey)||'[]');return Array.isArray(ids)?ids.filter(id=>typeof id==='string').slice(0,100):[]}catch{return []}})
  const [search,setSearch]=useState(''),[group,setGroup]=useState(''),[error,setError]=useState(''),[notice,setNotice]=useState(''),[busy,setBusy]=useState(false),[loading,setLoading]=useState(true),[readError,setReadError]=useState('')
  const alive=useRef(true),refreshing=useRef(false),loaded=useRef(false),submission=useRef(null)
  useEffect(()=>{try{localStorage.setItem(storageKey,JSON.stringify(selected))}catch{}},[selected,storageKey])
  useEffect(()=>{try{localStorage.setItem(visibilityKey,JSON.stringify(shownIds))}catch{}},[shownIds,visibilityKey])
  function saveVisibility(ids){setShownIds(ids);setSelected(old=>visibleLaunchIds(profiles,ids,old));submission.current=null;setChooseVisible(false);setSearch('');setGroup('')}
  async function refresh(list=false){
    if(refreshing.current)return
    refreshing.current=true
    try{
      const next=await request('/state');if(!alive.current)return
      setConnected(true);setState(next);setReadError('')
      if(next.configured&&(list||!loaded.current)){
        const data=await request('/profiles');if(!alive.current)return
        setProfiles(data.profiles);loaded.current=true
        setSelected(previous=>previous.filter(id=>data.profiles.some(p=>p.id===id)))
      }
    }catch(e){if(alive.current){setReadError(e.message);setConnected(false)}}
    finally{refreshing.current=false;if(alive.current)setLoading(false)}
  }
  useEffect(()=>{
    alive.current=true;refresh(true)
    const poll=()=>{if(document.visibilityState==='visible')refresh()};const timer=setInterval(poll,5000)
    document.addEventListener('visibilitychange',poll)
    return()=>{alive.current=false;clearInterval(timer);document.removeEventListener('visibilitychange',poll)}
  },[request])
  const latest=new Map((state?.jobs||[]).map(job=>[job.profile.id,job])),jobs=[...latest.values()]
  const runtime=new Map((state?.runtime||[]).map(item=>[item.profile_id,item]))
  const opened=freshCheck(state?.browser_checked_at)&&Array.isArray(state?.opened_ids)?new Set(state.opened_ids):null
  const viewFor=id=>activityView(latest.get(id),runtime.get(id),{monitoring:state?.monitoring,opened:opened?opened.has(id):null,browserCheckedAt:state?.browser_checked_at})
  const views=jobs.map(j=>viewFor(j.profile.id))
  const running=jobs.filter(isLaunching).length,done=views.filter(v=>v.state==='running').length,stopped=views.filter(v=>['closed','page_closed','paused'].includes(v.state)).length,attention=views.filter(v=>['attention','partial','unknown'].includes(v.state)).length
  const retryIds=visibleLaunchIds(profiles,shownIds,jobs.filter(j=>j.state==='attention').map(j=>j.profile.id))
  const groups=[...new Set(displayed.map(p=>p.group))].sort()
  const visible=displayed.filter(p=>(!group||p.group===group)&&[p.number,p.name,p.group].join(' ').toLocaleLowerCase().includes(search.toLocaleLowerCase()))
  const picked=displayed.filter(p=>selected.includes(p.id)),canLaunch=connected&&state?.configured&&picked.length>0&&!busy
  function toggle(id){setSelected(old=>old.includes(id)?old.filter(v=>v!==id):old.length<100?[...old,id]:old);submission.current=null}
  async function launch(ids=selected){
    ids=visibleLaunchIds(profiles,shownIds,ids)
    if(busy||!ids.length)return
    setBusy(true);setError('');setNotice('')
    const fingerprint=JSON.stringify([...ids].sort())
    if(submission.current?.fingerprint!==fingerprint)submission.current={fingerprint,requestId:crypto.randomUUID()}
    try{
      const data=await request('/launch',{ids,requestId:submission.current.requestId});if(!alive.current)return
      setState(old=>({...old,jobs:data.jobs}));submission.current=null;setNotice('Lancement demandé. La progression apparaît sur chaque profil.')
    }catch(e){if(alive.current)setError(e.message)}finally{if(alive.current)setBusy(false)}
  }
  async function cancel(){setBusy(true);setError('');try{const data=await request('/cancel',{});setState(old=>({...old,jobs:data.jobs}));setNotice('Les profils encore en attente ont été retirés du lancement.')}catch(e){setError(e.message)}finally{setBusy(false)}}
  const complete=jobs.filter(j=>!isLaunching(j)).length,percent=jobs.length?Math.round(complete/jobs.length*100):0
  return <main className="workspace-page max-w-screen-2xl mx-auto p-4 sm:p-6 space-y-5 text-slate-800">
    <header className="flex flex-wrap items-center justify-between gap-4"><div><p className="text-xs font-semibold uppercase tracking-widest text-teal-700">Tes comptes, au même endroit</p><h1 className="mt-1 text-3xl font-bold tracking-tight">AdsPower</h1><p className="mt-2 text-sm text-slate-500">Ouvre Vinted et démarre les messages Dotb sur les profils de ton choix.</p></div><div className="flex items-center gap-2"><span className={`rounded-full px-3 py-2 text-xs font-semibold ${connected?'bg-teal-50 text-teal-800':'bg-slate-100 text-slate-500'}`}>{loading?'Connexion…':connected?'● Ce PC est connecté':'○ Connecteur fermé'}</span><button disabled={loading||busy} className={secondary} onClick={()=>{setLoading(true);refresh(true)}}>Actualiser</button></div></header>
    {(error||readError)&&<p role="alert" className="rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">{error||readError}</p>}
    {notice&&<p role="status" className="text-sm text-teal-800">{notice}</p>}
    <PublicationSummary tracking={tracking} profiles={connected&&state?.configured?displayed:null}/>
    {chooseVisible&&<AdsPowerVisibility profiles={profiles} value={shownIds} onSave={saveVisibility} onClose={()=>setChooseVisible(false)}/>}
    {(!connected||!state?.configured)&&<PublicationOfflineList tracking={tracking} onOpen={setPublicationProfile}/>}
    {publicationProfile&&<PublicationDetails key={publicationProfile.id} profile={publicationProfile} tracking={tracking} onClose={()=>setPublicationProfile(null)}/>}
    {(!connected||!state?.configured)&&<section className="rounded-2xl border border-teal-100 bg-white p-5 sm:p-7"><h2 className="text-lg font-semibold">Connecter AdsPower à ton site</h2><p className="text-sm text-slate-500 mt-2">Une seule préparation sur ce PC, puis tu pourras lancer ta sélection en un clic.</p><ol className="mt-5 grid gap-4 sm:grid-cols-3 text-sm"><li><strong className="block mb-2">1. Ouvre le connecteur</strong><p className="text-slate-500">Télécharge le dossier, extrais-le et lance <strong>run.bat</strong>.</p><a className="inline-block text-teal-700 font-semibold mt-3 underline" href="/downloads/adspower-companion.zip" download>Télécharger le connecteur</a></li><li><strong className="block mb-2">2. Ajoute ta clé AdsPower</strong><p className="text-slate-500">La clé se trouve dans AdsPower → Automatisation → API. Elle reste sur ce PC.</p><a className="inline-block text-teal-700 font-semibold mt-3 underline" href={`${COMPANION}/setup`} target="_blank" rel="noreferrer">Ouvrir la connexion ↗</a></li><li><strong className="block mb-2">3. Choisis tes profils</strong><p className="text-slate-500">Reviens ici et clique sur Actualiser. Garde AdsPower et le connecteur ouverts.</p></li></ol></section>}
    {connected&&state?.configured&&<>
      {!state.monitoring&&<p role="status" className="rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">Le connecteur installé ne suit pas encore les fermetures. <a href="/downloads/adspower-companion.zip" download className="underline font-semibold">Télécharger la mise à jour</a>, puis relancer run.bat.</p>}
      <section className="rounded-2xl border border-teal-100 bg-gradient-to-r from-teal-50 to-white p-5 sm:p-6 flex flex-wrap items-center justify-between gap-5"><div><p className="text-xl font-bold">{picked.length} profil{picked.length>1?'s':''} sélectionné{picked.length>1?'s':''}</p><p className="text-sm text-slate-500 mt-2">Les 4 blocs Dotb · Historique des 12 dernières heures</p><p className="text-xs text-slate-400 mt-1">Tes réglages Dotb habituels · 3 ouvertures à la fois, puis tous les profils restent ouverts</p></div><button className={primary} disabled={!canLaunch} onClick={()=>launch()}>▶ {busy?'Préparation…':'Lancer Vinted + Dotb'}</button></section>
      {!!jobs.length&&<section aria-label="Progression du lancement" className="rounded-2xl border bg-white p-5"><div className="flex flex-wrap justify-between gap-3 text-sm"><p><strong>{running?`${running} démarrage${running>1?'s':''} en cours`:'Suivi des profils'}</strong><span className="text-slate-400 ml-3">{done} actif{done>1?'s':''} · {stopped} arrêté{stopped>1?'s':''} · {attention} à vérifier</span></p><div className="flex gap-3">{retryIds.length>0&&<button className="text-amber-800 underline" disabled={busy} onClick={()=>launch(retryIds)}>Réessayer les erreurs</button>}{jobs.some(j=>j.state==='queued')&&<button className="text-slate-500 underline" disabled={busy} onClick={cancel}>Annuler l’attente</button>}</div></div><progress className="mt-4 w-full h-2 accent-teal-600" max="100" value={percent} aria-label="Profils traités"/><p className="text-xs text-slate-400 mt-2">{complete} / {jobs.length} profils traités. L’état des profils et de Dotb est vérifié automatiquement pendant que cet onglet est ouvert.</p></section>}
      <div className="flex flex-wrap items-center justify-between gap-3"><p className="text-sm text-slate-500">{displayed.length} / {profiles.length} comptes affichés</p><button className={secondary} onClick={()=>setChooseVisible(true)}>Comptes affichés</button></div>
      <section className="rounded-2xl border bg-white overflow-hidden"><div className="p-4 flex flex-wrap items-center gap-3 border-b"><input aria-label="Rechercher un profil" className="min-w-0 flex-1 rounded-xl border px-4 py-2.5 text-sm" placeholder="Rechercher un numéro, un profil…" value={search} onChange={e=>setSearch(e.target.value)}/><select aria-label="Groupe AdsPower" className="max-w-full rounded-xl border px-3 py-2.5 text-sm" value={group} onChange={e=>setGroup(e.target.value)}><option value="">Tous les groupes</option>{groups.map(g=><option key={g}>{g}</option>)}</select><button className="text-xs font-semibold text-teal-700" onClick={()=>{setSelected(visible.slice(0,100).map(p=>p.id));submission.current=null}}>Sélectionner la liste</button><button className="text-xs text-slate-500" onClick={()=>{setSelected([]);submission.current=null}}>Effacer</button></div>
        <div className="divide-y">{visible.map(p=>{const job=latest.get(p.id),view=viewFor(p.id),chosen=selected.includes(p.id);return <div key={p.id} className={`px-4 py-4 sm:px-5 flex flex-wrap items-center gap-4 ${chosen?'bg-teal-50/40':''}`}><label className="flex flex-1 min-w-0 items-center gap-4 cursor-pointer"><input type="checkbox" aria-label={`Sélectionner le profil ${p.number} ${p.name}`} className="h-4 w-4 accent-teal-700 shrink-0" checked={chosen} onChange={()=>toggle(p.id)}/><span className="flex h-11 min-w-11 items-center justify-center rounded-xl border bg-white text-sm font-bold text-teal-800 px-2">#{p.number}</span><span className="min-w-0"><span className="block font-semibold truncate">{p.name}</span><span className="block text-xs text-slate-400 mt-1">{p.group}{opened?.has(p.id)?' · Navigateur ouvert':''}</span></span></label><PublicationBadge profile={p} tracking={tracking} onOpen={setPublicationProfile}/><div className="w-full sm:w-auto sm:max-w-sm pl-8 sm:pl-0 sm:text-right"><span className={`inline-block rounded-full px-3 py-1.5 text-xs font-semibold ${view.state==='running'?'text-teal-800 bg-teal-100':['attention','partial','unknown'].includes(view.state)?'text-amber-800 bg-amber-100':isLaunching(job)?'text-blue-700 bg-blue-50':'text-slate-500 bg-slate-100'}`}>{view.label}</span>{view.message&&<p className="text-xs text-slate-500 mt-2">{view.message}</p>}{view.checked_at&&<p className="text-[11px] text-slate-400 mt-1">Vérifié à {new Date(view.checked_at).toLocaleTimeString('fr-FR',{hour:'2-digit',minute:'2-digit',second:'2-digit'})}</p>}</div></div>})}{!visible.length&&<p className="p-8 text-sm text-center text-slate-500">{profiles.length?(displayed.length?'Aucun profil ne correspond à ta recherche.':'Aucun compte affiché. Clique sur « Comptes affichés » pour choisir ta liste.'):'Aucun profil disponible avec cette connexion AdsPower.'}</p>}</div>
      </section>
      <footer className="flex flex-wrap justify-between gap-2 text-xs text-slate-400"><span>{displayed.length} profils affichés · Sélection mémorisée sur ce navigateur · 100 profils maximum par lancement</span><a href={`${COMPANION}/setup`} target="_blank" rel="noreferrer" className="underline">Réglages de la connexion</a></footer>
    </>}
  </main>
}
