import {useEffect,useRef,useState} from 'react'
import {healthView,healthLabels,remainingHealthTime} from '../lib/accountHealth'
import {buttonClass,primaryClass,fieldClass} from './WorkspaceUI'
const date=v=>v?new Date(v).toLocaleString('fr-FR',{day:'numeric',month:'short',hour:'2-digit',minute:'2-digit'}):'Non renseignée'
const sources={manual:'Confirmé à la main',dotb:'Signalé par Dotb',accounts:'Suivi Comptes'}
export function HealthBadge({entry,now,onEdit}){
  const h=healthView(entry||{},now)
  return <button type="button" disabled={!onEdit} onClick={onEdit} className={`rounded-xl border px-3 py-2 text-left text-xs ${h.attention?'border-amber-300 bg-amber-50 text-amber-950':h.status==='ok'?'border-teal-200 bg-teal-50 text-teal-900':'border-slate-200 bg-slate-50 text-slate-600'}`}>
    <span className="block font-semibold">{h.label}</span>{h.source&&<span className="block mt-1">{sources[h.source]} · {date(h.checked_at)}</span>}
    {(h.status==='temporary'||h.expired)&&<span className="block mt-1">{remainingHealthTime(h.until_at,now)}</span>}
  </button>
}
export function HealthDialog({entry,tracker,onClose}){
  const dialog=useRef(null),sending=useRef(false)
  const h=healthView(entry,tracker.now),report=entry.report
  const [status,setStatus]=useState(report?.status||(['temporary','permanent','blocked'].includes(h.status)?h.status:'review'))
  const [until,setUntil]=useState(report?.until_at?new Date(Date.parse(report.until_at)-new Date(report.until_at).getTimezoneOffset()*60000).toISOString().slice(0,16):'')
  const [reason,setReason]=useState(report?.reason||''),[error,setError]=useState('')
  const legacyBlocked=healthView({native:entry.native}).attention
  useEffect(()=>{dialog.current.showModal();return()=>dialog.current?.close()},[])
  async function submit(e){e.preventDefault();if(sending.current)return;sending.current=true;setError('');try{await tracker.save({account_id:entry.id,version:report?.version||0,status,reason,until_at:status==='temporary'&&until?new Date(until).toISOString():null});onClose()}catch(e){setError(e.message)}finally{sending.current=false}}
  return <dialog ref={dialog} onCancel={e=>{e.preventDefault();if(!tracker.busy)onClose()}} className="w-[calc(100%-2rem)] max-w-lg rounded-2xl p-0 backdrop:bg-black/30" aria-labelledby="health-title">
    <form onSubmit={submit} className="p-5 space-y-4">
      <header className="flex items-start justify-between gap-3"><div><h2 id="health-title" className="text-lg font-bold">État de {entry.login}</h2><p className="text-xs text-slate-500 mt-1">Note ce que Vinted indique pour ce compte.</p></div><button type="button" aria-label="Fermer le suivi du compte" disabled={tracker.busy} onClick={onClose}>✕</button></header>
      {h.reason&&<p className="rounded-xl bg-slate-50 p-3 text-sm whitespace-pre-wrap break-words">{h.reason}</p>}
      {legacyBlocked&&<p className="rounded-xl bg-amber-50 p-3 text-sm text-amber-950">Ce compte est aussi classé bloqué dans l’onglet « Comptes ». Corrige ce statut dans sa fiche avant de confirmer le retour de l’accès ici.</p>}
      <label className="block text-sm font-medium">Statut constaté<select autoFocus className={`${fieldClass} mt-1 w-full`} value={status} disabled={tracker.busy} onChange={e=>setStatus(e.target.value)}>{['review','temporary','permanent','blocked','ok'].map(s=><option key={s} value={s} disabled={s==='ok'&&legacyBlocked}>{healthLabels[s]}</option>)}</select></label>
      {status==='temporary'&&<label className="block text-sm font-medium">Fin annoncée par Vinted (facultatif)<input className={`${fieldClass} mt-1 w-full`} type="datetime-local" value={until} disabled={tracker.busy} onChange={e=>setUntil(e.target.value)}/><span className="block text-xs font-normal text-slate-500 mt-1">Heure locale de ton appareil. Laisse vide si Vinted ne donne aucune date.</span></label>}
      <label className="block text-sm font-medium">Motif ou message Vinted (facultatif)<textarea className={`${fieldClass} mt-1 w-full`} rows={3} maxLength={1000} value={reason} disabled={tracker.busy} onChange={e=>setReason(e.target.value)}/></label>
      {status==='ok'&&<p className="text-sm text-teal-900">À utiliser après avoir vérifié que l’accès est rétabli dans Vinted. Une alerte Dotb plus récente sera à nouveau affichée.</p>}
      {error&&<p role="alert" className="text-sm text-red-700">{error}</p>}
      <footer className="flex justify-end gap-2"><button type="button" className={buttonClass} disabled={tracker.busy} onClick={onClose}>Annuler</button><button className={primaryClass} disabled={tracker.busy||status==='ok'&&legacyBlocked}>{tracker.busy?'Enregistrement…':'Enregistrer le statut'}</button></footer>
    </form>
  </dialog>
}
export function HealthSummary({tracker,ids=null,onEdit,showList=false}){
  const accounts=(tracker.data?.accounts||[]).filter(a=>!ids||ids.includes(a.id)),attention=accounts.filter(a=>healthView(a,tracker.now).attention),sync=tracker.data?.sync
  return <section className={`rounded-2xl border p-4 sm:p-5 space-y-3 ${attention.length?'border-amber-200 bg-amber-50/60':'border-slate-200 bg-white'}`} aria-label="État des comptes Vinted">
    <header className="flex flex-wrap justify-between gap-3"><div><h2 className="font-semibold">État des comptes Vinted{attention.length?` · ${attention.length} à vérifier`:''}</h2><p className="text-xs text-slate-500 mt-1">Alertes Dotb actualisées toutes les 5 minutes pendant que cet onglet est ouvert. Une connexion active ne garantit pas l’absence de restriction.</p></div><button className={buttonClass} disabled={tracker.busy} onClick={()=>tracker.refresh()}>{tracker.busy?'Lecture des alertes…':'Actualiser les alertes'}</button></header>
    <p className="text-xs text-slate-500">Dernière lecture réussie : {date(sync?.last_completed_at)}. Sans alerte, l’état reste non vérifié.</p>
    {(tracker.error||sync?.error)&&<p role="alert" className="text-sm text-amber-900">{tracker.error||sync.error}</p>}
    {sync?.partial&&<p role="status" className="text-sm text-amber-900">Seules les alertes les plus récentes ont été lues. Les anciens signalements restent conservés.</p>}
    {!!attention.length&&<ul className="flex flex-wrap gap-2">{attention.map(a=><li key={a.id}><button className="text-sm font-medium underline text-amber-950" onClick={()=>onEdit(a)}>{a.login} · {healthView(a,tracker.now).label}</button></li>)}</ul>}
    {showList&&!!accounts.length&&<details><summary className="text-sm font-medium cursor-pointer">Voir ou signaler l’état d’un compte ({accounts.length})</summary><div className="mt-3 grid gap-2 sm:grid-cols-2 lg:grid-cols-3">{accounts.map(a=><div key={a.id} className="rounded-xl border bg-white p-3"><p className="text-sm font-semibold break-all mb-2">{a.login}</p><HealthBadge entry={a} now={tracker.now} onEdit={()=>onEdit(a)}/></div>)}</div></details>}
  </section>
}
