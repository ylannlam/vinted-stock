import {useEffect,useRef,useState} from 'react'
import {useCachedState} from '../lib/useCachedState'
import {ACTIONS,actionDescription} from '../lib/saleDetails'
import {ErrorNotice,Pagination,buttonClass} from './WorkspaceUI'

export default function SaleActions({request,onOpen}) {
  const [category,setCategory]=useState('all'),[page,setPage]=useState(0),[busy,setBusy]=useState(false),[error,setError]=useState('')
  const [data,setData]=useCachedState(request,`actions:${category}:${page}`,null)
  const sequence=useRef(0)
  useEffect(()=>{
    let active=true
    async function load(){
      const seq=++sequence.current;setBusy(true)
      try{const next=await request('actions',{category,page});if(active&&seq===sequence.current){setData(next);setError('')}}
      catch(e){if(active&&seq===sequence.current)setError(e.message)}
      finally{if(active&&seq===sequence.current)setBusy(false)}
    }
    load()
    const timer=setInterval(()=>{if(document.visibilityState==='visible')load()},30000)
    return()=>{active=false;sequence.current++;clearInterval(timer)}
  },[category,page,request])
  return <section className="rounded-2xl bg-white border border-slate-200 p-4 sm:p-5 space-y-4">
    <header><h2 className="font-semibold text-lg">Mes prochaines actions</h2><p className="text-xs text-slate-500 mt-1">Les ventes à traiter, dans l’ordre des échéances.</p></header>
    <div className="flex flex-wrap gap-2" role="group" aria-label="Types d’action">{ACTIONS.filter(a=>a.id==='all'||a.id===category||data?.counts[a.id]>0).map(a=><button key={a.id} aria-pressed={category===a.id} className={`rounded-lg px-3 py-2 text-xs ${category===a.id?'bg-teal-700 text-white':'bg-slate-100 text-slate-600'}`} onClick={()=>{setCategory(a.id);setPage(0)}}>{a.label}{data?` ${data.counts[a.id]||0}`:''}</button>)}</div>
    <ErrorNotice error={error}/>
    {!data&&busy&&<p className="py-6 text-sm text-slate-500" role="status">Chargement des actions…</p>}
    <div className="divide-y">{data?.rows.map(row=>{
      const due=Date.parse(row.deadline_at),urgent=Number.isFinite(due)&&due-Date.now()<48*3600000
      return <article key={row.id} className="py-4 flex flex-wrap items-center gap-3">
        {row.photo_url&&<img src={row.photo_url} alt="" className="w-16 h-20 rounded-lg object-contain bg-stone-50" loading="lazy"/>}
        <div className="flex-1 min-w-40"><p className="text-sm font-medium">{row.title||'Article sans titre'}</p><p className="text-xs text-slate-500 mt-1">{row.account_login||'Compte inconnu'}{row.sku?` · ${row.sku}`:''}</p><p className="text-xs text-teal-800 mt-1">{actionDescription(row)}</p></div>
        <div className="flex flex-wrap items-center gap-3"><p className={`text-xs ${urgent?'text-amber-800 font-medium':'text-slate-500'}`}>{Number.isFinite(due)?`${due<Date.now()?'En retard · ':''}${new Date(due).toLocaleString('fr-FR',{dateStyle:'short',timeStyle:'short'})}`:'Sans échéance'}</p><button className={buttonClass} onClick={()=>onOpen(row.id)}>Ouvrir la vente →</button></div>
      </article>
    })}</div>
    {data&&!data.count&&<p className="py-6 text-sm text-slate-500">Aucune vente à traiter dans cette catégorie.</p>}
    {data&&(data.count>20||page>0)&&<Pagination page={page} count={data.count} size={20} busy={busy} onChange={setPage}/>}
  </section>
}
