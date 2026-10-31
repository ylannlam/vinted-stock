import { useEffect, useRef, useState } from 'react'
import { availabilityLabels, isStale, missingProductFields, observationChange, sheinProduct, sheinSearchUrl, variantLabel } from '../lib/catalog'
import { safeUrl } from '../lib/fulfillment'
import CollectionManager from './CollectionManager'
import TrackingPeriod from './TrackingPeriod'
import CatalogueClassification from './CatalogueClassification'
import CatalogueLibrary, {BestSellerList,ProductDetails} from './CatalogueLibrary'
const defaultRequest = (...args) => import('../lib/api').then(m => m.catalogRequest(...args))
const defaultCollectorRequest = (...args) => import('../lib/api').then(m => m.collectorRequest(...args))
const input = 'w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-teal-600 bg-white'
const button = 'border border-gray-200 rounded-lg px-3 py-2 text-sm bg-white hover:bg-gray-50 disabled:opacity-40'
const primary = 'rounded-lg px-4 py-2 text-sm font-medium bg-teal-700 text-white hover:bg-teal-800 disabled:opacity-40'
const money = value => value == null ? 'Non relevé' : new Intl.NumberFormat('fr-FR',{style:'currency',currency:'EUR'}).format(Number(value))
const date = value => value ? new Date(value).toLocaleString('fr-FR',{dateStyle:'short',timeStyle:'short'}) : 'Aucun relevé'

function Dialog({ title, close, busy, children }) {
  const ref = useRef(null)
  useEffect(() => {
    const previous = document.activeElement, overflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    ref.current?.querySelector('input,button,select')?.focus()
    return () => { document.body.style.overflow = overflow; previous?.focus() }
  }, [])
  function keys(e) {
    if (e.key==='Escape' && !busy) close()
    if (e.key!=='Tab') return
    const nodes=[...ref.current.querySelectorAll('button:not(:disabled),input:not(:disabled),select:not(:disabled),textarea:not(:disabled),a[href]')]
    if (!nodes.length) {e.preventDefault();return}
    if(e.shiftKey && document.activeElement===nodes[0]) {e.preventDefault();nodes.at(-1).focus()}
    if(!e.shiftKey && document.activeElement===nodes.at(-1)) {e.preventDefault();nodes[0].focus()}
  }
  return <div className="fixed inset-0 z-50 bg-slate-900/40 overflow-y-auto p-3 sm:p-6" onKeyDown={keys}>
    <section ref={ref} role="dialog" aria-modal="true" aria-label={title} className="mx-auto my-4 max-w-3xl rounded-2xl bg-white p-5 sm:p-6 shadow-xl space-y-4">
      <div className="flex items-center justify-between gap-4"><h2 className="font-semibold text-lg">{title}</h2><button type="button" onClick={close} disabled={busy} className={button}>Fermer</button></div>{children}
    </section>
  </div>
}

function Photo({url}) {return safeUrl(url) ? <img className="w-14 h-16 rounded-lg object-cover bg-gray-100 shrink-0" src={url} alt="" referrerPolicy="no-referrer" loading="lazy" onError={e=>{e.currentTarget.style.visibility='hidden'}}/> : <div className="w-14 h-16 rounded-lg bg-gray-100 grid place-items-center text-gray-400 shrink-0" aria-hidden="true">◇</div>}
function Delta({product}) {
  const delta=observationChange(product)
  return <span className={`text-xs ${delta?.amount>0?'text-rose-700':delta?.amount<0?'text-teal-700':'text-gray-500'}`}>{delta ? delta.amount===0 ? 'Prix stable · même variante' : `${delta.amount>0?'+':''}${money(delta.amount)} · même variante` : 'Pas encore de comparaison'}</span>
}

function SkuRow({group,data,isAdmin,busy,onLink,onHistory}) {
  const link=data.links.find(l=>l.sku===group.sku),product=data.products.find(p=>p.id===link?.product_id)
  const first=group.items[0],supplier=group.items.map(i=>sheinProduct(i.supplier_url)).find(Boolean)
  const sourceUrl=product?.supplier_url||supplier?.supplier_url
  const searchUrl=sheinSearchUrl(group.sku)
  const states=group.items.map(i=>i.supplier_link_status)
  const issue=states.includes('invalid')?'Le format du lien reçu est invalide.':states.includes('unrecognized')?'Le lien reçu ne désigne pas une fiche Shein complète.':!supplier?'Le lien fournisseur n’a pas été récupéré.':'Les liens de ce SKU sont à vérifier.'
  return <tr className="border-t">
    <td className="p-4"><div className="flex gap-3 items-center"><Photo url={first.photo_url}/><div><p className="font-semibold font-mono">{group.sku}</p><p className="text-xs text-gray-500 max-w-md mt-1">{first.title||'Article sans titre'}</p>{searchUrl&&<a className="inline-block mt-2 text-xs text-teal-700 underline" href={searchUrl} target="_blank" rel="noreferrer">Rechercher ce SKU sur Shein ↗</a>}</div></div></td>
    <td className="p-4">{group.items.length}</td>
    <td className="p-4"><p className="max-w-sm text-xs">{product?.title||'À associer'}</p>{sourceUrl?<a href={sourceUrl} target="_blank" rel="noreferrer" className="text-xs underline text-teal-700">Ouvrir la fiche Shein ↗</a>:<p className="text-xs text-amber-800 max-w-xs mt-1">{issue} Ajoute le lien ici pour créer la fiche.</p>}</td>
    <td className="p-4"><div className="flex flex-wrap gap-2">{isAdmin&&<><button disabled={busy} className={button} onClick={()=>onLink(group,'url')}>{product?'Modifier le lien':'Ajouter le lien Shein'}</button>{!product&&data.products.length>0&&<button disabled={busy} className={button} onClick={()=>onLink(group,'existing')}>Associer une fiche existante</button>}</>}{product&&<button disabled={busy} className="text-xs text-teal-700 underline" onClick={()=>onHistory(product)}>Historique</button>}</div></td>
  </tr>
}

export default function CatalogueTab({isAdmin,request=defaultRequest,collectorRequest=defaultCollectorRequest,collectorBridge}) {
  const [data,setData]=useState({products:[],items:[],links:[],sales:[],review_items:[]}), [tab,setTab]=useState('products')
  const [search,setSearch]=useState(''), [filter,setFilter]=useState('all'), [page,setPage]=useState(0)
  const [busy,setBusy]=useState(false), [error,setError]=useState(''), [notice,setNotice]=useState('')
  const [editing,setEditing]=useState(null),[linking,setLinking]=useState(null),[history,setHistory]=useState(null)
  const [historyFilter,setHistoryFilter]=useState('all')
  const [details,setDetails]=useState(null)
  const alive=useRef(true),operation=useRef(false)
  const groups=[...data.items.reduce((map,item)=>{
    if (!item.sku) return map
    if(!map.has(item.sku))map.set(item.sku,{sku:item.sku,items:[]})
    map.get(item.sku).items.push(item);return map
  },new Map()).values()]
  async function load() {
    const first=await request(), products=[...first.products],items=[...first.items],links=[...first.links],sales=[...(first.sales||[])],review_items=[...(first.review_items||[])]
    for(let offset=250;offset<Math.max(first.product_count,first.item_count,first.link_count,first.sales_count||0,first.review_count||0);offset+=250) {
      if(!alive.current)return
      const next=await request('GET',undefined,`?offset=${offset}`)
      products.push(...next.products);items.push(...next.items);links.push(...next.links);sales.push(...(next.sales||[]));review_items.push(...(next.review_items||[]))
    }
    if(alive.current)setData({...first,products,items,links,sales,review_items})
  }
  async function run(action) {
    if(operation.current)return
    operation.current=true;setBusy(true);setError('')
    try {await action()} catch(e) {if(alive.current)setError(e.message)}
    finally {operation.current=false;if(alive.current)setBusy(false)}
  }
  function draft(values={},sku='') {
    const fields=['supplier_url','title','supplier_sku','photo_url','price','size','color','availability','observed_at','note','capture_id']
    const clean=Object.fromEntries(fields.filter(k=>typeof values[k]==='string'||(k==='price'&&typeof values[k]==='number')).map(k=>[k,values[k]]))
    setError('');setHistory(null)
    setEditing({supplier_url:'',title:'',supplier_sku:'',photo_url:'',price:'',currency:'EUR',size:'',color:'',availability:'unknown',note:'',
      observed_at:new Date().toISOString(),capture_id:crypto.randomUUID(),...clean,
      source:values.source==='extension_reviewed'?'extension_reviewed':'manual',confirmed:false,sku})
  }
  useEffect(()=>{
    alive.current=true
    run(load)
    const imported=sessionStorage.getItem('shein-import-draft'), importError=sessionStorage.getItem('shein-import-error')
    if(isAdmin && imported) {try{draft(JSON.parse(imported))}catch{setError('Import illisible. Rouvrez la fiche depuis l’extension.')}}
    if(importError) {setError(importError);sessionStorage.removeItem('shein-import-error')}
    return()=>{alive.current=false}
  },[])
  useEffect(()=>setPage(0),[tab,search,filter])
  async function sync() {
    let result
    try {
      for(let n=0;n<20 && alive.current;n++) {
        result=await request('POST',{action:'sync'})
        if(!alive.current)return
        setNotice(`${result.processed} articles Dotb lus…`)
        if(!result.has_more)break
        await new Promise(resolve=>setTimeout(resolve,1800))
      }
    } finally {if(alive.current)await load()}
    if(alive.current)setNotice(result?.has_more?'Import enregistré. Cliquez sur « Reprendre l’import » pour continuer.':'Import Dotb terminé. Les associations et les relevés existants sont conservés.')
  }
  async function saveObservation() {
    const saved=await request('POST',{...editing,action:'observe'})
    if(editing.sku) {
      const existing=data.links.find(l=>l.sku===editing.sku)
      try {await request('PATCH',{action:'link',sku:editing.sku,product_id:saved.product_id,updated_at:existing?.updated_at||null})}
      catch(e){await load();throw Error(`Le relevé est enregistré, mais l’association reste à faire : ${e.message}`)}
    }
    sessionStorage.removeItem('shein-import-draft');setEditing(null);setNotice('Relevé enregistré.');await load()
  }
  function closeDraft(){setEditing(null);sessionStorage.removeItem('shein-import-draft')}
  async function showHistory(product) {
    const result=await request('GET',undefined,`?product_id=${product.id}`)
    setHistory({product,...result});setHistoryFilter('all')
  }
  function openLink(group,mode) {
    const old=data.links.find(l=>l.sku===group.sku),product=data.products.find(p=>p.id===old?.product_id)
    setError('');setLinking({mode,sku:group.sku,product_id:old?.product_id||'',updated_at:old?.updated_at||null,
      supplier_url:product?.supplier_url||group.items.find(i=>i.supplier_url)?.supplier_url||''})
  }
  async function saveLink() {
    if(linking.mode==='url')await request('POST',{action:'supplier',sku:linking.sku,supplier_url:linking.supplier_url,updated_at:linking.updated_at})
    else await request('PATCH',{action:'link',sku:linking.sku,product_id:linking.product_id||null,updated_at:linking.updated_at})
    setLinking(null);setNotice('Fiche Shein associée à ce SKU. Tu pourras ajouter les relevés de prix ensuite.');await load()
  }
  const term=search.trim().toLowerCase()
  const productView=['products','fluctuations'].includes(tab)
  const visibleProducts=data.products.filter(p=>(tab!=='fluctuations'||!!observationChange(p)?.amount)&&`${p.title} ${p.supplier_sku||''} ${p.supplier_id} ${data.links.filter(l=>l.product_id===p.id).map(l=>l.sku).join(' ')}`.toLowerCase().includes(term) &&
    (filter==='all'||filter==='review'&&(isStale(p)||missingProductFields(p).length>0||['blocked','failed'].includes(p.collection_status)||(p.price_scope!=='product'&&p.availability==='unknown'))||filter==='up'&&observationChange(p)?.amount>0||filter==='down'&&observationChange(p)?.amount<0))
  const visibleGroups=groups.filter(g=>`${g.sku} ${g.items.map(i=>i.title).join(' ')}`.toLowerCase().includes(term))
  const visible=productView?visibleProducts:visibleGroups
  const pages=Math.max(1,Math.ceil(visible.length/20)),currentPage=Math.min(page,pages-1)
  const withoutSku=data.items.filter(i=>!i.sku).length
  const historyRows=history?.observations.filter(o=>historyFilter==='all'||JSON.stringify([o.size,o.color])===historyFilter)||[]
  return <main className="max-w-screen-2xl mx-auto p-4 sm:p-6 space-y-5 text-slate-800">
    <header className="flex flex-wrap justify-between items-center gap-4"><div><p className="text-xs font-semibold tracking-widest text-teal-700 uppercase mb-1">Sourcing & suivi</p><h1 className="text-2xl font-bold">Catalogue</h1><p className="text-sm text-gray-500 mt-1">Tes références Shein, reliées aux SKU de Dotb.</p></div>
      <div className="flex flex-wrap gap-2"><button className={button} disabled={busy} onClick={()=>run(load)}>Actualiser</button>{isAdmin&&<><button className={button} disabled={busy||!data.connected} onClick={()=>run(sync)}>{data.resume?'Reprendre l’import':'Importer les articles Dotb'}</button><button className={primary} disabled={busy} onClick={()=>draft()}>Saisie manuelle</button></>}</div>
    </header>
    <TrackingPeriod period={data.tracking}>Seuls les articles que tu as inclus sont suivis. Classe les nouveaux articles dans « Articles à classer ».</TrackingPeriod>
    {error&&!editing&&!linking&&<p role="alert" className="border border-red-200 bg-red-50 rounded-xl p-3 text-sm text-red-800">{error}</p>}
    {notice&&<p role="status" className="text-sm text-teal-800">{notice}</p>}
    <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">{[[data.products.length,'Produits suivis'],[groups.length,'SKU Dotb'],[data.links.filter(l=>l.product_id).length,'SKU associés'],[data.products.filter(p=>isStale(p)||missingProductFields(p).length>0||['blocked','failed'].includes(p.collection_status)||(p.price_scope!=='product'&&p.availability==='unknown')).length,'Produits à vérifier']].map(([n,label])=><div className="bg-white rounded-xl border p-4" key={label}><p className="text-2xl font-semibold">{n}</p><p className="text-xs text-gray-500 mt-1">{label}</p></div>)}</div>
    <div className="flex gap-1 border-b overflow-x-auto">{[['products','Bibliothèque'],['fluctuations','Fluctuations'],['bestsellers','Best sellers'],['sku','Annonces Dotb'],['classification',`Articles à classer (${data.review_items?.filter(i=>i.tracking_status==='unclassified').length||0})`],['collector','Récupération']].map(([key,label])=><button key={key} onClick={()=>{setTab(key);setSearch('');setFilter('all')}} aria-pressed={tab===key} className={`whitespace-nowrap px-3 py-3 text-sm border-b-2 ${tab===key?'border-teal-700 text-teal-800 font-semibold':'border-transparent text-gray-500'}`}>{label}</button>)}</div>
    <CollectionManager isAdmin={isAdmin} full={tab==='collector'} request={collectorRequest} bridge={collectorBridge} onCollected={()=>run(load)} onManage={()=>setTab('collector')}/>
    {tab==='classification'&&<CatalogueClassification items={data.review_items||[]} isAdmin={isAdmin} request={request} onSaved={load}/>}
    {!['collector','classification'].includes(tab)&&<>
      <div className="flex flex-wrap gap-3"><input aria-label="Rechercher dans le catalogue" value={search} onChange={e=>setSearch(e.target.value)} className={`${input} flex-1 min-w-48`} placeholder="Rechercher un produit ou un SKU…"/>{productView&&<select aria-label="Filtrer les produits" value={filter} onChange={e=>setFilter(e.target.value)} className={`${input} sm:!w-auto`}><option value="all">Tous les produits</option><option value="review">À vérifier</option><option value="up">Prix en hausse</option><option value="down">Prix en baisse</option></select>}</div>
      {tab==='fluctuations'&&<p className="text-sm text-gray-500">Variation entre deux prix de même portée et de même couleur. Les prix de fiche et ceux d’une taille précise restent comparés séparément.</p>}
      {tab==='sku'&&<p className="text-sm text-gray-500">Le même SKU relie tes annonces Dotb à une fiche Shein. {withoutSku>0&&`${withoutSku} articles importés n’ont pas encore de SKU.`}</p>}
      {productView?<>
        <CatalogueLibrary products={visibleProducts.slice(currentPage*20,(currentPage+1)*20)} data={data} busy={busy} isAdmin={isAdmin} onDetails={setDetails} onHistory={p=>run(()=>showHistory(p))} onRefresh={p=>run(async()=>{await collectorRequest('POST',{action:'enqueue',references:p.supplier_url});setNotice('Demande enregistrée. Son résultat apparaîtra dans le suivi des ajouts.');await load()})}/>
        {!visibleProducts.length&&<div className="rounded-xl border bg-white p-10 text-center text-gray-500 text-sm">{busy?'Chargement…':tab==='fluctuations'?'Les variations apparaîtront après deux récupérations comparables.':'Ajoute tes SKU ou liens Shein, ou importe tes articles Dotb.'}</div>}
      </>:tab==='bestsellers'?<BestSellerList data={data} search={search} onDetails={setDetails}/>:<div className="rounded-xl border bg-white overflow-x-auto"><table className="w-full text-left text-sm"><thead className="bg-gray-50 text-gray-500 text-xs"><tr>{['SKU / article Dotb','Annonces','Fiche Shein associée','Actions'].map(t=><th key={t} className="p-4 font-medium">{t}</th>)}</tr></thead><tbody>{visibleGroups.slice(currentPage*20,(currentPage+1)*20).map(g=><SkuRow key={g.sku} group={g} data={data} isAdmin={isAdmin} busy={busy} onLink={openLink} onHistory={p=>run(()=>showHistory(p))}/>)}{!visibleGroups.length&&<tr><td colSpan="4" className="p-10 text-center text-gray-500">Aucun SKU correspondant. Importe les articles après avoir enregistré leurs SKU dans Dotb.</td></tr>}</tbody></table></div>}
      {tab!=='bestsellers'&&<div className="flex justify-between items-center text-xs text-gray-500"><span>{visible.length} {productView?'produits':'SKU'} · Page {currentPage+1}/{pages}</span><div className="flex gap-2"><button className={button} disabled={!currentPage} onClick={()=>setPage(currentPage-1)}>Précédente</button><button className={button} disabled={currentPage+1>=pages} onClick={()=>setPage(currentPage+1)}>Suivante</button></div></div>}
      <p className="text-xs text-gray-500">Dernier import Dotb : {data.last_sync?date(data.last_sync):'aucun'}. Les prix Shein sont datés, propres à la session du navigateur et hors coupons du panier.</p>
    </>}
    {details&&<Dialog title={details.title} close={()=>setDetails(null)} busy={busy}><ProductDetails product={details} items={data.items.filter(i=>data.links.some(l=>l.sku===i.sku&&l.product_id===details.id))}/></Dialog>}
    {editing&&<Dialog title="Vérifier le relevé Shein" close={closeDraft} busy={busy}><form onSubmit={e=>{e.preventDefault();run(saveObservation)}} className="space-y-4">
      <p className="text-sm text-gray-500">Vérifie la fiche ouverte sur Shein. Un prix illisible reste vide ; il ne devient jamais zéro.</p>
      <div className="grid sm:grid-cols-2 gap-3">{[['supplier_url','Lien complet de la fiche Shein',2000],['title','Nom du produit',500],['supplier_sku','SKU affiché sur Shein',200],['price','Prix affiché (€)',30],['size','Taille observée',80],['color','Couleur observée',100]].map(([key,label,max])=><label key={key} className="text-xs text-gray-600">{label}<input className={`${input} mt-1`} required={['title','supplier_url'].includes(key)} inputMode={key==='price'?'decimal':undefined} maxLength={max} value={editing[key]} onChange={e=>setEditing({...editing,[key]:e.target.value,confirmed:false})}/></label>)}
        <label className="text-xs text-gray-600">Disponibilité de cette taille/couleur<select className={`${input} mt-1`} value={editing.availability} onChange={e=>setEditing({...editing,availability:e.target.value,confirmed:false})}>{Object.entries(availabilityLabels).map(([key,label])=><option key={key} value={key}>{label}</option>)}</select></label>
        <label className="text-xs text-gray-600">Associer au SKU Dotb<select className={`${input} mt-1`} value={editing.sku} onChange={e=>setEditing({...editing,sku:e.target.value,confirmed:false})}><option value="">Sans association pour l’instant</option>{groups.map(g=><option key={g.sku} value={g.sku}>{g.sku}</option>)}</select></label>
      </div>
      {editing.sku&&<p className="text-xs text-teal-800 bg-teal-50 p-3 rounded-lg">Cette fiche sera associée à toutes les annonces portant le SKU {editing.sku}. La taille et la couleur concernent seulement ce relevé.</p>}
      <label className="block text-xs text-gray-600">Note (facultative)<textarea className={`${input} mt-1`} maxLength={500} value={editing.note} onChange={e=>setEditing({...editing,note:e.target.value})}/></label>
      <p className="text-xs text-gray-500">Relevé du {date(editing.observed_at)} · {editing.source==='extension_reviewed'?'Préparé par l’extension':'Saisie manuelle'} · Prix en euros uniquement.</p>
      <label className="flex gap-3 items-start text-sm"><input className="mt-1 accent-teal-700" type="checkbox" required checked={editing.confirmed} onChange={e=>setEditing({...editing,confirmed:e.target.checked})}/>J’ai vérifié le produit, la devise, le prix et les informations de variante sur Shein.</label>
      {error&&<p role="alert" className="text-sm text-red-700">{error}</p>}<button disabled={busy||!editing.confirmed} className={primary}>{busy?'Enregistrement…':'Enregistrer le relevé'}</button>
    </form></Dialog>}
    {linking&&<Dialog title={`Fiche Shein du SKU ${linking.sku}`} close={()=>setLinking(null)} busy={busy}>
      <form className="space-y-4" onSubmit={e=>{e.preventDefault();run(saveLink)}}>
        <p className="text-sm text-gray-500">La fiche sera partagée avec toutes les annonces de ce SKU. Aucun prix ni disponibilité n’est inventé.</p>
        {linking.mode==='url'?<>
          {sheinSearchUrl(linking.sku)&&<a className="inline-block text-sm text-teal-700 underline" href={sheinSearchUrl(linking.sku)} target="_blank" rel="noreferrer">Retrouver ce SKU sur Shein ↗</a>}
          <label className="block text-sm">Lien complet du produit Shein<input autoFocus required className={`${input} mt-2`} maxLength={6000} placeholder="https://fr.shein.com/…-p-123456.html" value={linking.supplier_url} onChange={e=>setLinking({...linking,supplier_url:e.target.value})}/></label>
          <p className="text-xs text-gray-500">Ouvre le résultat correspondant au SKU puis copie son adresse. Il n’est pas nécessaire de saisir un prix pour créer la fiche.</p>
        </>:<label className="block text-sm">Fiche Shein<select className={`${input} mt-2`} value={linking.product_id} onChange={e=>setLinking({...linking,product_id:e.target.value})}><option value="">Aucune association</option>{data.products.map(p=><option key={p.id} value={p.id}>{p.title} · {p.supplier_sku||p.supplier_id}</option>)}</select></label>}
        {error&&<p role="alert" className="text-sm text-red-700">{error}</p>}
        <button className={primary} disabled={busy}>{linking.mode==='url'?'Enregistrer la fiche et son lien':'Enregistrer l’association'}</button>
        {linking.mode==='url'&&data.products.length>0&&<button className={`${button} ml-2`} type="button" disabled={busy} onClick={()=>setLinking({...linking,mode:'existing'})}>Choisir une fiche existante</button>}
      </form>
    </Dialog>}
    {history&&<Dialog title="Historique des relevés" close={()=>setHistory(null)} busy={busy}><p className="font-medium">{history.product.title}</p><select aria-label="Variante de l’historique" className={input} value={historyFilter} onChange={e=>setHistoryFilter(e.target.value)}><option value="all">Toutes les variantes</option>{[...new Map(history.observations.map(o=>[JSON.stringify([o.size,o.color]),variantLabel(o)])).entries()].map(([key,label])=><option key={key} value={key}>{label}</option>)}</select><div className="overflow-x-auto"><table className="w-full text-sm text-left"><thead><tr>{['Date','Variante','Prix','Disponibilité'].map(t=><th key={t} className="py-3 pr-4 text-xs text-gray-500">{t}</th>)}</tr></thead><tbody>{historyRows.map(o=><tr key={o.id} className="border-t"><td className="py-3 pr-4 whitespace-nowrap text-xs">{date(o.observed_at)}</td><td className="py-3 pr-4 text-xs">{variantLabel(o)}{o.note&&<p className="text-gray-500 mt-1">{o.note}</p>}</td><td className="py-3 pr-4 whitespace-nowrap">{money(o.price)}</td><td className="py-3 text-xs">{availabilityLabels[o.availability]}</td></tr>)}</tbody></table>{!historyRows.length&&<p className="py-8 text-center text-gray-500">Aucun relevé pour cette variante.</p>}</div><p className="text-xs text-gray-500">{history.observations.length} relevés récents affichés sur {history.count}. Les montants de variantes différentes ne sont pas comparés entre eux.</p>{isAdmin&&<button className={primary} onClick={()=>draft({supplier_url:history.product.supplier_url,title:history.product.title,supplier_sku:history.product.supplier_sku,photo_url:history.product.photo_url})}>Nouveau relevé</button>}</Dialog>}
  </main>
}
