import {useCallback,useEffect,useRef,useState} from 'react'
import {useCachedState} from '../lib/useCachedState'
import {readViewCache,viewCacheEpoch,writeViewCache} from '../lib/viewCache'
import {act,query,formatMoney} from '../lib/scalency'
import {retryIntake,watchIntake} from '../lib/batchIntake'
import {accountBrandIssue,listingColors} from '../lib/scalencyQuick'
import {PhotoAccountPanel} from './AccountPhotos'
import {CadenceSettings,useCadence} from './PublicationCadence'
import {AccountHealthNotice,excludedPublicationAccount,preparationBlock,publicationProfiles,useAccountHealth} from './ScalencyAccountHealth'
import BatchEntry from './BatchEntry'
import ScalencyDraft from './ScalencyDraft'
import ScalencyQuickAccount from './ScalencyQuickAccount'
import PublicationAccountPicker from './PublicationAccountPicker'
import LotWindowPlanner from './LotWindowPlanner'
import {scalencyQueueUrl,transferConfirmedLot,transferMessage} from '../lib/lotTransfer'
import './ScalencyBatchStudio.css'

const labels={draft:'Brouillon',running:'Remplissage…',catalog:'Catégorie Vinted en attente',ready:'Prête à relire',review:'À compléter',error:'À reprendre'}
const transferLabels={saving:'Enregistrement des photos…',upload:'Envoi des photos…',generating:labels.running,error:labels.error}
const pendingCatalogMessage='Texte enregistré. Options de la catégorie Vinted en attente.'
function stage(row){
  const b=row.batch
  if(b?.status==='running'&&Date.now()-Date.parse(b.started)>600000)return 'error'
  if(b?.status==='review'&&b.catalog_pending)return 'catalog'
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
    <h2 id="bs-discard-title">{rows.length===1?'Supprimer ce brouillon ?':'Supprimer ces '+rows.length+' brouillons ?'}</h2>
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
function lastAccount(profile){
  if(!profile?.owner)return ''
  try{
    const last=localStorage.getItem('scalency-last-account:'+profile.owner)
    return profile.accounts.some(a=>a.id===last)?last:''
  }catch{return ''}
}
export default function ScalencyBatchStudio({params,focused=false}){
  const [profilesAtEntry]=useState(()=>readViewCache(query,'studio-profiles'))
  const [loadedProfiles,setProfiles]=useState(profilesAtEntry?.accounts??null),[owner,setOwner]=useState('')
  const [requestedAccount,setAccount]=useState(()=>params.account||lastAccount(profilesAtEntry))
  const profiles=loadedProfiles??[]
  const [page,setPage]=useState(0),[error,setError]=useState(''),[notice,setNotice]=useState('')
  const [draftCounts,setDraftCounts]=useState(null)
  const [selected,setSelected]=useState({}),[review,setReview]=useState(false),[sending,setSending]=useState(false)
  const [local,setLocal]=useState({}),[revision,setRevision]=useState(0)
  const [requestErrors,setRequestErrors]=useState({})
  const [profileError,setProfileError]=useState(''),[profileRevision,retryProfiles]=useState(0)
  const [discarding,setDiscarding]=useState(null)
  const [scheduled,setScheduled]=useState(false)
  const [quickEdit,setQuickEdit]=useState(''),[duplicates,setDuplicates]=useState({}),[duplicateCheck,setDuplicateCheck]=useState('')
  const [transfers,setTransfers]=useState([])
  const [editor,setEditor]=useState(params.draft||(params.piece||params.product||params.sku?'new':''))
  const lock=useRef(false),active=useRef(true),userPicked=useRef(false),pending=useRef(new Set())
  const returnToReview=useRef(false),openedPlanning=useRef(false)
  const health=useAccountHealth()
  const excluded=excludedPublicationAccount(health,requestedAccount)
  const account=health.report&&!health.error&&!excluded?requestedAccount:''
  const [snapshot,setData]=useCachedState(query,JSON.stringify(['studio-drafts',account,page]),null)
  const data=health.report||health.error?snapshot:null
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
    const epoch=viewCacheEpoch()
    async function read(){
      try{
        const r=await query('quick-profiles');if(!live)return
        writeViewCache(query,'studio-profiles',r,epoch)
        setProfileError('');setProfiles(r.accounts);setOwner(r.owner)
        if(!userPicked.current&&!params.account)setAccount(lastAccount(r))
      }catch(e){if(live)setProfileError(e.message)}
    }
    read()
    if(!focused)act('sync',{kind:'accounts',force:false}).then(result=>{if(live&&!result?.skipped)read()}).catch(()=>{})
    return()=>{live=false}
  },[params.account,focused,profileRevision])
  useEffect(()=>{
    let live=true
    if(!health.report&&!health.error)return
    if(!requestedAccount&&loadedProfiles===null&&!profileError&&!health.error)return
    query('batch-drafts',{account,page,withCounts:'1'}).then(r=>{
      if(!live)return
      setData(r);setDraftCounts(r.draftCounts??null);setError('')
      setSelected(prev=>Object.fromEntries(Object.entries(prev).filter(([id,row])=>{
        const current=r.rows.find(x=>x.id===id)
        return !current||current.version===row.version&&stage(current)!=='running'
      })))
      if(!r.rows.length&&page)setPage(p=>p-1)
    }).catch(e=>{if(live){setDraftCounts(null);setError(e.message)}})
    return()=>{live=false}
  },[account,page,revision,!!requestedAccount||loadedProfiles!==null||!!profileError,!!health.report,!!health.error])
  useEffect(()=>{
    if(params.programmer!=='1'||openedPlanning.current||!account||account!==params.account||!login||blocked)return
    let live=true
    query('batch-drafts',{account,ready:'1',page:0}).then(result=>{
      if(!live)return
      openedPlanning.current=true
      if(!result.rows.length){setNotice('Aucun brouillon prêt à programmer sur ce compte.');return}
      setSelected(Object.fromEntries(result.rows.map(row=>[row.id,row])))
      setScheduled(true);setReview(true)
      if(result.total>result.rows.length)setNotice('Les 100 premiers brouillons prêts sont sélectionnés pour ce lot.')
    }).catch(e=>{if(live)setError(e.message)})
    return ()=>{live=false}
  },[account,params.account,params.programmer,login?.id,blocked,revision])
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
    userPicked.current=true;setAccount(id);setSelected({});setReview(false);setPage(0);setNotice('')
    if(owner)try{localStorage.setItem('scalency-last-account:'+owner,id)}catch{}
  },[owner])
  useEffect(()=>{
    if(excluded)choose('')
  },[excluded,choose])
  function generate(row){
    const reason=preparationBlock(health,row.fields.account_id)
    if(reason){setError(reason);return}
    if(pending.current.has(row.id))return
    pending.current.add(row.id);setLocal(all=>({...all,[row.id]:row}));setEditor('');setPage(0)
    setNotice({id:row.id,label:row.fields.sku||row.fields.title||'Brouillon',before:row.version})
    setRequestErrors(all=>{const next={...all};delete next[row.id];return next})
    reload()
    act('batch-generate',{id:row.id,version:row.version}).catch(e=>{
      if(active.current)setRequestErrors(all=>({...all,[row.id]:{version:row.version,message:e.message||'Connexion interrompue.'}}))
    })
      .finally(()=>{pending.current.delete(row.id);if(active.current){setLocal(all=>{const next={...all};delete next[row.id];return next});reload()}})
  }
  function toggle(row){setSelected(prev=>{const next={...prev};if(next[row.id])delete next[row.id];else next[row.id]=row;return next})}
  function edit(id){returnToReview.current=review;setEditor(id);setReview(false)}
  function closeEditor(){setEditor('');setReview(returnToReview.current);returnToReview.current=false;reload()}
  function draftIssues(row){
    const brand=profiles.find(profile=>profile.id===row.fields.account_id)?.brand
    const pendingIssue=row.batch?.catalog_pending&&(row.batch.catalog_issue||pendingCatalogMessage)
    return row.batch?.missing?.filter(issue=>issue!==pendingIssue).map(issue=>issue==='Marque du compte'?accountBrandIssue(row.fields,brand):issue).join(' · ')
  }
  function requestError(row){
    const error=requestErrors[row.id]
    return error&&error.version===row.version?error.message:''
  }
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
    setNotice({id:row.id,label:row.fields.sku||row.fields.title||'Brouillon',saved:row})
  }
  const selection=Object.values(selected).filter(r=>account&&r.fields.account_id===account&&!local[r.id])
  const chosen=selection.filter(r=>stage(r)==='ready')
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
  // Follow the latest submitted draft by ID, including uploads without a SKU.
  // Older requests finishing out of order cannot overwrite its status.
  let preparation=null
  if(notice?.id){
    const transfer=intake.find(t=>t.id===notice.id)
    const listed=rows.find(r=>r.id===notice.id)
    const row=notice.saved&&(!listed||listed.version<notice.saved.version)?notice.saved:listed
    if(local[notice.id])preparation={tone:'running',text:local[notice.id].batch?.catalog_pending?'Vérification de la catégorie…':labels.running}
    else if(transfer)preparation={tone:transfer.stage==='error'?'error':'running',text:transfer.error||transferLabels[transfer.stage]}
    else if(row&&requestError(row))preparation={tone:'error',text:requestError(row)}
    else if(row&&(notice.before==null||row.version>notice.before)&&row.batch){
      const tone=stage(row)
      preparation={tone,text:tone==='error'?(draftIssues(row)||labels.error):labels[tone]}
    }
  }
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
      const submitted=new Set(entries.map(row=>row.id))
      setSelected(prev=>Object.fromEntries(Object.entries(prev).filter(([id])=>!submitted.has(id))));setReview(false);setScheduled(false)
      setNotice({lotId:result.id,text:'Lot enregistré. Transmission à Scalency en cours…'})
      try{
        await transferConfirmedLot(result.id,act,progress=>setNotice({lotId:result.id,text:transferMessage(progress)}))
      }catch(e){
        setNotice({lotId:result.id,text:'Lot enregistré. Ouvre son suivi pour vérifier les réceptions et reprendre la transmission.'})
        throw e
      }
    }catch(e){setError(e.message)}
    finally{lock.current=false;setSending(false);reload();cadence.refresh()}
  }
  const reviewPanel=useRef(null)
  useEffect(()=>{if(review)reviewPanel.current?.focus({preventScroll:false})},[review])
  const reviewRows=review&&chosen.map(row=><ReviewRow key={row.id} row={row} onEdit={edit} onDiscard={setDiscarding} blocked={blocked}
    disabled={sending||!!quickEdit} onQuick={setQuickEdit} quick={quickEdit===row.id} onSave={saveQuickEdit} duplicates={duplicates[row.id]}/>)
  return <main className="sc-work bs-work"><header className="sc-head"><div><p>{focused?'Espace Alicia':'Stock Vinted / Scalency'}</p><h1>Atelier d’annonces</h1></div><a href={focused?'#alicia/suivi':'#publication'}>Suivi des publications</a></header>
    <fieldset className="bs-account" hidden={review} disabled={sending||!!editor||!health.report}>
      {!editor&&<PublicationAccountPicker profiles={availableProfiles} loadingProfiles={loadedProfiles===null} draftCounts={draftCounts} account={account} onSelect={choose} health={health} cadence={cadence}/>}
      {login&&<ScalencyQuickAccount fixed readOnly={focused} accounts={availableProfiles} health={health} account={account} onSaved={updateProfile}/>}
    </fieldset>
    {profileError&&<p role="alert" className="sc-error">{profileError} <button onClick={()=>retryProfiles(n=>n+1)}>Recharger les comptes</button></p>}
    {!editor&&health.error&&<AccountHealthNotice health={health}/>}
    {focused&&login&&!login.brand&&<p role="status">La marque de ce compte doit être renseignée par l’administrateur pour le remplissage automatique.</p>}
    {focused&&quota&&!editor&&<p className="bs-meta">{quota.remaining} place(s) disponible(s) aujourd’hui sur ce compte.</p>}
    {!review&&!focused&&quota&&!editor&&<CadenceSettings key={'cadence-'+account} row={quota} blocked={blocked} onSaved={cadence.applySaved}/>}
    {!review&&account&&login&&<PhotoAccountPanel key={'photos-'+account} account={account} login={login.login}/>}
    {error&&<p role="alert" className="sc-error">{error} <button onClick={reload}>Réessayer</button></p>}
    {typeof notice==='string'&&notice&&<p className="bs-notice" role="status">{notice}</p>}
    {notice?.lotId&&<p className="bs-notice" role="status">{notice.text} · <a href={(focused?'#alicia/suivi':'#publication')+'?lot='+notice.lotId}>Suivre le lot</a> · <a href={scalencyQueueUrl} target="_blank" rel="noreferrer">Voir la file API Scalency</a></p>}
    {preparation&&<p className={'bs-preparation-note '+preparation.tone} role={preparation.tone==='error'?'alert':'status'} aria-atomic="true">
      <strong>{notice.label}</strong> · {preparation.text}</p>}
    {editor&&<ScalencyDraft key={editor} sharedHealth={health} focused={focused} detailed id={editor==='new'?null:editor} initialAccount={account} onProfileSaved={updateProfile} piece={params.piece} product={params.product} sku={params.sku}
      onClose={closeEditor} onGenerate={generate} onReviewed={savedEdit}
      onQueued={r=>{window.location.hash='publication'+(r?.job?.id?'?job='+r.job.id:'')}}/>}
    <div hidden={!!editor} className={'bs-layout'+(review?' bs-review-layout':'')}>
      <div hidden={review}><BatchEntry active={!editor&&!review&&!discarding} blocked={!!blocked} account={login} owner={owner} onQueued={(sku,id)=>{setPage(0);setNotice({id,label:sku||'Brouillon'})}} onDetailed={()=>edit('new')}/></div>
      <section className="bs-panel bs-list" ref={reviewPanel} tabIndex={-1}><div className="bs-panel-head"><div><h2>{review?'Récapitulatif du lot':'Annonces du compte'}</h2>
        <p className="bs-meta">{review?chosen.length+' sélectionnée(s) pour '+(login?.login||'ce compte'):login?login.login+' · '+(data?.total??'…')+' brouillon(s)':'Tous les brouillons · choisis un compte pour préparer un lot'}</p></div>
        {!review&&<button className="bs-link" onClick={()=>{reload();health.refresh();cadence.refresh()}}>Actualiser</button>}</div>
      {discarding&&<DiscardDialog rows={discarding} onClose={()=>setDiscarding(null)} onDiscard={discard}/>}
      {review?<>{duplicateCheck&&<p role="status">{duplicateCheck}</p>}
        <div className="bs-actions" role="group" aria-label="Quand publier le lot ?">
          <button type="button" aria-pressed={!scheduled} disabled={sending||!!quickEdit} onClick={()=>setScheduled(false)}>Mettre en file maintenant</button>
          <button type="button" aria-pressed={scheduled} disabled={sending||!!quickEdit} onClick={()=>setScheduled(true)}>Choisir un créneau</button>
        </div>
        {scheduled&&Object.values(duplicates).some(rows=>rows.length>0)&&<p className="bs-problem" role="status">Doublon possible. Ouvre les fiches ci-dessous pour vérifier les articles concernés.</p>}
        {scheduled?<details><summary>Relire les fiches sélectionnées ({chosen.length})</summary>{reviewRows}</details>:reviewRows}
        {scheduled?<LotWindowPlanner initialDay={params.jour} account={account} chosen={chosen} revision={revision} onSubmit={submit} sending={sending}
          disabled={!!blocked||!!quickEdit||duplicateCheck==='Vérification des doublons…'}/>:<>
        <p role="status">{blocked||(!quota||cadence.error?'Vérification du plafond…':quota.remaining+' place(s) disponible(s) aujourd’hui.')}</p>
        {!blocked&&quota&&!cadence.error&&toQueue.length<chosen.length&&<p>Les {toQueue.length} premières fiches du récapitulatif peuvent partir. Les {chosen.length-toQueue.length} autres restent en brouillon.</p>}
        <button className="sc-primary" disabled={!!blocked||sending||!toQueue.length||!!quickEdit||duplicateCheck==='Vérification des doublons…'} onClick={()=>submit(toQueue)}>{sending?'Enregistrement…':'Mettre dans la file ('+toQueue.length+')'}</button>
        <p className="bs-meta">Garde cet onglet ouvert jusqu’à la confirmation de réception par Scalency.</p></>}
        <button className="bs-link" disabled={sending||!!quickEdit} onClick={()=>setReview(false)}>Retour à la sélection</button></>:
        <><div className="bs-actions"><button disabled={!ready.length} onClick={()=>setSelected(prev=>({...prev,...Object.fromEntries(ready.map(r=>[r.id,r]))}))}>Sélectionner les prêtes</button>
        <button className="sc-primary" disabled={!!blocked||(!chosen.length&&!ready.length)} onClick={()=>{
          if(!chosen.length)setSelected(Object.fromEntries(ready.map(r=>[r.id,r])))
          setScheduled(true);setReview(true)
        }}>{chosen.length?'Programmer la sélection ('+chosen.length+')':'Programmer les prêtes ('+ready.length+')'}</button>
        <button disabled={!chosen.length} onClick={()=>{setScheduled(false);setReview(true)}}>{selection.length===chosen.length?'Relire la sélection':'Relire les prêtes'} ({chosen.length})</button>
        {selection.length>0&&<button type="button" className="bs-link bs-danger" onClick={()=>setDiscarding(selection)}>Supprimer la sélection ({selection.length})</button>}</div>
        {intake.map(t=><article key={t.id} className="bs-row"><div className="bs-row-body"><h3>{t.fields.sku||'Annonce en préparation'}</h3>
          <p className="bs-meta">{t.fields.size_text} · {formatMoney(t.fields.price)}</p>
          <span className={'bs-badge '+(t.stage==='error'?'error':'running')}>{transferLabels[t.stage]}</span>
          {t.stage==='error'&&<p className="bs-problem">{t.error}</p>}</div>
          {t.stage==='error'&&<button className="bs-link" disabled={!!preparationBlock(health,t.fields.account_id)} onClick={()=>retryIntake(owner,t.id).catch(e=>setError(e.message))}>Réessayer</button>}
        </article>)}
        {!data&&!drafts.length&&!intake.length?<p>Chargement des brouillons…</p>:!drafts.length&&!intake.length?<p className="bs-empty">Les annonces que tu prépares pour ce compte apparaîtront ici.</p>:drafts.map(row=>{
          const failure=requestError(row),state=local[row.id]?'running':failure?'error':stage(row),f=row.fields
          const issues=['catalog','review','error'].includes(state)?draftIssues(row):''
          return <article className="bs-row bs-draft-row" key={row.id} aria-busy={state==='running'}><input type="checkbox" aria-label={'Sélectionner '+(f.sku||f.title||'ce brouillon')} checked={!!selected[row.id]} disabled={!account||f.account_id!==account||state==='running'} onChange={()=>toggle(row)}/>
            <Cover row={row}/><div className="bs-row-body"><h3>{f.title||f.sku||'Brouillon sans titre'}</h3>
            <p className="bs-meta">{[f.sku&&'SKU '+f.sku,f.size_text&&'Taille '+f.size_text,f.price&&formatMoney(f.price),!account&&profiles.find(a=>a.id===f.account_id)?.login].filter(Boolean).join(' · ')}</p>
              {row.batch?.category&&<p className="bs-meta">Catégorie Vinted · {row.batch.category}</p>}
            <span className={'bs-badge '+state}>{state==='running'&&row.batch?.catalog_pending?'Vérification de la catégorie…':labels[state]}</span>
            {state==='catalog'&&<p className="bs-meta">{row.batch.catalog_issue||'Le titre et la description sont enregistrés.'}</p>}
            {state==='catalog'&&issues&&<p className="bs-problem">Champs à vérifier · {issues}</p>}
            {(state==='review'||state==='error')&&<p className="bs-problem">{failure||issues||'Remplissage interrompu, tu peux le relancer.'}</p>}
            </div><div className="bs-row-tools"><button disabled={state==='running'} className="bs-link" onClick={()=>edit(row.id)}>Modifier</button>
            {state!=='running'&&f.account_id&&<button type="button" className="bs-link bs-danger" onClick={()=>setDiscarding([row])}>Supprimer</button>}
            {state!=='running'&&state!=='ready'&&login?.brand&&f.account_id===account&&row.count>0&&Number(f.price)>0&&<button className="bs-link" disabled={!!blocked} onClick={()=>generate(row)}>{row.batch?.catalog_pending?'Actualiser la catégorie':state==='error'?'Réessayer':'Remplir'}</button>}</div></article>
        })}
        {data&&data.total>data.pageSize&&<div className="bs-actions"><button disabled={!page} onClick={()=>setPage(p=>p-1)}>Précédent</button><span>{page+1} / {Math.ceil(data.total/data.pageSize)}</span><button disabled={(page+1)*data.pageSize>=data.total} onClick={()=>setPage(p=>p+1)}>Suivant</button></div>}</>}
      </section>
    </div>
  </main>
}
