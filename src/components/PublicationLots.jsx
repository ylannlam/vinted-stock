import {useEffect,useState} from 'react'
import {act,query} from '../lib/scalency'
import {publicationDate} from '../lib/publicationTracking'
import {lotProgress} from '../lib/lotProgress'
import './PublicationLots.css'

const groups={waiting:'en préparation',queue:'en file ou en cours',live:'publiée',problem:'à corriger',check:'à vérifier',stopped:'arrêtée(s)'}

function Lot({lot,open,onRetry,busy}){
  const [expanded,setExpanded]=useState(open),[filter,setFilter]=useState('')
  const entries=lot.entries.map(e=>({...e,progress:lotProgress(e)}))
  const counts=entries.reduce((acc,e)=>{const k=e.progress.group;acc[k]=(acc[k]||0)+1;return acc},{})
  return <article className="lot-card">
    <div className="pt-row-head"><div><strong>{lot.login}</strong><p className="pt-meta">{publicationDate(lot.created_at)} · {entries.length} annonce{entries.length>1?'s':''}</p></div>
      <button type="button" aria-expanded={expanded} onClick={()=>{setFilter('');setExpanded(!expanded)}}>{expanded?'Masquer le détail':'Voir le lot'}</button></div>
    <div className="lot-counts">{Object.entries(groups).filter(([key])=>counts[key]).map(([key,label])=><button key={key} aria-pressed={expanded&&filter===key}
      onClick={()=>{setExpanded(true);setFilter(filter===key?'':key)}}>{counts[key]} {label}{key==='live'&&counts[key]>1?'s':''}</button>)}</div>
    {expanded&&entries.filter(e=>!filter||e.progress.group===filter).map(e=><div key={e.id} className="lot-entry">
      {e.photo&&<img src={e.photo} alt="" loading="lazy"/>}
      <div><strong>{e.title||e.sku}</strong><p className="pt-meta">{[e.sku&&'SKU '+e.sku,e.size_text&&'Taille '+e.size_text,e.job_id&&'N° '+e.job_id].filter(Boolean).join(' · ')}</p>
      <b>{e.progress.label}</b>{e.progress.detail&&<p>{e.progress.detail}</p>}
      <div className="lot-links">{e.editable&&<a href={'#annonces?draft='+e.draft_id}>Corriger la fiche</a>}
        {e.retryable&&<button disabled={busy} onClick={()=>onRetry(e.id)}>Relancer cette annonce</button>}
        {['pending','working','dispatched'].includes(e.status)&&<a href={'#publication?tab=queue&account='+encodeURIComponent(lot.account)+'&draft='+encodeURIComponent(e.draft_id)}>Gérer la mise en ligne</a>}
        {e.job_id&&<a href={'#publication?job='+e.job_id}>Gérer la publication</a>}
        {e.job?.status==='done'&&/^\d+$/.test(String(e.job.new_item_id))&&<a href={'https://www.vinted.fr/items/'+e.job.new_item_id} target="_blank" rel="noreferrer">Voir sur Vinted</a>}</div>
      </div></div>)}
  </article>
}

export default function PublicationLots({account,lotId}){
  const [data,setData]=useState(null),[error,setError]=useState(''),[revision,setRevision]=useState(0),[page,setPage]=useState(0),[busy,setBusy]=useState(false)
  useEffect(()=>{
    let active=true,running=false
    async function read(){
      if(!active||running)return
      running=true
      try{const result=await query('publication-lots',{account,lot:lotId,page});if(active){setData(result);setError('')}}
      catch(e){if(active)setError(e.message)}
      finally{running=false}
    }
    read()
    const visible=()=>{if(document.visibilityState==='visible')read()}
    const timer=setInterval(visible,20000)
    document.addEventListener('visibilitychange',visible)
    return ()=>{active=false;clearInterval(timer);document.removeEventListener('visibilitychange',visible)}
  },[account,lotId,page,revision])
  async function retry(id){
    setBusy(true)
    try{const lot=await act('retry-lot-entry',{id});window.location.hash='publication?lot='+lot.id}
    catch(e){setError(e.message)}finally{setBusy(false)}
  }
  return <section className="sc-panel"><div className="pt-head"><h2>{lotId?'Suivi du lot':'Lots de publication'}</h2>
    <button onClick={()=>setRevision(r=>r+1)}>Actualiser les lots</button></div>
    {error&&<p role="alert" className="sc-error">{error}</p>}
    {!data&&!error&&<p>Chargement des lots…</p>}
    {data&&!data.lots.length&&<p className="sc-muted">{lotId?'Lot introuvable.':'Les prochains lots validés dans l’atelier apparaîtront ici.'}</p>}
    {data?.lots.map(l=><Lot key={l.id} lot={l} open={!!lotId} onRetry={retry} busy={busy}/>)}
    {lotId&&<a href="#publication?tab=lots">Voir tous les lots</a>}
    {data&&data.total>data.pageSize&&<div className="sc-tools"><button disabled={!page} onClick={()=>setPage(p=>p-1)}>Précédent</button><button disabled={(page+1)*data.pageSize>=data.total} onClick={()=>setPage(p=>p+1)}>Suivant</button></div>}
  </section>
}
