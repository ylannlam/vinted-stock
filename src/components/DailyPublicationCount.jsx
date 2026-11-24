import {useEffect,useRef,useState} from 'react'
import {query} from '../lib/scalency'
import {supabase} from '../lib/supabase'
import {parisDay} from '../lib/publications'
import './DailyPublicationCount.css'

export default function DailyPublicationCount(){
  const [selected,setSelected]=useState('')
  const [data,setData]=useState(null)
  const [error,setError]=useState('')
  const [today,setToday]=useState(()=>parisDay())
  const onPublication=useRef(null)

  useEffect(()=>{
    let active=true,reading=false,again=false,wakeup
    async function refresh(reconcile=false){
      if(!active||document.visibilityState==='hidden')return
      if(reading){again=true;return}
      reading=true
      const currentDay=parisDay()
      setToday(currentDay)
      try{
        const report=await query('daily-publications',{day:selected||currentDay,reconcile:reconcile?'1':'0'})
        if(active){setData(report);setError('')}
      }catch(e){if(active)setError(e.message)}
      finally{
        reading=false
        if(active&&again){again=false;schedule()}
      }
    }
    function schedule(){
      clearTimeout(wakeup)
      wakeup=setTimeout(refresh,150)
    }
    function resume(){if(document.visibilityState!=='hidden')schedule()}
    onPublication.current=schedule
    refresh(true)
    const timer=setInterval(()=>refresh(true),30000)
    document.addEventListener('visibilitychange',resume)
    return ()=>{
      active=false;clearTimeout(wakeup);clearInterval(timer)
      document.removeEventListener('visibilitychange',resume)
      onPublication.current=null
    }
  },[selected])
  useEffect(()=>{
    const refresh=()=>onPublication.current?.()
    const channel=supabase.channel('stock-vinted:publications',{config:{private:true}})
      .on('broadcast',{event:'changed'},refresh)
      .subscribe(status=>{if(status==='SUBSCRIBED')refresh()})
    return ()=>{supabase.removeChannel(channel)}
  },[])

  const day=selected||today
  const report=data?.day===day?data:null
  return <section className="daily-publications" aria-label="Compteur de publications">
    <div className="daily-publications-head"><div><h2>{day===today?'Publiées aujourd’hui':'Annonces publiées ce jour'}</h2>
      <p>Tous les comptes · Heure de Paris</p></div>
      <label>Jour<input type="date" value={day} max={today} onChange={e=>{const value=e.target.value;setSelected(!value||value>=today?'':value);setError('')}}/></label></div>
    <div className="daily-publications-total" aria-live="polite" aria-atomic="true"><strong>{report?report.total:'—'}</strong>
      <span>{report?.total===1?'annonce publiée':'annonces publiées'}{report?.reposts>0&&<small>dont {report.reposts} {report.reposts===1?'republication':'republications'}</small>}</span></div>
    {error&&<p role="alert">{report?'Dernier total connu. ':''}{error}</p>}
    {report?.syncDelayed&&<p role="status">Scalency tarde à répondre. Le compteur affiche les confirmations déjà reçues.</p>}
    {!report&&!error&&<p role="status">Lecture des publications…</p>}
    {report?.estimated>0&&<p className="daily-publications-note">Pour {report.estimated} {report.estimated===1?'annonce, la date vient':'annonces, la date vient'} de la dernière mise à jour de la publication confirmée.</p>}
    {report?.accounts.length>0&&<details><summary>Détail par compte</summary><ul>{report.accounts.map(row=><li key={row.account||row.login}><span>{row.login}</span><strong>{row.total}</strong></li>)}</ul></details>}
  </section>
}
