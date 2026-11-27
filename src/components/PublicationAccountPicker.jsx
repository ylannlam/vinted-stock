import {preparationBlock} from './ScalencyAccountHealth'

function dailyStatus(row,block,loading){
  if(block)return {order:4,tone:'blocked',label:block}
  if(!row)return {order:5,tone:'neutral',label:loading?'Chargement…':'Suivi indisponible'}
  if(row.day_limit===0)return {order:3,tone:'neutral',label:'Plafond à zéro'}
  if(row.remaining>0)return {order:0,tone:'todo',label:row.remaining+(row.remaining===1?' place libre':' places libres')+' aujourd’hui'}
  if(row.posted>=row.day_limit)return {order:2,tone:'done',label:'Plafond atteint'}
  return {order:1,tone:'queued',label:'En attente de publication'}
}

export default function PublicationAccountPicker({profiles,account,onSelect,health,cadence,loadingProfiles,draftCounts}){
  const byAccount=new Map(cadence.rows.map(row=>[row.account,row]))
  const cards=profiles.map(profile=>{
    const row=cadence.error?null:byAccount.get(profile.id)
    const status=dailyStatus(row,preparationBlock(health,profile.id),cadence.loading)
    return {profile,row,status}
  }).sort((a,b)=>a.status.order-b.status.order)

  return <section className="bs-daily" aria-label="Choisir le compte de publication">
    <div className="bs-daily-head"><h2>Publications du jour</h2>
      {account&&<button className="bs-link" type="button" onClick={()=>onSelect('')}>Voir tous les brouillons</button>}
    </div>
    <div className="bs-daily-grid">{cards.map(({profile,row,status})=>{
      const selected=profile.id===account
      const total=draftCounts==null?null:(draftCounts[profile.id]??0)
      return <button type="button" className="bs-account-choice" key={profile.id} value={profile.id}
        aria-pressed={selected} onClick={()=>{if(!selected)onSelect(profile.id)}}>
        <strong>{profile.login}{selected&&<span className="bs-account-check" aria-hidden="true">✓</span>}</strong>
        <span className="bs-account-drafts">{total===null?'Brouillons · —':total+(total>1?' brouillons':' brouillon')}</span>
        <span className={'bs-account-state '+status.tone}>{status.label}</span>
        {row&&<span className="bs-account-counts">{row.posted} {row.posted>1?'publiées':'publiée'} · {row.reserved} en file</span>}
      </button>
    })}</div>
    {!cards.length&&<p role="status">{health.error?'Liste des comptes indisponible.':loadingProfiles||!health.report?'Chargement des comptes…':'Aucun compte de publication disponible.'}</p>}
    {cadence.error&&<p role="alert">Suivi des publications indisponible. <button className="bs-link" type="button" onClick={cadence.refresh}>Réessayer</button></p>}
  </section>
}
