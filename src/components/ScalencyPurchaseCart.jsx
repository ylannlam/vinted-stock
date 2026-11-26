import {useEffect,useMemo,useState} from 'react'
import {purchaseDay} from '../lib/dailyPurchases'
import {scalencyPurchaseCart} from '../lib/scalencyPurchaseCart'
import {copyText} from '../lib/copyText'
import CopySkuButton from './CopySkuButton'
import {ShopCover} from './ShopControls'

function saleLink(sale){
  return '#ventes?'+new URLSearchParams({account:sale.accountId||sale.account,id:sale.id})
}
export default function ScalencyPurchaseCart({sales}){
  const [today,setToday]=useState(()=>purchaseDay()),[chosen,setChosen]=useState(''),[feedback,setFeedback]=useState('')
  useEffect(()=>{
    const update=()=>setToday(purchaseDay())
    const timer=setInterval(update,30000)
    document.addEventListener('visibilitychange',update)
    return ()=>{clearInterval(timer);document.removeEventListener('visibilitychange',update)}
  },[])
  const day=chosen||today
  const cart=useMemo(()=>scalencyPurchaseCart(sales,day),[sales,day])
  useEffect(()=>setFeedback(''),[cart])
  async function copy(){
    const rows=cart.groups.map(g=>[g.quantity+' × '+g.title,g.size?'Taille '+g.size:'Taille à vérifier',g.color,g.sku,g.product||g.search||'Référence à vérifier'].filter(Boolean).join(' · '))
    try{await copyText(['Panier SHEIN du '+day,...rows].join('\n'));setFeedback('Liste copiée.')}
    catch{setFeedback('La copie a échoué. Tu peux copier les SKU individuellement.')}
  }
  return <section className="shop-cart" aria-label="Panier SHEIN du jour">
    <div className="shop-cart-head"><div><h2>Panier du jour</h2>
      <p>Articles à commander d’après les ventes Scalency de la journée, tous comptes confondus.</p></div>
      <label>Jour de vente · Paris<input type="date" value={day} max={today} onChange={e=>{const value=e.target.value;if(!value||value<=today)setChosen(value===today?'':value)}}/></label></div>
    {cart.groups.length>0?<><div className="shop-selectbar"><strong>{cart.units} article{cart.units>1?'s':''} · {cart.orders} vente{cart.orders>1?'s':''}</strong>
      <button className="shop-button" onClick={copy}>Copier la liste</button><span role="status">{feedback}</span></div>
      {cart.groups.map(g=><article key={g.key} className="shop-cart-row"><div className="shop-mini"><ShopCover src={g.photo} title={g.title} small/></div>
        <div><strong>{g.title}</strong><p>{[g.size?'Taille '+g.size:'Taille à vérifier',g.color,'Quantité '+g.quantity].filter(Boolean).join(' · ')}</p>
        {g.sku&&<small>SKU {g.sku} <CopySkuButton sku={g.sku}/></small>}
        <details><summary>Vente{g.sales.length>1?'s':''} concernée{g.sales.length>1?'s':''} ({g.sales.length})</summary>{g.sales.map(s=><a key={[s.accountId,s.id].join('/')} href={saleLink(s)}>{s.account} · {s.id}{s.estimated?' · Date estimée':''}</a>)}</details></div>
        {g.product||g.search?<a className="shop-button" target="_blank" rel="noopener noreferrer" href={g.product||g.search}>{g.product?'Ouvrir la fiche SHEIN':'Rechercher le SKU sur SHEIN'}</a>:
          <a className="shop-link" href={saleLink(g.sales[0])}>Vérifier la référence</a>}</article>)}</>:
      !cart.incomplete.length&&<p className="shop-empty">Aucun article à commander pour cette journée.</p>}
    {cart.incomplete.map(s=><p key={[s.accountId,s.id].join('/')} className="shop-alert">Articles ou quantité à vérifier · <a href={saleLink(s)}>{s.title||s.id} · {s.account}</a></p>)}
  </section>
}
