import {useMemo,useState} from 'react'
import {calendar,performanceRows,textMatch} from '../lib/shopView'
import {salesPeriodLabel} from '../lib/shopPeriod'
import {ShopCover,ShopFilters,PageBar} from './ShopControls'
import {SkuDetail} from './SkuActivity'
import ResourceDialog from './ResourceDialog'

export default function ShopRanking({board,accounts,initialSku='',admin,reread}){
  const [account,setAccount]=useState(''),[search,setSearch]=useState(initialSku),[sort,setSort]=useState('completed')
  const [page,setPage]=useState(0),[detail,setDetail]=useState(null)
  const groups=useMemo(()=>performanceRows(board.groups,account),[board,account])
  const rows=groups.filter(g=>g.key&&(textMatch(g,search)||g.listings.some(r=>textMatch({...r,sku:g.sku},search)))).sort((a,b)=>(b[sort]??-1)-(a[sort]??-1)||b.pending-a.pending||b.online-a.online||a.sku.localeCompare(b.sku,'fr'))
  const unknown=groups.find(g=>!g.key),missing=board.emptyOrders.filter(r=>!account||r.account===account)
  const current=groups.find(g=>g.key===detail)
  const size=30,here=Math.min(page,Math.max(0,Math.ceil(rows.length/size)-1))
  const update=setter=>value=>{setter(value);setPage(0);setDetail(null)}
  const identified=groups.filter(g=>g.key).reduce((n,g)=>n+g.completed,0)
  return <><div className="shop-subheading"><h2>Meilleures ventes par SKU</h2><span>{salesPeriodLabel} · {identified} article{identified>1?'s':''} vendu{identified>1?'s':''} avec SKU</span></div>
    <ShopFilters search={search} setSearch={update(setSearch)} hint="SKU ou titre de l’article" account={account} setAccount={update(setAccount)} accounts={accounts}
      sort={sort} setSort={update(setSort)} options={[[ 'completed','Ventes terminées'],['pending','Ventes en cours'],['online','Annonces en ligne'],['favourites','Favoris']]}/>
    <div className="shop-rank-scroll"><table className="shop-rank"><caption>Classement de {rows.length} références</caption><thead><tr><th>Article et SKU</th><th>Vendus</th><th>En cours</th><th>Publiées</th><th>En ligne</th><th>Favoris</th><th>Dernière vente</th></tr></thead>
    <tbody>{rows.slice(here*size,(here+1)*size).map(g=><tr key={g.key}><th scope="row"><button onClick={()=>setDetail(g.key)}><span className="shop-mini"><ShopCover src={g.photo} title={g.title} small/></span><span><b>{g.sku}</b><small>{g.title||'Article'}</small></span></button></th>
      <td><strong>{g.completed}</strong></td><td>{g.pending}</td><td>{g.published}</td><td>{g.online}</td><td>{g.favourites??'—'}</td><td>{calendar(g.lastSale)}</td></tr>)}</tbody></table></div>
    {!rows.length&&<p className="shop-empty">Aucune référence pour cette recherche.</p>}<PageBar page={here} setPage={setPage} total={rows.length} size={size}/>
    <div className="shop-unmatched">{unknown&&<button onClick={()=>setDetail('')}>À identifier · {unknown.published} annonces · {unknown.completed} article(s) vendu(s) sans SKU</button>}
      {missing.length>0&&<button onClick={()=>setDetail(':orders')}>{missing.length} commande(s) sans détail article</button>}</div>
    {(current||detail===':orders'&&missing.length>0)&&<ResourceDialog title={detail===':orders'?'Commandes à vérifier':current.sku||'À identifier'} onClose={()=>setDetail(null)}>
      <SkuDetail key={detail} row={current} orders={detail===':orders'?missing:[]} onLink={admin?reread:null}/></ResourceDialog>}
  </>
}
