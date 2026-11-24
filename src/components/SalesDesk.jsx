import {useMemo,useState} from 'react'
import CopySkuButton from './CopySkuButton'
import useShopBoard from './useShopBoard'
import {FilterTabs,PageBar,PrintArticles,SelectionBar,ShopCover,ShopFilters,ShopHeader,useShopSelection} from './ShopControls'
import BatchLabelsDialog from './BatchLabelsDialog'
import {calendar,price,printableLabel,saleBucket,salesLabels,sortSales,textMatch} from '../lib/shopView'
import {salesPeriodLabel} from '../lib/shopPeriod'
import {query} from '../lib/scalency'
import './ShopBoard.css'

const key=r=>JSON.stringify([r.account,r.id])
async function getLabel(_method,{id}){
  const blob=await query('label',{id})
  return {pdf:await blob.arrayBuffer()}
}
function SalesGrid({board,params}){
  const accounts=useMemo(()=>[...new Set(board.sales.map(r=>r.account).filter(Boolean))].sort(),[board])
  const [account,setAccount]=useState(params.login||board.sales.find(r=>r.accountId===params.account)?.account||params.account||''),[search,setSearch]=useState('')
  const [tab,setTab]=useState('dispatch'),[sort,setSort]=useState('due'),[page,setPage]=useState(0)
  const [labels,setLabels]=useState(null),[sheets,setSheets]=useState(null)
  const selection=useShopSelection()
  const update=setter=>value=>{setter(value);setPage(0);selection.clear()}
  const match=board.sales.filter(r=>(!account||account===r.account)&&textMatch(r,search))
  const counts={all:match.length}
  for(const r of match){const stage=saleBucket(r);counts[stage]=(counts[stage]||0)+1}
  const rows=sortSales(match.filter(r=>tab==='all'||saleBucket(r)===tab),sort)
  const size=32,here=Math.min(page,Math.max(0,Math.ceil(rows.length/size)-1))
  const displayed=rows.slice(here*size,(here+1)*size)
  const picked=rows.filter(r=>selection.keys.has(key(r))),available=picked.filter(printableLabel)
  const eligible=rows.filter(printableLabel).map(key)
  const tabs={...salesLabels}
  if(!counts.other)delete tabs.other
  function printSheets(){
    setSheets(picked.flatMap(r=>(r.lines.length?r.lines:[{title:r.title}]).map(line=>({...line,account:r.account,reference:'Commande '+r.id}))))
  }
  function chooseLabels(){
    setLabels(available.map(r=>({id:r.id,order_id:r.id,account_login:r.account,source:{title:r.title||r.lines[0]?.title}})))
  }
  return <><ShopFilters search={search} setSearch={update(setSearch)} hint="Titre, SKU, compte ou n° de commande" account={account} setAccount={update(setAccount)} accounts={accounts}
      sort={sort} setSort={setSort} options={[[ 'due','Échéance la plus proche'],['recent','Ventes récentes'],['amount','Montant décroissant']]}/>
    <FilterTabs options={tabs} counts={counts} value={tab} onChange={value=>{update(setTab)(value);setSort(value==='dispatch'?'due':'recent')}} label="État de la vente"/>
    <SelectionBar count={picked.length} totalVisible={rows.length} noun="commandes" selection={selection} pageKeys={displayed.map(key)}>
      {eligible.length>0&&<button className="shop-link" onClick={()=>selection.togglePage(eligible)}>{eligible.every(k=>selection.keys.has(k))?'Décocher':'Cocher'} les bordereaux disponibles ({eligible.length})</button>}
      <button className="shop-button" disabled={!picked.length} onClick={printSheets}>Fiches articles</button>
      <button className="shop-primary" disabled={!available.length} onClick={chooseLabels}>Imprimer les bordereaux ({available.length})</button>
    </SelectionBar>
    {rows.length?<div className="shop-sales-scroll"><table className="shop-sales"><caption className="sr-only">Ventes et expéditions depuis le 1er octobre 2026</caption>
      <thead><tr><th aria-label="Sélection"></th><th>Articles et SKU</th><th>Compte et vente</th><th>Expédition</th><th>Montant</th></tr></thead>
      <tbody>{displayed.map(r=>{
        const checked=selection.keys.has(key(r)),lines=r.lines.length?r.lines:[{title:r.title}],bucket=saleBucket(r)
        return <tr key={key(r)} className={checked?'picked':''}><td className="sale-tick"><input type="checkbox" checked={checked} aria-label={'Sélectionner la commande '+r.id} onChange={()=>selection.toggle(key(r))}/></td>
          <td className="sale-products">{lines.map((line,i)=><div className="sale-product" key={line.id||i}><div className="shop-mini"><ShopCover src={line.photo} title={line.title} small/></div><div>
            <a href={'#ventes?'+new URLSearchParams({id:r.id,account:r.accountId||r.account})}>{line.title||r.title||'Commande'}</a>
            <small>{[line.sku?'SKU '+line.sku:'SKU à identifier',line.size&&'Taille '+line.size,line.quantity>1&&'× '+line.quantity].filter(Boolean).join(' · ')}<CopySkuButton key={line.sku} sku={line.sku}/></small></div></div>)}</td>
          <td className="sale-account"><b>{r.account}</b><small>{r.estimated?'Vers le ':''}{calendar(r.date)}</small></td>
          <td className="sale-state"><span className={'shop-badge '+bucket}>{r.label||salesLabels[bucket]}</span>
            {bucket==='dispatch'&&<small>{r.deadline?'À envoyer avant le '+calendar(r.deadline):'Échéance inconnue'}</small>}
            {bucket==='dispatch'&&<small>{r.printed?'Bordereau déjà imprimé':r.hasLabel?'Bordereau disponible':'Bordereau indisponible'}</small>}</td>
          <td className="sale-price">{price(r.amount,r.currency)}</td></tr>
      })}</tbody></table></div>:<p className="shop-empty">Aucune commande pour cette sélection.</p>}
    <PageBar page={here} setPage={setPage} total={rows.length} size={size}/>
    {labels&&<BatchLabelsDialog lines={labels} original request={getLabel} onClose={()=>setLabels(null)}/>}
    {sheets&&<PrintArticles rows={sheets} onClose={()=>setSheets(null)}/>}
  </>
}
export default function SalesDesk({params}){
  const {board,busy,error,refresh}=useShopBoard()
  return <main className="shop-work"><ShopHeader title="Ventes et expédition" busy={busy} refresh={refresh}><p>{salesPeriodLabel} · <a href="#dressing/sku">Meilleures ventes par SKU</a></p></ShopHeader>
    {error&&<p className="shop-alert" role="alert">{error}</p>}
    {!board&&!error&&<p role="status" className="shop-empty">Chargement des ventes…</p>}
    {board&&<SalesGrid board={board} params={params}/>}
  </main>
}
