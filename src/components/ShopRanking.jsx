import {useMemo,useState} from 'react'
import CopySkuButton from './CopySkuButton'
import {calendar,performanceRows,textMatch} from '../lib/shopView'
import {salesPeriodLabel} from '../lib/shopPeriod'
import {ShopCover,ShopFilters,PageBar} from './ShopControls'
import {SkuDetail} from './SkuActivity'
import ResourceDialog from './ResourceDialog'

function RankingCard({group,open}){
  const {sku,title,photo,sold,completed,pending,published,online,favourites,lastSale}=group
  const name=title||sku
  return <article className="shop-card shop-rank-card">
    <div className="shop-photo">
      <button type="button" className="shop-photo-open" onClick={open} aria-label={'Voir le détail du SKU '+sku}>
        <ShopCover src={photo} title={name} card/>
      </button>
      <span className={'shop-badge shop-units'+(sold?' complete':'')}>{sold} {sold>1?'vendus':'vendu'}</span>
    </div>
    <div className="shop-card-body">
      <button type="button" className="shop-card-title" title={name} onClick={open}>{name}</button>
      <div className="shop-sku-row"><span className="shop-sku">SKU {sku}</span><CopySkuButton sku={sku}/></div>
      <dl className="shop-rank-stats">
        <div><dt>Terminées</dt><dd>{completed}</dd></div>
        <div><dt>En cours</dt><dd>{pending}</dd></div>
        <div><dt>Publiées</dt><dd>{published}</dd></div>
        <div><dt>En ligne</dt><dd>{online}</dd></div>
        <div><dt>Favoris</dt><dd>{favourites??'—'}</dd></div>
      </dl>
      <p className="shop-rank-date">{lastSale?'Dernière vente · '+calendar(lastSale):sold?'Date de vente inconnue':'Aucune vente sur la période'}</p>
    </div>
  </article>
}

export default function ShopRanking({board,accounts,initialSku='',admin,reread}){
  const [account,setAccount]=useState(''),[search,setSearch]=useState(initialSku),[sort,setSort]=useState('sold')
  const [page,setPage]=useState(0),[detail,setDetail]=useState(null)
  const [view,setView]=useState('photos')
  const groups=useMemo(()=>performanceRows(board.groups,account),[board,account])
  const rows=groups.filter(g=>g.key&&g.sold>0&&(textMatch(g,search)||[...g.sales,...g.listings].some(r=>textMatch({...r,sku:g.sku},search)))).sort((a,b)=>(b[sort]??-1)-(a[sort]??-1)||b.pending-a.pending||b.online-a.online||a.sku.localeCompare(b.sku,'fr'))
  const unknown=groups.find(g=>!g.key),missing=board.emptyOrders.filter(r=>!account||r.account===account)
  const current=groups.find(g=>g.key===detail&&g.sold>0)
  const size=30,here=Math.min(page,Math.max(0,Math.ceil(rows.length/size)-1))
  const visible=rows.slice(here*size,(here+1)*size)
  const update=setter=>value=>{setter(value);setPage(0);setDetail(null)}
  const identified=groups.filter(g=>g.key).reduce((n,g)=>n+g.sold,0)
  return <><div className="shop-subheading"><h2>Meilleures ventes par SKU</h2><span>{salesPeriodLabel} · {identified} article{identified>1?'s':''} vendu{identified>1?'s':''} avec SKU</span></div>
    <ShopFilters search={search} setSearch={update(setSearch)} hint="SKU ou titre de l’article" account={account} setAccount={update(setAccount)} accounts={accounts}
      sort={sort} setSort={update(setSort)} options={[['sold','Articles vendus'],['completed','Ventes terminées'],['pending','Ventes en cours'],['online','Annonces en ligne'],['favourites','Favoris']]}/>
    {(unknown?.sold>0||missing.length>0)&&<div className="shop-unmatched">
      {unknown?.sold>0&&<button onClick={()=>setDetail('')}>Ventes à identifier ({unknown.sold})</button>}
      {missing.length>0&&<button onClick={()=>setDetail(':orders')}>Commandes sans détail article ({missing.length})</button>}
    </div>}
    <div className="shop-rank-toolbar">
      <p aria-live="polite">{rows.length} référence{rows.length>1?'s':''}</p>
      <div className="shop-view-switch" role="group" aria-label="Affichage du classement">
        <button type="button" aria-pressed={view==='photos'} onClick={()=>setView('photos')}>Photos</button>
        <button type="button" aria-pressed={view==='table'} onClick={()=>setView('table')}>Tableau</button>
      </div>
    </div>
    {view==='photos'?<div className="shop-grid" aria-label="Classement par SKU" role="region">
      {visible.map(group=><RankingCard key={group.key} group={group} open={()=>setDetail(group.key)}/>)}
    </div>:<div className="shop-rank-scroll"><table className="shop-rank"><caption className="sr-only">Classement par SKU</caption><thead><tr><th>Article et SKU</th><th>Vendus</th><th>Terminées</th><th>En cours</th><th>Publiées</th><th>En ligne</th><th>Favoris</th><th>Dernière vente</th></tr></thead>
    <tbody>{visible.map(g=><tr key={g.key}><th scope="row"><div className="shop-rank-item"><button onClick={()=>setDetail(g.key)}><span className="shop-mini"><ShopCover src={g.photo} title={g.title} small/></span><span><b>{g.sku}</b><small>{g.title||'Article'}</small></span></button><CopySkuButton sku={g.sku}/></div></th>
      <td><strong>{g.sold}</strong></td><td>{g.completed}</td><td>{g.pending}</td><td>{g.published}</td><td>{g.online}</td><td>{g.favourites??'—'}</td><td>{calendar(g.lastSale)}</td></tr>)}</tbody></table></div>}
    {!rows.length&&<p className="shop-empty">Aucune vente associée à un SKU pour cette sélection.</p>}<PageBar page={here} setPage={setPage} total={rows.length} size={size}/>
    {(current||detail===':orders'&&missing.length>0)&&<ResourceDialog title={detail===':orders'?'Commandes à vérifier':current.sku||'Ventes à identifier'} onClose={()=>setDetail(null)}>
      <SkuDetail key={detail} row={current} orders={detail===':orders'?missing:[]} salesOnly={detail===''} skuOptions={detail===''?board.groups.filter(g=>g.key):[]} onLink={admin?reread:null}/></ResourceDialog>}
  </>
}
