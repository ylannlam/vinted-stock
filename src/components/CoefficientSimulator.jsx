import {useId,useState} from 'react'
import {simulateCoefficient,formatCoefficient} from '../lib/coefficient'
import {money} from '../lib/fulfillment'

const field='w-full rounded-lg border border-slate-200 bg-white px-3 py-2.5 text-sm focus:outline-teal-600'

// Calculateur avant achat : rien n'est enregistré, tout reste dans la page.
export default function CoefficientSimulator({initialCost=''}) {
  const id=useId()
  const [cost,setCost]=useState(String(initialCost||'')),[price,setPrice]=useState(''),[fees,setFees]=useState('')
  const result=simulateCoefficient({cost,price,fees})
  const tone=!result.ready?'text-slate-500':result.coefficient>=2?'text-teal-800':result.coefficient>=1.5?'text-amber-700':'text-rose-700'
  return <section aria-labelledby={`${id}-title`} className="rounded-2xl border border-slate-200 bg-white p-4 sm:p-5 space-y-4">
    <div><h2 id={`${id}-title`} className="font-semibold">Calculateur de coefficient</h2><p className="mt-1 text-sm text-slate-500">Avant d’acheter : combien de fois ton prix d’achat tu revends l’article. Rien n’est enregistré.</p></div>
    <div className="grid gap-3 sm:grid-cols-3">
      <label className="text-sm font-medium">Prix payé sur Shein<input className={`${field} mt-1.5`} inputMode="decimal" placeholder="Ex. 8,50" value={cost} onChange={e=>setCost(e.target.value)}/></label>
      <label className="text-sm font-medium">Prix de revente Vinted<input className={`${field} mt-1.5`} inputMode="decimal" placeholder="Ex. 20" value={price} onChange={e=>setPrice(e.target.value)}/></label>
      <label className="text-sm font-medium">Frais à ta charge <span className="font-normal text-slate-400">(facultatif)</span><input className={`${field} mt-1.5`} inputMode="decimal" placeholder="0" value={fees} onChange={e=>setFees(e.target.value)}/></label>
    </div>
    <div role="status" aria-live="polite" className="rounded-xl bg-slate-50 p-4 flex flex-wrap items-end justify-between gap-4">
      {result.ready?<>
        <div><p className="text-xs text-slate-500">Coefficient</p><p className={`text-3xl font-bold ${tone}`}>{formatCoefficient(result.coefficient)}</p></div>
        <div className="text-right"><p className="text-xs text-slate-500">Marge par article</p><p className={`text-lg font-semibold ${result.margin<0?'text-rose-700':''}`}>{money(result.margin,'EUR')}</p></div>
      </>:<p className="text-sm text-slate-500">{result.reason==='cost'?'Indique le prix payé sur Shein (plus que 0 €, deux décimales maximum).':result.reason==='fees'?'Vérifie les frais : un montant positif ou nul, avec deux décimales maximum.':'Indique un prix de revente valide, avec deux décimales maximum.'}</p>}
    </div>
    {result.suggestions&&<div><p className="text-xs font-medium text-slate-500 mb-2">Prix de revente pour atteindre…</p><div className="grid grid-cols-3 gap-2">{result.suggestions.map(s=><button type="button" key={s.k} onClick={()=>setPrice(String(s.price).replace('.',','))} className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-left hover:bg-slate-50"><span className="block text-xs text-slate-500">{formatCoefficient(s.k)}</span><span className="font-semibold">{money(s.price,'EUR')}</span></button>)}</div></div>}
    <p className="text-xs text-slate-500">Calcul : (prix de revente − frais) ÷ prix payé. La livraison Shein n’est pas répartie par article.</p>
  </section>
}
