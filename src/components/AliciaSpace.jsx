import {useState} from 'react'
import PublicationPlanning from './PublicationPlanning'
import {isPublicationProfile,useAccountHealth} from './ScalencyAccountHealth'
import './PublicationTracker.css'
import AccountPhotos from './AccountPhotos'
import PublicationLots from './PublicationLots'
import ScalencyBatchStudio from './ScalencyBatchStudio'
import '../scalency.css'
import './AliciaSpace.css'

function AliciaPlanning(){
  const [account,setAccount]=useState(''),[revision,setRevision]=useState(0)
  const health=useAccountHealth(),accounts=(health.report?.accounts||[]).filter(isPublicationProfile)
  const selected=accounts.some(a=>a.id===account)?account:''
  return <main className="sc-work pub-console"><h1>Planning</h1>
    <div className="pub-filters"><label>Compte<select value={selected} onChange={e=>setAccount(e.target.value)}>
      <option value="">Tous les comptes</option>{accounts.map(a=><option key={a.id} value={a.id}>{a.login}</option>)}</select></label>
      <button onClick={()=>{setRevision(n=>n+1);health.refresh()}}>Actualiser</button></div>
    {health.error&&<p role="alert" className="sc-error">{health.error}</p>}
    <PublicationPlanning key={selected} focused account={selected} health={health} revision={revision}/></main>
}

export default function AliciaSpace({params}){
  const section=params.section==='planning'?'planning':params.section==='fonds'?'fonds':params.section==='suivi'?'suivi':'annonces'
  const tabs=[['annonces','Annonces'],['planning','Planning'],['fonds','Fonds et prompts'],['suivi','Suivi des lots']]
  return <div className="alicia-space">
    <header className="alicia-bar"><strong>Espace Alicia</strong><nav aria-label="Espace Alicia">{tabs.map(([id,label])=>
      <a key={id} aria-current={id===section?'page':undefined} href={'#alicia/'+id}>{label}</a>)}</nav>
      <a className="alicia-return" href="#espaces">Changer d’espace</a></header>
    {section==='planning'?<AliciaPlanning/>:section==='fonds'?<AccountPhotos account={params.account} base="#alicia/fonds"/>:
      section==='suivi'?<main className="sc-work"><h1>Suivi des lots</h1><PublicationLots key={params.lot||''} focused account="" lotId={params.lot||''}/></main>:
      <ScalencyBatchStudio key={JSON.stringify(params)} focused params={params}/>}
  </div>
}
