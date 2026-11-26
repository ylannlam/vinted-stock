const paris=new Intl.DateTimeFormat('fr-FR',{timeZone:'Europe/Paris',day:'2-digit',month:'short',year:'numeric',hour:'2-digit',minute:'2-digit'})
export function publicationDate(value){
  const at=Date.parse(value)
  return Number.isFinite(at)?paris.format(at):''
}

export function publicationProgress(job,now=Date.now()){
  const earliest=Date.parse(job.not_before)
  if(['queued','pending','waiting','scheduled','planned'].includes(job.status)){
    if(earliest>now)return {label:'Planifiée',tone:'planned',detail:'Départ au plus tôt le '+publicationDate(job.not_before)}
    return {label:'En file',tone:'pending',detail:job.reason||'En attente du passage de Scalency. Heure de publication à confirmer.'}
  }
  if(job.status==='retry')return {label:'Nouvel essai prévu',tone:'pending',detail:job.reason||'Scalency doit réessayer la publication.'}
  if(['running','sent'].includes(job.status))return {label:'Publication en cours',tone:'pending',detail:job.sent_at?'Transmise pour publication le '+publicationDate(job.sent_at):'Scalency traite cette annonce.'}
  if(job.status==='done'&&job.new_item_id)return {label:'Publiée',tone:'success',detail:job.done_at?'Publication confirmée le '+publicationDate(job.done_at):'Publication confirmée sur Vinted.'}
  if(job.status==='done')return {label:'À vérifier',tone:'warning',detail:'Scalency a terminé le traitement. Le lien Vinted reste à confirmer.'}
  if(job.status==='failed'||job.status==='skipped'||job.status==='cancelled'){
    const label={failed:'Échec',skipped:'Ignorée',cancelled:'Annulée'}[job.status]
    return {label,tone:job.status==='failed'?'warning':'muted',detail:job.reason||label}
  }
  return {label:job.status_label||'Statut à vérifier',tone:'muted',detail:job.reason||'En attente d’une nouvelle information de Scalency.'}
}
