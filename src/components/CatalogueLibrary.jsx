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
  return <div className="grid sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-5">{products.map(p=>{
    const delta=observationChange(p),skus=data.links.filter(l=>l.product_id===p.id).map(l=>l.sku)
    const sales=(data.sales||[]).filter(s=>skus.includes(s.sku)||s.sku===p.supplier_sku).reduce((n,s)=>n+Number(s.quantity),0)
    const incomplete=missingProductFields(p).length>0||['blocked','failed'].includes(p.collection_status)
    return <article key={p.id} className="rounded-2xl border bg-white overflow-hidden flex flex-col">
      <button onClick={()=>onDetails(p)} className="bg-slate-100 text-left" aria-label={'Voir '+p.title}>{safeUrl(p.photo_url)?<img src={p.photo_url} alt={p.title} className="w-full aspect-[4/3] object-cover" referrerPolicy="no-referrer" loading="lazy"/>:<div className="w-full aspect-[4/3] grid place-items-center text-slate-400 text-sm">Photo à récupérer</div>}</button>
      <div className="p-4 flex-1 flex flex-col gap-3">
        <div className="flex items-center justify-between gap-2 text-xs"><span className="text-slate-500">{sales} vente{sales>1?'s':''}</span>{incomplete&&<span className="rounded-full bg-amber-50 px-2 py-1 text-amber-800">Fiche à compléter</span>}</div>
        <div><h2 className="font-semibold text-sm line-clamp-2">{p.title}</h2><p className="text-xs text-slate-400 break-all mt-1">{p.supplier_sku||skus.join(' · ')||'Shein '+p.supplier_id}</p></div>
        <div className="mt-auto"><div className="flex flex-wrap items-center gap-2"><p className="text-xl font-semibold">{p.price==null?'Prix à récupérer':money(p.price)}</p>{delta?.amount!==0&&delta&&<span className={'rounded-full px-2 py-1 text-xs '+(delta.amount>0?'text-rose-700 bg-rose-50':'text-teal-700 bg-teal-50')}>{delta.amount>0?'+':''}{money(delta.amount)}</span>}</div><p className="text-xs text-slate-500 mt-1">{p.color||'Couleur à préciser'} · {date(p.observed_at)}</p></div>
        <div className="flex items-center justify-between gap-2 pt-2 border-t"><button className="text-sm text-teal-800 font-medium py-1" disabled={busy} onClick={()=>onDetails(p)}>Voir les détails</button>{safeUrl(p.supplier_url)&&<a className="text-xs text-slate-500 underline py-1" href={p.supplier_url} target="_blank" rel="noreferrer">Shein ↗</a>}</div>
      </div>
    </article>
  })}</div>
}

export function BestSellerList({data,search,onDetails}) {
  const rows=(data.sales||[]).filter(s=>s.sku.toLowerCase().includes(search.toLowerCase())).sort((a,b)=>Number(b.quantity)-Number(a.quantity))
  return <section className="rounded-xl border bg-white overflow-x-auto"><p className="p-4 text-sm text-gray-500">Les ventes importées sont regroupées par SKU. Les annulations et retours sont exclus. Les ventes sans SKU restent visibles dans Mes ventes et ne sont pas attribuées au hasard.</p><table className="w-full text-left text-sm"><thead className="bg-gray-50"><tr>{['Produit / SKU','Ventes','Chiffre d’affaires connu','Dernière vente'].map(h=><th key={h} className="p-4 font-medium">{h}</th>)}</tr></thead><tbody>{rows.map(s=>{const link=data.links.find(l=>l.sku===s.sku),p=data.products.find(p=>p.id===link?.product_id||p.supplier_sku===s.sku);return <tr key={`${s.sku}-${s.currency}`} className="border-t"><td className="p-4">{p?<button className="text-teal-700 underline text-left" onClick={()=>onDetails(p)}>{p.title}</button>:s.sku}<p className="font-mono text-xs text-gray-500 mt-1">{s.sku}</p></td><td className="p-4">{s.quantity}</td><td className="p-4">{s.currency?money(s.revenue,s.currency):'Devise non renseignée'}{Number(s.known_prices)<Number(s.quantity)&&<p className="text-xs text-amber-700">Montant incomplet</p>}</td><td className="p-4 text-xs">{date(s.last_sale)}</td></tr>})}</tbody></table>{!rows.length&&<p className="text-center text-sm text-gray-500 p-10">Aucune vente avec SKU importée pour cette recherche. Les prochaines ventes portant tes SKU alimenteront ce classement.</p>}</section>
}
