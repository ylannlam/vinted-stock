import { useEffect, useRef, useState } from 'react'
import { validateTracker } from '../../server/drop-tracker'
import { budgetTotals, euro, mergeExpenses } from '../lib/budget'
const defaultRequest = (...args) => import('../lib/api').then(m=>m.authenticatedFetch(...args))
const today = () => new Date(Date.now()-new Date().getTimezoneOffset()*60000).toISOString().slice(0,10)
const field = 'w-full border border-gray-200 rounded-lg bg-white px-3 py-2 text-sm focus:outline-none focus:border-teal-400'
const button = 'border border-gray-200 bg-white text-gray-600 rounded-lg px-3 py-2 text-xs font-semibold hover:bg-gray-50 disabled:opacity-50'

export default function BudgetTab({request=defaultRequest}) {
  const [record,setRecord]=useState(null), [busy,setBusy]=useState(false), [error,setError]=useState(''), [notice,setNotice]=useState('')
  const [month,setMonth]=useState(today().slice(0,7)), [kind,setKind]=useState('all'), [search,setSearch]=useState('')
  const [draft,setDraft]=useState(null), [budget,setBudget]=useState(''), [deleteId,setDeleteId]=useState(null)
  const file=useRef(null)
  async function load() {
    setBusy(true);setError('')
    try {const response=await request('/api/drop-tracker');const data=await response.json();if(!response.ok)throw Error(data.error);setRecord(data);setBudget(String(data.payload.settings.budget))}
    catch(e){setError(e.message)}finally{setBusy(false)}
  }
  useEffect(()=>{load()},[])
  async function save(payload) {
    setBusy(true);setError('');setNotice('')
    try {
      const clean=validateTracker(payload)
      const response=await request('/api/drop-tracker',{method:'PUT',body:JSON.stringify({payload:clean,revision:record.revision})})
      const result=await response.json();if(!response.ok)throw Error(result.error)
      setRecord({payload:clean,revision:result.revision});setNotice('Modifications enregistrées.');return true
    } catch(e){setError(e.message);return false}finally{setBusy(false)}
  }
  function exportBudget(){
    const blob=new Blob([JSON.stringify({expenses:record.payload.expenses,settings:record.payload.settings},null,2)],{type:'application/json'})
    const url=URL.createObjectURL(blob),a=document.createElement('a');a.href=url;a.download=`budget-vinted-${today()}.json`;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000)
  }
  async function importBudget(event){
    const selected=event.target.files[0];event.target.value='';if(!selected)return
    try {
      if(selected.size>2e6)throw Error('Le fichier dépasse 2 Mo.')
      const raw=JSON.parse(await selected.text())
      const incoming=validateTracker({...raw,accounts:[]})
      const expenses=mergeExpenses(record.payload.expenses,incoming.expenses)
      if(await save({...record.payload,expenses,settings:incoming.settings}))setBudget(String(incoming.settings.budget))
    }catch(e){setError(e.message)}
  }
  const periodRows=(record?.payload.expenses||[]).filter(e=>!month||e.date.startsWith(month))
  const totals=budgetTotals(periodRows)
  const rows=periodRows.filter(e=>(kind==='all'||e.type===kind)&&`${e.cat} ${e.label}`.toLowerCase().includes(search.toLowerCase())).sort((a,b)=>b.date.localeCompare(a.date))
  const limit=record?.payload.settings.budget||0
  const categories=[...new Set(['Stock Shein','Comptes Vinted','Emballage','Frais de port','Employés','Outils / abonnements',...(record?.payload.expenses||[]).map(e=>e.cat)])]
  return <main className="max-w-screen-2xl mx-auto p-4 space-y-4">
    <div className="flex flex-wrap items-center justify-between gap-3"><div><h1 className="text-xl font-bold text-gray-900">Budget</h1><p className="text-sm text-gray-500">Dépenses, revenus et suivi de trésorerie.</p></div>
      <div className="flex flex-wrap gap-2"><button disabled={busy} onClick={load} className={button}>Actualiser</button><button disabled={!record||busy} onClick={exportBudget} className={button}>Exporter</button><button disabled={!record||busy} onClick={()=>file.current.click()} className={button}>Importer le budget</button><input hidden ref={file} type="file" accept="application/json" onChange={importBudget}/><button disabled={!record||busy} onClick={()=>setDraft({id:crypto.randomUUID(),date:today(),type:'out',cat:'',label:'',amount:''})} className="px-4 py-2 text-sm font-semibold rounded-lg bg-teal-500 text-white disabled:opacity-50">+ Ajouter une opération</button></div>
    </div>
    {error&&<p role="alert" className="rounded-lg border border-red-200 bg-red-50 text-red-700 p-3 text-sm">{error}</p>}
    {notice&&<p role="status" className="text-xs text-teal-700">{notice}</p>}
    {!record?<p className="text-sm text-gray-400 py-10 text-center">{busy?'Chargement du budget…':'Le budget n’a pas pu être chargé.'}</p>:<>
      <div className="flex flex-wrap gap-3 items-center"><label className="text-xs font-semibold text-gray-500">Période <input aria-label="Période" type="month" value={month} onChange={e=>setMonth(e.target.value)} className="ml-2 border border-gray-200 rounded-lg px-3 py-2 bg-white text-gray-800"/></label><button className={button} onClick={()=>setMonth('')}>Toutes les périodes</button><span className="text-xs text-gray-400">Opérations saisies manuellement · ventes Dotb non comptabilisées automatiquement</span></div>
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">{[['Dépenses',totals.expenses,'text-red-600'],['Revenus',totals.income,'text-teal-600'],['Solde',totals.balance,totals.balance<0?'text-red-600':'text-teal-600'],['Budget mensuel',limit,'text-gray-900']].map(([label,value,color])=><div key={label} className="bg-white border border-gray-200 rounded-xl p-4"><p className="text-xs text-gray-500">{label}</p><p className={`text-2xl font-semibold mt-1 ${color}`}>{euro(value)}</p></div>)}</div>
      {draft&&<form className="bg-white border border-teal-200 rounded-xl p-4" onSubmit={async e=>{e.preventDefault();const value={...draft,cat:draft.cat.trim()||'Sans catégorie',amount:Number(draft.amount)};if(!(value.amount>0)){setError('Renseignez un montant positif.');return}const existing=record.payload.expenses.find(x=>x.id===draft.id);const expenses=existing?record.payload.expenses.map(x=>x.id===draft.id?value:x):[...record.payload.expenses,value];if(await save({...record.payload,expenses}))setDraft(null)}}>
        <div className="grid grid-cols-2 lg:grid-cols-6 gap-3">{[['date','Date','date'],['cat','Catégorie','text'],['label','Libellé','text'],['amount','Montant (€)','number']].map(([key,label,type])=><label className={`text-xs text-gray-500 ${key==='label'?'lg:col-span-2':''}`} key={key}>{label}<input autoFocus={key==='label'} aria-label={label} className={`${field} mt-1`} type={type} required={['date','amount'].includes(key)} min={type==='number'?'0.01':undefined} step={type==='number'?'0.01':undefined} maxLength={2000} list={key==='cat'?'budget-categories':undefined} value={draft[key]} onChange={e=>setDraft({...draft,[key]:e.target.value})}/></label>)}<label className="text-xs text-gray-500">Type<select aria-label="Type d’opération" className={`${field} mt-1`} value={draft.type} onChange={e=>setDraft({...draft,type:e.target.value})}><option value="out">Dépense</option><option value="in">Revenu</option></select></label></div>
        <datalist id="budget-categories">{categories.map(c=><option key={c}>{c}</option>)}</datalist><div className="mt-3 flex justify-end gap-2"><button type="button" disabled={busy} className={button} onClick={()=>setDraft(null)}>Annuler</button><button disabled={busy} className="bg-teal-500 text-white rounded-lg px-4 py-2 text-sm disabled:opacity-50">{busy?'Enregistrement…':'Enregistrer'}</button></div>
      </form>}
      <div className="grid lg:grid-cols-3 gap-4"><section className="lg:col-span-2 bg-white border border-gray-200 rounded-xl overflow-hidden">
        <div className="p-3 flex flex-wrap gap-2 border-b border-gray-100">{[['all','Toutes'],['out','Dépenses'],['in','Revenus']].map(([key,label])=><button key={key} onClick={()=>setKind(key)} className={`rounded-full px-3 py-1.5 text-xs font-semibold ${kind===key?'bg-teal-100 text-teal-700':'bg-gray-100 text-gray-500'}`}>{label}</button>)}<input aria-label="Rechercher une opération" placeholder="Rechercher une opération…" value={search} onChange={e=>setSearch(e.target.value)} className="border border-gray-200 rounded-lg px-3 py-1.5 text-xs flex-1 min-w-40"/></div>
        <div className="overflow-x-auto"><table className="w-full text-left text-sm"><thead className="bg-gray-50 text-gray-500 text-xs"><tr>{['Date','Catégorie / libellé','Montant','Actions'].map(h=><th className="px-4 py-3" key={h}>{h}</th>)}</tr></thead><tbody>{rows.map(row=><tr key={row.id} className="border-t border-gray-100"><td className="px-4 py-3 text-gray-500 whitespace-nowrap">{new Date(row.date+'T12:00:00').toLocaleDateString('fr-FR')}</td><td className="px-4 py-3"><p className="font-medium text-gray-800">{row.cat}</p><p className="text-xs text-gray-400">{row.label||'—'}</p></td><td className={`px-4 py-3 whitespace-nowrap font-semibold ${row.type==='out'?'text-red-600':'text-teal-600'}`}>{row.type==='out'?'−':'+'}{euro(row.amount)}</td><td className="px-4 py-3"><div className="flex flex-wrap gap-2 text-xs">{deleteId===row.id?<><button disabled={busy} className="text-red-600 font-semibold" onClick={async()=>{if(await save({...record.payload,expenses:record.payload.expenses.filter(e=>e.id!==row.id)}))setDeleteId(null)}}>Confirmer la suppression</button><button onClick={()=>setDeleteId(null)}>Annuler</button></>:<><button disabled={busy} className="text-teal-600" onClick={()=>setDraft({...row})}>Modifier</button><button disabled={busy} className="text-gray-400" onClick={()=>setDeleteId(row.id)}>Supprimer</button></>}</div></td></tr>)}{!rows.length&&<tr><td colSpan="4" className="py-12 text-center text-gray-400">Aucune opération sur cette sélection.</td></tr>}</tbody></table></div>
      </section><aside className="space-y-4"><section className="bg-white border border-gray-200 rounded-xl p-4"><h2 className="font-semibold text-sm text-gray-800">Budget mensuel</h2><form className="flex gap-2 mt-3" onSubmit={async e=>{e.preventDefault();await save({...record.payload,settings:{budget:Number(budget)}})}}><input aria-label="Budget mensuel en euros" className={field} type="number" min="0" max="1000000000" step="0.01" required value={budget} onChange={e=>setBudget(e.target.value)}/><button disabled={busy} className={button}>Enregistrer</button></form>{month&&limit>0&&<><div className="h-2 bg-gray-100 rounded-full mt-4 overflow-hidden"><div className={totals.expenses>limit?'h-full bg-red-400':'h-full bg-teal-400'} style={{width:`${Math.min(100,totals.expenses/limit*100)}%`}}/></div><p className="text-xs text-gray-500 mt-2">{totals.expenses>limit?'Dépassement : ':'Disponible : '}{euro(Math.abs(limit-totals.expenses))}</p></>}</section>
      <section className="bg-white border border-gray-200 rounded-xl p-4"><h2 className="text-sm font-semibold text-gray-800 mb-4">Dépenses par catégorie</h2>{totals.categories.map(c=><div key={c.name} className="mb-4"><div className="flex justify-between gap-2 text-xs text-gray-600"><span>{c.name}</span><span>{euro(c.amount)}</span></div><div className="h-1.5 bg-gray-100 rounded-full mt-2"><div className="h-full bg-teal-400 rounded-full" style={{width:`${totals.expenses?c.amount/totals.expenses*100:0}%`}}/></div></div>)}{!totals.categories.length&&<p className="text-xs text-gray-400">Aucune dépense sur cette période.</p>}</section></aside></div>
    </>}
  </main>
}
