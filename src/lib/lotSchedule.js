import {addDays,clockMinutes,parisDate,parisToUtc,timeLabel} from './publicationPlan.js'
import {validDay} from './publications.js'

const minute=60000

// Scalency requires a future first send; the form accepts whole minutes.
export function tonightWindow(now){
  const next=(Math.floor(now/minute)+1)*minute
  const from=timeLabel(next),to='23:55'
  return {from,to,available:parisDate(next)===parisDate(now)&&from<to}
}

export function lotSchedule(window,count){
  if(!validDay(window?.day))throw Error('Choisis la date de publication.')
  const {day,from,to}=window
  const startMinutes=clockMinutes(from),endMinutes=clockMinutes(to)
  if(startMinutes===null||endMinutes===null||endMinutes<=startMinutes)
    throw Error('La fin du créneau doit suivre le début dans la même journée.')
  const start=parisToUtc(day,startMinutes),end=parisToUtc(day,endMinutes)
  if(timeLabel(start)!==from||timeLabel(end)!==to)
    throw Error('Cette heure n’existe pas à Paris le jour du changement d’heure.')
  const span=(end-start)/minute
  if(!Number.isInteger(count)||count<1||count>100)throw Error('Sélectionne entre 1 et 100 annonces.')
  if(span<count)throw Error('Élargis le créneau pour laisser au moins une minute par annonce.')
  const margin=Math.min(45,Math.floor(span/count),span-count+1)
  const times=Array.from({length:count},(_,i)=>{
    const offset=count===1?0:Math.floor(i*(span-margin)/(count-1))
    return new Date(start+offset*minute).toISOString()
  })
  return {times,end:new Date(end).toISOString()}
}

export function lotDays(window,count){
  if(window.firstCount===undefined)return [{...lotSchedule(window,count),day:window.day}]
  const first=window.firstCount
  if(!Number.isInteger(count)||count<1||count>100||!Number.isInteger(first)||first<0||first>=count||!validDay(window.day))
    throw Error('Répartition des annonces invalide.')
  const next=addDays(window.day,1)
  return [
    ...(first?[{...lotSchedule(window,first),day:window.day}]:[]),
    {...lotSchedule({...window,day:next},count-first),day:next}
  ]
}
