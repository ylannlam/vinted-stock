import {useState} from 'react'
import {bestSellers} from '../lib/library'
import ArticlePhotos from './ArticlePhotos'
import {observationChange,missingProductFields} from '../lib/catalog'
import {safeUrl,money} from '../lib/fulfillment'
const date=value=>value?new Date(value).toLocaleString('fr-FR',{dateStyle:'short',timeStyle:'short'}):'Pas encore vérifié'
const button='rounded-lg border px-3 py-2 text-sm bg-white hover:bg-gray-50 disabled:opacity-40'
export function ProductDetails({product,items,onPreparePhoto}) {
  return <div className="space-y-4">{onPreparePhoto&&<button className={button} onClick={onPreparePhoto}>Préparer les photos avec la DA d’un compte</button>}
    {!!missingProductFields(product).length&&<p className="text-sm text-amber-900 bg-amber-50 border border-amber-200 rounded-lg p-3">Non récupéré : {missingProductFields(product).join(', ')}. Ces informations restent à compléter.</p>}
    <div className="grid grid-cols-3 sm:grid-cols-5 gap-2">{(product.photos?.length?product.photos:[product.photo_url]).filter(safeUrl).map(url=><a key={url} href={url} target="_blank" rel="noreferrer"><img src={url} className="w-full aspect-[3/4] rounded-lg object-cover" alt={product.title} referrerPolicy="no-referrer"/></a>)}</div>
    <p className="text-sm font-mono break-all">{product.supplier_sku||'SKU non récupéré'}</p>
    <div className="bg-slate-50 p-4 rounded-xl"><p className="text-sm">Prix affiché sur Shein : <strong>{product.price==null?'À récupérer':money(product.price)}</strong></p><p className="text-xs text-gray-500 mt-1">{date(product.observed_at)} · {product.color||'Couleur non précisée'}{product.price_scope==='product'?' · avant sélection de taille, hors coupons':''}</p></div>
    <div><h3 className="font-semibold text-sm mb-2">Tailles proposées pour cette couleur</h3><div className="flex flex-wrap gap-2">{product.sizes?.map(s=><span key={s.size} className={`rounded-lg border px-3 py-1 text-sm ${s.availability==='unavailable'?'text-gray-400 line-through':'text-teal-800 bg-teal-50'}`}>{s.size}{s.availability==='unknown'?' · à vérifier':''}</span>)}</div>{!product.sizes?.length&&<p className="text-sm text-gray-500">Pas encore récupérées.</p>}</div>
    {product.description&&<div><h3 className="font-semibold text-sm mb-2">Description Shein</h3><p className="text-sm whitespace-pre-wrap text-gray-600">{product.description}</p></div>}
    <div><h3 className="font-semibold text-sm mb-2">Mesures et détails</h3>{product.details?.length?<dl className="text-sm divide-y">{product.details.map((d,i)=><div key={i} className="py-2"><dt className="text-gray-500">{d.name}</dt><dd>{d.value}</dd></div>)}</dl>:<p className="text-sm text-gray-500">Aucune mesure récupérée pour le moment. Consulte le guide des tailles sur Shein.</p>}</div>
    <div><h3 className="font-semibold text-sm mb-2">Ventes reliées · {items.length}</h3>{items.map(item=><div key={item.id} className="border-t py-2 text-sm"><p>{item.title}</p><p className="text-xs text-gray-500">{item.sku} · {item.status==='pending'?'En attente de publication':item.status==='imported'?'Importée depuis Vinted':item.status||'Statut inconnu'} · {money(item.price,item.currency||'EUR')}</p></div>)}{!items.length&&<p className="text-sm text-gray-500">Aucune vente portant ce SKU.</p>}</div>
    <a className="text-sm text-teal-700 underline" href={product.supplier_url} target="_blank" rel="noreferrer">Ouvrir la fiche Shein ↗</a>
  </div>
}
export default function CatalogueLibrary({products,data,busy,onDetails}) {
  return <div className="article-grid catalog-grid">{products.map(p=>{
    const delta=observationChange(p),skus=data.links.filter(l=>l.product_id===p.id).map(l=>l.sku)
    const sales=(data.sales||[]).filter(s=>skus.includes(s.sku)||s.sku===p.supplier_sku).reduce((n,s)=>n+Number(s.quantity),0)
    const incomplete=missingProductFields(p).length>0||['blocked','failed'].includes(p.collection_status)
    const photos=Array.isArray(p.photos)?p.photos:[]
    return <article key={p.id} className="catalog-card">
      <ArticlePhotos photos={[p.photo_url,...photos]} title={p.title} onOpen={()=>onDetails(p)} badge={incomplete?'À compléter':undefined}/>
      <div className="catalog-card-body">
        <div className="catalog-card-meta"><span>{p.color||'Produit Shein'}</span><span>{sales} vente{sales>1?'s':''}</span></div>
        <button className="article-title-button" onClick={()=>onDetails(p)}><h2 className="article-title">{p.title||'Article Shein'}</h2></button>
        <p className="catalog-sku">{p.supplier_sku||skus.join(' · ')||'Réf. '+p.supplier_id}</p>
        <div className="catalog-price-row"><div><span className="card-eyebrow">Prix Shein</span><strong className="catalog-price">{p.price==null?'À récupérer':money(p.price)}</strong></div>{delta&&delta.amount!==0&&<span className={'price-change '+(delta.amount>0?'is-up':'is-down')}>{delta.amount>0?'↗ +':'↘ '}{money(delta.amount)}</span>}</div>
        <div className="catalog-sizes" aria-label="Tailles proposées">{(p.sizes||[]).slice(0,8).map(s=><span key={s.size} title={s.availability==='unavailable'?'Indisponible':s.availability==='unknown'?'Disponibilité à vérifier':'Disponible'} className={s.availability==='unavailable'?'is-unavailable':s.availability==='unknown'?'is-unknown':''}>{s.size}</span>)}{p.sizes?.length>8&&<span>+{p.sizes.length-8}</span>}{!p.sizes?.length&&<span className="sizes-pending">Tailles à récupérer</span>}</div>
        <div className="catalog-card-footer"><button className="article-open-button" disabled={busy} onClick={()=>onDetails(p)}>Ouvrir la fiche <span aria-hidden="true">↗</span></button>{safeUrl(p.supplier_url)&&<a className="article-details-link" href={p.supplier_url} target="_blank" rel="noreferrer">Voir sur Shein</a>}</div>
      </div>
    </article>
  })}</div>
}

const PERIODS=[[7,'7 jours'],[30,'30 jours'],[90,'90 jours'],[null,'Depuis le début']]
const ago=ms=>{const d=Math.floor((Date.now()-ms)/86400000);return d<1?'aujourd’hui':d===1?'hier':`il y a ${d} j`}
export function BestSellerList({data,search,onDetails,onCreateListing}) {
  const [days,setDays]=useState(30)
  const all=bestSellers(data,{days}),q=search.trim().toLowerCase()
  const rows=all.filter(r=>!q||`${r.sku} ${r.title}`.toLowerCase().includes(q))
  return <section className="space-y-4">
    <div className="flex flex-wrap items-center justify-between gap-3"><p className="text-sm text-gray-500">Les SKU les plus vendus (annulations et retours exclus). Un clic sur « Reposter » prépare une annonce avec le SKU.</p>
      <div className="flex flex-wrap gap-1.5">{PERIODS.map(([d,label])=><button key={label} aria-pressed={days===d} onClick={()=>setDays(d)} className={`rounded-full px-3 py-1.5 text-xs font-medium ${days===d?'bg-teal-700 text-white':'border bg-white text-gray-600'}`}>{label}</button>)}</div></div>
    {rows.length?<div className="grid gap-3 grid-cols-2 sm:grid-cols-3 lg:grid-cols-5">{rows.slice(0,60).map((r,i)=><article key={r.sku} className="rounded-xl border bg-white overflow-hidden flex flex-col">
      <div className="relative aspect-[3/4] bg-stone-100">{safeUrl(r.photo)?<img src={safeUrl(r.photo)} alt="" loading="lazy" className="h-full w-full object-cover"/>:null}
        <span className="absolute left-2 top-2 rounded-full bg-white/95 px-2 py-0.5 text-xs font-bold">#{i+1}</span>
        <span className="absolute right-2 top-2 rounded-full bg-teal-700 px-2.5 py-0.5 text-xs font-semibold text-white">{r.count} vente{r.count>1?'s':''}</span></div>
      <div className="p-3 flex flex-col gap-1.5 flex-1"><p className="text-sm font-medium line-clamp-2">{r.title}</p><p className="font-mono text-[11px] text-gray-500 truncate">{r.sku}</p>
        <div className="flex flex-wrap gap-x-3 text-xs text-gray-600">{r.priced>0&&<span>{money(r.revenue,'EUR')}{r.priced<r.count?' (partiel)':''}</span>}{r.product?.price!=null&&<span>Shein {money(r.product.price,'EUR')}</span>}</div>
        <p className="text-[11px] text-gray-500">Dernière vente {ago(r.last)}</p>
        <div className="mt-auto flex gap-1.5 pt-1">{r.product&&<button className="flex-1 rounded-lg border px-2 py-1.5 text-xs bg-white hover:bg-gray-50" onClick={()=>onDetails(r.product)}>Fiche</button>}{onCreateListing&&<button className="flex-1 rounded-lg bg-teal-700 px-2 py-1.5 text-xs font-medium text-white hover:bg-teal-800" onClick={()=>onCreateListing(r.sku)}>Reposter</button>}</div></div>
    </article>)}</div>
    :<p className="rounded-xl border border-dashed bg-white p-10 text-center text-sm text-gray-500">{q?'Aucune vente pour cette recherche.':days?`Aucune vente avec SKU sur ${days} jours. Essaie une période plus longue.`:'Aucune vente avec SKU pour l’instant. Les prochaines ventes portant tes SKU alimenteront ce classement.'}</p>}
  </section>
}
