import {useEffect,useRef,useState} from 'react'
import {collectionLabels,collectorOnline} from '../lib/collector'
import {sheinProduct,sheinSearchUrl} from '../lib/catalog'
const defaultRequest=(...args)=>import('../lib/api').then(m=>m.collectorRequest(...args))
const button='rounded-lg border px-3 py-2 text-sm bg-white hover:bg-gray-50 disabled:opacity-40'
const primary='rounded-lg px-4 py-2 text-sm font-medium bg-teal-700 text-white hover:bg-teal-800 disabled:opacity-40'
const date=value=>value?new Date(value).toLocaleString('fr-FR',{dateStyle:'short',timeStyle:'short'}):'Pas encore lancé'

export default function CollectionManager({isAdmin,full=false,request=defaultRequest,onCollected,onManage}) {
  const [state,setState]=useState({devices:[],jobs:[],pending:0}),[error,setError]=useState(''),[notice,setNotice]=useState('')
  const [busy,setBusy]=useState(false),[references,setReferences]=useState('')
  const [name,setName]=useState('Mon navigateur'),[token,setToken]=useState('')
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
      if(result.queued!==undefined){setNotice(result.queued?`${result.queued} demande(s) enregistrée(s). Les fiches apparaîtront ici après leur récupération.`:'Ces produits sont déjà en attente ou à jour.');setReferences('')}
      await refresh()
    }catch(e){setError(e.message)}finally{running.current=false;if(alive.current)setBusy(false)}
  }
  const online=state.devices.some(d=>collectorOnline(d)&&d.enabled)
  const visibleJobs=full?state.jobs:state.jobs.slice(0,3)
  return <section className="space-y-4">
    {isAdmin&&<form className="rounded-xl border border-teal-200 bg-teal-50/60 p-4 sm:p-5 space-y-3" onSubmit={e=>{e.preventDefault();action({action:'enqueue',references})}}>
      <div className="flex flex-wrap justify-between gap-2"><label className="font-semibold text-teal-950" htmlFor="shein-references">Ajouter à ma bibliothèque</label><span className="text-xs text-teal-800">Lien Shein ou SKU</span></div>
      <div className="flex flex-col sm:flex-row gap-3"><textarea id="shein-references" className="w-full border border-teal-200 rounded-lg p-3 text-sm resize-y bg-white focus:outline-teal-600" rows={2} required maxLength={30000} value={references} onChange={e=>setReferences(e.target.value)} placeholder={'Colle un lien Shein ou un SKU, par exemple sz25052272411726746\nPlusieurs produits ? Un par ligne.'}/><button className={`${primary} shrink-0 self-stretch`} disabled={busy||!references.trim()}>{busy?'Ajout…':'Ajouter à ma bibliothèque'}</button></div>
      <p className="text-xs text-teal-900">Jusqu’à 50 produits. L’extension récupère les photos, le prix et les informations lisibles, puis la fiche apparaît automatiquement. Les doublons en attente sont ignorés.</p>
    </form>}
    <div className="rounded-xl border bg-white px-4 py-3 flex flex-wrap items-center justify-between gap-3">
      <div><p className="text-sm font-medium"><span className={`inline-block w-2 h-2 rounded-full mr-2 ${online?'bg-teal-600':'bg-amber-500'}`}/>{online?'Appareil joignable':state.devices.length?'Récupération à démarrer':'Extension à connecter'}<span className="ml-3 text-gray-500 font-normal">{state.pending} en attente ou en cours</span></p><p className="text-xs text-gray-500 mt-1">{online?'Laisse le navigateur ouvert. Les vérifications réussies sont renouvelées après 6 h.':'Tes demandes sont conservées. Associe l’extension 0.3.0 et clique sur Démarrer pour les traiter.'}</p></div>
      {!full&&<button className={button} onClick={onManage}>{state.devices.length?'Voir la file et la connexion':'Installer et connecter l’extension'}</button>}
    </div>
    {error&&<p role="alert" className="text-sm text-red-800 bg-red-50 rounded-lg p-3">{error}</p>}
    {notice&&<p role="status" className="text-sm text-teal-800">{notice}</p>}
    {full&&<>
      <div className="grid lg:grid-cols-2 gap-5">
        <section className="bg-white border rounded-xl p-5 space-y-4"><h2 className="font-semibold text-lg">Connecter mon navigateur · une seule fois</h2>
          <p className="text-sm text-gray-600">La version 0.3.0 traite la file du site dans ton Edge ou Chrome habituel. Tu n’as plus à ouvrir et importer chaque produit à la main.</p>
          <a className={`${primary} inline-block`} href="/downloads/shein-catalogue.zip?v=0.3.0" download>Télécharger l’extension · 0.3.0</a>
          <ol className="list-decimal ml-5 text-sm space-y-3"><li>Décompresse le ZIP dans un dossier à conserver.</li><li>Ouvre <strong>edge://extensions</strong> ou <strong>chrome://extensions</strong>, active le mode développeur puis « Charger l’extension non empaquetée » et choisis ce dossier.</li><li>Crée le code ci-dessous, colle-le dans l’extension et clique sur « Associer ce navigateur », puis « Démarrer ».</li><li>Reviens dans la bibliothèque pour coller tes liens ou SKU. La fenêtre de l’extension peut se fermer ; garde le navigateur ouvert.</li></ol>
          <p className="text-xs text-gray-500">Déjà en 0.2.0 ? Remplace ses fichiers, recharge l’extension et accepte les nouvelles permissions demandées par le navigateur. Pour cette extension, pas de run.bat ni de Node.js. Arrête l’ancien programme si tu l’utilisais.</p>
          {isAdmin&&<form onSubmit={e=>{e.preventDefault();action({action:'create_device',name})}} className="flex flex-wrap gap-2"><input aria-label="Nom du navigateur" className="border rounded-lg p-2 text-sm flex-1 min-w-0" value={name} onChange={e=>setName(e.target.value)} required maxLength={80}/><button className={button} disabled={busy}>Créer le code d’association</button></form>}
          {token&&<div className="bg-teal-50 rounded-xl p-4 space-y-2"><label htmlFor="collector-token" className="text-sm font-medium">Code à coller dans l’extension</label><textarea id="collector-token" readOnly className="w-full border rounded-lg p-2 text-xs font-mono break-all" value={token}/><p className="text-xs text-gray-600">Ce code n’est affiché qu’ici. Il autorise les récupérations Shein pendant 90 jours et reste révocable ci-contre.</p><button className={button} onClick={()=>navigator.clipboard.writeText(token).then(()=>setNotice('Code copié.')).catch(()=>setNotice('Sélectionne le code pour le copier.'))}>Copier le code</button><button className={`${button} ml-2`} onClick={()=>setToken('')}>Masquer</button></div>}
        </section>
        <section className="bg-white border rounded-xl p-5 space-y-3"><h2 className="font-semibold text-lg">Mes appareils associés</h2>{!state.devices.length&&<p className="text-sm text-gray-500">Aucun appareil associé pour le moment.</p>}{state.devices.map(d=><div key={d.id} className="border rounded-lg p-3"><div className="flex justify-between gap-3"><strong className="text-sm">{d.name}</strong><span className="text-xs text-gray-500">{Date.parse(d.expires_at)<Date.now()?'Association expirée':!d.enabled?'En pause':collectorOnline(d)?'Joignable':'Hors ligne'}</span></div><p className="text-xs text-gray-500 mt-1">Dernier contact : {date(d.last_seen_at)}</p>{isAdmin&&<div className="flex flex-wrap gap-2 mt-3"><button disabled={busy} className={button} onClick={()=>action({action:'pause_device',id:d.id,enabled:!d.enabled})}>{d.enabled?'Mettre en pause':'Réactiver'}</button><button disabled={busy} className={`${button} text-rose-700`} onClick={()=>action({action:'revoke_device',id:d.id})}>Déconnecter</button></div>}</div>)}<p className="text-xs text-gray-500">Après une réactivation sur le site, clique aussi sur Démarrer dans l’extension.</p></section>
      </div>
      <section className="rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-950 space-y-2"><h2 className="font-semibold">Si Shein demande une vérification</h2><p>La récupération se met en pause. Dans l’extension, clique sur « Ouvrir l’onglet Shein », termine la vérification, puis « Reprendre la fiche ouverte ». La page n’est pas rechargée automatiquement.</p><p>Un SKU incorrect ou un prix illisible reste à vérifier. L’accès à Shein dépend de ta session ; une association réussie ne garantit pas que Shein acceptera les consultations.</p></section>
      <details className="rounded-xl border bg-white p-4 text-sm"><summary className="cursor-pointer text-gray-600">Ancien programme Windows · option séparée</summary><p className="my-3">Le programme 1.0.1 reste disponible pour les appareils déjà configurés. Il utilise une fenêtre dédiée, nécessite Node.js 20+ et peut rencontrer la vérification Shein qui t’a bloqué. Utilise un seul outil à la fois.</p><a className={`${button} inline-block`} href="/downloads/shein-collector.zip?v=1.0.1" download>Télécharger le programme Windows · 1.0.1</a></details>
      <div className="flex flex-wrap justify-between gap-3 items-center"><h2 className="text-lg font-semibold">File d’import · 100 dernières demandes</h2>{isAdmin&&<button className={button} disabled={busy} onClick={()=>action({action:'queue_due'})}>Préparer les fiches à actualiser</button>}</div>
    </>}
    {visibleJobs.length>0&&<div className="rounded-xl border bg-white divide-y">{visibleJobs.map(j=><div key={j.id} className="p-4 flex flex-wrap justify-between gap-3"><div className="min-w-0 flex-1"><p className="text-sm font-medium break-all">{j.expected_sku||j.input}</p><p className="text-xs text-gray-500 mt-1">{date(j.created_at)}</p>{j.message&&<p className="text-sm text-amber-800 mt-2">{j.message}</p>}{full&&(sheinProduct(j.input)||sheinSearchUrl(j.expected_sku))&&<a className="inline-block text-xs text-teal-700 underline mt-2" href={sheinProduct(j.input)?.supplier_url||sheinSearchUrl(j.expected_sku)} target="_blank" rel="noreferrer">Voir sur Shein ↗</a>}</div><div className="flex items-start gap-3"><span className={`text-xs rounded-full px-3 py-1 ${j.status==='completed'?'bg-teal-50 text-teal-800':j.status==='failed'||j.status==='blocked'?'bg-amber-50 text-amber-800':'bg-slate-100 text-slate-700'}`}>{collectionLabels[j.status]}</span>{isAdmin&&['blocked','failed'].includes(j.status)&&<button className={button} disabled={busy} onClick={()=>action({action:'retry',id:j.id})}>Réessayer</button>}</div></div>)}</div>}
    {full&&!state.jobs.length&&<p className="p-6 text-sm text-center text-gray-500">Colle un lien ou un SKU ci-dessus pour commencer.</p>}
  </section>
}
