import {useEffect,useRef,useState} from 'react'
import {query} from '../lib/scalency'
import {publicationDate,publicationProgress} from '../lib/publicationTracking'
import './PublicationTracker.css'
import PublicationLots from './PublicationLots'

const filters=[['','Tous les statuts'],['queued','En file ou planifiées'],['sent','Publication en cours'],['done','Traitement terminé'],['failed','Échec'],['cancelled','Annulées'],['skipped','Ignorées']]
const draftLabels={draft:'En préparation',preparing:'Transmission en cours',attention:'À vérifier'}

function Job({job}){
  const progress=publicationProgress(job)
  const vinted=job.status==='done'&&/^\d+$/.test(String(job.new_item_id))&&job.new_item_id
  const events=[['Mise en file',job.created_at],['Au plus tôt',job.not_before],['Transmise pour publication',job.sent_at],[job.status==='done'&&vinted?'Publication confirmée':'Fin du traitement',job.done_at]]
  return <article className="pt-row">
    <div className="pt-row-head"><h3>{job.title||'Annonce n° '+job.id}</h3><span className={'pt-badge '+progress.tone}>{progress.label}</span></div>
    <p className="pt-meta">{[job.account,job.sku&&'SKU '+job.sku,'N° '+job.id].filter(Boolean).join(' · ')}</p>
    <p>{progress.detail}</p>
    <details><summary>Horaires et détails</summary>
      <dl>{events.filter(([,date])=>publicationDate(date)).map(([label,date])=><div key={label}><dt>{label}</dt><dd><time dateTime={date}>{publicationDate(date)}</time></dd></div>)}</dl>
      {job.reason&&job.reason!==progress.detail&&<p>{job.reason}</p>}
    </details>
    {vinted&&<a href={'https://www.vinted.fr/items/'+vinted} target="_blank" rel="noreferrer">Voir sur Vinted ↗</a>}
  </article>
}

export default function PublicationTracker({params}){
  const [status,setStatus]=useState(''),[draftPage,setDraftPage]=useState(0),[cursors,setCursors]=useState([''])
  const [data,setData]=useState(null),[error,setError]=useState(''),[busy,setBusy]=useState(true)
  const refresh=useRef(null)
  const cursor=cursors[cursors.length-1],account=params.account||'',job=params.job||''
  useEffect(()=>{
    let active=true,running=false
    setData(null);setError('')
    async function read(){
      if(running||!active)return
      running=true;setBusy(true)
      try{
        const result=await query('publication-tracking',{status,cursor,draftPage,account,job})
        if(active){setData(result);setError('')}
      }catch(e){if(active)setError(e.message)}
      finally{running=false;if(active)setBusy(false)}
    }
    const visible=()=>{if(document.visibilityState==='visible')read()}
    refresh.current=read
    read()
    const timer=setInterval(visible,60000)
    document.addEventListener('visibilitychange',visible)
    return ()=>{active=false;clearInterval(timer);document.removeEventListener('visibilitychange',visible);refresh.current=null}
  },[account,job,cursor,draftPage,status])
  return <main className="sc-work pt-work">
    <header className="sc-head"><div><p>Stock Vinted / Scalency</p><h1>Suivi des publications</h1></div>
      <button disabled={busy} onClick={()=>refresh.current?.()}>{busy?'Actualisation…':'Actualiser'}</button></header>
    <div className="pt-nav"><a href="#annonces?nouvelle=1">Nouvelle annonce</a><a href="#publication?section=actions">Toutes les actions Scalency</a></div>
    {error&&<p role="alert" className="sc-error">Actualisation impossible. {error}{data?' Les informations précédentes restent affichées.':''}</p>}
    <p className="pt-sync">Heure de Paris{data?.checkedAt&&' · Actualisé le '+publicationDate(data.checkedAt)}</p>
    {!job&&<PublicationLots key={(params.lot||'')+account} account={account} lotId={params.lot||''}/>}
    {!job&&<section className="sc-panel"><div className="pt-head"><h2>En préparation sur Stock Vinted</h2>{data&&<span>{data.draftTotal}</span>}</div>
      {data?data.drafts.length?data.drafts.map(d=><article className="pt-row" key={d.id}>
        <div className="pt-row-head"><h3>{d.title||d.sku||'Brouillon sans titre'}</h3><span className={'pt-badge '+(d.state==='attention'?'warning':'muted')}>{draftLabels[d.state]}</span></div>
        <p className="pt-meta">{[d.account,d.sku&&'SKU '+d.sku,publicationDate(d.updated_at)].filter(Boolean).join(' · ')}</p>
        {d.state==='attention'&&d.message&&<p>{d.message}</p>}
        {d.state==='draft'&&<a href={'#annonces?draft='+encodeURIComponent(d.id)}>Ouvrir le brouillon</a>}
      </article>):<p className="sc-muted">Aucune annonce en préparation.</p>:busy&&<p>Chargement des brouillons…</p>}
      {data&&(draftPage>0||data.draftTotal>data.pageSize)&&<div className="sc-tools sc-pages">
        <button disabled={!draftPage||busy} onClick={()=>setDraftPage(p=>p-1)}>Brouillons précédents</button>
        <button disabled={busy||(draftPage+1)*data.pageSize>=data.draftTotal} onClick={()=>setDraftPage(p=>p+1)}>Brouillons suivants</button>
      </div>}
    </section>}
    <section className="sc-panel"><div className="pt-head"><h2>{job?'Suivi de ton annonce':'File et historique Scalency'}</h2>
      {job?<a href="#publication">Toutes les publications</a>:<select aria-label="Filtrer les publications par statut" value={status} onChange={e=>{setStatus(e.target.value);setCursors([''])}}>{filters.map(([value,label])=><option key={value} value={value}>{label}</option>)}</select>}</div>
      {data?data.jobs.length?data.jobs.map(j=><Job key={j.id} job={j}/>):<p className="sc-muted">Aucune publication pour cette sélection.</p>:busy&&<p>Chargement des publications…</p>}
      {!job&&data&&(cursors.length>1||data.nextCursor)&&<div className="sc-tools sc-pages">
        <button disabled={busy||cursors.length===1} onClick={()=>setCursors(c=>c.slice(0,-1))}>Précédent</button>
        <button disabled={busy||!data.nextCursor} onClick={()=>setCursors(c=>[...c,data.nextCursor])}>Suivant</button>
      </div>}
    </section>
  </main>
}
