import {useEffect,useRef,useState} from 'react'
import {act,query} from '../lib/scalency'
import {publicationDate,publicationProgress} from '../lib/publicationTracking'
import PublicationLots from './PublicationLots'
import DailyPublicationCount from './DailyPublicationCount'
import './PublicationTracker.css'

const tabs=[['queue','À publier'],['drafts','Brouillons'],['live','Mises en ligne'],['history','Historique'],['lots','Par lot']]
const operations={
  launch:{label:'Mettre en file',description:'Scalency publiera ces annonces au rythme du compte.'},
  'stop-local':{label:'Arrêter',description:'Les fiches sélectionnées reviendront dans les brouillons.'},
  cancel:{label:'Arrêter',description:'Scalency tentera d’arrêter les publications sélectionnées. Une annonce déjà en ligne reste publiée.'},
  remove:{label:'Retirer de Vinted',description:'Scalency recevra une demande de suppression pour chaque annonce sélectionnée.'},
  discard:{label:'Supprimer le brouillon',plural:'Supprimer les brouillons',description:'Les brouillons sélectionnés seront supprimés de Stock Vinted.'}
}
const keyOf=r=>r.kind+'-'+r.id
const titleOf=r=>r.title||r.sku||'Annonce sans titre'
function progress(row){
  if(row.removal==='deleted')return {label:'Retirée de Vinted',tone:'muted'}
  if(row.removal==='removing')return {label:'Retrait demandé',tone:'planned'}
  if(row.removal==='remove-failed')return {label:'Retrait à reprendre',tone:'warning'}
  if(row.kind==='job')return publicationProgress(row)
  if(row.state==='preparing')return {label:row.actions.length?'En attente d’envoi':'Transmission en cours',tone:'pending'}
  if(row.state==='attention'||['error','review'].includes(row.batch))return {label:'À vérifier',tone:'warning',detail:row.reason}
  if(row.batch==='ready')return {label:'Prête à publier',tone:'success'}
  if(row.batch==='running')return {label:'Génération en cours',tone:'pending'}
  return {label:'Brouillon',tone:'muted'}
}
function pageLink(tab,account){
  const params=new URLSearchParams({tab})
  if(account)params.set('account',account)
  return '#publication?'+params
}
function Confirm({choice,onClose,onApply,busy}){
  const dialog=useRef(null)
  useEffect(()=>{dialog.current?.showModal()},[])
  const action=operations[choice.action],n=choice.rows.length
  return <dialog className="pub-dialog" ref={dialog} aria-labelledby="pub-confirm" onCancel={e=>{if(busy)e.preventDefault();else onClose()}}>
    <h2 id="pub-confirm">{action.plural&&n>1?action.plural:action.label} · {n} annonce{n>1?'s':''}</h2>
    <p>{action.description}</p><ul>{choice.rows.map(r=><li key={keyOf(r)}>{titleOf(r)}{r.size&&' · '+r.size}</li>)}</ul>
    <footer><button autoFocus disabled={busy} onClick={onClose}>Revenir</button><button className={choice.action==='launch'?'pub-primary':'pub-danger'} disabled={busy} onClick={onApply}>{busy?'Traitement…':'Confirmer'}</button></footer>
  </dialog>
}
function Listing({row,login,selected,onSelect,onAction,disabled}){
  const info=progress(row),title=titleOf(row)
  const date=row.kind==='draft'?row.date:row.done_at||row.sent_at||row.not_before||row.created_at
  return <article className={'pub-row'+(selected?' chosen':'')}>
    <input type="checkbox" aria-label={'Sélectionner '+title} checked={selected} disabled={disabled||!row.actions.length} onChange={onSelect}/>
    <div className="pub-cover">{row.photo?<img src={row.photo} alt="" loading="lazy"/>:<span aria-label="Sans photo">◇</span>}</div>
    <div className="pub-copy"><h3>{title}</h3><p>{[login,row.size&&'Taille '+row.size,row.sku&&'SKU '+row.sku].filter(Boolean).join(' · ')}</p>
      <span className={'pt-badge '+info.tone}>{info.label}</span>{date&&<time dateTime={date}>{publicationDate(date)}</time>}
      {row.kind==='job'&&<details><summary>Détails du suivi</summary><p>{info.detail||row.reason||info.label}</p>
        <p>Demande n° {row.id}</p>{row.new_item_id&&row.removal!=='deleted'&&<a target="_blank" rel="noreferrer" href={'https://www.vinted.fr/items/'+row.new_item_id}>Voir sur Vinted ↗</a>}</details>}
      {row.kind==='draft'&&info.detail&&<p>{info.detail}</p>}
    </div>
    <div className="pub-row-actions">{row.kind==='draft'&&row.state==='draft'&&<a href={'#annonces?draft='+row.id}>Modifier</a>}
      {row.actions.map(a=><button disabled={disabled} key={a} className={a==='launch'?'pub-launch':'pub-action'} onClick={()=>onAction(a,[row])}>{a==='discard'?'Supprimer':operations[a].label}</button>)}</div>
  </article>
}

export default function PublicationTracker({params}){
  const tab=params.lot?'lots':tabs.some(([key])=>key===params.tab)?params.tab:'queue'
  const account=params.account||'',job=params.job||'',draft=params.draft||''
  const [data,setData]=useState(null),[error,setError]=useState(''),[loading,setLoading]=useState(false)
  const [input,setInput]=useState(''),[search,setSearch]=useState(''),[page,setPage]=useState(0),[cursors,setCursors]=useState([''])
  const [selection,setSelection]=useState({}),[choice,setChoice]=useState(null),[busy,setBusy]=useState(false),[receipt,setReceipt]=useState(null),[revision,setRevision]=useState(0)
  const lock=useRef(false),scope=[tab,account,job,draft].join('|'),[viewScope,setViewScope]=useState(scope)
  if(scope!==viewScope){setViewScope(scope);setSearch('');setInput('');setPage(0);setCursors(['']);setSelection({});setChoice(null);setReceipt(null);setData(null)}
  const cursor=cursors[cursors.length-1]
  useEffect(()=>{setData(null);setError('')},[scope,search,page,cursor])
  useEffect(()=>{const t=setTimeout(()=>{setSearch(input.trim());setPage(0);setCursors(['']);setSelection({})},280);return ()=>clearTimeout(t)},[input])
  useEffect(()=>{
    let alive=true,reading=false
    async function read(){
      if(reading||!alive)return
      reading=true;setLoading(true)
      try{const next=await query('publication-tracking',{tab,account,job,draft,search,cursor,draftPage:page});if(alive){setData(next);setError('')}}
      catch(e){if(alive)setError(e.message)}finally{reading=false;if(alive)setLoading(false)}
    }
    read()
    const visible=()=>{if(document.visibilityState==='visible')read()}
    const timer=setInterval(visible,30000);document.addEventListener('visibilitychange',visible)
    return ()=>{alive=false;clearInterval(timer);document.removeEventListener('visibilitychange',visible)}
  },[scope,tab,account,job,draft,search,page,cursor,revision])
  const accounts=data?.accounts||[],logins=new Map(accounts.map(a=>[a.id,a.login]))
  const rows=[...(data?.drafts||[]),...(data?.jobs||[])],eligible=rows.filter(r=>r.actions.length)
  const picked=eligible.filter(r=>selection[keyOf(r)])
  function toggle(row){setSelection(old=>({...old,[keyOf(row)]:!old[keyOf(row)]}))}
  function ask(action,items){if(items.length)setChoice({action,rows:items})}
  async function apply(){
    if(lock.current||!choice)return
    lock.current=true;setBusy(true);const results=[]
    try{
      if(choice.action==='launch'){
        const groups=new Map()
        for(const r of choice.rows)groups.set(r.account,[...(groups.get(r.account)||[]),r])
        for(const [acct,rs] of groups)try{const lot=await act('accept-lot',{account:acct,entries:rs.map(({id,version})=>({id,version}))});results.push({ok:true,text:rs.length+' annonce(s) en file sur Stock Vinted.',href:'#publication?lot='+lot.id})}
          catch(e){results.push({ok:false,text:(logins.get(acct)||acct)+' · '+e.message})}
      }else for(const row of choice.rows){
        const operation=choice.action==='cancel'&&row.kind==='draft'?'stop-local':choice.action
        try{const r=await act('manage-publication',{operation,id:row.id,version:row.version,account:row.account});results.push({ok:true,text:titleOf(row)+' · '+r.message})}
        catch(e){results.push({ok:false,text:titleOf(row)+' · '+e.message})}
      }
      setReceipt(results);setSelection({});setChoice(null);setRevision(n=>n+1)
    }finally{lock.current=false;setBusy(false)}
  }
  const allSelected=eligible.length>0&&picked.length===eligible.length
  const bulk=[...new Set(picked.flatMap(r=>r.actions.map(a=>a==='stop-local'?'cancel':a)))]
  const groupFor=a=>picked.filter(r=>r.actions.includes(a)||(a==='cancel'&&r.actions.includes('stop-local')))
  const pageCount=Math.ceil((data?.draftTotal||0)/(data?.pageSize||20))
  return <main className="sc-work pt-work pub-console">
    <header className="pub-header"><div><h1>Publications</h1><p>Suivi des annonces sur Stock Vinted et Scalency</p></div><a className="pub-primary" href="#annonces?nouvelle=1">+ Nouvelle annonce</a></header>
    <DailyPublicationCount/>
    <nav className="pub-tabs" aria-label="Étapes de publication">{tabs.map(([value,label])=><a key={value} aria-current={!job&&tab===value?'page':undefined} href={pageLink(value,account)}>{label}</a>)}</nav>
    <div className="pub-filters">{!job&&!draft&&tab!=='lots'&&<label>Rechercher<input type="search" placeholder="Titre ou SKU" maxLength={120} value={input} onChange={e=>{setInput(e.target.value);setSelection({})}}/></label>}
      {!job&&!draft&&!params.lot&&<label>Compte<select value={account} onChange={e=>{window.location.hash=pageLink(tab,e.target.value)}}><option value="">Tous les comptes</option>{accounts.map(a=><option key={a.id} value={a.id}>{a.login}</option>)}</select></label>}
      <button disabled={loading||busy} onClick={()=>setRevision(n=>n+1)}>{loading?'Actualisation…':'Actualiser'}</button></div>
    {error&&<p className="sc-error" role="alert">{error}</p>}
    {receipt&&<div className="pub-receipt" role="status"><strong>Résultat de la sélection</strong><button onClick={()=>setReceipt(null)} aria-label="Fermer le résultat">×</button>{receipt.map((r,i)=><p key={i} className={r.ok?'':'sc-error'}>{r.text} {r.href&&<a href={r.href}>Suivre le lot</a>}</p>)}</div>}
    {tab==='lots'&&!job?<PublicationLots key={account+(params.lot||'')+revision} account={account} lotId={params.lot||''}/>:<section className="pub-panel" aria-busy={loading}>
      <div className="pub-panel-head"><h2>{job||draft?'Annonce sélectionnée':({queue:'En attente et en cours',drafts:'Brouillons du site',live:'Annonces mises en ligne',history:'Arrêts et incidents'})[tab]}</h2>
        {(job||draft)&&<a href={pageLink(tab,account)}>Retour à la liste</a>}</div>
      {eligible.length>0&&<div className="pub-select"><label><input type="checkbox" aria-label="Sélectionner toutes les annonces disponibles sur cette page" checked={allSelected} disabled={busy} onChange={()=>setSelection(allSelected?{}:Object.fromEntries(eligible.map(r=>[keyOf(r),true])))}/> {picked.length?picked.length+' sélectionnée(s)':'Sélectionner la page'}</label>
        {bulk.map(a=><button key={a} disabled={busy} onClick={()=>ask(a,groupFor(a))}>{(groupFor(a).length>1&&operations[a].plural)||operations[a].label} ({groupFor(a).length})</button>)}</div>}
      {rows.map(row=><Listing key={keyOf(row)} row={row} login={logins.get(row.account)||row.account} selected={!!selection[keyOf(row)]} disabled={busy} onSelect={()=>toggle(row)} onAction={ask}/>)}
      {!rows.length&&<div className="pub-empty">{loading?'Chargement des annonces…':error?'Informations indisponibles.':search?'Aucun résultat sur les pages consultées.':tab==='queue'?'Aucune mise en ligne en attente sur cette page.':'Aucune annonce dans cette vue.'}</div>}
      {pageCount>1&&<div className="pub-pager"><button disabled={page===0||busy} onClick={()=>{setPage(page-1);setSelection({})}}>Précédent</button><span>Brouillons · {page+1} / {pageCount}</span><button disabled={page+1>=pageCount||busy} onClick={()=>{setPage(page+1);setSelection({})}}>Suivant</button></div>}
      {(cursors.length>1||data?.nextCursor)&&<div className="pub-pager"><button disabled={cursors.length<2||busy} onClick={()=>{setCursors(c=>c.slice(0,-1));setSelection({})}}>Précédent</button><span>Scalency · page {cursors.length}</span><button disabled={!data?.nextCursor||busy} onClick={()=>{setCursors(c=>[...c,data.nextCursor]);setSelection({})}}>Suivant</button></div>}
    </section>}
    <footer className="pub-foot"><span>{data?.checkedAt&&'Actualisé le '+publicationDate(data.checkedAt)+' · Paris'}</span><a href="#publication?section=actions">Journal Scalency ↗</a></footer>
    {choice&&<Confirm choice={choice} busy={busy} onClose={()=>{if(!lock.current)setChoice(null)}} onApply={apply}/>}
  </main>
}
