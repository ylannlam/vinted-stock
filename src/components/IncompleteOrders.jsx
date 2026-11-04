import {useEffect,useState} from 'react'
import {ORDER_LABELS} from '../lib/fulfillment'
import {buttonClass} from './WorkspaceUI'
const date=value=>value?new Date(value).toLocaleString('fr-FR',{timeZone:'Europe/Paris',day:'2-digit',month:'2-digit',year:'numeric',hour:'2-digit',minute:'2-digit'}):'Date non transmise'
export default function IncompleteOrders({initial,request,busy,onSync}){
  const [page,setPage]=useState(0),[data,setData]=useState(initial),[loading,setLoading]=useState(false),[error,setError]=useState(''),[retry,setRetry]=useState(0)
  useEffect(()=>{
    if(!initial)return
    if(page===0){setData(initial);setError('');setLoading(false);return}
    if(page*10>=initial.count){setPage(0);return}
    let active=true;setLoading(true);setError('')
    request('GET',undefined,`?view=incomplete&page=${page}`).then(next=>{if(active)setData(next)}).catch(e=>{if(active)setError(e.message)}).finally(()=>{if(active)setLoading(false)})
    return()=>{active=false}
  },[initial,page,request,retry])
  if(!initial?.count)return null
  return <section className="rounded-2xl border border-amber-200 bg-amber-50/60 p-4 sm:p-5 space-y-3" aria-label="Commandes sans détail d’article">
    <header className="flex flex-wrap items-start justify-between gap-3"><div><h2 className="font-semibold text-amber-950">Commandes à compléter · {initial.count}</h2><p className="text-sm text-amber-900 mt-1">Dotb a transmis ces commandes sans leurs articles. Elles restent visibles ici, avec un montant inconnu.</p><p className="text-xs text-slate-600 mt-1">Toute la période suivie. Cette liste reste indépendante des filtres d’articles ci-dessous.</p></div>{onSync&&<button className={buttonClass} disabled={busy||loading} onClick={onSync}>Relire les commandes Dotb</button>}</header>
    {error?<p role="alert" className="text-sm text-red-800">{error} <button className="underline" onClick={()=>setRetry(n=>n+1)}>Réessayer</button></p>:loading?<p role="status" className="text-sm">Chargement des commandes…</p>:<ul className="grid gap-3 md:grid-cols-2">{(data?.orders||[]).map(o=><li key={o.id} className="rounded-xl border border-amber-200 bg-white p-4 space-y-1"><div className="flex flex-wrap justify-between gap-2"><strong className="text-sm">{o.account_login||'Compte non transmis'}</strong><span className="text-xs text-slate-600">{ORDER_LABELS[o.status]||'Statut à vérifier'}</span></div><p className="text-sm font-medium">Article à identifier</p><p className="text-xs text-slate-600">Vente du {date(o.order_date)}</p><p className="text-xs text-slate-600">Commande {o.transaction_id||o.id}</p>{o.deadline&&<p className="text-xs text-slate-600">Échéance d’envoi : {date(o.deadline)}</p>}<p className="text-xs text-amber-900">Article, quantité, SKU et prix non transmis.</p></li>)}</ul>}
    {initial.count>10&&<nav className="flex justify-end items-center gap-3 text-sm" aria-label="Pages des commandes incomplètes"><button className={buttonClass} disabled={busy||loading||page===0} onClick={()=>setPage(p=>p-1)}>Précédent</button><span>Page {page+1} sur {Math.ceil(initial.count/10)}</span><button className={buttonClass} disabled={busy||loading||(page+1)*10>=initial.count} onClick={()=>setPage(p=>p+1)}>Suivant</button></nav>}
    <p className="text-xs text-slate-600">Après avoir vérifié ces commandes dans Dotb, relis-les pour récupérer les informations disponibles. Elles rejoindront les articles ci-dessous quand Dotb en transmettra le détail.</p>
  </section>
}
