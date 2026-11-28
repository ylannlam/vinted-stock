import {useEffect,useState} from 'react'
import {useCachedState} from '../lib/useCachedState'
import {query} from '../lib/scalency'
import {parisDay,validDay} from '../lib/publications'
import {addDays,dayLabel,timeLabel} from '../lib/publicationPlan'
import {publicationDate,publicationProgress} from '../lib/publicationTracking'
import {isPublicationProfile,preparationBlock} from './ScalencyAccountHealth'

function status(row){
  if(row.job_status){
    const info=publicationProgress({status:row.job_status,new_item_id:row.item_id,not_before:row.due})
    if(info.label==='Publiée')return {...info,label:'Publiée sur Vinted'}
    if(['En file','Planifiée'].includes(info.label))return {...info,label:'En file chez Scalency'}
    return info
  }
  if(row.local_status==='queued'&&row.job_id)return {label:'En file chez Scalency',tone:'planned'}
  if(row.local_status==='stopped')return {label:'Arrêtée',tone:'muted'}
  if(['uncertain','failed'].includes(row.local_status))return {label:'À vérifier',tone:'warning'}
  if(row.local_status==='pending')return {label:row.due?'Programmée sur Stock Vinted':'En attente d’envoi',tone:'pending'}
  return {label:'Transmission en cours',tone:'pending'}
}

export default function PublicationPlanning({account,health,revision,focused=false,initialDay,initialFilter,onViewChange}){
  const [selectedDay,setDay]=useState(validDay(initialDay)?initialDay:''),[filter,setFilter]=useState(initialFilter==='added'?'added':'planned'),[page,setPage]=useState(0)
  const [today,setToday]=useState(parisDay),[failure,setFailure]=useState(null)
  const day=selectedDay||today,key=JSON.stringify(['planning',account,day,filter,page])
  const [data,setData]=useCachedState(query,key,null)
  useEffect(()=>{
    let active=true,reading=false
    async function read(){
      if(reading||document.visibilityState==='hidden')return
      const now=parisDay()
      if(today!==now){setToday(now);return}
      reading=true
      try{
        const data=await query('publication-planning',{account,day,filter,page})
        if(active){
          if(page>0&&page>=Math.ceil(data.total/data.pageSize))setPage(Math.max(0,Math.ceil(data.total/data.pageSize)-1))
          setData(data);setFailure(null)
        }
      }catch(e){if(active)setFailure({key,message:e.message})}
      finally{reading=false}
    }
    read()
    const timer=setInterval(read,30000)
    document.addEventListener('visibilitychange',read)
    return ()=>{active=false;clearInterval(timer);document.removeEventListener('visibilitychange',read)}
  },[account,day,filter,page,revision,today,key])
  const error=failure?.key===key?failure.message:''
  const publishedDay=day===today?'aujourd’hui':'le '+dayLabel(day)
  const linked=new Map((health.report?.accounts||[]).filter(a=>a.linked).map(a=>[String(a.id),a]))
  const cards=health.report&&data?data.accounts.filter(a=>isPublicationProfile(linked.get(a.account))):[]
  const rows=(data?.rows||[]).filter(r=>linked.has(r.account))
  function chooseDay(next){setDay(next);setPage(0);onViewChange?.(next,filter)}
  function chooseFilter(next){setFilter(next);setPage(0);onViewChange?.(selectedDay,next)}
  return <section className="plan-board" aria-label="Planning des publications">
    <div className="plan-heading"><div><h2>Planning par compte</h2><p>Heure de Paris</p></div>
      <div className="plan-days"><button type="button" aria-pressed={day===today} onClick={()=>chooseDay('')}>Aujourd’hui</button>
        <button type="button" aria-pressed={day===addDays(today,1)} onClick={()=>chooseDay(addDays(today,1))}>Demain</button>
        <input aria-label="Jour du planning" type="date" value={day} onChange={e=>chooseDay(e.target.value)}/></div></div>
    {error&&<p role="alert" className="sc-error">{error}</p>}
    {data?.syncDelayed&&<p role="status">Derniers statuts connus. La synchronisation Scalency est momentanément retardée.</p>}
    {!data&&!error&&<p role="status">Chargement du planning…</p>}
    {data&&health.report&&<><div className="plan-accounts">{cards.map(card=>{
      const block=preparationBlock(health,card.account),free=card.capacity.remaining
      const params=new URLSearchParams({account:card.account,programmer:'1',jour:day>=today?day:today})
      return <article className="plan-account" key={card.account}><div><h3>{card.login||card.account}</h3>
        <p className={block?'plan-block':'plan-free'}>{block||free+' place'+(free>1?'s':'')+' libre'+(free>1?'s':'')+' sur '+card.capacity.day_limit}</p></div>
        <dl><div><dt>Prêtes</dt><dd>{card.ready}</dd></div><div><dt>En file chez Scalency · total</dt><dd>{card.queued??'Indisponible'}</dd></div>
          <div><dt>Publiées {publishedDay}</dt><dd>{card.posted}</dd></div></dl>
        {card.ready>0&&!block?<a className="pub-primary" href={(focused?'#alicia/annonces?':'#annonces?')+params}>{card.ready===1?'Programmer la fiche prête':'Programmer les '+Math.min(card.ready,100)+' prêtes'}</a>:
          <span className="plan-muted">{block?'Programmation suspendue':'Aucune fiche prête'}</span>}</article>
    })}</div>{!cards.length&&<p>Aucun compte relié à afficher.</p>}
    <section className="pub-panel"><div className="plan-agenda"><h2>Annonces du jour</h2>
      <div className="plan-days" role="group" aria-label="Filtrer les annonces par date">
        <button aria-pressed={filter==='planned'} onClick={()=>chooseFilter('planned')}>Prévues {publishedDay}</button>
        <button aria-pressed={filter==='added'} onClick={()=>chooseFilter('added')}>Ajoutées à la file {publishedDay}</button></div></div>
      {rows.map(row=>{
        const info=status(row),params=new URLSearchParams(row.job_id?{tab:'queue',job:row.job_id,account:row.account}:{lot:row.lot})
        return <article className="plan-event" key={row.account+'/'+row.id}><time dateTime={row.event_time}>{timeLabel(row.event_time)}</time>
          <div><strong>{row.title||row.sku||'Annonce sans titre'}</strong><p>{linked.get(row.account)?.login}{row.sku&&' · '+row.sku}</p>
            {filter==='added'&&<p>{row.due?'Créneau prévu le '+publicationDate(row.due):'Sans créneau fixe'}</p>}</div>
          <span className={'pt-badge '+info.tone}>{info.label}</span>{focused?(row.lot&&<a href={'#alicia/suivi?lot='+encodeURIComponent(row.lot)}>Voir le lot</a>):<a href={'#publication?'+params}>Voir le suivi</a>}</article>
      })}
      {!rows.length&&<p className="pub-empty">{filter==='added'?'Aucune annonce ajoutée à la file ce jour-là.':'Aucune annonce avec un créneau prévu ce jour-là.'}</p>}
      {data.total>data.pageSize&&<div className="pub-pager"><button disabled={!page} onClick={()=>setPage(p=>p-1)}>Précédent</button>{page+1} / {Math.ceil(data.total/data.pageSize)}
        <button disabled={(page+1)*data.pageSize>=data.total} onClick={()=>setPage(p=>p+1)}>Suivant</button></div>}
    </section></>}
  </section>
}
