import {useEffect,useState} from 'react'
import {query} from '../lib/scalency'
import {addDays,dayLabel,timeLabel} from '../lib/publicationPlan'
import {parisDay,validDay} from '../lib/publications'
import {lotDays,tonightWindow} from '../lib/lotSchedule'

export default function LotWindowPlanner({account,chosen,disabled,sending,onSubmit,revision,initialDay}){
  const [now,setNow]=useState(Date.now)
  const tonight=tonightWindow(now),today=parisDay(now),tomorrow=addDays(today,1),lastDay=addDays(today,30)
  const [day,setDay]=useState(()=>validDay(initialDay)&&initialDay>today&&initialDay<=lastDay?initialDay:tonight.available?today:tomorrow)
  const [manualFrom,setFrom]=useState(null),[manualTo,setTo]=useState(null)
  const from=manualFrom??(day===today?tonight.from:'08:00'),to=manualTo??(day===today?tonight.to:'20:00')
  useEffect(()=>{
    let timer
    function tick(){
      clearTimeout(timer)
      const time=Date.now()
      setNow(time)
      timer=setTimeout(tick,60000-(time%60000))
    }
    tick()
    document.addEventListener('visibilitychange',tick)
    return ()=>{clearTimeout(timer);document.removeEventListener('visibilitychange',tick)}
  },[])
  function chooseDay(next){
    setNow(Date.now());setDay(next);setFrom(null);setTo(null);setAcceptedSplit('')
  }
  const [capacity,setCapacity]=useState(null),[retry,setRetry]=useState(0),[acceptedSplit,setAcceptedSplit]=useState('')
  const validDate=validDay(day)&&day>=today&&day<=lastDay
  const count=chosen.length,key=JSON.stringify([account,day,count,revision,retry])
  const nextDay=validDate?addDays(day,1):''
  useEffect(()=>{
    if(!account||!validDate||!count)return
    let active=true
    async function read(){
      try{
        const {remaining}=await query('lot-capacity',{account,day})
        if(!active)return
        let next=null
        if(remaining<count&&nextDay<=lastDay){
          setCapacity({key,remaining,checking:true})
          next=(await query('lot-capacity',{account,day:nextDay})).remaining
        }
        if(active)setCapacity({key,remaining,next})
      }catch{if(active)setCapacity({key,error:true})}
    }
    read()
    return ()=>{active=false}
  },[key,validDate,nextDay,lastDay])
  const available=capacity?.key===key?capacity:null
  const free=available?.remaining,overflow=count-free
  const canSplit=overflow>0&&Number.isInteger(available?.next)&&available.next>=overflow
  const splitKey=JSON.stringify([account,day,manualFrom,to,count,free])
  const split=canSplit&&acceptedSplit===splitKey
  const windowPlan={day,from,to,...(split?{firstCount:free}:{})}
  let groups=[],issue=''
  try{
    groups=lotDays(windowPlan,count)
    if(!validDate||Date.parse(groups[0].times[0])<=Date.now())issue='Choisis un créneau futur dans les 30 prochains jours.'
  }catch(e){issue=e.message}
  let position=0
  return <div className="bs-window">
    <fieldset disabled={sending}><legend>Créneau de publication · heure de Paris</legend>
      <button type="button" disabled={!tonight.available} aria-pressed={day===today&&from===tonight.from&&to===tonight.to}
        onClick={()=>chooseDay(today)}>Ce soir · jusqu’à 23 h 55</button>
      <button type="button" aria-pressed={day===tomorrow&&from==='08:00'&&to==='20:00'} onClick={()=>chooseDay(tomorrow)}>Demain · 8 h–20 h</button>
      <label>Date<input type="date" min={today} max={lastDay} required value={day} onChange={e=>chooseDay(e.target.value)}/></label>
      <label>De<input type="time" required value={from} onChange={e=>setFrom(e.target.value)}/></label>
      <label>À<input type="time" required value={to} onChange={e=>setTo(e.target.value)}/></label>
    </fieldset>
    {validDate&&(!available?<p role="status">Vérification des places…</p>:available.error?
      <p role="alert">Plafond indisponible. <button type="button" onClick={()=>setRetry(n=>n+1)}>Réessayer</button></p>:<>
      <p role="status">{free} place{free>1?'s':''} disponible{free>1?'s':''} le {dayLabel(day)}.
        {available.checking?' Vérification du lendemain…':overflow>0&&!canSplit?' Choisis une autre date ou réduis la sélection.':''}</p>
      {canSplit&&<label className="plan-split"><input type="checkbox" disabled={sending} checked={split}
        onChange={e=>setAcceptedSplit(e.target.checked?splitKey:'')}/>
        Programmer {free>0&&<><strong>{free}</strong> le {dayLabel(day)} et </>}<strong>{overflow}</strong> le {dayLabel(nextDay)}</label>}
    </>)}
    {issue&&<p role="alert">{issue}</p>}
    {!issue&&(free>=count||split)&&groups.map(group=><section key={group.day} aria-label={'Envois du '+dayLabel(group.day)}>
      <h3>{dayLabel(group.day)} · {group.times.length} annonce{group.times.length>1?'s':''}</h3>
      <ol className="bs-window-times plan-preview" aria-label="Horaires prévus">{group.times.map(at=>{
        const row=chosen[position++]
        return <li key={row.id}><time dateTime={at}>{timeLabel(at)}</time>{row.photo&&<img src={row.photo} loading="lazy" alt=""/>}
          <span>{row.fields.title||row.fields.sku||'Annonce '+position}</span></li>
      })}</ol></section>)}
    <p className="bs-meta">Horaires d’envoi à Scalency. La mise en ligne est confirmée dans le Planning.</p>
    <button type="button" className="sc-primary" disabled={disabled||sending||!!issue||!(free>=count||split)}
      onClick={()=>{
        const time=Date.now()
        if(!groups.length||Date.parse(groups[0].times[0])<=time){setNow(time);return}
        onSubmit(chosen,windowPlan)
      }}>{sending?'Enregistrement…':'Programmer le lot ('+count+')'}</button>
  </div>
}
