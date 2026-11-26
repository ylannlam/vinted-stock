import {useEffect,useRef,useState} from 'react'
import {act} from '../lib/scalency'
import {addDays,parisDate,timeLabel} from '../lib/publicationPlan'
import {publicationDate} from '../lib/publicationTracking'
import {replacementWindow,reservedDay} from '../lib/publicationWindow'

export function moveSelectionIssue(rows){
  if(new Set(rows.map(r=>r.account)).size>1)return 'Sélectionne les annonces d’un seul compte pour déplacer leur créneau.'
  if(new Set(rows.map(r=>r.kind)).size>1)return 'Choisis « À transmettre » ou « Toute la file Scalency » avant de sélectionner les annonces à déplacer.'
  if(rows[0]?.kind==='job'&&new Set(rows.map(r=>reservedDay(r))).size>1)return 'Sélectionne des annonces réservées pour le même jour sur Scalency.'
  return ''
}

export default function MovePublications({rows,login,onClose,onResult}){
  const dialog=useRef(null),lock=useRef(false)
  const remote=rows[0].kind==='job',today=parisDate(Date.now())
  const previous=Date.parse(rows[0].not_before||rows[0].scheduled_for)
  const first=Number.isFinite(previous)&&previous>Date.now()?previous:Date.now()+15*60000
  const [day,setDay]=useState(remote?reservedDay(rows[0]):parisDate(first))
  const [from,setFrom]=useState(timeLabel(first)),[to,setTo]=useState('20:00')
  const [busy,setBusy]=useState(false)
  useEffect(()=>{dialog.current?.showModal()},[])
  const window={day,from,to}
  let plan,problem=moveSelectionIssue(rows)
  if(!problem){
    try{plan=replacementWindow(window,rows.length)}catch(e){problem=e.message}
  }
  async function submit(e){
    e.preventDefault()
    if(!plan||lock.current)return
    lock.current=true;setBusy(true)
    try{
      const result=await act('move-publications',{kind:rows[0].kind,account:rows[0].account,window,
        entries:rows.map(r=>({id:r.id,version:r.version,previous:r.not_before||r.scheduled_for||null}))})
      const byId=new Map(result.rows.map(r=>[r.id,r]))
      onResult(rows.map(r=>{
        const receipt=byId.get(r.id)
        const detail=receipt?.at?(remote?'Scalency · au plus tôt le ':'Stock Vinted · envoi prévu le ')+publicationDate(receipt.at)
          +' (Paris)'+(receipt.note?' · '+receipt.note:''):'Horaire non confirmé. Actualise le suivi.'
        return {ok:!!receipt?.at,text:(r.title||r.sku||r.id)+' · '+detail}
      }))
    }catch(e){onResult([{ok:false,text:e.message+' Actualise le suivi pour vérifier les horaires.'}])}
    finally{lock.current=false;setBusy(false)}
  }
  return <dialog className="pub-dialog" ref={dialog} aria-labelledby="move-heading" onCancel={e=>{if(busy)e.preventDefault();else onClose()}}>
    <form onSubmit={submit}>
      <h2 id="move-heading">Déplacer {rows.length===1?'une annonce':rows.length+' annonces'}</h2>
      <p>{login} · {remote?'Reçues par Scalency':'Sur Stock Vinted'} · Heure de Paris</p>
      {remote&&<p>Scalency permet ici d’ajuster les heures du jour réservé. La pause de nuit et le délai du compte peuvent repousser la mise en ligne.</p>}
      <div className="pub-window-fields">
        <label>Jour<input type="date" value={day} min={today} max={addDays(today,30)} onChange={e=>setDay(e.target.value)} required disabled={busy||remote}/></label>
        <label>{rows.length===1?'Heure de départ':'Début du créneau'}<input type="time" value={from} onChange={e=>setFrom(e.target.value)} required disabled={busy}/></label>
        {rows.length>1&&<label>Fin du créneau<input type="time" value={to} onChange={e=>setTo(e.target.value)} required disabled={busy}/></label>}
      </div>
      {problem?<p className="sc-error" role="status">{problem}</p>:<ul>{rows.map((row,i)=><li key={row.id}><b>{timeLabel(Date.parse(plan.times[i]))}</b> · {row.title||row.sku||row.id}</li>)}</ul>}
      <footer><button type="button" onClick={onClose} disabled={busy}>Revenir</button><button type="submit" className="pub-primary" disabled={!plan||busy}>{busy?'Enregistrement…':'Confirmer le créneau'}</button></footer>
    </form>
  </dialog>
}
