import {useEffect,useRef,useState} from 'react'
import {collectionLabels,collectorOnline,latestCollections} from '../lib/collector'
import {collectorBridge} from '../lib/collectorBridge'
import CollectorConnection from './CollectorConnection'
import {sheinProduct,sheinSearchUrl} from '../lib/catalog'
const defaultRequest=(...args)=>import('../lib/api').then(m=>m.collectorRequest(...args))
const button='rounded-lg border px-3 py-2 text-sm bg-white hover:bg-gray-50 disabled:opacity-40'
const primary='rounded-lg px-4 py-2 text-sm font-medium bg-teal-700 text-white hover:bg-teal-800 disabled:opacity-40'
const date=value=>value?new Date(value).toLocaleString('fr-FR',{dateStyle:'short',timeStyle:'short'}):'Pas encore lancé'

export default function CollectionManager({isAdmin,full=false,request=defaultRequest,bridge=collectorBridge,onCollected,onManage}) {
  const [state,setState]=useState({devices:[],jobs:[],pending:0}),[browser,setBrowser]=useState(null)
  const [error,setError]=useState(''),[notice,setNotice]=useState(''),[busy,setBusy]=useState(false),[references,setReferences]=useState('')
  const [filter,setFilter]=useState('pending'),[showAll,setShowAll]=useState(false)
  const alive=useRef(true),running=useRef(false),latest=useRef(''),callback=useRef(onCollected)
  callback.current=onCollected
  async function refresh() {
    const next=await request()
    if(!alive.current)return
    setState(next)
    const completed=next.jobs.filter(j=>j.status==='completed').map(j=>j.id).sort().join(',')||'none'
    if(latest.current&&latest.current!==completed)callback.current?.()
    latest.current=completed
  }
  useEffect(()=>{
    alive.current=true;let loading=false,checking=false
    const poll=async()=>{if(loading)return;loading=true;try{await refresh()}catch(e){if(alive.current)setError(e.message)}finally{loading=false}}
    const check=async()=>{if(checking)return;checking=true;try{const s=await bridge('status');if(alive.current)setBrowser(s)}catch{if(alive.current)setBrowser(null)}finally{checking=false}}
    poll();check();const timer=setInterval(poll,5000),browserTimer=setInterval(check,3000)
    return()=>{alive.current=false;clearInterval(timer);clearInterval(browserTimer)}
  },[request,bridge])
  async function perform(work) {
    if(running.current)return
    running.current=true;setBusy(true);setError('');setNotice('')
    try{await work();await refresh()}catch(e){if(alive.current)setError(e.message)}finally{running.current=false;if(alive.current)setBusy(false)}
  }
  async function command(action) {const s=await bridge(action);if(alive.current)setBrowser(s);return s}
  async function connect() {
    const created=await request('POST',{action:'create_device',name:'Mon navigateur'})
    try{await bridge('connect',{token:created.token})}catch(e){
      // A lost acknowledgement must not create unused credentials or revoke a successful pairing.
      const actual=await bridge('status').catch(()=>null)
      if(actual?.device_id!==created.id){await request('POST',{action:'revoke_device',id:created.id});throw e}
    }
    await command('start');setNotice('Navigateur connecté. Tu peux maintenant ajouter tes articles ici.')
  }
  async function action(body) {
    const result=await request('POST',body)
    if(result.queued!==undefined){
      setReferences('');setFilter('pending');setShowAll(true)
      setNotice(result.queued?`${result.queued} demande(s) enregistrée(s). Suis leur résultat ci-dessous.`:'Ces références sont déjà en attente ou à jour.')
      if(browser?.connected)try{await command('start')}catch{setNotice('Demandes enregistrées. La connexion au navigateur doit être reprise ci-dessous.')}
    }
  }
  const recent=latestCollections(state.jobs)
  const buckets={pending:recent.filter(j=>['queued','running'].includes(j.status)),review:recent.filter(j=>['blocked','failed'].includes(j.status)),done:recent.filter(j=>j.status==='completed')}
  const visible=buckets[filter]||[]
  return <section className="space-y-3">
    {isAdmin&&<form className="rounded-xl border border-teal-200 bg-teal-50/60 p-4 sm:p-5 space-y-3" onSubmit={e=>{e.preventDefault();perform(()=>action({action:'enqueue',references}))}}>
      <label className="font-semibold text-teal-950 block" htmlFor="shein-references">Ajouter des articles Shein</label>
      <div className="flex flex-col sm:flex-row gap-3"><textarea id="shein-references" className="w-full border border-teal-200 rounded-lg p-3 text-sm resize-y bg-white focus:outline-teal-600" rows={2} required maxLength={30000} value={references} onChange={e=>setReferences(e.target.value)} placeholder={'Colle un lien Shein ou un SKU\nPlusieurs articles ? Un par ligne.'}/><button className={`${primary} shrink-0 self-stretch`} disabled={busy||!references.trim()}>{busy?'Ajout…':'Ajouter les articles'}</button></div>
      <p className="text-xs text-teal-900">Jusqu’à 50 articles. Les demandes restent enregistrées même si ton navigateur est fermé.</p>
    </form>}
    <CollectorConnection browser={browser} busy={busy} isAdmin={isAdmin} onCommand={a=>perform(()=>command(a))} onConnect={()=>perform(connect)}/>
    {error&&<p role="alert" className="text-sm text-red-800 bg-red-50 rounded-lg p-3">{error}</p>}
    {notice&&<p role="status" className="text-sm text-teal-800">{notice}</p>}
    {!!recent.length&&<div className="rounded-xl border bg-white overflow-hidden">
      <div className="px-4 pt-3 flex flex-wrap items-center justify-between gap-2"><h2 className="text-sm font-semibold">Suivi des ajouts</h2><span className="text-xs text-gray-500">Dernière tentative par article · demandes récentes</span></div>
      <div className="flex flex-wrap gap-2 border-b p-3">{[['pending','En cours'],['review','À vérifier'],['done','Ajoutés']].map(([key,label])=><button key={key} className={`px-3 py-2 text-sm rounded-lg ${filter===key?'bg-teal-700 text-white':'bg-gray-50 text-gray-600'}`} onClick={()=>{setFilter(key);setShowAll(false)}} aria-pressed={filter===key}>{label} {key==='pending'?state.pending:buckets[key].length}</button>)}</div>
      <div className="divide-y">{visible.slice(0,full||showAll?100:3).map(j=><div key={j.id} className="p-4 flex flex-wrap justify-between gap-3"><div className="min-w-0 flex-1"><p className="text-sm font-medium break-all">{j.expected_sku||j.input}</p>{j.message&&<p className="text-xs text-amber-800 mt-2">{j.message}</p>}<p className="text-xs text-gray-400 mt-1">{date(j.finished_at||j.created_at)}</p></div><div className="flex items-start gap-2"><span className={`text-xs rounded-full px-3 py-1 ${j.status==='completed'?'bg-teal-50 text-teal-800':['failed','blocked'].includes(j.status)?'bg-amber-50 text-amber-800':'bg-slate-100 text-slate-700'}`}>{collectionLabels[j.status]}</span>{isAdmin&&['blocked','failed'].includes(j.status)&&<button className={button} disabled={busy} onClick={()=>perform(()=>action({action:'retry',id:j.id}))}>Relancer</button>}{filter==='review'&&(sheinProduct(j.input)||sheinSearchUrl(j.expected_sku))&&<a className={`${button} text-teal-700`} href={sheinProduct(j.input)?.supplier_url||sheinSearchUrl(j.expected_sku)} target="_blank" rel="noreferrer">Voir l’article</a>}</div></div>)}{!visible.length&&<p className="p-5 text-sm text-gray-500">{filter==='pending'?'Aucun article en attente.':filter==='review'?'Aucun article à vérifier dans les demandes récentes.':'Les fiches importées apparaîtront ici et dans la bibliothèque.'}</p>}</div>
      {!full&&!showAll&&visible.length>3&&<button className="text-sm text-teal-700 p-3 w-full border-t" onClick={()=>setShowAll(true)}>Afficher les {visible.length} demandes</button>}
    </div>}
    {full?<details className="rounded-xl border bg-white p-4 text-sm"><summary className="cursor-pointer text-gray-500">Appareils et réglages</summary><div className="space-y-3 mt-4"><p className="text-xs text-gray-500">Les prix sont revérifiés après 6 h quand le navigateur est disponible. Les vérifications Shein nécessitent ton intervention.</p>{state.devices.map(d=><div key={d.id} className="flex flex-wrap items-center justify-between gap-2 rounded-lg border p-3"><div>{d.name}<span className="ml-2 text-xs text-gray-500">{Date.parse(d.expires_at)<Date.now()?'Expiré':!d.enabled?'Désactivé':collectorOnline(d)?'Joignable':'Hors ligne'}</span></div>{isAdmin&&<div className="flex gap-2"><button className={button} disabled={busy} onClick={()=>perform(()=>action({action:'pause_device',id:d.id,enabled:!d.enabled}))}>{d.enabled?'Désactiver':'Réactiver'}</button><button className={`${button} text-rose-700`} disabled={busy} onClick={()=>perform(()=>action({action:'revoke_device',id:d.id}))}>Déconnecter</button></div>}</div>)}{isAdmin&&<button className={button} disabled={busy} onClick={()=>perform(()=>action({action:'queue_due'}))}>Préparer les fiches à actualiser</button>}</div></details>:<button className="text-xs text-gray-500 underline" onClick={onManage}>Appareils et réglages</button>}
  </section>
}
