import {useEffect,useState} from 'react'
import {query} from '../lib/scalency'
import {addDays,timeLabel} from '../lib/publicationPlan'
import {parisDay,validDay} from '../lib/publications'
import {lotSchedule} from '../lib/lotSchedule'

export default function LotWindowPlanner({account,chosen,disabled,sending,onSubmit,revision}){
  const today=parisDay(),lastDay=addDays(today,30)
  const [day,setDay]=useState(()=>addDays(today,1)),[from,setFrom]=useState('08:00'),[to,setTo]=useState('20:00')
  const [capacity,setCapacity]=useState(null),[retry,setRetry]=useState(0)
  const key=account+'/'+day,validDate=validDay(day)&&day>=today&&day<=lastDay
  useEffect(()=>{
    if(!account||!validDate)return
    let active=true
    query('lot-capacity',{account,day}).then(row=>{
      if(active)setCapacity({key,remaining:row.remaining})
    }).catch(()=>{if(active)setCapacity({key,error:true})})
    return ()=>{active=false}
  },[account,day,key,validDate,revision,retry])
  const available=capacity?.key===key?capacity:null
  let plan,issue
  try{
    plan=lotSchedule({day,from,to},chosen.length)
    if(!validDate||Date.parse(plan.times[0])<=Date.now())issue='Choisis un créneau futur dans les 30 prochains jours.'
  }catch(error){issue=error.message}
  const fits=available?.remaining>=chosen.length
  return <div className="bs-window">
    <fieldset disabled={sending}><legend>Créneau de publication · heure de Paris</legend>
      <label>Date<input type="date" min={today} max={lastDay} required value={day} onChange={e=>setDay(e.target.value)}/></label>
      <label>De<input type="time" required value={from} onChange={e=>setFrom(e.target.value)}/></label>
      <label>À<input type="time" required value={to} onChange={e=>setTo(e.target.value)}/></label>
    </fieldset>
    {issue?<p role="alert">{issue}</p>:<>
      <ol className="bs-window-times" aria-label="Horaires prévus">{chosen.map((row,i)=><li key={row.id}>
        <time dateTime={plan.times[i]}>{timeLabel(plan.times[i])}</time><span>{row.fields.sku||row.fields.title||'Annonce '+(i+1)}</span>
      </li>)}</ol>
      {!available?<p role="status">Vérification des places pour cette date…</p>:available.error?
        <p role="alert">Plafond indisponible. <button type="button" onClick={()=>setRetry(n=>n+1)}>Réessayer</button></p>:
        <p role="status">{available.remaining} place{available.remaining>1?'s':''} disponible{available.remaining>1?'s':''} ce jour-là.
          {!fits&&' Réduis la sélection ou choisis une autre date.'}</p>}
    </>}
    <p className="bs-meta">Les annonces sont transmises à Scalency aux horaires prévus. Une pause du compte peut retarder leur mise en ligne.</p>
    <button type="button" className="sc-primary" disabled={disabled||sending||!!issue||!fits}
      onClick={()=>onSubmit(chosen,{day,from,to})}>{sending?'Enregistrement…':'Programmer le lot ('+chosen.length+')'}</button>
  </div>
}
