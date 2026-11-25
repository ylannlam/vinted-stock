import {useCallback,useEffect,useRef,useState} from 'react'
import {act,query,formatMoney} from '../lib/scalency'
import {retryIntake,watchIntake} from '../lib/batchIntake'
import {listingColors} from '../lib/scalencyQuick'
import {PhotoAccountPanel} from './AccountPhotos'
import {CadenceSettings,useCadence} from './PublicationCadence'
import {AccountHealthNotice,isBanned,preparationBlock,publicationProfiles,useAccountHealth} from './ScalencyAccountHealth'
import BatchEntry from './BatchEntry'
import ScalencyDraft from './ScalencyDraft'
import ScalencyQuickAccount from './ScalencyQuickAccount'
import PublicationAccountPicker from './PublicationAccountPicker'
import LotWindowPlanner from './LotWindowPlanner'
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
function DiscardDialog({rows,onClose,onDiscard}){
  const dialog=useRef(null),request=useRef(false)
  const [busy,setBusy]=useState(false),[error,setError]=useState('')
  useEffect(()=>{
    const element=dialog.current
    element.showModal()
    return ()=>element.close()
  },[])
  async function confirm(){
    if(request.current)return
    request.current=true;setBusy(true);setError('')
    try{await onDiscard(rows)}
    catch(e){setError(e.message);request.current=false;setBusy(false)}
  }
  return <dialog className="bs-discard-dialog" ref={dialog} aria-labelledby="bs-discard-title" onCancel={ev=>{ev.preventDefault();if(!request.current)onClose()}}>
    <h2 id="bs-discard-title">{rows.length===1?'Supprimer cette annonce prête ?':'Supprimer ces '+rows.length+' annonces prêtes ?'}</h2>
    <ul>{rows.map(r=><li key={r.id}><strong>{r.fields.sku}</strong>{r.fields.title&&' · '+r.fields.title}</li>)}</ul>
    <p>La suppression du brouillon est définitive.</p>
    {error&&<p className="sc-error" role="alert">{error}</p>}
    <div className="bs-actions"><button type="button" autoFocus disabled={busy} onClick={onClose}>Annuler</button>
      <button type="button" className="bs-confirm-discard" disabled={busy} onClick={confirm}>{busy?'Suppression…':'Confirmer la suppression'}</button></div>
  </dialog>
}
function ReviewRow({row,onEdit,onDiscard,onSave,onQuick,quick,disabled,blocked,duplicates}){
  const f=row.fields
  const [price,setPrice]=useState(f.price),[size,setSize]=useState(f.size_text),[error,setError]=useState(''),[busy,setBusy]=useState(false)
  async function save(){
    setBusy(true);setError('')
    try{const saved=await act('lot-review-edit',{id:row.id,account:f.account_id,version:row.version,price,size});onSave(saved)}
    catch(e){setError(e.message)}finally{setBusy(false)}
  }
  return <article className="bs-review-item"><div className="bs-review-head"><Cover row={row}/><div><h3>{f.title}</h3><p>{f.sku&&f.sku+' · '}{f.size_text} · {formatMoney(f.price)}</p></div></div>
    <p>{[row.batch?.category||'Catégorie '+f.catalog_id,f.brand_title,(f.color_ids||[]).map(id=>listingColors.find(c=>c.id===id)?.title).filter(Boolean).join(' / '),row.batch?.condition,'Petit colis',row.count&&row.count+' photo'+(row.count>1?'s':'')].filter(Boolean).join(' · ')}</p>
    <details><summary>Lire la bio</summary><p className="bs-bio">{f.description}</p></details>
    {duplicates?.map((d,i)=><p className="bs-problem" key={i}>{d.label}{d.url&&<> · <a href={d.url}>Voir l’annonce</a></>}</p>)}
    {quick&&<form className="bs-inline-edit" onSubmit={e=>{e.preventDefault();if(!busy)save()}}>
      <label>Prix (€)<input required inputMode="decimal" value={price} onChange={e=>setPrice(e.target.value)}/></label>
      <label>Taille<input required value={size||''} onChange={e=>setSize(e.target.value)}/></label>
      <button disabled={busy||blocked}>{busy?'Enregistrement…':'Enregistrer'}</button><button type="button" disabled={busy} onClick={()=>onQuick('')}>Annuler</button>
      {error&&<p className="bs-problem" role="alert">{error}</p>}</form>}
    <div className="bs-actions"><button className="bs-link" disabled={disabled} onClick={()=>onEdit(row.id)}>Modifier la fiche</button>
      {!quick&&<button className="bs-link" disabled={disabled||blocked} onClick={()=>{setPrice(f.price);setSize(f.size_text);setError('');onQuick(row.id)}}>Corriger le prix ou la taille</button>}
      <button className="bs-link bs-danger" disabled={disabled} onClick={()=>onDiscard([row])}>Supprimer</button></div>
  </article>
}
export default function ScalencyBatchStudio({params,focused=false}){
  const [loadedProfiles,setProfiles]=useState(null),[owner,setOwner]=useState(''),[requestedAccount,setAccount]=useState(params.account||'')
  const profiles=loadedProfiles??[]
  const [page,setPage]=useState(0),[data,setData]=useState(null),[error,setError]=useState(''),[notice,setNotice]=useState('')
  const [selected,setSelected]=useState({}),[review,setReview]=useState(false),[sending,setSending]=useState(false),[lastLot,setLastLot]=useState('')
  const [local,setLocal]=useState({}),[revision,setRevision]=useState(0)
  const [discarding,setDiscarding]=useState(null)
  const [scheduled,setScheduled]=useState(false)
  const [quickEdit,setQuickEdit]=useState(''),[duplicates,setDuplicates]=useState({}),[duplicateCheck,setDuplicateCheck]=useState('')
  const [transfers,setTransfers]=useState([])
  const [editor,setEditor]=useState(params.draft||(params.piece||params.product||params.sku?'new':''))
  const lock=useRef(false),active=useRef(true),userPicked=useRef(false),pending=useRef(new Set())
  const returnToReview=useRef(false)
  const health=useAccountHealth()
  const banned=isBanned(health,requestedAccount)
  const account=health.report&&!banned?requestedAccount:''
  const availableProfiles=publicationProfiles(profiles,health)
  const cadence=useCadence()
  const quota=!cadence.error&&cadence.rows.find(row=>row.account===account)
  const blocked=preparationBlock(health,account)
  const login=profiles.find(a=>a.id===account)
  const reload=useCallback(()=>setRevision(n=>n+1),[])
  useEffect(()=>{
    setTransfers([])
    if(owner)return watchIntake(owner,setTransfers,reload,setError)
  },[owner,reload])
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
    if(!focused)act('sync',{kind:'accounts',force:false}).then(()=>{if(live)read()}).catch(()=>{})
    return()=>{live=false}
  },[params.account,focused])
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
  function updateProfile(id,changes){setProfiles(rows=>rows.map(a=>a.id===id?{...a,...changes}:a))}
  const choose=useCallback(id=>{
    setScheduled(false)
    userPicked.current=true;setAccount(id);setSelected({});setReview(false);setData(null);setPage(0);setLastLot('');setNotice('')
    if(owner)try{localStorage.setItem('scalency-last-account:'+owner,id)}catch{}
  },[owner])
  useEffect(()=>{
    if(banned)choose('')
  },[banned,choose])
  function generate(row){
    const reason=preparationBlock(health,row.fields.account_id)
    if(reason){setError(reason);return}
    if(pending.current.has(row.id))return
    pending.current.add(row.id);setLocal(all=>({...all,[row.id]:row}));setEditor('');setPage(0)
    setNotice('Remplissage lancé pour '+(row.fields.sku||'cette annonce')+'. Tu peux saisir la suivante.');reload()
    act('batch-generate',{id:row.id,version:row.version}).catch(e=>{if(active.current)setNotice('Remplissage de '+(row.fields.sku||'la fiche')+' : '+e.message)})
      .finally(()=>{pending.current.delete(row.id);if(active.current){setLocal(all=>{const next={...all};delete next[row.id];return next});reload()}})
  }
  function toggle(row){setSelected(prev=>{const next={...prev};if(next[row.id])delete next[row.id];else next[row.id]=row;return next})}
  function edit(id){returnToReview.current=review;setEditor(id);setReview(false)}
  function closeEditor(){setEditor('');setReview(returnToReview.current);returnToReview.current=false;reload()}
  function savedEdit(row){
    closeEditor()
    if(account!==row.fields.account_id)choose(row.fields.account_id)
    else setSelected(prev=>{
      if(!prev[row.id])return prev
      const next={...prev}
      if(row.batch?.status==='ready')next[row.id]={...prev[row.id],fields:row.fields,version:row.version,batch:row.batch,count:row.photos.length}
      else delete next[row.id]
      return next
    })
    setNotice(row.batch?.missing?.length?'À compléter : '+row.batch.missing.join(', '):'Fiche enregistrée pour le récapitulatif.')
  }
  const chosen=Object.values(selected).filter(r=>account&&r.fields.account_id===account)
  const toQueue=chosen.slice(0,cadence.error?0:(quota?.remaining??0))
  const reviewKey=review?JSON.stringify(chosen.map(r=>[r.id,r.version])):''
  useEffect(()=>{
    let active=true
    setDuplicates({})
    if(!reviewKey||reviewKey==='[]'){setQuickEdit('');setDuplicateCheck('');return}
    setDuplicateCheck('Vérification des doublons…')
    act('lot-duplicates',{account,ids:JSON.parse(reviewKey).map(([id])=>id)})
      .then(found=>{if(active){setDuplicates(found);setDuplicateCheck('')}})
      .catch(()=>{if(active)setDuplicateCheck('Vérification des doublons indisponible.')})
    return ()=>{active=false}
  },[account,reviewKey])
  function saveQuickEdit(saved){
    setSelected(prev=>({...prev,[saved.id]:{...prev[saved.id],...saved}}))
    setQuickEdit('');reload()
  }
  const rows=data?.rows||[],ready=rows.filter(r=>account&&r.fields.account_id===account&&stage(r)==='ready'&&!local[r.id])
  const intake=transfers.filter(t=>(!account||t.fields.account_id===account)&&(t.stage==='error'||!rows.some(row=>row.id===t.id&&row.batch)))
  const drafts=[...Object.values(local).filter(r=>(!account||r.fields.account_id===account)&&!rows.some(x=>x.id===r.id)),...rows.filter(row=>!intake.some(t=>t.id===row.id))]
  async function discard(batch){
    if(lock.current)throw Error('Une opération est déjà en cours.')
    lock.current=true
    try{
      await act('batch-discard',{account:batch[0].fields.account_id,drafts:batch.map(({id,version})=>({id,version}))})
      const ids=new Set(batch.map(row=>row.id))
      setSelected(prev=>Object.fromEntries(Object.entries(prev).filter(([id])=>!ids.has(id))))
      setData(prev=>prev&&({...prev,rows:prev.rows.filter(row=>!ids.has(row.id)),total:Math.max(0,prev.total-ids.size)}))
      if(review&&chosen.every(row=>ids.has(row.id)))setReview(false)
      setNotice(ids.size===1?'Brouillon supprimé · '+(batch[0].fields.sku||batch[0].fields.title):ids.size+' brouillons supprimés.')
      setDiscarding(null)
    }finally{lock.current=false;reload()}
  }
  async function submit(entries,windowPlan=null){
    if(blocked||lock.current||!review||!entries.length)return
    lock.current=true;setSending(true);setError('');setNotice('')
    try{
      const result=await act('accept-lot',{account,entries:entries.map(({id,version})=>({id,version})),...(windowPlan?{window:windowPlan}:{})})
      setLastLot(result.id);setSelected(Object.fromEntries(chosen.slice(entries.length).map(row=>[row.id,row])));setReview(false);setScheduled(false)
      setNotice(windowPlan?'Lot programmé · '+result.count+' annonce(s) le '+windowPlan.day.split('-').reverse().join('/')+' entre '+windowPlan.from+' et '+windowPlan.to+' (Paris).':
        'Lot enregistré · '+result.count+' annonce'+(result.count>1?'s':'')+'. Tu peux fermer cet onglet ou changer de compte.')
    }catch(e){setError(e.message)}
    finally{lock.current=false;setSending(false);reload();cadence.refresh()}
  }
  const reviewRows=review&&chosen.map(row=><ReviewRow key={row.id} row={row} onEdit={edit} onDiscard={setDiscarding} blocked={blocked}
    disabled={sending||!!quickEdit} onQuick={setQuickEdit} quick={quickEdit===row.id} onSave={saveQuickEdit} duplicates={duplicates[row.id]}/>)
  return <main className="sc-work bs-work"><header className="sc-head"><div><p>{focused?'Espace Alicia':'Stock Vinted / Scalency'}</p><h1>Atelier d’annonces</h1></div><a href={focused?'#alicia/suivi':'#publication'}>Suivi des publications</a></header>
    <fieldset className="bs-account" disabled={sending||!!editor||!health.report}>
      {!editor&&<PublicationAccountPicker profiles={availableProfiles} loadingProfiles={loadedProfiles===null} account={account} onSelect={choose} health={health} cadence={cadence}/>}
      {login&&<ScalencyQuickAccount fixed readOnly={focused} accounts={availableProfiles} health={health} account={account} onSaved={updateProfile}/>}
    </fieldset>
    {!editor&&<AccountHealthNotice health={health} id={account} overview showOtherBans={false}/>}
    {focused&&login&&!login.brand&&<p role="status">La marque de ce compte doit être renseignée par l’administrateur pour le remplissage automatique.</p>}
    {focused&&quota&&!editor&&<p className="bs-meta">{quota.remaining} place(s) disponible(s) aujourd’hui sur ce compte.</p>}
    {!focused&&quota&&!editor&&<CadenceSettings key={'cadence-'+account} row={quota} blocked={blocked} onSaved={cadence.applySaved}/>}
    {account&&login&&<PhotoAccountPanel key={'photos-'+account} account={account} login={login.login}/>}
    {error&&<p role="alert" className="sc-error">{error} <button onClick={reload}>Réessayer</button></p>}
    {notice&&<p className="bs-notice" role="status">{notice}{lastLot&&<> · <a href={(focused?'#alicia/suivi':'#publication')+'?lot='+lastLot}>Suivre le lot</a></>}</p>}
    {editor&&<ScalencyDraft key={editor} sharedHealth={health} focused={focused} detailed id={editor==='new'?null:editor} initialAccount={account} onProfileSaved={updateProfile} piece={params.piece} product={params.product} sku={params.sku}
      onClose={closeEditor} onGenerate={generate} onReviewed={savedEdit}
      onQueued={r=>{window.location.hash='publication'+(r?.job?.id?'?job='+r.job.id:'')}}/>}
    <div hidden={!!editor} className={'bs-layout'+(review?' bs-review-layout':'')}>
      <div hidden={review}><BatchEntry active={!editor&&!review&&!discarding} blocked={!!blocked} account={login} owner={owner} onQueued={sku=>{setPage(0);setNotice((sku?'Préparation lancée pour '+sku:'Préparation lancée')+'. Tu peux saisir la suivante.')}} onDetailed={()=>edit('new')}/></div>
      <section className="bs-panel bs-list"><div className="bs-panel-head"><div><h2>{review?'Récapitulatif du lot':'Annonces du compte'}</h2>
        <p className="bs-meta">{review?chosen.length+' sélectionnée(s) pour '+(login?.login||'ce compte'):login?login.login+' · '+(data?.total??'…')+' brouillon(s)':'Tous les brouillons · choisis un compte pour préparer un lot'}</p></div>
        {!review&&<button className="bs-link" onClick={()=>{reload();health.refresh();cadence.refresh()}}>Actualiser</button>}</div>
      {discarding&&<DiscardDialog rows={discarding} onClose={()=>setDiscarding(null)} onDiscard={discard}/>}
      {review?<>{duplicateCheck&&<p role="status">{duplicateCheck}</p>}
        <div className="bs-actions" role="group" aria-label="Quand publier le lot ?">
          <button type="button" aria-pressed={!scheduled} disabled={sending||!!quickEdit} onClick={()=>setScheduled(false)}>Mettre en file maintenant</button>
          <button type="button" aria-pressed={scheduled} disabled={sending||!!quickEdit} onClick={()=>setScheduled(true)}>Choisir un créneau</button>
        </div>
        {scheduled?<details><summary>Relire les fiches sélectionnées ({chosen.length})</summary>{reviewRows}</details>:reviewRows}
        {scheduled?<LotWindowPlanner account={account} chosen={chosen} revision={revision} onSubmit={submit} sending={sending}
          disabled={!!blocked||!!quickEdit||duplicateCheck==='Vérification des doublons…'}/>:<>
        <p role="status">{blocked||(!quota||cadence.error?'Vérification du plafond…':quota.remaining+' place(s) disponible(s) aujourd’hui.')}</p>
        {!blocked&&quota&&!cadence.error&&toQueue.length<chosen.length&&<p>Les {toQueue.length} premières fiches du récapitulatif peuvent partir. Les {chosen.length-toQueue.length} autres restent en brouillon.</p>}
        <button className="sc-primary" disabled={!!blocked||sending||!toQueue.length||!!quickEdit||duplicateCheck==='Vérification des doublons…'} onClick={()=>submit(toQueue)}>{sending?'Enregistrement…':'Mettre dans la file ('+toQueue.length+')'}</button>
        <p className="bs-meta">Scalency gère le départ de chaque annonce. Tu peux fermer cet onglet dès que le lot est enregistré.</p></>}
        <button className="bs-link" disabled={sending||!!quickEdit} onClick={()=>setReview(false)}>Retour à la sélection</button></>:
        <><div className="bs-actions"><button disabled={!ready.length} onClick={()=>setSelected(prev=>({...prev,...Object.fromEntries(ready.map(r=>[r.id,r]))}))}>Sélectionner les prêtes</button>
        <button className="sc-primary" disabled={!chosen.length} onClick={()=>{setReview(true)}}>Relire la sélection ({chosen.length})</button>
        {chosen.length>0&&<button type="button" className="bs-link bs-danger" onClick={()=>setDiscarding(chosen)}>Supprimer la sélection ({chosen.length})</button>}</div>
        {intake.map(t=><article key={t.id} className="bs-row"><div className="bs-row-body"><h3>{t.fields.sku||'Annonce en préparation'}</h3>
          <p className="bs-meta">{t.fields.size_text} · {formatMoney(t.fields.price)}</p>
          <span className={'bs-badge '+(t.stage==='error'?'error':'running')}>{t.stage==='error'?'À reprendre':t.stage==='generating'?'Remplissage…':t.stage==='saving'?'En préparation…':'Envoi des photos…'}</span>
          {t.stage==='error'&&<p className="bs-problem">{t.error}</p>}</div>
          {t.stage==='error'&&<button className="bs-link" disabled={!!preparationBlock(health,t.fields.account_id)} onClick={()=>retryIntake(owner,t.id).catch(e=>setError(e.message))}>Réessayer</button>}
        </article>)}
        {!data&&!drafts.length&&!intake.length?<p>Chargement des brouillons…</p>:!drafts.length&&!intake.length?<p className="bs-empty">Les annonces que tu prépares pour ce compte apparaîtront ici.</p>:drafts.map(row=>{
          const state=local[row.id]?'running':stage(row),f=row.fields
          return <article className="bs-row" key={row.id}><input type="checkbox" aria-label={'Sélectionner '+(f.sku||f.title||'ce brouillon')} checked={!!selected[row.id]} disabled={!account||f.account_id!==account||state!=='ready'} onChange={()=>toggle(row)}/>
            <Cover row={row}/><div className="bs-row-body"><h3>{f.title||f.sku||'Brouillon sans titre'}</h3>
            <p className="bs-meta">{[f.sku&&'SKU '+f.sku,f.size_text&&'Taille '+f.size_text,f.price&&formatMoney(f.price),!account&&profiles.find(a=>a.id===f.account_id)?.login].filter(Boolean).join(' · ')}</p>
            <span className={'bs-badge '+state}>{labels[state]}</span>
            {(state==='review'||state==='error')&&<p className="bs-problem">{row.batch?.missing?.join(' · ')||'Remplissage interrompu, tu peux le relancer.'}</p>}
            </div><div className="bs-row-tools"><button disabled={state==='running'} className="bs-link" onClick={()=>edit(row.id)}>Modifier</button>
            {state==='ready'&&<button type="button" className="bs-link bs-danger" onClick={()=>setDiscarding([row])}>Supprimer</button>}
            {state!=='running'&&state!=='ready'&&login?.brand&&f.account_id===account&&row.count>0&&Number(f.price)>0&&<button className="bs-link" disabled={!!blocked} onClick={()=>generate(row)}>{state==='error'?'Réessayer':'Remplir'}</button>}</div></article>
        })}
        {data&&data.total>data.pageSize&&<div className="bs-actions"><button disabled={!page} onClick={()=>setPage(p=>p-1)}>Précédent</button><span>{page+1} / {Math.ceil(data.total/data.pageSize)}</span><button disabled={(page+1)*data.pageSize>=data.total} onClick={()=>setPage(p=>p+1)}>Suivant</button></div>}</>}
      </section>
    </div>
  </main>
}
