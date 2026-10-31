import {useEffect,useRef,useState} from 'react'
import {collectionLabels,collectorOnline} from '../lib/collector'
const defaultRequest=(...args)=>import('../lib/api').then(m=>m.collectorRequest(...args))
const button='rounded-lg border px-3 py-2 text-sm bg-white hover:bg-gray-50 disabled:opacity-40'
const primary='rounded-lg px-4 py-2 text-sm font-medium bg-teal-700 text-white hover:bg-teal-800 disabled:opacity-40'
const date=value=>value?new Date(value).toLocaleString('fr-FR',{dateStyle:'short',timeStyle:'short'}):'Pas encore lancé'

export default function CollectionManager({isAdmin,full=false,request=defaultRequest,onCollected,onManage}) {
  const [state,setState]=useState({devices:[],jobs:[],pending:0}),[error,setError]=useState(''),[notice,setNotice]=useState('')
  const [busy,setBusy]=useState(false),[adding,setAdding]=useState(false),[references,setReferences]=useState('')
  const [name,setName]=useState('Mon PC'),[token,setToken]=useState('')
  const alive=useRef(true),running=useRef(false),latest=useRef(''),callback=useRef(onCollected)
  callback.current=onCollected
  async function refresh() {
    const next=await request()
    if(!alive.current)return
    setState(next)
    const completed=next.jobs.filter(j=>j.status==='completed').map(j=>j.id).sort().join(',')||'none'
    if(latest.current && latest.current!==completed)callback.current?.()
    latest.current=completed
  }
  useEffect(()=>{
    alive.current=true;let loading=false
    const poll=async()=>{if(loading)return;loading=true;try{await refresh()}catch(e){if(alive.current)setError(e.message)}finally{loading=false}}
    poll();const timer=setInterval(poll,10000)
    return()=>{alive.current=false;clearInterval(timer)}
  },[request])
  async function action(body) {
    if(running.current)return
    running.current=true;setBusy(true);setError('');setNotice('')
    try {
      const result=await request('POST',body)
      if(result.token)setToken(result.token)
      if(result.queued!==undefined){setNotice(result.queued?`${result.queued} récupération(s) ajoutée(s). Le PC associé les traitera.`:'Ces produits sont déjà en attente ou à jour.');setAdding(false);setReferences('')}
      await refresh()
    }catch(e){setError(e.message)}finally{running.current=false;if(alive.current)setBusy(false)}
  }
  const online=state.devices.filter(d=>collectorOnline(d)&&d.enabled),paused=state.devices.some(d=>collectorOnline(d)&&!d.enabled)
  const status=online.length?'PC connecté':paused?'Récupération en pause':state.devices.length?'PC hors ligne':'PC à associer'
  return <section className="space-y-4">
    <div className="rounded-xl border bg-white px-4 py-3 flex flex-wrap items-center justify-between gap-3">
      <div><p className="text-sm font-medium"><span className={`inline-block w-2 h-2 rounded-full mr-2 ${online.length?'bg-teal-600':'bg-amber-500'}`}/>{status}<span className="ml-3 text-gray-500 font-normal">{state.pending} en attente ou en cours</span></p><p className="text-xs text-gray-500 mt-1">{online.length?'Les fiches sont revérifiées toutes les 6 h après une récupération réussie.':'Les demandes restent conservées. Lance le programme sur ton PC pour les traiter.'}</p></div>
      <div className="flex flex-wrap gap-2">{!full&&<button className={button} onClick={onManage}>Gérer la récupération</button>}{isAdmin&&<button className={primary} disabled={busy} onClick={()=>setAdding(!adding)}>+ Importer des SKU ou liens</button>}</div>
    </div>
    {adding&&<form className="rounded-xl border bg-white p-5 space-y-3" onSubmit={e=>{e.preventDefault();action({action:'enqueue',references})}}>
      <label className="block font-medium text-sm" htmlFor="shein-references">SKU Shein ou liens des produits</label>
      <textarea id="shein-references" className="w-full border rounded-lg p-3 text-sm min-h-32 font-mono" required maxLength={30000} value={references} onChange={e=>setReferences(e.target.value)} placeholder={'sz25052272411726746\nhttps://fr.shein.com/…-p-90176146.html'}/>
      <p className="text-xs text-gray-500">Un par ligne, jusqu’à 50. Un SKU est recherché sur Shein puis vérifié sur la fiche trouvée. Les SKU et liens déjà en attente ne sont pas ajoutés deux fois.</p>
      <button className={primary} disabled={busy}>Mettre en file d’attente</button><button type="button" className={`${button} ml-2`} onClick={()=>setAdding(false)}>Annuler</button>
    </form>}
    {error&&<p role="alert" className="text-sm text-red-800 bg-red-50 rounded-lg p-3">{error}</p>}
    {notice&&<p role="status" className="text-sm text-teal-800">{notice}</p>}
    {full&&<>
      <div className="grid lg:grid-cols-2 gap-5">
        <section className="bg-white border rounded-xl p-5 space-y-4"><h2 className="font-semibold text-lg">Le programme sur ton PC</h2><ol className="list-decimal ml-5 text-sm space-y-3"><li>Télécharge le programme et décompresse son dossier.</li><li>Clique sur « Associer mon PC » ci-dessous.</li><li>Lance <strong>run.bat</strong> dans le dossier, puis colle le code demandé.</li></ol><a className={`${primary} inline-block`} href="/downloads/shein-collector.zip" download>Télécharger le programme Windows</a><p className="text-xs text-gray-500">Edge ou Chrome et Node.js 20+ sont nécessaires. Le programme utilise une fenêtre dédiée. Le PC doit rester éveillé ; une vérification demandée par Shein se termine dans cette fenêtre.</p>
          {isAdmin&&<form onSubmit={e=>{e.preventDefault();action({action:'create_device',name})}} className="flex flex-wrap gap-2"><input aria-label="Nom du PC" className="border rounded-lg p-2 text-sm flex-1" value={name} onChange={e=>setName(e.target.value)} required maxLength={80}/><button className={button} disabled={busy}>Associer mon PC</button></form>}
          {token&&<div className="bg-teal-50 rounded-xl p-4 space-y-2"><label htmlFor="collector-token" className="text-sm font-medium">Code à coller dans le programme</label><textarea id="collector-token" readOnly className="w-full border rounded-lg p-2 text-xs font-mono break-all" value={token}/><p className="text-xs text-gray-600">Ce code n’est affiché qu’ici. Il autorise ce PC à récupérer les fiches Shein pendant 90 jours. Tu peux le déconnecter à tout moment.</p><button className={button} onClick={()=>navigator.clipboard.writeText(token).then(()=>setNotice('Code copié.')).catch(()=>setNotice('Sélectionne le code pour le copier.'))}>Copier le code</button><button className={`${button} ml-2`} onClick={()=>setToken('')}>Masquer</button></div>}
        </section>
        <section className="bg-white border rounded-xl p-5 space-y-3"><h2 className="font-semibold text-lg">Mes PC associés</h2>{!state.devices.length&&<p className="text-sm text-gray-500">Aucun PC associé pour le moment.</p>}{state.devices.map(d=><div key={d.id} className="border rounded-lg p-3"><div className="flex justify-between gap-3"><strong className="text-sm">{d.name}</strong><span className="text-xs text-gray-500">{Date.parse(d.expires_at)<Date.now()?'Association expirée':!d.enabled?'En pause':collectorOnline(d)?'Connecté':'Hors ligne'}</span></div><p className="text-xs text-gray-500 mt-1">Dernier contact : {date(d.last_seen_at)}</p>{isAdmin&&<div className="flex gap-2 mt-3"><button disabled={busy} className={button} onClick={()=>action({action:'pause_device',id:d.id,enabled:!d.enabled})}>{d.enabled?'Mettre en pause':'Reprendre'}</button><button disabled={busy} className={`${button} text-rose-700`} onClick={()=>action({action:'revoke_device',id:d.id})}>Déconnecter ce PC</button></div>}</div>)}</section>
      </div>
      <div className="flex flex-wrap justify-between gap-3 items-center"><h2 className="text-lg font-semibold">Les 100 dernières récupérations</h2>{isAdmin&&<button className={button} disabled={busy} onClick={()=>action({action:'queue_due'})}>Préparer les fiches à actualiser</button>}</div>
      <div className="rounded-xl border bg-white divide-y">{state.jobs.map(j=><div key={j.id} className="p-4 flex flex-wrap justify-between gap-3"><div className="min-w-0 flex-1"><p className="text-sm font-medium break-all">{j.expected_sku||j.input}</p><p className="text-xs text-gray-500 mt-1">{date(j.created_at)}</p>{j.message&&<p className="text-sm text-amber-800 mt-2">{j.message}</p>}</div><div className="flex items-start gap-3"><span className={`text-xs rounded-full px-3 py-1 ${j.status==='completed'?'bg-teal-50 text-teal-800':j.status==='failed'||j.status==='blocked'?'bg-amber-50 text-amber-800':'bg-slate-100 text-slate-700'}`}>{collectionLabels[j.status]}</span>{isAdmin&&['blocked','failed'].includes(j.status)&&<button className={button} disabled={busy} onClick={()=>action({action:'retry',id:j.id})}>Réessayer</button>}</div></div>)}{!state.jobs.length&&<p className="p-8 text-sm text-center text-gray-500">Colle des SKU ou importe tes articles Dotb pour commencer.</p>}</div>
    </>}
  </section>
}
