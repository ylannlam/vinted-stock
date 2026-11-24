import {useEffect,useMemo,useRef,useState} from 'react'
import {act,query} from '../lib/scalency'
import {buildSkuActivity,skuFeeds} from '../lib/skuActivity'
import './SkuActivity.css'
import DailyPublicationCount from './DailyPublicationCount'

const sources={comptes:'Comptes',annonces:'Annonces',supprimees:'Annonces supprimées',publications:'Publications',republications:'Republications',commandes:'Commandes'}
const columns=[['published','Déjà publiées'],['online','En ligne'],['completed','Ventes terminées'],['pending','Ventes en cours']]
const number=n=>n.toLocaleString('fr-FR')
const date=value=>value?new Date(value).toLocaleDateString('fr-FR'):'—'
const perPage=25
function Pager({count,page,change}){
  if(count<=perPage)return null
  return <div className="sku-pager"><button disabled={!page} onClick={()=>change(page-1)}>Précédent</button><span>{page+1} / {Math.ceil(count/perPage)}</span><button disabled={(page+1)*perPage>=count} onClick={()=>change(page+1)}>Suivant</button></div>
}
function Detail({row,orders=[],onLink}){
  const [tab,setTab]=useState(row?.listings.length?'listings':'sales'),[page,setPage]=useState(0)
  const [editing,setEditing]=useState(null),[sku,setSku]=useState(''),[busy,setBusy]=useState(false),[error,setError]=useState('')
  const listings=tab==='listings',all=orders.length?orders:listings?row.listings:row.sales
  const here=Math.min(page,Math.max(0,Math.ceil(all.length/perPage)-1))
  async function save(e){
    e.preventDefault();if(busy||!sku.trim())return
    setBusy(true);setError('')
    try{const value=await act('sku-link',{...editing,sku:sku.trim()});onLink(value);setEditing(null);setSku('')}
    catch(e){setError(e.message)}finally{setBusy(false)}
  }
  return <section className="sku-detail"><h2>{orders.length?'Commandes sans détail article':row.sku||'À identifier'}</h2>
    {!orders.length&&<div className="sku-tabs">{[['listings','Annonces',row.listings],['sales','Articles vendus ou en cours',row.sales]].map(([id,title,items])=><button key={id} aria-pressed={tab===id} onClick={()=>{setTab(id);setPage(0);setEditing(null)}}>{title} ({number(items.length)})</button>)}</div>}
    {!all.length&&<p>Aucun article dans cette sélection.</p>}
    {all.slice(here*perPage,(here+1)*perPage).map((r,i)=>{
      const isAd=!orders.length&&listings
      const dest=isAd?('https://www.vinted.fr/items/'+encodeURIComponent(r.id)):(r.id?'#ventes?'+new URLSearchParams({id:r.id,account:r.account}):'')
      const match=!orders.length&&!row.sku&&(isAd||r.lineId)
      return <div className="sku-line" key={JSON.stringify([r.account,r.id,r.lineId,i])}><div><strong>{r.title||r.id||'Article'}</strong>
        <small>{[r.account,isAd?r.status:r.stage==='completed'?'Vente terminée':'Vente en cours',!isAd&&date(r.date),!isAd&&r.qty>1&&('Quantité '+r.qty)].filter(Boolean).join(' · ')}</small></div>
        <div>{dest&&<a href={dest} {...(isAd?{target:'_blank',rel:'noreferrer'}:{})}>{isAd?'Voir sur Vinted':'Voir la vente'}</a>}
        {match&&<button disabled={busy} onClick={()=>{setEditing({kind:isAd?'listing':'sale',account:r.account,id:r.id,line:r.lineId||''});setSku('');setError('')}}>Associer un SKU</button>}</div></div>
    })}
    {editing&&<form className="sku-edit" onSubmit={save}><label>SKU de l’article {editing.line||editing.id}<input autoFocus required maxLength={150} value={sku} onChange={e=>setSku(e.target.value)}/></label><button disabled={busy}>Enregistrer</button><button type="button" disabled={busy} onClick={()=>setEditing(null)}>Annuler</button></form>}
    {error&&<p role="alert">{error}</p>}<Pager count={all.length} page={here} change={setPage}/>
  </section>
}
export default function SkuActivity(){
  const [data,setData]=useState(null),[revision,setRevision]=useState(0),[progress,setProgress]=useState('Lecture de Scalency…'),[error,setError]=useState('')
  const [account,setAccount]=useState(''),[term,setTerm]=useState(''),[sort,setSort]=useState('completed'),[page,setPage]=useState(0),[selected,setSelected]=useState(null)
  const details=useRef(null)
  useEffect(()=>{if(selected!==null)details.current?.scrollIntoView?.({block:'start'})},[selected])
  useEffect(()=>{
    let live=true
    async function read(){
      setProgress('Lecture des références du stock…');setError('')
      const refs=await query('sku-references'),feeds={}
      for(const feed of skuFeeds){
        let cursor='',pageNo=0;const seen=new Set();feeds[feed]=[]
        do{
          if(!live)return
          setProgress(sources[feed]+' · page '+(++pageNo))
          let result
          try{result=await query('sku-feed',{feed,cursor})}
          catch(e){
            if(!e.retryAfterSeconds)throw e
            if(!live)return
            setProgress('Pause demandée par Scalency · reprise dans '+e.retryAfterSeconds+' s')
            await new Promise(resolve=>setTimeout(resolve,e.retryAfterSeconds*1000))
            if(!live)return
            result=await query('sku-feed',{feed,cursor})
          }
          feeds[feed].push(...result.rows);cursor=result.next
          if(cursor&&seen.has(cursor))throw Error('Scalency a renvoyé deux fois la même page.')
          if(cursor)seen.add(cursor)
        }while(cursor)
      }
      if(live){setData({feeds,refs,stamp:new Date()});setProgress('')}
    }
    read().catch(e=>{if(live){setError(e.message);setProgress('')}})
    return()=>{live=false}
  },[revision])
  const report=useMemo(()=>data?buildSkuActivity(data.feeds,data.refs,account):null,[data,account])
  const rows=report?.rows||[],unknown=rows.find(r=>!r.key)
  const totals=Object.fromEntries(columns.map(([k])=>[k,rows.reduce((n,r)=>n+r[k],0)]))
  const search=term.trim().toLowerCase()
  const shown=rows.filter(r=>r.key&&(!search||r.key.includes(search)||r.title.toLowerCase().includes(search))).sort((a,b)=>b[sort]-a[sort]||b.online-a.online||a.sku.localeCompare(b.sku,'fr'))
  const current=rows.find(r=>r.key===selected),here=Math.min(page,Math.max(0,Math.ceil(shown.length/perPage)-1))
  const link=value=>setData(prev=>({...prev,refs:{...prev.refs,manual:[...(prev.refs.manual||[]),value]}}))
  return <main className="sc-work sku-work"><header className="sc-head"><div><a href="#dressing">Dressing</a><h1>Suivi par SKU</h1>{data&&<small>Scalency · Actualisé à {data.stamp.toLocaleTimeString('fr-FR',{hour:'2-digit',minute:'2-digit'})}</small>}</div>
    <button disabled={!!progress} onClick={()=>setRevision(v=>v+1)}>Actualiser depuis Scalency</button></header>
    <DailyPublicationCount/>
    {progress&&<p role="status">{progress}</p>}{error&&<p role="alert" className="sc-error">Lecture incomplète. {error}</p>}
    {report&&<><div className="sku-tools"><label>Compte<select value={account} onChange={e=>{setAccount(e.target.value);setPage(0);setSelected(null)}}><option value="">Tous les comptes</option>{report.accounts.map(a=><option key={a}>{a}</option>)}</select></label></div>
    <div className="sku-metrics">{columns.map(([k,label])=><div key={k}><span>{label}</span><strong>{number(totals[k])}</strong></div>)}</div>
    <p className="sku-note">Chaque numéro d’annonce compte une fois. Les ventes terminées comptent les articles, y compris ceux vendus en lot. Les commandes annulées, expirées ou en retour sont exclues.</p>
    <div className="sku-tools"><label>Rechercher<input type="search" placeholder="SKU ou titre d’article" value={term} onChange={e=>{setTerm(e.target.value);setPage(0)}}/></label><label>Trier par<select value={sort} onChange={e=>{setSort(e.target.value);setPage(0)}}>{columns.map(([k,label])=><option key={k} value={k}>{label}</option>)}</select></label></div>
    <div className="sku-table"><table><caption>{number(shown.length)} références</caption><thead><tr><th>SKU et article</th>{columns.map(([k,l])=><th key={k}>{l}</th>)}<th>Dernière vente terminée</th></tr></thead>
    <tbody>{shown.slice(here*perPage,(here+1)*perPage).map(r=><tr key={r.key}><th><button aria-expanded={selected===r.key} onClick={()=>setSelected(selected===r.key?null:r.key)}>{r.sku}</button><small>{r.title}</small></th>{columns.map(([k])=><td key={k}>{number(r[k])}</td>)}<td>{date(r.lastSale)}</td></tr>)}</tbody></table>{!shown.length&&<p>Aucune référence pour cette recherche.</p>}</div><Pager count={shown.length} page={here} change={setPage}/>
    <div className="sku-audit">{unknown&&<button onClick={()=>setSelected(selected===''?null:'')}>À identifier · {number(unknown.published)} annonces et {number(unknown.completed+unknown.pending)} articles en vente terminée ou en cours</button>}
      {!!report.emptyOrders.length&&<button onClick={()=>setSelected(selected===':orders'?null:':orders')}>{number(report.emptyOrders.length)} commandes sans détail article</button>}</div>
    <div ref={details} style={{scrollMarginTop:'6rem'}}>{current&&<Detail key={current.key+account} row={current} onLink={link}/>}
    {selected===':orders'&&report.emptyOrders.length>0&&<Detail key={'orders'+account} orders={report.emptyOrders}/>}</div>
    </>}
  </main>
}
