import {observationChange} from '../lib/catalog'
import {collectionLabels} from '../lib/collector'
import {safeUrl,money} from '../lib/fulfillment'
const date=value=>value?new Date(value).toLocaleString('fr-FR',{dateStyle:'short',timeStyle:'short'}):'Pas encore vérifié'
const button='rounded-lg border px-3 py-2 text-sm bg-white hover:bg-gray-50 disabled:opacity-40'
export function ProductDetails({product,items}) {
  return <div className="space-y-4">
    <div className="grid grid-cols-3 sm:grid-cols-5 gap-2">{(product.photos?.length?product.photos:[product.photo_url]).filter(safeUrl).map(url=><a key={url} href={url} target="_blank" rel="noreferrer"><img src={url} className="w-full aspect-[3/4] rounded-lg object-cover" alt={product.title} referrerPolicy="no-referrer"/></a>)}</div>
    <p className="text-sm font-mono break-all">{product.supplier_sku||'SKU non récupéré'}</p>
    <div className="bg-slate-50 p-4 rounded-xl"><p className="text-sm">Prix affiché sur Shein : <strong>{product.price==null?'À récupérer':money(product.price)}</strong></p><p className="text-xs text-gray-500 mt-1">{date(product.observed_at)} · {product.color||'Couleur non précisée'}{product.price_scope==='product'?' · avant sélection de taille, hors coupons':''}</p></div>
    <div><h3 className="font-semibold text-sm mb-2">Tailles proposées pour cette couleur</h3><div className="flex flex-wrap gap-2">{product.sizes?.map(s=><span key={s.size} className={`rounded-lg border px-3 py-1 text-sm ${s.availability==='unavailable'?'text-gray-400 line-through':'text-teal-800 bg-teal-50'}`}>{s.size}{s.availability==='unknown'?' · à vérifier':''}</span>)}</div>{!product.sizes?.length&&<p className="text-sm text-gray-500">Pas encore récupérées.</p>}</div>
    {product.description&&<div><h3 className="font-semibold text-sm mb-2">Description Shein</h3><p className="text-sm whitespace-pre-wrap text-gray-600">{product.description}</p></div>}
    <div><h3 className="font-semibold text-sm mb-2">Mesures et détails</h3>{product.details?.length?<dl className="text-sm divide-y">{product.details.map((d,i)=><div key={i} className="py-2"><dt className="text-gray-500">{d.name}</dt><dd>{d.value}</dd></div>)}</dl>:<p className="text-sm text-gray-500">Aucune mesure récupérée pour le moment. Consulte le guide des tailles sur Shein.</p>}</div>
    <div><h3 className="font-semibold text-sm mb-2">Annonces Dotb reliées · {items.length}</h3>{items.map(item=><div key={item.id} className="border-t py-2 text-sm"><p>{item.title}</p><p className="text-xs text-gray-500">{item.sku} · {item.status==='pending'?'En attente de publication':item.status==='imported'?'Importée depuis Vinted':item.status||'Statut inconnu'} · {money(item.price,item.currency||'EUR')}</p></div>)}{!items.length&&<p className="text-sm text-gray-500">Aucune annonce importée portant ce SKU.</p>}</div>
    <a className="text-sm text-teal-700 underline" href={product.supplier_url} target="_blank" rel="noreferrer">Ouvrir la fiche Shein ↗</a>
  </div>
}
export default function CatalogueLibrary({products,data,busy,isAdmin,onDetails,onHistory,onRefresh}) {
  return <div className="grid sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">{products.map(p=>{
    const delta=observationChange(p),skus=data.links.filter(l=>l.product_id===p.id).map(l=>l.sku)
    const listings=data.items.filter(i=>skus.includes(i.sku)),sales=(data.sales||[]).filter(s=>skus.includes(s.sku)||s.sku===p.supplier_sku).reduce((n,s)=>n+Number(s.quantity),0)
    return <article key={p.id} className="rounded-2xl border bg-white overflow-hidden flex flex-col">
      <button onClick={()=>onDetails(p)} className="bg-slate-100 text-left" aria-label={`Voir ${p.title}`}>{safeUrl(p.photo_url)?<img src={p.photo_url} alt={p.title} className="w-full aspect-[4/3] object-cover" referrerPolicy="no-referrer" loading="lazy"/>:<div className="w-full aspect-[4/3] grid place-items-center text-gray-400 text-sm">Photos à récupérer</div>}</button>
      <div className="p-4 flex-1 flex flex-col gap-3"><div><h2 className="font-semibold text-sm line-clamp-2">{p.title}</h2><p className="text-xs font-mono text-gray-500 break-all mt-1">{p.supplier_sku||skus.join(' · ')||`Shein ${p.supplier_id}`}</p></div>
        <div><p className="text-xl font-semibold">{p.price==null?'Prix à récupérer':money(p.price)}</p>{delta&&<p className={`text-xs mt-1 ${delta.amount>0?'text-rose-700':'text-teal-700'}`}>{delta.amount>0?'▲ +':delta.amount<0?'▼ ':''}{money(delta.amount)} · {Math.abs(delta.percent).toFixed(1)} % <span className="text-gray-400">(avant {money(p.previous_price)})</span></p>}<p className="text-xs text-gray-500 mt-1">{p.color||'Couleur à récupérer'}{p.price_scope==='product'?' · prix de la fiche':p.size?` · ${p.size}`:''}</p></div>
        <div className="flex flex-wrap gap-1">{p.sizes?.map(s=><span key={s.size} className={`text-xs px-2 py-1 rounded border ${s.availability==='unavailable'?'line-through text-gray-400':'bg-teal-50 text-teal-800'}`}>{s.size}</span>)}</div>
        <p className="text-xs text-gray-500">{listings.length} annonce(s) Dotb · {sales} vente(s) reliée(s)</p>
        <div className="text-xs text-gray-500 mt-auto"><p>{collectionLabels[p.collection_status]||'À récupérer'}</p><p>Vérifié : {date(p.last_checked_at||p.observed_at)}</p>{p.next_check_at&&<p>Prochaine vérification : {date(p.next_check_at)}</p>}{p.collection_message&&<p className="text-amber-800 mt-1">{p.collection_message}</p>}</div>
        <div className="flex flex-wrap gap-2"><button className={button} disabled={busy} onClick={()=>onDetails(p)}>Fiche</button><button className={button} disabled={busy} onClick={()=>onHistory(p)}>Historique</button>{isAdmin&&<button className="text-xs text-teal-700 underline" disabled={busy} onClick={()=>onRefresh(p)}>Récupérer maintenant</button>}</div>
      </div>
    </article>
  })}</div>
}

export function BestSellerList({data,search,onDetails}) {
  const rows=(data.sales||[]).filter(s=>s.sku.toLowerCase().includes(search.toLowerCase())).sort((a,b)=>Number(b.quantity)-Number(a.quantity))
  return <section className="rounded-xl border bg-white overflow-x-auto"><p className="p-4 text-sm text-gray-500">Les ventes importées sont regroupées par SKU. Les annulations et retours sont exclus. Les anciennes ventes sans SKU ne sont pas attribuées au hasard.</p><table className="w-full text-left text-sm"><thead className="bg-gray-50"><tr>{['Produit / SKU','Ventes','Chiffre d’affaires connu','Dernière vente'].map(h=><th key={h} className="p-4 font-medium">{h}</th>)}</tr></thead><tbody>{rows.map(s=>{const link=data.links.find(l=>l.sku===s.sku),p=data.products.find(p=>p.id===link?.product_id||p.supplier_sku===s.sku);return <tr key={`${s.sku}-${s.currency}`} className="border-t"><td className="p-4">{p?<button className="text-teal-700 underline text-left" onClick={()=>onDetails(p)}>{p.title}</button>:s.sku}<p className="font-mono text-xs text-gray-500 mt-1">{s.sku}</p></td><td className="p-4">{s.quantity}</td><td className="p-4">{s.currency?money(s.revenue,s.currency):'Devise non renseignée'}{Number(s.known_prices)<Number(s.quantity)&&<p className="text-xs text-amber-700">Montant incomplet</p>}</td><td className="p-4 text-xs">{date(s.last_sale)}</td></tr>})}</tbody></table>{!rows.length&&<p className="text-center text-sm text-gray-500 p-10">Aucune vente avec SKU importée pour cette recherche. Les prochaines ventes portant tes SKU alimenteront ce classement.</p>}</section>
}
