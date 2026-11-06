import {useState} from 'react'
import ArticlePhotos from './ArticlePhotos'
import {CATEGORIES,categoryLabel,postedStatus,productCategory,salePriceOf,validatePricing} from '../lib/library'
import {observationChange} from '../lib/catalog'
import {safeUrl,money} from '../lib/fulfillment'

const button='rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm hover:bg-slate-50 disabled:opacity-40'
const primary='rounded-lg bg-teal-700 px-4 py-2 text-sm font-semibold text-white hover:bg-teal-800 disabled:opacity-40'
const field='rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm'
const euros=v=>`${Number(v).toLocaleString('fr-FR',{maximumFractionDigits:2})} €`

export function CategoryChips({value,onChange,counts}) {
  const used=CATEGORIES.filter(([k])=>counts[k])
  if(used.length<2)return null
  return <div className="library-chips" role="group" aria-label="Catégories">
    <button aria-pressed={value==='all'} onClick={()=>onChange('all')}>Toutes <span>{Object.values(counts).reduce((a,b)=>a+b,0)}</span></button>
    {used.map(([k,label])=><button key={k} aria-pressed={value===k} onClick={()=>onChange(k)}>{label} <span>{counts[k]}</span></button>)}
  </div>
}

function CopyLine({label,value}) {
  const [done,setDone]=useState(false)
  if(!value)return null
  return <div className="library-copy"><span className="card-eyebrow">{label}</span><span className="library-copy-value">{value}</span>
    <button type="button" onClick={()=>navigator.clipboard?.writeText(value).then(()=>{setDone(true);setTimeout(()=>setDone(false),1200)})}>{done?'Copié':'Copier'}</button></div>
}

function SalePrice({product,pricing,isAdmin,busy,onMeta}) {
  const [editing,setEditing]=useState(false),[value,setValue]=useState('')
  const sale=salePriceOf(product,pricing)
  if(editing)return <form className="library-sale-edit" onSubmit={e=>{e.preventDefault();onMeta({product_id:product.id,category:product.category||null,sale_price:value||null}).then(()=>setEditing(false),()=>{})}}>
    <input aria-label="Prix de vente" inputMode="decimal" autoFocus className={field+' w-20'} value={value} onChange={e=>setValue(e.target.value)} placeholder="€"/>
    <button className={button} disabled={busy}>OK</button><button type="button" className={button} onClick={()=>setEditing(false)}>×</button>
  </form>
  return <div><span className="card-eyebrow">Prix de vente</span>
    <span className="library-sale">{sale?euros(sale.price):'—'}</span>
    <span className="library-sale-note">{sale?.manual?'choisi':sale?'grille':'grille à définir'}{isAdmin&&<button type="button" className="ml-1 underline" onClick={()=>{setValue(sale?.manual?String(sale.price):'');setEditing(true)}}>modifier</button>}</span>
  </div>
}

export function CategorySelect({product,isAdmin,busy,onMeta}) {
  const current=productCategory(product)
  if(!isAdmin)return <span className="library-category">{categoryLabel(current)}</span>
  return <select aria-label="Catégorie" className="library-category" disabled={busy} value={current}
    onChange={e=>onMeta({product_id:product.id,category:e.target.value,sale_price:product.sale_price??null})}>
    {CATEGORIES.map(([k,label])=><option key={k} value={k}>{label}{!product.category&&k===current?' (auto)':''}</option>)}
  </select>
}

// Carte d'un produit Shein (vendu ou ajouté).
export function LibraryCard({product,sales=0,skus=[],pricing,isAdmin,busy,onDetails,onMeta,onCreateListing}) {
  const delta=observationChange(product),photos=Array.isArray(product.photos)?product.photos:[]
  const sku=product.supplier_sku||skus[0]||''
  const pending=['queued','running'].includes(product.collection_status)
  return <article className="catalog-card">
    <ArticlePhotos photos={[product.photo_url,...photos]} title={product.title} onOpen={()=>onDetails(product)} badge={pending?'Récupération…':['blocked','failed'].includes(product.collection_status)?'À vérifier':undefined}/>
    <div className="catalog-card-body">
      <div className="catalog-card-meta"><CategorySelect product={product} isAdmin={isAdmin} busy={busy} onMeta={onMeta}/><span>{sales?`${sales} vente${sales>1?'s':''}`:product.sold?'Vendu':'Jamais vendu'}</span></div>
      <button className="article-title-button" onClick={()=>onDetails(product)}><h2 className="article-title">{product.title||'Article Shein'}</h2></button>
      <div className="catalog-price-row library-prices">
        <div><span className="card-eyebrow">Shein</span><strong className="library-shein">{product.price==null?'—':money(product.price)}</strong>{delta&&delta.amount!==0&&<span className={'price-change '+(delta.amount>0?'is-up':'is-down')}>{delta.amount>0?'▲ ':'▼ '}{money(product.previous_price)}</span>}</div>
        <SalePrice product={product} pricing={pricing} isAdmin={isAdmin} busy={busy} onMeta={onMeta}/>
      </div>
      <div className="catalog-sizes" aria-label="Tailles proposées">{(product.sizes||[]).slice(0,8).map(s=><span key={s.size} className={s.availability==='unavailable'?'is-unavailable':s.availability==='unknown'?'is-unknown':''}>{s.size}</span>)}{!product.sizes?.length&&<span className="sizes-pending">{pending?'Récupération en cours…':'Tailles à récupérer'}</span>}</div>
      <CopyLine label="SKU" value={sku}/>
      <div className="catalog-card-footer">
        {onCreateListing&&sku?<button className="article-open-button" onClick={()=>onCreateListing(sku)}>Créer une annonce</button>:<button className="article-open-button" onClick={()=>onDetails(product)}>Ouvrir la fiche</button>}
        {safeUrl(product.supplier_url)&&<a className="article-details-link" href={product.supplier_url} target="_blank" rel="noreferrer">Shein ↗</a>}
      </div>
    </div>
  </article>
}

// Carte d'un SKU posté sur Dotb mais pas encore vendu.
export function PostedCard({group,pricing,isAdmin,busy,onDetails,onMeta,onCollect,onCreateListing}) {
  const p=group.product,statuses=[...new Set(group.items.map(i=>postedStatus(i.status)))]
  const vinted=group.prices.length?group.prices.length>1?`${euros(group.prices[0])} – ${euros(group.prices.at(-1))}`:euros(group.prices[0]):'—'
  const pending=['queued','running'].includes(p?.collection_status)
  return <article className="catalog-card">
    <ArticlePhotos photos={[group.photo_url,p?.photo_url]} title={group.title} onOpen={()=>p&&onDetails(p)} badge={`${group.items.length} annonce${group.items.length>1?'s':''}`}/>
    <div className="catalog-card-body">
      <div className="catalog-card-meta">{p?<CategorySelect product={p} isAdmin={isAdmin} busy={busy} onMeta={onMeta}/>:<span className="library-category">{categoryLabel(productCategory({title:group.title}))}</span>}<span>{statuses.join(' · ')}</span></div>
      <h2 className="article-title">{group.title}</h2>
      <div className="catalog-price-row library-prices">
        <div><span className="card-eyebrow">Shein</span><strong className="library-shein">{p?.price==null?'—':money(p.price)}</strong></div>
        <div><span className="card-eyebrow">Sur Vinted</span><span className="library-sale">{vinted}</span>{p&&salePriceOf(p,pricing)&&<span className="library-sale-note">conseillé {euros(salePriceOf(p,pricing).price)}</span>}</div>
      </div>
      {!!group.accounts.length&&<p className="text-xs text-slate-500">Comptes : {group.accounts.slice(0,4).join(', ')}{group.accounts.length>4?` +${group.accounts.length-4}`:''}</p>}
      <CopyLine label="SKU" value={group.sku}/>
      <div className="catalog-card-footer">
        {p?<button className="article-open-button" onClick={()=>onDetails(p)}>Fiche Shein</button>
          :isAdmin?<button className="article-open-button" disabled={busy} onClick={()=>onCollect(group)}>{pending?'Récupération…':'Récupérer sur Shein'}</button>:<span className="text-xs text-slate-400">Fiche Shein à récupérer</span>}
        {onCreateListing&&<button className="article-details-link" onClick={()=>onCreateListing(group.sku)}>Reposter</button>}
      </div>
    </div>
  </article>
}

export function AddReferencesPanel({busy,onAdd,onClose}) {
  const [text,setText]=useState('')
  const lines=text.split(/\r?\n/).map(s=>s.trim()).filter(Boolean).length
  return <section className="rounded-2xl border border-teal-100 bg-white p-4 space-y-3">
    <div className="flex items-start justify-between gap-3"><div><h2 className="font-semibold">Ajouter des SKU ou liens Shein</h2><p className="text-xs text-slate-500 mt-1">Un par ligne (50 au maximum). Le PC avec l’extension Shein récupère photos, prix, tailles, description et mesures, puis l’article apparaît dans « À poster ».</p></div><button className={button} onClick={onClose}>Fermer</button></div>
    <textarea aria-label="SKU ou liens Shein" rows={5} spellCheck={false} className={field+' w-full font-mono text-xs'} placeholder={'sz2603311904347259290072\nhttps://fr.shein.com/robe-p-12345678.html'} value={text} onChange={e=>setText(e.target.value)}/>
    <div className="flex justify-end"><button className={primary} disabled={busy||!lines||lines>50} onClick={()=>onAdd(text).then(()=>setText(''),()=>{})}>{busy?'Envoi…':`Ajouter ${lines||''} article${lines>1?'s':''}`}</button></div>
  </section>
}

const EXAMPLE={tiers:[{max:6,price:31},{max:10,price:39},{max:14,price:49},{max:18,price:64}],above:4.4}
export function PricingPanel({pricing,busy,onSave,onClose}) {
  const start=pricing?.tiers?.length?pricing:EXAMPLE
  const [tiers,setTiers]=useState(start.tiers.map(t=>({max:String(t.max),price:String(t.price)}))),[above,setAbove]=useState(start.above==null?'':String(start.above)),[error,setError]=useState('')
  const set=(i,key,v)=>setTiers(tiers.map((t,j)=>j===i?{...t,[key]:v}:t))
  function save(){try{const valid=validatePricing({tiers,above});setError('');onSave(valid)}catch(e){setError(e.message)}}
  return <section className="rounded-2xl border border-teal-100 bg-white p-4 space-y-3">
    <div className="flex items-start justify-between gap-3"><div><h2 className="font-semibold">Grille tarifaire</h2><p className="text-xs text-slate-500 mt-1">Prix de vente conseillé selon le prix Shein. Il suit les variations de prix ; un prix choisi à la main sur un article reste prioritaire.{!pricing?.tiers?.length&&' Exemple à adapter : rien n’est appliqué avant l’enregistrement.'}</p></div><button className={button} onClick={onClose}>Fermer</button></div>
    <div className="space-y-2">{tiers.map((t,i)=><div key={i} className="flex flex-wrap items-center gap-2 text-sm">
      <span className="text-slate-500 w-24">Shein jusqu’à</span><input aria-label={`Palier ${i+1} : prix Shein maximum`} inputMode="decimal" className={field+' w-20'} value={t.max} onChange={e=>set(i,'max',e.target.value)}/><span>€ →</span>
      <input aria-label={`Palier ${i+1} : prix de vente`} inputMode="decimal" className={field+' w-20'} value={t.price} onChange={e=>set(i,'price',e.target.value)}/><span>€</span>
      <button type="button" className="text-xs text-rose-700 underline" onClick={()=>setTiers(tiers.filter((_,j)=>j!==i))}>retirer</button>
    </div>)}</div>
    <div className="flex flex-wrap items-center gap-2 text-sm"><button type="button" className={button} disabled={tiers.length>=20} onClick={()=>setTiers([...tiers,{max:'',price:''}])}>+ Palier</button>
      <span className="text-slate-500 ml-2">Au-delà : ×</span><input aria-label="Coefficient au-delà du dernier palier" inputMode="decimal" className={field+' w-20'} value={above} onChange={e=>setAbove(e.target.value)} placeholder="aucun"/></div>
    {error&&<p role="alert" className="text-sm text-red-700">{error}</p>}
    <div className="flex justify-end"><button className={primary} disabled={busy} onClick={save}>Enregistrer la grille</button></div>
  </section>
}
