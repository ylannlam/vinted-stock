import { useEffect, useRef, useState } from 'react'
import ResourceDialog from './ResourceDialog'
import SaleDetails, {SheinStatus} from './SaleDetails'
import {ErrorNotice,Pagination,fieldClass,buttonClass,primaryClass} from './WorkspaceUI'
import {commonNextStage} from '../lib/workspace'
import CollectionManager from './CollectionManager'
const defaultRequest = (...args) => import('../lib/api').then(m => m.salesRequest(...args))
import { STAGES, skuOf, supplierOf, productOf, stageOf, blocked, deadline, money, nextStage, ORDER_LABELS } from '../lib/fulfillment'

export default function SalesTab({ isAdmin, request = defaultRequest, collectorRequest, collectorBridge, initialFilters={}, onPreparePhoto }) {
  const [data, setData] = useState({ lines: [], catalog: [], counts:{}, accounts:[], count:0 })
  const [filter, setFilter] = useState(initialFilters.stage||'all'), [search, setSearch] = useState(initialFilters.search||'')
  const [query,setQuery]=useState(initialFilters.search||''),[account,setAccount]=useState(initialFilters.account||''),[from,setFrom]=useState(''),[to,setTo]=useState(''),[urgent,setUrgent]=useState(initialFilters.urgent===true||initialFilters.urgent==='true'),[page,setPage]=useState(0)
  const [selected,setSelected]=useState([]),[batch,setBatch]=useState(null),[batchValue,setBatchValue]=useState(''),[confirmed,setConfirmed]=useState(false)
  const revision=useRef(null),sequence=useRef(0),mutation=useRef(false)
  const filterKey=JSON.stringify({stage:filter,search:query,account,from,to,urgent,page})
  useEffect(()=>{const timer=setTimeout(()=>{setQuery(search);setPage(0)},300);return()=>clearTimeout(timer)},[search])
  const [busy, setBusy] = useState(false), [error, setError] = useState(''), [notice, setNotice] = useState('')
  const [editing, setEditing] = useState(null)
  const [detailCatalog,setDetailCatalog]=useState([]),[detailNotice,setDetailNotice]=useState('')
  const [skuEditing, setSkuEditing] = useState(null)
  const loading=useRef(false),activationAttempted=useRef(false)
  async function load(force=false) {
    const seq=++sequence.current
    const params=new URLSearchParams({view:'page',...JSON.parse(filterKey)})
    if(!force&&revision.current)params.set('revision',revision.current)
    const next=await request('GET',undefined,`?${params}`)
    if(seq!==sequence.current)return
    if(!next.unchanged){setData(next);revision.current=next.revision}
    setError('')
  }
  async function run(fn) { if(mutation.current)return;mutation.current=true;setBusy(true);setError('');try{await fn()}catch(e){setError(e.message)}finally{mutation.current=false;setBusy(false)} }
  useEffect(()=>{let active=true;revision.current=null;setSelected([]);setBusy(true);load(true).catch(e=>{if(active)setError(e.message)}).finally(()=>{if(active)setBusy(false)});return()=>{active=false;sequence.current++}},[filterKey])
  useEffect(()=>{
    if(busy||editing||skuEditing||batch||selected.length)return
    const timer=setInterval(()=>{if(document.visibilityState==='visible')load().catch(e=>setError(e.message))},15000)
    return ()=>clearInterval(timer)
  },[busy,editing,skuEditing,batch,selected.length,filterKey])
  useEffect(()=>{
    if(!isAdmin||!data.connected||!data.automation||data.automation.configured||data.automation.error||activationAttempted.current)return
    activationAttempted.current=true
    run(async()=>{await request('POST',{action:'automation'});await load()})
  },[data.automation,isAdmin,data.connected])
  async function sync() {
    let page
    do {
      page = await request('POST', {})
      setNotice(`${page.processed} commandes lues…`)
      if (page.has_more) await new Promise(resolve => setTimeout(resolve, 1700))
    } while(page.has_more)
    await load(); setNotice('Synchronisation terminée. Les données de préparation ont été conservées.')
  }
  const scoped=data.lines, visible=data.lines
  const selectedLines=data.lines.filter(l=>selected.includes(l.id)),batchTarget=commonNextStage(selectedLines)
  const selectable=data.lines.filter(l=>!blocked(l)&&nextStage(l))
  function showDetail(line,catalog) {
    setSkuEditing(null);setError('');setDetailNotice('');setDetailCatalog(catalog)
    const product=catalog.find(p=>p.sku===skuOf(line))
    setEditing({...line,sku:skuOf(line),supplier_url:supplierOf(line,catalog)||'',variant:product?.variant||'',supplier_size:line.supplier_size||'',supplier_color:line.supplier_color||'',actual_cost:line.actual_cost??'',fees_amount:line.fees_amount??0,refund_amount:line.refund_amount??0,finance_confirmed:line.finance_confirmed===true})
  }
  async function openDetail(id) {
    const result=await request('GET',undefined,'?'+new URLSearchParams({view:'detail',id}))
    showDetail(result.line,result.catalog)
  }
  function edit(line){run(()=>openDetail(line.id))}
  useEffect(()=>{if(initialFilters.line)run(()=>openDetail(initialFilters.line))},[initialFilters.line])
  async function retryDetail(){
    const send=collectorRequest||((...args)=>import('../lib/api').then(m=>m.collectorRequest(...args)))
    const result=await send('POST',{action:'enqueue',references:editing.sku})
    await openDetail(editing.id)
    setDetailNotice(result.queued?'Demande enregistrée. Le navigateur connecté récupérera cette fiche ; les relevés existants restent conservés.':'Cette fiche est déjà à jour ou en attente de récupération.')
  }
  async function advanceDetail(){
    const stage=nextStage(editing)
    if(stage==='shipped'&&!window.confirm('Confirmer que cet article a été déposé auprès du transporteur ?'))return
    await request('PATCH',{action:'advance',id:editing.id,updated_at:editing.updated_at,stage})
    await openDetail(editing.id);await load(true);setDetailNotice('Étape de préparation enregistrée.')
  }
  function editSku(line) {
    setError(''); setNotice('')
    setSkuEditing({id:line.id,updated_at:line.updated_at,sku:skuOf(line)})
  }
  async function saveSku() {
    await request('PATCH',{action:'sku',...skuEditing})
    setSkuEditing(null)
    await load()
    setNotice('SKU enregistré. La fiche Shein est reliée ou sera récupérée automatiquement par le navigateur connecté.')
  }
  const input = 'border border-gray-300 rounded-md px-3 py-2 text-sm w-full focus:outline-teal-600'
  return <main className="max-w-screen-2xl mx-auto p-4 space-y-4">
    <div className="flex flex-wrap justify-between gap-3 items-center">
      <div><h1 className="text-xl font-bold text-gray-900">Ventes & achats</h1><p className="text-sm text-gray-500">De la vente Vinted au colis déposé.</p></div>
      <div className="flex gap-2"><button disabled={busy} onClick={() => run(()=>load(true))} className="border rounded-lg px-3 py-2 text-sm">Actualiser</button>
        {isAdmin && <button disabled={busy || data.setup_required || !data.connected} onClick={() => run(sync)} className="rounded-lg px-4 py-2 bg-teal-700 text-white text-sm disabled:opacity-40">{busy ? 'Traitement…' : data.resume ? 'Reprendre l’import' : 'Synchroniser Dotb'}</button>}</div>
    </div>
    <details className="rounded-xl border bg-white p-3 text-sm"><summary className="cursor-pointer text-slate-600">{data.automation?.enabled?'● Réception Dotb active':'Connexion Dotb à vérifier'} · Connexion et fonctionnement</summary>
      <div className="mt-3 space-y-3"><p className="text-xs text-gray-500">Ajoute le SKU après la vente si nécessaire. L’extension récupère la fiche lorsque le navigateur connecté est ouvert. Les étapes de préparation sont propres à ce site.</p>
      {data.tracking&&<p className="text-xs text-gray-500">Suivi depuis le {new Date(data.tracking.starts_at).toLocaleDateString('fr-FR',{timeZone:'Europe/Paris'})} · heure de Paris.</p>}
      {data.automation?.last_received_at&&<p className="text-xs text-gray-500">Dernière réception : {new Date(data.automation.last_received_at).toLocaleString('fr-FR')}</p>}
      {isAdmin&&!data.automation?.enabled&&<button disabled={busy||!data.connected} className={buttonClass} onClick={()=>run(async()=>{await request('POST',{action:'automation'});await load(true)})}>Activer la réception automatique</button>}
      </div>
    </details>
    <CollectionManager compact isAdmin={isAdmin} request={collectorRequest} bridge={collectorBridge} onCollected={()=>load(true)} />
    <ErrorNotice error={!skuEditing&&!editing&&!batch?error:null} retry={()=>run(()=>load(true))} busy={busy}/>
    {notice && <p role="status" className="text-sm text-teal-800">{notice}</p>}
    {data.setup_required ? <div className="bg-amber-50 border border-amber-200 rounded-lg p-4"><h2 className="font-semibold">Activation du suivi nécessaire</h2><p className="text-sm mt-1">La nouvelle structure de données doit être installée avant le premier import. Le stock existant reste disponible dans les autres onglets.</p></div> : data.connected === false && <p className="bg-amber-50 p-3 rounded-lg text-sm">La connexion Dotb n’est pas encore activée. Les ventes déjà importées restent consultables.</p>}
    <div className="flex flex-wrap gap-1 border-b pb-3">
      {[{id:'all',label:'Toutes'}, {id:'missing_sku',label:'Sans SKU'}, ...STAGES, {id:'review',label:'À vérifier'}].map(s => <button key={s.id} disabled={busy} onClick={()=>{setFilter(s.id);setPage(0);setSkuEditing(null);setError('')}} className={`px-3 py-2 rounded-md text-sm ${filter===s.id?'bg-teal-700 text-white':'bg-white border text-gray-600'}`}>
        {s.label} <span className="opacity-70">{data.counts?.[s.id]||0}</span>
      </button>)}
    </div>
    <section className="rounded-xl bg-white border p-3 space-y-3" aria-label="Filtrer les ventes"><div className="grid sm:grid-cols-2 gap-3"><select aria-label="Compte de vente" className={input} value={account} disabled={busy} onChange={e=>{setAccount(e.target.value);setPage(0)}}><option value="">Tous les comptes</option>{data.accounts.map(a=><option key={a}>{a}</option>)}</select><label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={urgent} disabled={busy} onChange={e=>{setUrgent(e.target.checked);setPage(0)}}/>Urgences sous 48 h</label></div><div className="flex flex-wrap gap-3"><label className="text-xs text-gray-500 flex-1 min-w-32">Du<input type="date" className={input} value={from} onChange={e=>{setFrom(e.target.value);setPage(0)}}/></label><label className="text-xs text-gray-500 flex-1 min-w-32">Au<input type="date" className={input} value={to} onChange={e=>{setTo(e.target.value);setPage(0)}}/></label><button className={buttonClass} onClick={()=>{setFrom('');setTo('');setAccount('');setUrgent(false);setSearch('');setFilter('all');setPage(0)}}>Réinitialiser</button></div></section>
    <input aria-label="Rechercher une vente" className={input} placeholder="Rechercher un article, un SKU, un compte ou une commande Shein…" value={search} onChange={e=>setSearch(e.target.value)} />
    {!!selectable.length&&<label className="flex gap-2 text-sm items-center"><input type="checkbox" disabled={busy} checked={selectable.every(l=>selected.includes(l.id))} onChange={e=>setSelected(e.target.checked?selectable.map(l=>l.id):[])}/>Sélectionner cette page</label>}
    {!!selected.length&&<div className="flex flex-wrap gap-2 items-center bg-teal-900 text-white rounded-xl p-3"><strong className="mr-auto text-sm">{selected.length} sélectionnée(s)</strong><button disabled={busy} className={buttonClass+' !text-slate-800'} onClick={()=>{setBatch('order_ref');setBatchValue('');setConfirmed(false)}}>Même commande Shein</button>{batchTarget&&<button disabled={busy} className={buttonClass+' !text-slate-800'} onClick={()=>{setBatch('advance');setBatchValue(batchTarget);setConfirmed(false)}}>{STAGES.find(s=>s.id===batchTarget)?.label} →</button>}<button className="px-2 text-sm" onClick={()=>setSelected([])}>Annuler</button></div>}
    <div className="sales-list border rounded-lg bg-white"><table className="w-full text-sm text-left"><thead className="bg-gray-50 text-gray-500 text-xs"><tr>{['Article / SKU','Compte / Vente','Fiche Shein','Approvisionnement','Échéance','Actions'].map(t=><th key={t} className="p-3">{t}</th>)}</tr></thead><tbody>
      {visible.map(line => { const due=deadline(line), stage=stageOf(line), supplier=supplierOf(line,data.catalog),product=productOf(line,data.catalog); return <tr key={line.id} className="border-t hover:bg-gray-50">
        <td className="p-3 min-w-48"><div className="flex gap-3"><input type="checkbox" aria-label={`Sélectionner ${line.source.title||'cet article'}`} className="self-start mt-1" disabled={busy||blocked(line)||!nextStage(line)} checked={selected.includes(line.id)} onChange={e=>setSelected(old=>e.target.checked?[...old,line.id]:old.filter(id=>id!==line.id))}/>{(line.source.thumbnail_url||product?.photo_url)&&<img src={line.source.thumbnail_url||product.photo_url} alt="" className="w-12 h-16 rounded object-cover" loading="lazy"/>}<div className="min-w-0"><div className="font-medium">{line.source.title || 'Article sans titre'}</div>
          {skuEditing?.id===line.id?<form className="mt-2 space-y-2 min-w-52 max-w-sm" aria-label={`SKU de ${line.source.title||'cet article'}`} onSubmit={e=>{e.preventDefault();run(saveSku)}} onKeyDown={e=>{if(e.key==='Escape'&&!busy){setSkuEditing(null);setError('')}}}>
            <label className="block text-xs text-gray-600">SKU Shein<input autoFocus required disabled={busy} autoCapitalize="none" autoCorrect="off" spellCheck={false} maxLength={200} placeholder="Ex. sz25052272411726746" className={`${input} mt-1`} value={skuEditing.sku} onChange={e=>setSkuEditing({...skuEditing,sku:e.target.value})}/></label>
            <p className="text-xs text-gray-500">Colle la référence de l’article Shein. La recherche démarrera automatiquement.</p>
            {error&&<p role="alert" className="text-xs text-red-700">{error}</p>}
            <div className="flex flex-wrap gap-2"><button disabled={busy||!skuEditing.sku.trim()} className="rounded-md bg-teal-700 text-white px-3 py-2 text-xs disabled:opacity-40">{busy?'Enregistrement…':'Enregistrer le SKU'}</button><button type="button" disabled={busy} onClick={()=>{setSkuEditing(null);setError('')}} className="text-xs px-2 py-2">Annuler</button></div>
          </form>:<><div className={skuOf(line)?'text-gray-500 text-xs break-all':'text-amber-700 text-xs'}>{skuOf(line)||'SKU à renseigner'}</div>{!blocked(line)&&<button disabled={busy} onClick={()=>editSku(line)} className={`mt-2 text-xs ${skuOf(line)?'text-teal-700 underline':'rounded-md bg-teal-700 text-white px-3 py-2'}`}>{skuOf(line)?'Modifier le SKU':'Ajouter le SKU Shein'}</button>}</>}
        </div></div></td>
        <td className="p-3"><div>{line.order.account_login || 'Compte inconnu'}</div><div>{money(line.source.selling_price,line.order.currency)}</div><small className="text-gray-500">{ORDER_LABELS[line.order.status] || 'Statut à vérifier'}</small></td>
        <td className="p-3 min-w-48">
          {supplier&&<a className="text-teal-700 underline" href={supplier} target="_blank" rel="noreferrer">Ouvrir la fiche Shein</a>}
          {product?.price!=null&&<><div className="font-semibold mt-1">{money(product.price,product.currency)}</div><p className="text-xs text-gray-500">Prix relevé{product.color?` · ${product.color}`:''} · hors coupons</p><p className="text-xs text-gray-500">Relevé le {new Date(product.observed_at).toLocaleString('fr-FR')}</p></>}
          <SheinStatus sku={skuOf(line)} product={product}/>
          {(line.supplier_size||line.supplier_color)&&<p className="text-xs text-slate-600 mt-2">À acheter : {[line.supplier_size,line.supplier_color].filter(Boolean).join(' · ')}</p>}
        </td>
        <td className="p-3"><span className="bg-teal-50 text-teal-800 rounded px-2 py-1 text-xs">{STAGES.find(s=>s.id===stage)?.label}</span><div className="text-xs text-gray-500 mt-2">{line.supplier_order_ref || 'Commande Shein non renseignée'}</div>{line.location && <small>Emplacement : {line.location}</small>}</td>
        <td className={`p-3 whitespace-nowrap ${due?.urgent?'text-red-700':'text-gray-500'}`}>{due?.text || '—'}</td>
        <td className="p-3"><div className="flex flex-col items-start gap-2"><button disabled={busy} onClick={()=>edit(line)} className={buttonClass}>Ouvrir la vente</button>{isAdmin&&onPreparePhoto&&<button className={buttonClass} onClick={()=>onPreparePhoto({type:'sale',id:line.id,title:line.source.title,photo_url:line.source.thumbnail_url||product?.photo_url,account_login:line.order.account_login,sku:skuOf(line)})}>Préparer les photos</button>}
          {!blocked(line) && nextStage(line) && <button disabled={busy} onClick={()=>run(async()=>{ if(nextStage(line)==='shipped' && !window.confirm('Confirmer que cet article a été déposé auprès du transporteur ?')) return; await request('PATCH',{action:'advance',id:line.id,updated_at:line.updated_at,stage:nextStage(line)}); await load() })} className="border rounded px-2 py-1 text-xs">{STAGES.find(s=>s.id===stage)?.action} →</button>}
          {line.order.label_url && <a href={line.order.label_url} target="_blank" rel="noreferrer" className="text-xs underline">Bordereau</a>}</div></td>
      </tr>})}
      {!visible.length && <tr><td colSpan="6" className="text-center py-16 text-gray-500">{busy?'Chargement…':scoped.length?'Aucune vente ne correspond à ces filtres.':data.automation?.enabled?'Les prochaines ventes reçues par Dotb apparaîtront ici automatiquement.':data.tracking?'Aucune vente sur cette période. Synchronise Dotb pour récupérer les ventes récentes.':'Aucune vente importée. Connectez Dotb puis lancez une synchronisation.'}</td></tr>}
    </tbody></table></div>
    <Pagination page={page} count={data.count} onChange={setPage} busy={busy}/>
    <p className="text-xs text-gray-500">Dernier import complet : {data.last_sync ? new Date(data.last_sync).toLocaleString('fr-FR') : 'aucun'} · Les étapes de préparation sont propres à votre site. Les prix fournisseurs sont consultables dans le Catalogue.</p>
    {editing&&<SaleDetails key={editing.id+editing.updated_at} value={editing} onChange={setEditing} product={detailCatalog.find(p=>p.sku===editing.sku)} isAdmin={isAdmin} busy={busy} error={error} notice={detailNotice} onClose={()=>{setEditing(null);setError('')}} onRefresh={()=>run(()=>openDetail(editing.id))} onRetry={()=>run(retryDetail)} onAdvance={()=>run(advanceDetail)} onSave={()=>run(async()=>{await request('PATCH',{...editing,action:'edit'});setEditing(null);await load(true);setNotice('Vente enregistrée. Les tailles, couleurs et coûts sont conservés pour cet article.');})}/>}
    {batch&&<ResourceDialog title={batch==='order_ref'?'Associer une commande Shein':'Confirmer la préparation'} busy={busy} onClose={()=>setBatch(null)}><form className="space-y-4" onSubmit={e=>{e.preventDefault();run(async()=>{await request('PATCH',{action:'batch',operation:batch,value:batchValue,lines:selectedLines.map(l=>({id:l.id,updated_at:l.updated_at}))});setBatch(null);setSelected([]);await load(true);setNotice('Les ventes sélectionnées ont été mises à jour ensemble.')})}}><p className="text-sm">{selectedLines.length} vente(s). L’ensemble est enregistré uniquement si toutes sont encore à jour.</p>{batch==='order_ref'?<label className="block text-sm">Numéro de commande Shein<input required maxLength={200} className={fieldClass+' mt-2'} value={batchValue} onChange={e=>setBatchValue(e.target.value)}/></label>:<><p className="font-semibold">Nouvelle étape : {STAGES.find(s=>s.id===batchValue)?.label}</p><label className="flex items-start gap-2 text-sm"><input type="checkbox" required checked={confirmed} onChange={e=>setConfirmed(e.target.checked)}/>{batchValue==='shipped'?'Je confirme que les colis ont été déposés auprès du transporteur.':'Je confirme que cette étape a été réalisée pour tous les articles sélectionnés.'}</label></>}<ErrorNotice error={error}/><button className={primaryClass} disabled={busy||!selectedLines.length}>{busy?'Enregistrement…':'Enregistrer'}</button></form></ResourceDialog>}
  </main>
}
