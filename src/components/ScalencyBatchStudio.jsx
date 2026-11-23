import {useCallback,useEffect,useRef,useState} from 'react'
import {act,query,formatMoney} from '../lib/scalency'
import {listingColors} from '../lib/scalencyQuick'
import BatchEntry from './BatchEntry'
import ScalencyDraft from './ScalencyDraft'
import ScalencyQuickAccount from './ScalencyQuickAccount'
import './ScalencyBatchStudio.css'

const labels={draft:'Brouillon',running:'Remplissage…',ready:'Prête à relire',review:'À compléter',error:'À reprendre'}
function stage(row){
  const b=row.batch
  if(b?.status==='running'&&Date.now()-Date.parse(b.started)>600000)return 'error'
  return labels[b?.status]?b.status:'draft'
}
function Cover({row}){
  return row.photo?<img className="bs-cover" src={row.photo} loading="lazy" alt=""/>:<span className="bs-cover bs-placeholder" aria-label="Sans aperçu">—</span>
}
function ReviewRow({row,onEdit,disabled}){
  const f=row.fields
  return <article className="bs-review-item"><div className="bs-review-head"><Cover row={row}/><div><h3>{f.title}</h3><p>{f.sku} · {f.size_text} · {formatMoney(f.price)}</p></div></div>
    <p>{[row.batch?.category||'Catégorie '+f.catalog_id,f.brand_title,(f.color_ids||[]).map(id=>listingColors.find(c=>c.id===id)?.title).filter(Boolean).join(' / '),'Petit colis'].filter(Boolean).join(' · ')}</p>
    <details><summary>Lire la bio</summary><p className="bs-bio">{f.description}</p></details>
    <button className="bs-link" disabled={disabled} onClick={()=>onEdit(row.id)}>Modifier la fiche</button>
  </article>
}
export default function ScalencyBatchStudio({params}){
  const [profiles,setProfiles]=useState([]),[owner,setOwner]=useState(''),[account,setAccount]=useState(params.account||'')
  const [page,setPage]=useState(0),[data,setData]=useState(null),[error,setError]=useState(''),[notice,setNotice]=useState('')
  const [selected,setSelected]=useState({}),[review,setReview]=useState(false),[sending,setSending]=useState(false),[receipts,setReceipts]=useState([])
  const [local,setLocal]=useState({}),[saving,setSaving]=useState(false),[revision,setRevision]=useState(0)
  const [editor,setEditor]=useState(params.draft||(params.piece||params.product||params.sku?'new':''))
  const lock=useRef(false),active=useRef(true),userPicked=useRef(false),pending=useRef(new Set())
  const login=profiles.find(a=>a.id===account)
  const reload=useCallback(()=>setRevision(n=>n+1),[])
  useEffect(()=>{active.current=true;return()=>{active.current=false}},[])
  useEffect(()=>{
    let live=true
    async function read(){
      try{
        const r=await query('quick-profiles');if(!live)return
        setProfiles(r.accounts);setOwner(r.owner)
        let last='';try{last=localStorage.getItem('scalency-last-account:'+r.owner)||''}catch{}
        if(!userPicked.current&&!params.account&&r.accounts.some(a=>a.id===last))setAccount(last)
      }catch(e){if(live)setError(e.message)}
    }
    read()
    act('sync',{kind:'accounts',force:false}).then(()=>{if(live)read()}).catch(()=>{})
    return()=>{live=false}
  },[params.account])
  useEffect(()=>{
    let live=true
    query('batch-drafts',{account,page}).then(r=>{
      if(!live)return
      setData(r);setError('')
      setSelected(prev=>Object.fromEntries(Object.entries(prev).filter(([id,row])=>{
        const current=r.rows.find(x=>x.id===id)
        return !current||current.version===row.version&&stage(current)==='ready'
      })))
      if(!r.rows.length&&page)setPage(p=>p-1)
    }).catch(e=>{if(live)setError(e.message)})
    return()=>{live=false}
  },[account,page,revision])
  const inProgress=!!Object.keys(local).length||data?.rows.some(r=>stage(r)==='running')
  useEffect(()=>{
    const tick=()=>{if(document.visibilityState==='visible')reload()}
    const timer=setInterval(tick,inProgress?4500:45000)
    document.addEventListener('visibilitychange',tick)
    return()=>{clearInterval(timer);document.removeEventListener('visibilitychange',tick)}
  },[inProgress,reload])
  function choose(id){
    userPicked.current=true;setAccount(id);setSelected({});setReview(false);setData(null);setPage(0);setReceipts([]);setNotice('')
    if(owner)try{localStorage.setItem('scalency-last-account:'+owner,id)}catch{}
  }
  function generate(row){
    if(pending.current.has(row.id))return
    pending.current.add(row.id);setLocal(all=>({...all,[row.id]:row}));setEditor('');setPage(0)
    setNotice('Remplissage lancé pour '+(row.fields.sku||'cette annonce')+'. Tu peux saisir la suivante.');reload()
    act('batch-generate',{id:row.id,version:row.version}).catch(e=>{if(active.current)setNotice('Remplissage de '+(row.fields.sku||'la fiche')+' : '+e.message)})
      .finally(()=>{pending.current.delete(row.id);if(active.current){setLocal(all=>{const next={...all};delete next[row.id];return next});reload()}})
  }
  function toggle(row){setSelected(prev=>{const next={...prev};if(next[row.id])delete next[row.id];else next[row.id]=row;return next})}
  function edit(id){setEditor(id);setReview(false)}
  const chosen=Object.values(selected).filter(r=>account&&r.fields.account_id===account)
  const rows=data?.rows||[],ready=rows.filter(r=>account&&r.fields.account_id===account&&stage(r)==='ready'&&!local[r.id])
  const drafts=[...Object.values(local).filter(r=>(!account||r.fields.account_id===account)&&!rows.some(x=>x.id===r.id)),...rows]
  async function submit(){
    if(lock.current||!review||!chosen.length)return
    lock.current=true;setSending(true);setReceipts([]);setNotice('')
    try{
      for(const row of chosen){
        let receipt
        try{
          const result=await act('batch-submit',{id:row.id,account,version:row.version})
          if(!result.job?.id)throw Error('Mise en file à vérifier dans le suivi.')
          receipt={sku:row.fields.sku,job:result.job.id}
          setSelected(prev=>{const next={...prev};delete next[row.id];return next})
        }catch(e){receipt={sku:row.fields.sku,error:e.message}}
        setReceipts(prev=>[...prev,receipt])
      }
    }finally{lock.current=false;setSending(false);setReview(false);reload()}
  }
  return <main className="sc-work bs-work"><header className="sc-head"><div><p>Stock Vinted / Scalency</p><h1>Atelier d’annonces</h1></div><a href="#publication">Suivi des publications</a></header>
    <fieldset className="bs-account" disabled={saving||sending||!!editor}><ScalencyQuickAccount accounts={profiles} account={account} onSelect={choose} onSaved={(id,brand)=>setProfiles(old=>old.map(a=>a.id===id?{...a,brand}:a))}/></fieldset>
    {error&&<p role="alert" className="sc-error">{error} <button onClick={reload}>Réessayer</button></p>}
    {notice&&<p className="bs-notice" role="status">{notice}</p>}
    {editor&&<ScalencyDraft key={editor} detailed id={editor==='new'?null:editor} initialAccount={account} piece={params.piece} product={params.product} sku={params.sku}
      onClose={()=>{setEditor('');reload()}} onGenerate={generate} onReviewed={r=>{setEditor('');choose(r.fields.account_id);setNotice(r.batch?.missing?.length?'À compléter : '+r.batch.missing.join(', '):'Fiche enregistrée pour le récapitulatif.');reload()}}
      onQueued={r=>{window.location.hash='publication'+(r?.job?.id?'?job='+r.job.id:'')}}/>}
    <div hidden={!!editor} className={'bs-layout'+(review?' bs-review-layout':'')}>
      <div hidden={review}><BatchEntry account={login} onBusy={setSaving} onSaved={generate} onDetailed={()=>edit('new')}/></div>
      <section className="bs-panel bs-list"><div className="bs-panel-head"><div><h2>{review?'Récapitulatif du lot':'Annonces du compte'}</h2>
        <p className="bs-meta">{review?chosen.length+' sélectionnée(s) pour '+(login?.login||'ce compte'):login?login.login+' · '+(data?.total??'…')+' brouillon(s)':'Tous les brouillons · choisis un compte pour préparer un lot'}</p></div>
        {!review&&<button className="bs-link" onClick={reload}>Actualiser</button>}</div>
      {review?<>{chosen.map(row=><ReviewRow key={row.id} row={row} onEdit={edit} disabled={sending}/>)}
        <div className="bs-actions"><button disabled={sending} onClick={()=>setReview(false)}>Retour à la sélection</button><button className="sc-primary" disabled={sending||!chosen.length} onClick={submit}>{sending?'Mise en file en cours…':'Publier le lot via Scalency ('+chosen.length+')'}</button></div>
        <p className="bs-meta">Scalency gère le départ de chaque annonce. Garde cet onglet ouvert pendant l’envoi du lot.</p></>:
        <><div className="bs-actions"><button disabled={!ready.length} onClick={()=>setSelected(prev=>({...prev,...Object.fromEntries(ready.map(r=>[r.id,r]))}))}>Sélectionner les prêtes</button>
        <button className="sc-primary" disabled={!chosen.length||saving} onClick={()=>{setReceipts([]);setReview(true)}}>Relire la sélection ({chosen.length})</button></div>
        {!data&&!drafts.length?<p>Chargement des brouillons…</p>:!drafts.length?<p className="bs-empty">Les annonces que tu prépares pour ce compte apparaîtront ici.</p>:drafts.map(row=>{
          const state=local[row.id]?'running':stage(row),f=row.fields
          return <article className="bs-row" key={row.id}><input type="checkbox" aria-label={'Sélectionner '+(f.sku||f.title||'ce brouillon')} checked={!!selected[row.id]} disabled={!account||f.account_id!==account||state!=='ready'} onChange={()=>toggle(row)}/>
            <Cover row={row}/><div className="bs-row-body"><h3>{f.title||f.sku||'Brouillon sans titre'}</h3>
            <p className="bs-meta">{[f.sku&&'SKU '+f.sku,f.size_text&&'Taille '+f.size_text,f.price&&formatMoney(f.price),!account&&profiles.find(a=>a.id===f.account_id)?.login].filter(Boolean).join(' · ')}</p>
            <span className={'bs-badge '+state}>{labels[state]}</span>
            {(state==='review'||state==='error')&&<p className="bs-problem">{row.batch?.missing?.join(' · ')||'Remplissage interrompu, tu peux le relancer.'}</p>}
            </div><div className="bs-row-tools"><button disabled={state==='running'||saving} className="bs-link" onClick={()=>edit(row.id)}>Modifier</button>
            {state!=='running'&&state!=='ready'&&login?.brand&&f.account_id===account&&row.count>0&&f.sku&&Number(f.price)>0&&<button className="bs-link" onClick={()=>generate(row)}>{state==='error'?'Réessayer':'Remplir'}</button>}</div></article>
        })}
        {data&&data.total>data.pageSize&&<div className="bs-actions"><button disabled={!page} onClick={()=>setPage(p=>p-1)}>Précédent</button><span>{page+1} / {Math.ceil(data.total/data.pageSize)}</span><button disabled={(page+1)*data.pageSize>=data.total} onClick={()=>setPage(p=>p+1)}>Suivant</button></div>}</>}
      {receipts.length>0&&<div className="bs-receipts" role="status"><h3>Résultat de l’envoi</h3>{receipts.map((r,i)=><p key={i}><b>{r.sku}</b> · {r.job?<a href={'#publication?job='+r.job}>En file · suivre l’annonce</a>:r.error}</p>)}</div>}
      </section>
    </div>
  </main>
}
