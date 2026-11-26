import {useEffect,useRef,useState} from 'react'
import {createPortal} from 'react-dom'
import ResourceDialog from './ResourceDialog'
import {price} from '../lib/shopView'

export function ShopCover({src,title,small=false,thumbnail,card=false}){
  const [failed,setFailed]=useState('')
  const [failedPreview,setFailedPreview]=useState('')
  if(!src||failed===src)return <span className={'shop-placeholder'+(small?' small':'')}>Sans photo</span>
  const canOptimize=(small||card)&&/^https:\/\/images1\.vinted\.net\/(t|tc)\//.test(src)
  const optimized=w=>'/_vercel/image?'+new URLSearchParams({url:src,w:String(w),q:'75'})
  const preview=thumbnail||(canOptimize?optimized(small?96:256):null)
  const usePreview=preview&&failedPreview!==preview
  const srcSet=usePreview&&canOptimize&&!thumbnail&&!small?optimized(256)+' 1x, '+optimized(512)+' 2x':undefined
  return <img src={usePreview?preview:src} srcSet={srcSet} loading="lazy" decoding="async" alt={title||'Article'}
    onError={()=>usePreview?setFailedPreview(preview):setFailed(src)}/>
}
export function ShopHeader({title,children,busy,refresh}){
  return <header className="shop-header"><div><h1>{title}</h1>{children}</div><button className="shop-button" disabled={busy} onClick={()=>refresh(true)}>{busy?'Actualisation…':'Actualiser'}</button></header>
}
export function ShopFilters({search,setSearch,hint,account,setAccount,accounts,sort,setSort,options,children}){
  return <div className="shop-filterbar"><label className="shop-search"><span>Rechercher</span><input type="search" value={search} onChange={e=>setSearch(e.target.value)} placeholder={hint}/></label>
    <label><span>Compte</span><select value={account} onChange={e=>setAccount(e.target.value)}><option value="">Tous les comptes</option>{accounts.map(a=><option key={a}>{a}</option>)}</select></label>
    <label><span>Trier par</span><select value={sort} onChange={e=>setSort(e.target.value)}>{options.map(([key,label])=><option key={key} value={key}>{label}</option>)}</select></label>{children}</div>
}
export function FilterTabs({options,counts,value,onChange,label}){
  return <div className="shop-statuses" role="group" aria-label={label}>{Object.entries(options).map(([k,title])=><button key={k} aria-pressed={value===k} onClick={()=>onChange(k)}>{title}<span>{counts[k]||0}</span></button>)}</div>
}
export function PageBar({page,setPage,total,size}){
  const pages=Math.ceil(total/size)
  if(pages<2)return null
  return <nav className="shop-pages" aria-label="Pages des résultats"><button disabled={!page} onClick={()=>setPage(page-1)}>Précédent</button><span>{page+1} / {pages}</span><button disabled={page+1>=pages} onClick={()=>setPage(page+1)}>Suivant</button></nav>
}
export function useShopSelection(){
  const [keys,setKeys]=useState(()=>new Set())
  function toggle(id){setKeys(before=>{const next=new Set(before);if(next.has(id))next.delete(id);else next.add(id);return next})}
  function togglePage(ids){setKeys(before=>{const next=new Set(before),remove=ids.every(id=>before.has(id));for(const id of ids){if(remove)next.delete(id);else next.add(id)}return next})}
  return {keys,toggle,togglePage,clear:()=>setKeys(new Set())}
}
export function SelectionBar({count,totalVisible,pageKeys,selection,noun,children}){
  const every=pageKeys.length>0&&pageKeys.every(k=>selection.keys.has(k))
  return <div className="shop-selectbar">
    <label><input type="checkbox" checked={every} disabled={!pageKeys.length} onChange={()=>selection.togglePage(pageKeys)}/>Cocher la page</label>
    <span aria-live="polite">{count?count+' en sélection':totalVisible+' '+noun}</span>
    {count>0&&<button className="shop-link" onClick={selection.clear}>Effacer</button>}
    <div className="shop-select-actions">{children}</div>
  </div>
}
export function PrintArticles({rows,onClose}){
  const preview=useRef(null),[preparing,setPreparing]=useState(false)
  useEffect(()=>{document.body.classList.add('shop-printing');return ()=>document.body.classList.remove('shop-printing')},[])
  async function print(){
    setPreparing(true)
    const images=[...(preview.current?.querySelectorAll('img')||[])]
    await Promise.allSettled(images.map(img=>img.decode?.()))
    setPreparing(false)
    if(preview.current)window.print()
  }
  return createPortal(<div className="shop-print-root"><ResourceDialog title="Fiches articles à imprimer" onClose={onClose}>
    <div className="shop-print-actions"><span>{rows.length} fiche{rows.length>1?'s':''}</span><button className="shop-primary" onClick={print} disabled={preparing}>{preparing?'Préparation des photos…':'Imprimer les fiches'}</button></div>
    <div className="shop-print-list" ref={preview}>{rows.map((r,i)=><article key={i}>{r.photo&&<img src={r.photo} alt=""/>}<div><strong>{r.sku||'SKU non renseigné'}</strong><h3>{r.title||'Article'}</h3>
      <p>{[r.account,r.size&&'Taille '+r.size,r.quantity!=null&&'Qté '+r.quantity,r.price!=null&&price(r.price,r.currency)].filter(Boolean).join(' · ')}</p>
      {r.location&&<p>Emplacement · {r.location}</p>}{r.reference&&<p>{r.reference}</p>}</div></article>)}</div>
    </ResourceDialog></div>,document.body)
}
