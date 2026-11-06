import {useEffect,useState} from 'react'
import {thumbOf} from '../lib/resourceThumbs'

const button='inline-flex items-center justify-center gap-1.5 border rounded-lg px-3 py-1.5 text-xs bg-white hover:bg-gray-50 disabled:opacity-40'
const fold=s=>String(s||'').normalize('NFD').replace(/[̀-ͯ]/g,'').toLowerCase()

function PromptText({text}){
 return <pre className="max-h-28 overflow-y-auto whitespace-pre-wrap break-words rounded-lg border border-slate-200 bg-slate-50 p-3 font-sans text-xs leading-relaxed text-slate-700">{text||<span className="text-slate-400">Vide</span>}</pre>
}

// Prompts rangés par usage : ceux des fonds (avant / arrière), puis les prompts libres par catégorie.
export function PromptList({rows,onEdit,onNew,onCopy}){
 const [search,setSearch]=useState('')
 const active=rows.filter(r=>!r.archived_at&&fold(`${r.title} ${r.category} ${r.content} ${r.content_back}`).includes(fold(search.trim())))
 const fonds=active.filter(r=>r.kind==='background'&&(r.content?.trim()||r.content_back?.trim())).sort((a,b)=>a.title.localeCompare(b.title,'fr'))
 const prompts=active.filter(r=>r.kind==='prompt')
 const groups=[...new Set(prompts.map(r=>r.category?.trim()||'Autres prompts'))].sort((a,b)=>a==='Autres prompts'?1:b==='Autres prompts'?-1:a.localeCompare(b,'fr'))
 return <section className="space-y-6" aria-label="Bibliothèque de prompts">
  <div className="flex flex-wrap items-center justify-between gap-3"><div><h2 className="text-xl font-semibold">Prompts</h2><p className="text-sm text-gray-500 mt-1">Tous tes prompts au même endroit, rangés par usage. Un clic pour copier.</p></div>
   <div className="flex flex-wrap gap-2"><input className="border border-gray-300 rounded-lg px-3 py-2 text-sm bg-white focus:outline-teal-600 min-w-56" aria-label="Rechercher un prompt" placeholder="Rechercher un prompt…" value={search} onChange={e=>setSearch(e.target.value)}/><button className="rounded-lg px-4 py-2 text-sm font-medium bg-teal-700 text-white hover:bg-teal-800" onClick={onNew}>+ Nouveau prompt</button></div></div>
  <div className="space-y-3"><h3 className="font-semibold text-teal-800">Prompts des fonds <span className="text-xs font-normal text-gray-500">· avant et arrière, repris par les comptes qui utilisent ce fond</span></h3>
   {fonds.length?fonds.map(r=><article key={r.id} className="rounded-xl border bg-white p-3 grid gap-3 md:grid-cols-[56px_1fr_1fr]">
    {thumbOf(r)?<img src={thumbOf(r)} alt="" loading="lazy" className="h-[72px] w-14 rounded-md object-cover bg-stone-100"/>:<span className="h-[72px] w-14 rounded-md bg-stone-100"/>}
    {[['content','Avant'],['content_back','Arrière']].map(([key,label])=><div key={key} className="min-w-0 space-y-1.5"><div className="flex items-center justify-between gap-2"><p className="text-sm font-medium truncate">{label==='Avant'?r.title:''}<span className="text-xs text-gray-500 font-normal">{label==='Avant'?' · avant':'Arrière'}</span></p><div className="flex gap-1.5">{label==='Avant'&&<button className={button} onClick={()=>onEdit(r)}>Modifier</button>}<button className={button} disabled={!r[key]?.trim()} onClick={()=>onCopy(r,key)}>Copier</button></div></div><PromptText text={r[key]}/></div>)}
   </article>):<p className="text-sm text-gray-500">Aucun fond n’a encore de prompt{search?' pour cette recherche':''}.</p>}
  </div>
  {groups.map(group=><div key={group} className="space-y-3"><h3 className="font-semibold text-violet-800">{group}</h3>
   {prompts.filter(r=>(r.category?.trim()||'Autres prompts')===group).sort((a,b)=>Number(!!b.favorite)-Number(!!a.favorite)||a.title.localeCompare(b.title,'fr')).map(r=><article key={r.id} className="rounded-xl border bg-white p-3 space-y-1.5">
    <div className="flex items-center justify-between gap-2"><p className="text-sm font-medium truncate">{r.favorite?'★ ':''}{r.title}</p><div className="flex gap-1.5"><button className={button} onClick={()=>onEdit(r)}>Modifier</button><button className={button} onClick={()=>onCopy(r,'content')}>Copier</button></div></div><PromptText text={r.content}/>
   </article>)}</div>)}
  {!prompts.length&&<p className="rounded-xl border border-dashed p-6 text-center text-sm text-gray-500">{search?'Aucun prompt libre ne correspond.':'Pas encore de prompt libre. Donne une catégorie à tes prompts (« Habillage », « Mannequin »…) : ils seront rangés par groupe ici.'}</p>}
 </section>
}

const usd=v=>new Intl.NumberFormat('fr-FR',{style:'currency',currency:'USD',maximumFractionDigits:v<1?3:2}).format(v||0)
const tokens=v=>new Intl.NumberFormat('fr-FR',{notation:v>=1e6?'compact':'standard',maximumFractionDigits:1}).format(v||0)

// Dépenses IA : ce que coûte la rédaction automatique des annonces, au tarif enregistré pour chaque modèle.
export function AiSpending({request}){
 const [days,setDays]=useState(30),[data,setData]=useState(null),[loading,setLoading]=useState(true),[error,setError]=useState(''),[notice,setNotice]=useState('')
 const [edits,setEdits]=useState({}),[saving,setSaving]=useState('')
 async function load(period=days){
  setLoading(true);setError('')
  try{setData(await request('GET',undefined,`action=ai_usage&days=${period}`))}catch(e){setError(e.message||'Dépenses indisponibles.')}finally{setLoading(false)}
 }
 useEffect(()=>{load(days)},[days])
 async function savePrice(model){
  const e=edits[model];setSaving(model);setError('');setNotice('')
  try{await request('POST',{action:'ai_price',model,input_per_million:e.input,output_per_million:e.output});setEdits(x=>{const n={...x};delete n[model];return n});setNotice('Tarif enregistré : les montants sont recalculés.');await load()}
  catch(err){setError(err.message||'Tarif non enregistré.')}finally{setSaving('')}
 }
 const max=Math.max(...(data?.series||[]).map(d=>d.cost),0.000001)
 const models=[...new Set([...(data?.prices||[]).map(p=>p.model),...(data?.unknown_models||[])])]
 return <section className="space-y-5" aria-label="Dépenses IA">
  <div className="flex flex-wrap items-center justify-between gap-3"><div><h2 className="text-xl font-semibold">Dépenses IA</h2><p className="text-sm text-gray-500 mt-1">Coût des rédactions d’annonces (titre, description, catégorie). Chaque rédaction s’enregistre toute seule.</p></div>
   <div className="flex gap-2"><select className="border border-gray-300 rounded-lg px-3 py-2 text-sm bg-white" aria-label="Période" value={days} onChange={e=>setDays(Number(e.target.value))}>{[7,30,90].map(d=><option key={d} value={d}>{d} derniers jours</option>)}</select><button className="border rounded-lg px-3 py-2 text-sm bg-white hover:bg-gray-50 disabled:opacity-40" disabled={loading} onClick={()=>load()}>Actualiser</button></div></div>
  {error&&<p role="alert" className="rounded-lg bg-red-50 p-3 text-sm text-red-800">{error}</p>}
  {notice&&<p role="status" className="text-sm text-teal-800">{notice}</p>}
  {loading&&!data?<p role="status" className="py-10 text-center text-gray-500">Calcul des dépenses…</p>:data&&<>
   {!data.ready&&<p className="rounded-xl bg-amber-50 p-3 text-sm text-amber-900">Le suivi des dépenses sera actif après la mise à jour de la base.</p>}
   <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">{[[usd(data.total.cost),'coût estimé'],[data.total.generations,'rédaction(s)'],[data.total.generations?usd(data.total.cost/data.total.generations):'—','par annonce en moyenne'],[`${tokens(data.total.input_tokens)} / ${tokens(data.total.output_tokens)}`,'jetons envoyés / reçus']].map(([v,l])=><div key={l} className="rounded-2xl border bg-white px-4 py-3"><p className="text-xl font-bold text-slate-800">{v}</p><p className="text-xs text-slate-500">{l}</p></div>)}</div>
   {data.total.generations?<div className="rounded-2xl border bg-white p-4"><p className="text-xs font-semibold uppercase tracking-widest text-slate-500 mb-3">Par jour</p>
    <div className="flex h-32 items-end gap-[2px]" role="img" aria-label="Coût par jour">{data.series.map(d=><div key={d.key} className="flex-1 rounded-t bg-teal-600/80 hover:bg-teal-700" style={{height:`${Math.max(d.cost?4:0,d.cost/max*100)}%`}} title={`${new Date(d.key+'T12:00:00Z').toLocaleDateString('fr-FR',{day:'2-digit',month:'2-digit'})} · ${d.generations} rédaction(s) · ${usd(d.cost)}`}/>)}</div>
    <div className="mt-1 flex justify-between text-[10px] text-slate-400"><span>{new Date(data.series[0].key+'T12:00:00Z').toLocaleDateString('fr-FR',{day:'2-digit',month:'2-digit'})}</span><span>aujourd’hui</span></div></div>
   :<p className="rounded-2xl border border-dashed bg-white p-10 text-center text-sm text-gray-500">Aucune dépense sur la période. Elles s’enregistrent toutes seules à chaque rédaction d’annonce.</p>}
   <div className="grid lg:grid-cols-2 gap-4">
    <div className="rounded-2xl border bg-white p-4 space-y-3"><p className="text-xs font-semibold uppercase tracking-widest text-slate-500">Tarifs par modèle · $ par million de jetons</p>
     {models.map(model=>{const p=data.prices.find(x=>x.model===model),e=edits[model],used=data.models.find(m=>m.key===model)
      return <div key={model} className="flex flex-wrap items-end gap-2 border-t pt-3 first:border-0 first:pt-0"><div className="min-w-40 flex-1"><p className="text-sm font-medium">{model}</p><p className="text-xs text-slate-500">{used?`${used.generations} rédaction(s) · ${usd(used.cost)}`:'Pas utilisé sur la période'}{!p&&' · tarif à renseigner'}</p></div>
       {[['input','Entrée','input_per_million'],['output','Sortie','output_per_million']].map(([k,l,f])=><label key={k} className="text-[11px] text-slate-500">{l}<input inputMode="decimal" className="mt-0.5 block w-20 rounded-lg border px-2 py-1.5 text-sm" value={e?.[k]??p?.[f]??''} onChange={ev=>setEdits(x=>({...x,[model]:{input:p?.input_per_million??'',output:p?.output_per_million??'',...x[model],[k]:ev.target.value}}))}/></label>)}
       {e&&<button className={button} disabled={saving===model} onClick={()=>savePrice(model)}>{saving===model?'…':'Enregistrer'}</button>}</div>})}
     <p className="text-[11px] text-slate-500">Montants estimés avec ces tarifs : compare-les à ta facture Google. Si un tarif change, corrige-le ici.</p>
    </div>
    <div className="rounded-2xl border bg-white p-4"><p className="text-xs font-semibold uppercase tracking-widest text-slate-500 mb-3">Par compte</p>
     {data.accounts.length?<ul className="divide-y text-sm">{data.accounts.map(a=><li key={a.key} className="flex justify-between gap-3 py-2"><span className="truncate">{a.label}</span><span className="text-slate-500 shrink-0">{a.generations} · {usd(a.cost)}</span></li>)}</ul>:<p className="text-sm text-slate-500">Rien sur la période.</p>}
    </div>
   </div>
  </>}
 </section>
}
