import AccountPhotos from './AccountPhotos'
import PublicationLots from './PublicationLots'
import ScalencyBatchStudio from './ScalencyBatchStudio'
import '../scalency.css'
import './AliciaSpace.css'

export default function AliciaSpace({params}){
  const section=params.section==='fonds'?'fonds':params.section==='suivi'?'suivi':'annonces'
  const tabs=[['annonces','Annonces'],['fonds','Fonds et prompts'],['suivi','Suivi des lots']]
  return <div className="alicia-space">
    <header className="alicia-bar"><strong>Espace Alicia</strong><nav aria-label="Espace Alicia">{tabs.map(([id,label])=>
      <a key={id} aria-current={id===section?'page':undefined} href={'#alicia/'+id}>{label}</a>)}</nav>
      <a className="alicia-return" href="#accueil">Retour à l’administration</a></header>
    {section==='fonds'?<AccountPhotos account={params.account} base="#alicia/fonds"/>:
      section==='suivi'?<main className="sc-work"><h1>Suivi des lots</h1><PublicationLots key={params.lot||''} focused account="" lotId={params.lot||''}/></main>:
      <ScalencyBatchStudio key={params.draft||'atelier'} focused params={{draft:params.draft,account:params.account}}/>}
  </div>
}
