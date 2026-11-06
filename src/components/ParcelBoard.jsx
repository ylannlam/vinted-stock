import {useEffect,useRef,useState} from 'react'
import {parcelState,since,toneClass,STAGE_TEXT} from '../lib/parcels'
import {buttonClass} from './WorkspaceUI'

const FILTERS=[{id:'active',label:'En route'},{id:'delivered',label:'Livrés'},{id:'all',label:'Tous'}]

// Tous les colis Shein en cours : où ils en sont, ce qu'ils contiennent, pour quelles ventes.
export default function ParcelBoard({request,onOpenSale,children}){
 const [data,setData]=useState(null),[error,setError]=useState(''),[filter,setFilter]=useState('active'),[open,setOpen]=useState(()=>new Set())
 const alive=useRef(true)
 async function load(){
  try{const next=await request('GET',undefined,'?view=parcels');if(alive.current){setData(next);setError('')}}
  catch(e){if(alive.current)setError(e.message||'Colis indisponibles.')}
 }
 useEffect(()=>{alive.current=true;load();const timer=setInterval(()=>{if(document.visibilityState==='visible')load()},60000);return()=>{alive.current=false;clearInterval(timer)}},[])
 const parcels=data?.parcels||[],now=Date.now()
 const counts={today:parcels.filter(p=>parcelState(p).key==='today').length,transit:parcels.filter(p=>['transit','waiting'].includes(parcelState(p).key)).length,delivered:parcels.filter(p=>p.delivered).length}
 const shown=parcels.filter(p=>filter==='all'||(filter==='delivered'?p.delivered:!p.delivered))
 const toggle=id=>setOpen(old=>{const next=new Set(old);next.has(id)?next.delete(id):next.add(id);return next})
 return <section aria-label="Colis Shein" className="space-y-5">
  <div className="grid gap-3 sm:grid-cols-3">
   <Stat label="Arrivent aujourd’hui" value={counts.today} tone="today"/>
   <Stat label="En route" value={counts.transit} tone="transit"/>
   <Stat label="Livrés · à réceptionner" value={counts.delivered} tone="done"/>
  </div>
  <div className="flex flex-wrap items-center justify-between gap-3">
   <div className="workspace-filter-pills">{FILTERS.map(f=><button key={f.id} aria-pressed={filter===f.id} onClick={()=>setFilter(f.id)} className={'rounded-full px-4 py-2 text-sm '+(filter===f.id?'bg-teal-800 text-white':'bg-white border text-slate-600 hover:bg-slate-50')}>{f.label}</button>)}</div>
   <div className="flex items-center gap-3"><p className="text-xs text-slate-500">Suivi relevé par l’extension Shein, au plus toutes les 25 min.</p><button className={buttonClass} onClick={load}>Actualiser</button></div>
  </div>
  {error&&<p role="alert" className="rounded-xl bg-red-50 p-3 text-sm text-red-800">{error}</p>}
  {!data&&!error&&<p className="text-sm text-slate-500">Chargement des colis…</p>}
  {data&&!shown.length&&<div className="workspace-empty" role="status"><span className="workspace-empty-symbol" aria-hidden="true">◇</span><h2>{filter==='delivered'?'Aucun colis livré récemment':'Aucun colis en route'}</h2><p>Les colis apparaissent dès que l’extension Shein lit une commande expédiée.</p></div>}
  <div className="grid gap-4 xl:grid-cols-2">
   {shown.map(p=>{
    const state=parcelState(p),key=p.order_ref+p.tracking_number,expanded=open.has(key),last=p.events[0]
    return <article key={key} className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
     <header className="flex flex-wrap items-start justify-between gap-3">
      <div className="min-w-0"><p className="text-xs uppercase tracking-wide text-slate-500">{p.carrier||'Transporteur'} · commande {p.order_ref}</p>
       <p className="mt-1 font-mono text-base font-semibold text-slate-800"><button className="hover:underline" title="Copier le numéro" onClick={()=>navigator.clipboard?.writeText(p.tracking_number)}>{p.tracking_number}</button></p></div>
      <span className={`rounded-full px-3 py-1 text-xs font-semibold ${toneClass[state.tone]}`}>{state.label}</span>
     </header>
     {p.steps.length>0&&<ol className="mt-4 grid gap-1" style={{gridTemplateColumns:`repeat(${p.steps.length},minmax(0,1fr))`}}>{p.steps.map((s,i)=><li key={i} className="min-w-0"><span className={`block h-1.5 rounded-full ${s.done?'bg-teal-600':'bg-slate-200'}`}/><span className={`mt-1 block truncate text-[11px] ${s.done?'text-teal-800':'text-slate-400'}`} title={s.name}>{s.name}</span></li>)}</ol>}
     {last?<p className="mt-3 text-sm text-slate-700"><span className="font-medium">{since(last.at,now)}{last.place?` · ${last.place}`:''}</span> — {last.text}</p>
      :<p className="mt-3 text-sm text-slate-500">{p.eta?`Livraison prévue ${p.eta}. `:''}Les étapes apparaîtront à la prochaine lecture du suivi.</p>}
     {p.eta&&last&&!p.delivered&&<p className="mt-1 text-xs text-slate-500">Livraison prévue {p.eta}</p>}
     {p.delivered&&<p className="mt-2 rounded-lg bg-emerald-50 px-3 py-2 text-xs text-emerald-900">Livré : ouvre chaque vente pour confirmer que l’article est bien arrivé.</p>}
     <ul className="mt-4 space-y-2">{p.items.map(item=><li key={item.id} className="flex gap-3 rounded-xl bg-slate-50 p-2">
      {item.photo?<img src={item.photo} alt="" className="h-14 w-11 shrink-0 rounded-md object-cover"/>:<span className="h-14 w-11 shrink-0 rounded-md bg-slate-200"/>}
      <div className="min-w-0 text-sm"><p className="truncate font-medium text-slate-800">{item.title||item.sku}</p><p className="text-xs text-slate-500">{[item.color,item.size,item.quantity>1&&`× ${item.quantity}`].filter(Boolean).join(' · ')}</p>
       {item.sales.length?<p className="mt-0.5 flex flex-wrap gap-x-3 text-xs">{item.sales.map(s=><button key={s.id} className="text-teal-700 underline" onClick={()=>onOpenSale?.(s.id)}>{s.account||'Vente'} · {STAGE_TEXT[s.stage]||s.stage}</button>)}</p>:<p className="mt-0.5 text-xs text-amber-700">Aucune vente associée</p>}</div>
     </li>)}{!p.items.length&&<li className="text-xs text-slate-500">Articles de ce colis non précisés par Shein.</li>}</ul>
     <footer className="mt-4 flex flex-wrap items-center gap-x-4 gap-y-2 text-sm">
      {p.track_url&&<a className="font-medium text-teal-700 underline" href={p.track_url} target="_blank" rel="noreferrer">Suivre chez {p.carrier||'le transporteur'} ↗</a>}
      <a className="text-teal-700 underline" href={`https://fr.shein.com/orders/track?billno=${encodeURIComponent(p.order_ref)}`} target="_blank" rel="noreferrer">Page Suivre Shein ↗</a>
      {p.events.length>1&&<button className="text-slate-600 underline" aria-expanded={expanded} onClick={()=>toggle(key)}>{expanded?'Masquer':'Voir'} l’historique ({p.events.length})</button>}
     </footer>
     {expanded&&<ol className="mt-3 space-y-2 border-l-2 border-slate-200 pl-4">{p.events.map((e,i)=><li key={i} className="text-xs"><p className="font-medium text-slate-700">{new Date(e.at).toLocaleString('fr-FR',{timeZone:'Europe/Paris',day:'2-digit',month:'short',hour:'2-digit',minute:'2-digit'})}{e.place?` · ${e.place}`:''}</p><p className="text-slate-600">{e.text}</p></li>)}</ol>}
    </article>})}
  </div>
  {children}
 </section>
}

function Stat({label,value,tone}){
 return <div className="rounded-2xl border border-slate-200 bg-white px-4 py-3"><p className="text-2xl font-bold text-slate-800">{value}</p><p className="mt-0.5 flex items-center gap-2 text-xs text-slate-500"><span className={`h-2 w-2 rounded-full ${{today:'bg-amber-500',transit:'bg-sky-500',done:'bg-emerald-500'}[tone]}`}/>{label}</p></div>
}
