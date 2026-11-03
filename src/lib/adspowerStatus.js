export const launchStates={queued:'En attente',opening:'Ouverture',vinted:'Vinted',dotb:'Démarrage Dotb',started:'Dotb actif',attention:'À vérifier',cancelled:'Annulé'}
export const isLaunching=job=>['queued','opening','vinted','dotb'].includes(job?.state)
const labels={running:'Dotb actif',closed:'Profil fermé',page_closed:'Dotb fermé',paused:'En pause',partial:'Dotb partiel',unknown:'État indisponible',checking:'Vérification…'}
export const freshCheck=(time,now=Date.now())=>typeof time==='number'&&now-time>=0&&now-time<20000
export function activityView(job,live,{monitoring=false,opened=null,browserCheckedAt=null,now=Date.now()}={}){
  if(isLaunching(job))return {...job,label:launchStates[job.state]}
  if(opened===false&&freshCheck(browserCheckedAt,now)&&(!job||browserCheckedAt>=(job.checked_at||job.created_at)))return {state:'closed',label:labels.closed,message:'Le profil AdsPower est fermé.',checked_at:browserCheckedAt}
  if(live&&live.job_id===job?.id&&freshCheck(live.checked_at,now)){
    return {state:live.status,label:labels[live.status]||labels.unknown,message:job.state==='attention'&&['partial','paused','page_closed'].includes(live.status)?job.message:live.message,checked_at:live.checked_at}
  }
  if(job?.state==='cancelled')return {...job,label:launchStates.cancelled}
  if(job){
    return {state:'unknown',label:monitoring?labels.checking:'Statut non suivi',message:monitoring?'Vérification de l’état actuel de Dotb…':'Mets à jour le connecteur pour suivre les fermetures.'}
  }
  return {state:'idle',label:opened===true?'Navigateur ouvert':'Prêt à lancer',message:''}
}
