import {useMemo,useState} from 'react'
import CopySkuButton from './CopySkuButton'
import {act} from '../lib/scalency'
import {calendar,listingRows,price,recordKey,sortListings,statusLabels,textMatch} from '../lib/shopView'
import {FilterTabs,PageBar,PrintArticles,SelectionBar,ShopCover,ShopFilters,ShopHeader,useShopSelection} from './ShopControls'
import ResourceDialog from './ResourceDialog'
import ShopRanking from './ShopRanking'
import useShopBoard from './useShopBoard'
import './ShopBoard.css'

function Card({row,selected,toggle,open}){
  const name=row.title||'Annonce '+row.id
  return <article className={'shop-card'+(selected?' selected':'')}>
    <div className="shop-photo"><button className="shop-photo-open" aria-label={'Ouvrir '+name} onClick={open}><ShopCover src={row.photo} title={name}/></button>
      <label className="shop-check"><input type="checkbox" checked={selected} onChange={toggle} aria-label={'Sélectionner '+name}/></label>
      <span className={'shop-badge '+row.state}>{statusLabels[row.state]?.replace('Vendues','Vendue').replace('Masquées','Masquée').replace('Brouillons','Brouillon')}</span>
    </div>
    <div className="shop-card-body"><button className="shop-card-title" onClick={open}>{name}</button>
      <div className="shop-sku-row"><p className={'shop-sku'+(!row.sku?' missing':'')}>{row.sku?'SKU '+row.sku:'SKU à identifier'}</p><CopySkuButton key={row.sku} sku={row.sku}/></div>
      <p className="shop-card-price"><strong>{price(row.price,row.currency)}</strong><span>{row.account}</span></p>
      {!row.isDraft&&<p className="shop-metrics"><span>{row.views??'—'} vues</span><span>♡ {row.favourites??'—'} favoris</span></p>}
      <p className="shop-card-date">{row.date?(row.isDraft?'Modifié le ':row.approx?'Vers le ':'Publié le ')+calendar(row.date):'Date de publication inconnue'}</p>
      {!row.isDraft&&<a className="shop-vinted" href={'https://www.vinted.fr/items/'+encodeURIComponent(row.id)} target="_blank" rel="noreferrer">Voir sur Vinted ↗</a>}
    </div>
  </article>
}
function ListingDetail({row,admin,reread,onClose}){
  const [sku,setSku]=useState(''),[busy,setBusy]=useState(false),[error,setError]=useState('')
  async function save(e){e.preventDefault();if(!sku.trim()||busy)return;setBusy(true)
    try{await act('sku-link',{kind:'listing',account:row.account,id:row.id,sku:sku.trim()});await reread();onClose()}
    catch(err){setError(err.message)}finally{setBusy(false)}}
  return <ResourceDialog title={row.title||'Fiche article'} onClose={onClose}><div className="shop-product-detail"><div className="shop-detail-photo"><ShopCover title={row.title} src={row.photo}/></div>
    <div><strong>{price(row.price,row.currency)}</strong><p>{row.account} · {row.status}</p><dl>
    {[['SKU',row.sku],['Taille',row.size],['Emplacement',row.location],['Numéro',row.id],['Vues',row.views],['Favoris',row.favourites]].map(([k,v])=><div key={k}><dt>{k}</dt><dd>{v==null||v===''?'—':v}{k==='SKU'&&<CopySkuButton sku={v}/>}</dd></div>)}</dl>
    {row.sku&&<a href={'#dressing/sku?'+new URLSearchParams({sku:row.sku})}>Voir les ventes de ce SKU</a>}
    {row.isDraft?<a href={'#annonces?'+new URLSearchParams({account:row.accountId||'',draft:row.id})}>Modifier le brouillon</a>:<>
      <a href={'https://www.vinted.fr/items/'+encodeURIComponent(row.id)} target="_blank" rel="noreferrer">Ouvrir sur Vinted ↗</a>
      {row.inventory&&<a href={'#dressing?'+new URLSearchParams({id:row.id,account:row.accountId})}>Voir la fiche stock</a>}
      {!row.sku&&admin&&<form className="shop-sku-form" onSubmit={save}><label>Associer un SKU<input value={sku} onChange={e=>setSku(e.target.value)} maxLength={150} required/></label><button className="shop-primary" disabled={busy||!sku.trim()}>Enregistrer</button></form>}</>}
    {error&&<p role="alert">{error}</p>}</div></div></ResourceDialog>
}
function Gallery({board,admin,params,reread,accounts}){
  const all=useMemo(()=>listingRows(board),[board])
  const [account,setAccount]=useState(params.login||all.find(r=>r.accountId===params.account)?.account||params.account||''),[search,setSearch]=useState('')
  const [skuFilter,setSkuFilter]=useState('all')
  const [sort,setSort]=useState('recent'),[status,setStatus]=useState('all'),[age,setAge]=useState('all'),[page,setPage]=useState(0)
  const [detail,setDetail]=useState(null),[print,setPrint]=useState(null)
  const selection=useShopSelection()
  const update=setter=>value=>{setter(value);setPage(0);selection.clear()}
  const cutoff=Date.now()-30*86400000
  const match=all.filter(r=>(!account||r.account===account)&&textMatch(r,search)&&(skuFilter==='all'||(skuFilter==='known'?!!r.sku:!r.sku))&&(age==='all'||r.date&&(age==='new'?Date.parse(r.date)>=cutoff:Date.parse(r.date)<cutoff)))
  const counts={all:match.length}
  for(const r of match)counts[r.state]=(counts[r.state]||0)+1
  const rows=sortListings(match.filter(r=>status==='all'||r.state===status),sort)
  const picked=rows.filter(r=>selection.keys.has(recordKey(r))),size=36,here=Math.min(page,Math.max(0,Math.ceil(rows.length/size)-1))
  const displayed=rows.slice(here*size,(here+1)*size)
  return <><ShopFilters search={search} setSearch={update(setSearch)} hint="Titre, compte, SKU ou n° d’annonce" account={account} setAccount={update(setAccount)} accounts={accounts}
    sort={sort} setSort={setSort} options={[[ 'recent','Plus récentes'],['likes','Plus de favoris'],['views','Plus de vues'],['price','Prix décroissant']]}>
    <label><span>Ancienneté</span><select value={age} onChange={e=>update(setAge)(e.target.value)}><option value="all">Toutes les dates</option><option value="new">30 jours ou moins</option><option value="old">Plus de 30 jours</option></select></label>
    <label><span>Référence</span><select value={skuFilter} onChange={e=>update(setSkuFilter)(e.target.value)}><option value="all">Tous les SKU</option><option value="known">Avec SKU</option><option value="missing">SKU à identifier</option></select></label></ShopFilters>
    <FilterTabs options={statusLabels} counts={counts} value={status} onChange={update(setStatus)} label="État de l’annonce"/>
    <SelectionBar count={picked.length} totalVisible={rows.length} noun="annonces" selection={selection} pageKeys={displayed.map(recordKey)}>
      <button className="shop-primary" disabled={!picked.length} onClick={()=>setPrint(picked.map(r=>({...r,reference:r.isDraft?'Brouillon':'Annonce n° '+r.id})))}>Imprimer les fiches{picked.length?' ('+picked.length+')':''}</button>
    </SelectionBar>
    {rows.length?<div className="shop-grid">{displayed.map(r=><Card key={recordKey(r)} row={r} selected={selection.keys.has(recordKey(r))} toggle={()=>selection.toggle(recordKey(r))} open={()=>setDetail(r)}/>)}</div>:
      <p className="shop-empty">Aucune annonce avec ces filtres.</p>}
    <PageBar page={here} setPage={setPage} total={rows.length} size={size}/>
    {detail&&<ListingDetail row={detail} admin={admin} reread={reread} onClose={()=>setDetail(null)}/>}
    {print&&<PrintArticles rows={print} onClose={()=>setPrint(null)}/>}
  </>
}
export default function Wardrobe({params,admin}){
  const {board,busy,error,refresh,reread}=useShopBoard()
  const ranking=params.section==='sku'
  const accounts=useMemo(()=>board?[...new Set([...board.groups.flatMap(g=>[...g.listings,...g.sales].map(r=>r.account)),...board.drafts.map(r=>r.account)])].filter(Boolean).sort():[],[board])
  return <main className="shop-work"><ShopHeader title="Dressing" busy={busy} refresh={refresh}>
    <nav className="shop-views" aria-label="Dressing"><a href="#dressing" aria-current={!ranking?'page':undefined}>Annonces</a><a href="#dressing/sku" aria-current={ranking?'page':undefined}>Meilleures ventes par SKU</a></nav></ShopHeader>
    {error&&<p className="shop-alert" role="alert">{error}</p>}
    {!board&&!error&&<p role="status" className="shop-empty">Chargement du dressing…</p>}
    {board&&(ranking?<ShopRanking board={board} initialSku={params.sku} accounts={accounts} admin={admin} reread={reread}/>:<Gallery board={board} params={params} accounts={accounts} admin={admin} reread={reread}/>)}
  </main>
}
