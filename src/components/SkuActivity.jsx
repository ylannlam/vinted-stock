import {useState} from 'react'
import {calendar} from '../lib/shopView'
import {act} from '../lib/scalency'
import './SkuActivity.css'

const number=n=>n.toLocaleString('fr-FR')
const perPage=25
export function Pager({count,page,change}){
  if(count<=perPage)return null
  return <div className="sku-pager"><button disabled={!page} onClick={()=>change(page-1)}>Précédent</button><span>{page+1} / {Math.ceil(count/perPage)}</span><button disabled={(page+1)*perPage>=count} onClick={()=>change(page+1)}>Suivant</button></div>
}
export function SkuDetail({row,orders=[],onLink}){
  const [tab,setTab]=useState(row?.sales.length?'sales':'listings'),[page,setPage]=useState(0)
  const [editing,setEditing]=useState(null),[sku,setSku]=useState(''),[busy,setBusy]=useState(false),[error,setError]=useState('')
  const listings=tab==='listings',all=orders.length?orders:listings?row.listings:row.sales
  const here=Math.min(page,Math.max(0,Math.ceil(all.length/perPage)-1))
  async function save(e){
    e.preventDefault();if(busy||!sku.trim())return
    setBusy(true);setError('')
    try{const value=await act('sku-link',{...editing,sku:sku.trim()});await onLink(value);setEditing(null);setSku('')}
    catch(e){setError(e.message)}finally{setBusy(false)}
  }
  return <section className="sku-detail">
    {!orders.length&&<div className="sku-tabs">{[['listings','Annonces',row.listings],['sales','Articles vendus ou en cours',row.sales]].map(([id,title,items])=><button key={id} aria-pressed={tab===id} onClick={()=>{setTab(id);setPage(0);setEditing(null)}}>{title} ({number(items.length)})</button>)}</div>}
    {!all.length&&<p>Aucun article dans cette sélection.</p>}
    {all.slice(here*perPage,(here+1)*perPage).map((r,i)=>{
      const isAd=!orders.length&&listings
      const dest=isAd?('https://www.vinted.fr/items/'+encodeURIComponent(r.id)):(r.id?'#ventes?'+new URLSearchParams({id:r.id,account:r.account}):'')
      const match=!!onLink&&!orders.length&&!row.sku&&(isAd||r.lineId)
      return <div className="sku-line" key={JSON.stringify([r.account,r.id,r.lineId,i])}><div><strong>{r.title||r.id||'Article'}</strong>
        <small>{[r.account,isAd?r.status:r.stage==='completed'?'Vente terminée':'Vente en cours',!isAd&&calendar(r.date),!isAd&&r.qty>1&&('Quantité '+r.qty)].filter(Boolean).join(' · ')}</small></div>
        <div>{dest&&<a href={dest} {...(isAd?{target:'_blank',rel:'noreferrer'}:{})}>{isAd?'Voir sur Vinted':'Voir la vente'}</a>}
        {match&&<button disabled={busy} onClick={()=>{setEditing({kind:isAd?'listing':'sale',account:r.account,id:r.id,line:r.lineId||''});setSku('');setError('')}}>Associer un SKU</button>}</div></div>
    })}
    {editing&&<form className="sku-edit" onSubmit={save}><label>SKU de l’article {editing.line||editing.id}<input autoFocus required maxLength={150} value={sku} onChange={e=>setSku(e.target.value)}/></label><button disabled={busy}>Enregistrer</button><button type="button" disabled={busy} onClick={()=>setEditing(null)}>Annuler</button></form>}
    {error&&<p role="alert">{error}</p>}<Pager count={all.length} page={here} change={setPage}/>
  </section>
}
