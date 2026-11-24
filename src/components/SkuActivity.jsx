import {useId,useState} from 'react'
import {calendar} from '../lib/shopView'
import {act} from '../lib/scalency'
import './SkuActivity.css'

const number=n=>n.toLocaleString('fr-FR')
const perPage=25
export function Pager({count,page,change}){
  if(count<=perPage)return null
  return <div className="sku-pager"><button disabled={!page} onClick={()=>change(page-1)}>Précédent</button><span>{page+1} / {Math.ceil(count/perPage)}</span><button disabled={(page+1)*perPage>=count} onClick={()=>change(page+1)}>Suivant</button></div>
}
export function SkuDetail({row,orders=[],onLink,salesOnly=false,skuOptions=[]}){
  const suggestions=useId()
  const [tab,setTab]=useState(row?.sales.length?'sales':'listings'),[page,setPage]=useState(0)
  const [editing,setEditing]=useState(null),[sku,setSku]=useState(''),[busy,setBusy]=useState(false),[error,setError]=useState('')
  const listings=!salesOnly&&tab==='listings',all=orders.length?orders:listings?row.listings:row.sales
  const here=Math.min(page,Math.max(0,Math.ceil(all.length/perPage)-1))
  async function save(e){
    e.preventDefault();if(busy||!sku.trim())return
    setBusy(true);setError('')
    try{const {kind,account,id,line}=editing;const value=await act('sku-link',{kind,account,id,line,sku:sku.trim()});await onLink(value);setEditing(null);setSku('')}
    catch(e){setError(e.message)}finally{setBusy(false)}
  }
  return <section className="sku-detail">
    {!orders.length&&!salesOnly&&<div className="sku-tabs">{[['listings','Annonces',row.listings],['sales','Articles vendus ou en cours',row.sales]].map(([id,title,items])=><button key={id} aria-pressed={tab===id} onClick={()=>{setTab(id);setPage(0);setEditing(null)}}>{title} ({number(items.length)})</button>)}</div>}
    {!all.length&&<p>Aucun article dans cette sélection.</p>}
    {all.slice(here*perPage,(here+1)*perPage).map((r,i)=>{
      const isAd=!orders.length&&listings
      const dest=isAd?('https://www.vinted.fr/items/'+encodeURIComponent(r.id)):(r.id?'#ventes?'+new URLSearchParams({id:r.id,account:r.account}):'')
      const match=!!onLink&&!orders.length&&!row.sku&&(isAd||r.lineId||r.listingId)
      return <div className="sku-line" key={JSON.stringify([r.account,r.id,r.lineId,i])}>{salesOnly&&r.photo&&<img className="h-16 w-12 rounded object-cover" src={r.photo} alt="" loading="lazy"/>}<div className={salesOnly?'flex-1':undefined}><strong>{r.title||r.id||'Article'}</strong>
        <small>{[r.account,isAd?r.status:r.stage==='completed'?'Vente terminée':'Vente en cours',!isAd&&calendar(r.date),!isAd&&r.qty>1&&('Quantité '+r.qty)].filter(Boolean).join(' · ')}</small></div>
        <div>{dest&&<a href={dest} {...(isAd?{target:'_blank',rel:'noreferrer'}:{})}>{isAd?'Voir sur Vinted':'Voir la vente'}</a>}
        {match&&<button disabled={busy} onClick={()=>{const byListing=isAd||!r.lineId;setEditing({kind:byListing?'listing':'sale',account:r.account,id:byListing&&!isAd?r.listingId:r.id,line:byListing?'':r.lineId,title:r.title});setSku('');setError('')}}>Associer un SKU</button>}</div></div>
    })}
    {editing&&<form className="sku-edit" onSubmit={save}><label>SKU de {editing.title||"l'article"}<input autoFocus required maxLength={150} list={skuOptions.length?suggestions:undefined} value={sku} onChange={e=>setSku(e.target.value)}/></label>
      {skuOptions.length>0&&<datalist id={suggestions}>{skuOptions.map(g=><option key={g.key} value={g.sku}>{g.title}</option>)}</datalist>}
      <button disabled={busy}>Enregistrer</button><button type="button" disabled={busy} onClick={()=>setEditing(null)}>Annuler</button></form>}
    {error&&<p role="alert">{error}</p>}<Pager count={all.length} page={here} change={setPage}/>
  </section>
}
