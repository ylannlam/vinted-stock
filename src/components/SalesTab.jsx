import { useEffect, useRef, useState } from 'react'
import ResourceDialog from './ResourceDialog'
import SupplierShipments,{ShipmentForm} from './SupplierShipments'
import SaleDetails, {SheinStatus} from './SaleDetails'
import {ErrorNotice,Pagination,fieldClass,buttonClass,primaryClass} from './WorkspaceUI'
import {nextSaleAction,confirmPurchase} from '../lib/saleDetails'
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
  const [showShipments,setShowShipments]=useState(false),[parcelLines,setParcelLines]=useState(null)
  const [detailCatalog,setDetailCatalog]=useState([]),[detailNotice,setDetailNotice]=useState('')
  const [skuEditing, setSkuEditing] = useState(null)
  const [purchaseLine,setPurchaseLine]=useState(null),[purchaseReference,setPurchaseReference]=useState('')
  const [selecting,setSelecting]=useState(false),[filtersOpen,setFiltersOpen]=useState(false),[settingsOpen,setSettingsOpen]=useState(false)
  const activationAttempted=useRef(false)
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
    if(busy||editing||skuEditing||batch||purchaseLine||parcelLines||showShipments||selected.length)return
    const timer=setInterval(()=>{if(document.visibilityState==='visible')load().catch(e=>setError(e.message))},15000)
    return ()=>clearInterval(timer)
  },[busy,editing,skuEditing,batch,purchaseLine,parcelLines,showShipments,selected.length,filterKey])
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
  const visible=data.lines
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
    setEditing(null); setError(''); setNotice('')
    setSkuEditing({id:line.id,updated_at:line.updated_at,sku:skuOf(line)})
  }
  async function saveSku(value=skuEditing) {
    if(!/^[A-Za-z0-9_-]{1,200}$/.test(value.sku.trim()))throw new Error('Colle uniquement le SKU, sans lien ni espaces.')
    await request('PATCH',{action:'sku',...value,sku:value.sku.trim()})
    setSkuEditing(null)
    setNotice('SKU enregistré. La récupération Shein continue en arrière-plan.')
    await load(true)
  }
  function pasteSku(event) {
    event.preventDefault()
    if(busy||mutation.current)return
    const value={...skuEditing,sku:event.clipboardData.getData('text/plain').trim()}
    setSkuEditing(value)
    run(()=>saveSku(value))
  }
  async function advance(line) {
    if(nextStage(line)==='shipped'&&!window.confirm('Confirmer que cet article a été déposé auprès du transporteur ?'))return
    await request('PATCH',{action:'advance',id:line.id,updated_at:line.updated_at,stage:nextStage(line)})
    await load(true)
  }
  const input = fieldClass
  const activeFilters=[account,from,to,urgent].filter(Boolean).length
  const stages=[{id:'all',label:'Toutes'},...STAGES.filter(s=>data.counts?.[s.id]>0||filter===s.id)]
  const chooseStage=id=>{setFilter(id);setPage(0);setSkuEditing(null);setError('')}
  return <main className="max-w-screen-2xl mx-auto p-4 sm:p-6 space-y-5 text-slate-800">
    <header className="flex flex-wrap justify-between gap-3 items-center">
      <div><h1 className="text-2xl font-bold">Mes ventes</h1><p className="text-sm text-slate-500 mt-1">Commande sur Shein, reçois l’article, puis expédie-le.</p></div>
      <div className="flex gap-2"><button disabled={busy} onClick={()=>run(()=>load(true))} className={buttonClass}>Actualiser</button><button aria-expanded={settingsOpen} aria-controls="sales-settings" className={buttonClass} onClick={()=>setSettingsOpen(!settingsOpen)}>Réglages</button></div>
    </header>
    {settingsOpen&&<section id="sales-settings" className="rounded-2xl border bg-white p-4 space-y-3"><h2 className="font-semibold text-sm">Réception des ventes Dotb</h2>
      <p className="text-sm text-slate-600">{data.automation?.enabled?'Les nouvelles ventes arrivent automatiquement.':'La réception automatique doit être activée.'}</p>
      {data.tracking&&<p className="text-xs text-slate-500">Suivi depuis le {new Date(data.tracking.starts_at).toLocaleDateString('fr-FR',{timeZone:'Europe/Paris'})}.</p>}
      <div className="flex flex-wrap gap-2">{isAdmin&&<button disabled={busy||data.setup_required||!data.connected} className={buttonClass} onClick={()=>run(sync)}>{data.resume?'Reprendre l’import':'Synchroniser Dotb'}</button>}{isAdmin&&!data.automation?.enabled&&<button disabled={busy||!data.connected} className={buttonClass} onClick={()=>run(async()=>{await request('POST',{action:'automation'});await load(true)})}>Activer la réception automatique</button>}</div>
      <p className="text-xs text-slate-500">Dernier import complet : {data.last_sync?new Date(data.last_sync).toLocaleString('fr-FR'):'aucun'}</p>
    </section>}
    <CollectionManager disclosure isAdmin={isAdmin} request={collectorRequest} bridge={collectorBridge} onCollected={()=>load(true)}/>
    <ErrorNotice error={!skuEditing&&!editing&&!batch&&!purchaseLine?error:null} retry={()=>run(()=>load(true))} busy={busy}/>
    {notice&&<p role="status" className="rounded-xl bg-teal-50 px-4 py-3 text-sm text-teal-800">{notice}</p>}
    {data.setup_required?<p className="bg-amber-50 p-3 rounded-lg text-sm">Le suivi doit être activé avant le premier import.</p>:data.connected===false&&<p className="bg-amber-50 p-3 rounded-lg text-sm">La connexion Dotb n’est pas encore activée. Les ventes déjà importées restent consultables.</p>}
    <nav aria-label="Ventes ou colis" className="flex gap-5 border-b"><button className={'pb-3 text-sm font-semibold border-b-2 '+(!showShipments?'border-teal-700 text-teal-800':'border-transparent text-slate-500')} onClick={()=>setShowShipments(false)}>Mes ventes</button><button className={'pb-3 text-sm font-semibold border-b-2 '+(showShipments?'border-teal-700 text-teal-800':'border-transparent text-slate-500')} onClick={()=>setShowShipments(true)}>Mes colis Shein</button></nav>
    {showShipments?<SupplierShipments request={request} onOpenSale={id=>run(()=>openDetail(id))} onChanged={()=>load(true)}/>:<>
    <section aria-label="Liste des ventes" className="space-y-4">
      <div className="flex flex-wrap gap-2 items-center">
        {stages.map(s=><button key={s.id} disabled={busy} aria-pressed={filter===s.id} onClick={()=>chooseStage(s.id)} className={'rounded-full px-4 py-2 text-sm '+(filter===s.id?'bg-teal-800 text-white':'bg-white border text-slate-600 hover:bg-slate-50')}>{s.label} <span className="ml-1 opacity-70">{data.counts?.[s.id]||0}</span></button>)}
        {(data.counts?.missing_sku>0||filter==='missing_sku')&&<button disabled={busy} aria-pressed={filter==='missing_sku'} onClick={()=>chooseStage('missing_sku')} className={'rounded-full px-4 py-2 text-sm '+(filter==='missing_sku'?'bg-amber-700 text-white':'bg-amber-50 text-amber-900')}>SKU à ajouter · {data.counts?.missing_sku||0}</button>}
        {(data.counts?.review>0||filter==='review')&&<button disabled={busy} aria-pressed={filter==='review'} onClick={()=>chooseStage('review')} className={'rounded-full px-4 py-2 text-sm '+(filter==='review'?'bg-amber-700 text-white':'bg-amber-50 text-amber-900')}>À vérifier · {data.counts?.review||0}</button>}
      </div>
      <div className="flex flex-wrap gap-2"><input aria-label="Rechercher une vente" className={input+' flex-1 min-w-48'} placeholder="Rechercher une vente, un compte ou un SKU…" value={search} onChange={e=>setSearch(e.target.value)}/><button className={buttonClass} aria-expanded={filtersOpen} aria-controls="sales-filters" onClick={()=>setFiltersOpen(!filtersOpen)}>Filtres{activeFilters?' · '+activeFilters:''}</button><button className={buttonClass} aria-pressed={selecting} disabled={busy} onClick={()=>{setSelecting(!selecting);setSelected([])}}>{selecting?'Fin de sélection':'Sélectionner'}</button></div>
      {filtersOpen&&<section id="sales-filters" className="rounded-xl bg-white border p-4 space-y-3" aria-label="Filtrer les ventes"><div className="grid sm:grid-cols-2 gap-3"><select aria-label="Compte de vente" className={input} value={account} disabled={busy} onChange={e=>{setAccount(e.target.value);setPage(0)}}><option value="">Tous les comptes</option>{data.accounts.map(a=><option key={a}>{a}</option>)}</select><label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={urgent} disabled={busy} onChange={e=>{setUrgent(e.target.checked);setPage(0)}}/>À expédier sous 48 h</label></div><div className="flex flex-wrap gap-3"><label className="text-xs text-slate-500 flex-1 min-w-32">Du<input type="date" className={input} value={from} onChange={e=>{setFrom(e.target.value);setPage(0)}}/></label><label className="text-xs text-slate-500 flex-1 min-w-32">Au<input type="date" className={input} value={to} onChange={e=>{setTo(e.target.value);setPage(0)}}/></label><button className={buttonClass} onClick={()=>{setFrom('');setTo('');setAccount('');setUrgent(false);setSearch('');chooseStage('all')}}>Effacer les filtres</button></div></section>}
      {selecting&&!!selectable.length&&<label className="flex gap-2 text-sm items-center"><input type="checkbox" disabled={busy} checked={selectable.every(l=>selected.includes(l.id))} onChange={e=>setSelected(e.target.checked?selectable.map(l=>l.id):[])}/>Sélectionner cette page</label>}
      {!!selected.length&&<div className="flex flex-wrap gap-2 items-center bg-teal-900 text-white rounded-xl p-3"><strong className="mr-auto text-sm">{selected.length} sélectionnée(s)</strong><button disabled={busy} className={buttonClass+' !text-slate-800'} onClick={()=>setParcelLines(selectedLines)}>Associer un colis</button><button disabled={busy} className={buttonClass+' !text-slate-800'} onClick={()=>{setBatch('order_ref');setBatchValue('');setConfirmed(false)}}>Même commande Shein</button>{batchTarget&&<button disabled={busy} className={buttonClass+' !text-slate-800'} onClick={()=>{setBatch('advance');setBatchValue(batchTarget);setConfirmed(false)}}>{STAGES.find(s=>s.id===batchTarget)?.label} →</button>}<button className="px-2 text-sm" onClick={()=>setSelected([])}>Annuler</button></div>}
      <div className="sales-list border rounded-2xl bg-white overflow-hidden"><table className="w-full text-sm text-left"><thead className="bg-slate-50 text-slate-500 text-xs"><tr>{['Article vendu','Achat sur Shein','Prochaine action'].map(t=><th key={t} className="p-4 font-medium">{t}</th>)}</tr></thead><tbody>
        {visible.map(line=>{const due=deadline(line),stage=stageOf(line),supplier=supplierOf(line,data.catalog),product=productOf(line,data.catalog),action=nextSaleAction(line,data.catalog);return <tr key={line.id} className="border-t align-top">
          <td className="p-4 lg:w-[44%]"><div className="flex gap-3">{selecting&&<input type="checkbox" aria-label={'Sélectionner '+(line.source.title||'cet article')} className="self-start mt-1" disabled={busy||blocked(line)||!nextStage(line)} checked={selected.includes(line.id)} onChange={e=>setSelected(old=>e.target.checked?[...old,line.id]:old.filter(id=>id!==line.id))}/>}{(line.source.thumbnail_url||product?.photo_url)&&<img src={line.source.thumbnail_url||product.photo_url} alt="" className="w-16 h-20 rounded-lg object-cover shrink-0" loading="lazy"/>}<div className="min-w-0 flex-1"><h2 className="font-semibold leading-relaxed">{line.source.title||'Article sans titre'}</h2><p className="text-sm mt-1"><strong>{money(line.source.selling_price,line.order.currency)}</strong><span className="text-slate-500"> · {line.order.account_login||'Compte inconnu'}</span></p>
            {skuEditing?.id===line.id?<form className="mt-3 space-y-2 max-w-sm" aria-label={'SKU de '+(line.source.title||'cet article')} onSubmit={e=>{e.preventDefault();run(saveSku)}} onKeyDown={e=>{if(e.key==='Escape'&&!busy){setSkuEditing(null);setError('')}}}>
              <label className="block text-xs text-slate-600">SKU Shein<input autoFocus required disabled={busy} autoCapitalize="none" autoCorrect="off" spellCheck={false} maxLength={200} placeholder="Colle le SKU ici" className={input+' mt-1'} value={skuEditing.sku} onPaste={pasteSku} onChange={e=>setSkuEditing({...skuEditing,sku:e.target.value})}/></label>
              <p className="text-xs text-slate-500">{busy?'Enregistrement…':'Colle le SKU : il s’enregistre automatiquement. Ou saisis-le puis appuie sur Entrée.'}</p>{error&&<p role="alert" className="text-xs text-red-700">{error}</p>}
              <div className="flex gap-2"><button disabled={busy||!skuEditing.sku.trim()} className={primaryClass}>Enregistrer</button><button type="button" disabled={busy} onClick={()=>{setSkuEditing(null);setError('')}} className="text-xs px-2 py-2">Annuler</button></div>
            </form>:skuOf(line)?<button disabled={busy||blocked(line)} onClick={()=>editSku(line)} title="Modifier le SKU" className="text-xs text-slate-500 mt-2 break-all text-left hover:text-teal-800 underline decoration-dotted underline-offset-4">SKU : {skuOf(line)}</button>:stage!=='to_order'&&!blocked(line)&&<button disabled={busy} onClick={()=>editSku(line)} className="text-xs text-teal-700 underline mt-2">Ajouter le SKU Shein</button>}
          </div></div></td>
          <td className="p-4 lg:w-[28%]"><p className="font-medium">{line.supplier_size?'Taille '+line.supplier_size:'Taille à préciser'}{line.supplier_color?' · '+line.supplier_color:''}</p>
            {product?.price!=null&&<p className="mt-1"><strong>{money(product.price,product.currency)}</strong><span className="text-xs text-slate-500"> · prix relevé, hors coupons</span></p>}
            {supplier&&<a className="inline-block text-teal-800 underline underline-offset-4 mt-2" href={supplier} target="_blank" rel="noreferrer">Voir sur Shein ↗</a>}
            {skuOf(line)&&(product?.price==null||['failed','blocked','queued','running'].includes(product?.retrieval_status))&&<SheinStatus sku={skuOf(line)} product={product}/>}
            {!skuOf(line)&&<p className="text-xs text-slate-500 mt-2">La fiche sera recherchée après l’ajout du SKU.</p>}
            {line.supplier_order_ref&&<p className="text-xs text-slate-500 mt-3 break-all">Commande : {line.supplier_order_ref}</p>}
          </td>
          <td className="p-4"><div className="flex flex-col items-start gap-2"><span className={'rounded-full px-2.5 py-1 text-xs '+(blocked(line)?'bg-amber-50 text-amber-800':'bg-slate-100 text-slate-600')}>{blocked(line)?ORDER_LABELS[line.order.status]||'Statut à vérifier':STAGES.find(s=>s.id===stage)?.label}</span>
            {due&&<p className={'text-xs '+(due.urgent?'text-red-700 font-medium':'text-slate-500')}>Envoi Vinted : {due.text.toLowerCase()}</p>}
            {action&&skuEditing?.id!==line.id&&<button disabled={busy} onClick={()=>action.kind==='sku'?editSku(line):action.kind==='details'?edit(line):action.kind==='order'?(setError(''),setPurchaseReference(''),setPurchaseLine(line)):run(()=>advance(line))} className={primaryClass}>{action.label}</button>}
            {action?.kind!=='details'&&<button disabled={busy} onClick={()=>edit(line)} className="text-sm text-slate-600 underline underline-offset-4 py-1">Voir les détails</button>}
            {line.order.label_url&&<a href={line.order.label_url} target="_blank" rel="noreferrer" className="text-xs text-teal-800 underline py-1">Bordereau Vinted ↗</a>}
          </div></td>
        </tr>})}
        {!visible.length&&<tr><td colSpan="3" className="text-center px-4 py-16 text-slate-500">{busy?'Chargement…':search||filter!=='all'||activeFilters?'Aucune vente ne correspond à ces filtres.':data.automation?.enabled?'Tes prochaines ventes apparaîtront ici automatiquement.':'Aucune vente importée. Ouvre les réglages pour synchroniser Dotb.'}</td></tr>}
      </tbody></table></div>
      {data.count>50||page>0?<Pagination page={page} count={data.count} onChange={setPage} busy={busy}/>:<p className="text-xs text-slate-500">{data.count} vente{data.count>1?'s':''}</p>}
    </section>
    </>}
    {purchaseLine&&<ResourceDialog title="Commande Shein passée" busy={busy} onClose={()=>{setPurchaseLine(null);setError('');run(()=>load(true))}}><form className="space-y-4" onSubmit={e=>{e.preventDefault();run(async()=>{await confirmPurchase(request,purchaseLine,purchaseReference);setPurchaseLine(null);await load(true);setNotice('Commande enregistrée. La vente est maintenant dans « Commandé ».')})}}><p className="text-sm font-medium">{purchaseLine.source.title}</p><p className="text-sm text-slate-500">Colle le numéro de la commande que tu viens de passer sur Shein.</p><label className="block text-sm">Numéro de commande Shein<input autoFocus required maxLength={200} disabled={busy} className={fieldClass+' mt-2'} value={purchaseReference} onChange={e=>setPurchaseReference(e.target.value)}/></label><ErrorNotice error={error}/><button className={primaryClass} disabled={busy||!purchaseReference.trim()}>{busy?'Enregistrement…':'Confirmer l’achat'}</button></form></ResourceDialog>}
    {parcelLines&&<ShipmentForm lines={parcelLines} request={request} onClose={()=>setParcelLines(null)} onSaved={async()=>{setParcelLines(null);setSelected([]);await load(true);setShowShipments(true);setNotice('Colis associé. Tous ses articles sont regroupés ci-dessous.')}}/>}
    {editing&&<SaleDetails key={editing.id+editing.updated_at} value={editing} onChange={setEditing} product={detailCatalog.find(p=>p.sku===editing.sku)} isAdmin={isAdmin} busy={busy} error={error} notice={detailNotice} onParcel={()=>{setParcelLines([editing]);setEditing(null)}} onShipments={()=>{setEditing(null);setShowShipments(true)}} onPreparePhoto={isAdmin&&onPreparePhoto?()=>{const line=editing;setEditing(null);onPreparePhoto({type:'sale',id:line.id,title:line.source.title,photo_url:line.source.thumbnail_url,account_login:line.order.account_login,sku:skuOf(line)})}:undefined} onClose={()=>{setEditing(null);setError('')}} onRefresh={()=>run(()=>openDetail(editing.id))} onRetry={()=>run(retryDetail)} onAdvance={()=>run(advanceDetail)} onSave={()=>run(async()=>{await request('PATCH',{...editing,action:'edit'});setEditing(null);await load(true);setNotice('Vente enregistrée. Les tailles, couleurs et coûts sont conservés pour cet article.');})}/>}
    {batch&&<ResourceDialog title={batch==='order_ref'?'Associer une commande Shein':'Confirmer la préparation'} busy={busy} onClose={()=>setBatch(null)}><form className="space-y-4" onSubmit={e=>{e.preventDefault();run(async()=>{await request('PATCH',{action:'batch',operation:batch,value:batchValue,lines:selectedLines.map(l=>({id:l.id,updated_at:l.updated_at}))});setBatch(null);setSelected([]);await load(true);setNotice('Les ventes sélectionnées ont été mises à jour ensemble.')})}}><p className="text-sm">{selectedLines.length} vente(s). L’ensemble est enregistré uniquement si toutes sont encore à jour.</p>{batch==='order_ref'?<label className="block text-sm">Numéro de commande Shein<input required maxLength={200} className={fieldClass+' mt-2'} value={batchValue} onChange={e=>setBatchValue(e.target.value)}/></label>:<><p className="font-semibold">Nouvelle étape : {STAGES.find(s=>s.id===batchValue)?.label}</p><label className="flex items-start gap-2 text-sm"><input type="checkbox" required checked={confirmed} onChange={e=>setConfirmed(e.target.checked)}/>{batchValue==='shipped'?'Je confirme que les colis ont été déposés auprès du transporteur.':'Je confirme que cette étape a été réalisée pour tous les articles sélectionnés.'}</label></>}<ErrorNotice error={error}/><button className={primaryClass} disabled={busy||!selectedLines.length}>{busy?'Enregistrement…':'Enregistrer'}</button></form></ResourceDialog>}
  </main>
}
