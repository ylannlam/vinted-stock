export const healthLabels={unknown:'État non vérifié',ok:'Accès confirmé',temporary:'Blocage temporaire',restricted:'Compte restreint',permanent:'Bannissement définitif',blocked:'Compte bloqué',verification:'Vérification demandée',review:'À vérifier'}
export const healthHasDeadline=status=>['temporary','restricted'].includes(status)
const rank={permanent:8,temporary:7,blocked:6,restricted:5,verification:4,review:3,unknown:1,ok:0}
const validTime=value=>value&&Number.isFinite(Date.parse(value))?Date.parse(value):null
export const parisHealthDay=(now=Date.now())=>new Intl.DateTimeFormat('en-CA',{timeZone:'Europe/Paris',year:'numeric',month:'2-digit',day:'2-digit'}).format(now)
export function healthView({report=null,alerts=[],native=null},now=Date.now()){
  const candidates=[]
  if(report)candidates.push({status:report.status,until_at:report.until_at,until_date:report.until_date,reason:report.reason,checked_at:report.checked_at,source:'manual'})
  for(const a of alerts){
    // A human confirmation acknowledges earlier alerts, but never later ones.
    if(a.resolved||report&&validTime(a.created_at)<=validTime(report.checked_at))continue
    candidates.push({status:a.status,until_date:a.until_date,reason:[a.title,a.body].filter(Boolean).join(' — '),checked_at:a.created_at,source:'dotb'})
  }
  if(native&&!native.deleted_at){
    const status=({banni_temp:'temporary',banni_def:'permanent',suspendu:'blocked'})[native.statut]||(native.creation_stage==='blocked'?'blocked':native.is_shadowbanned?'restricted':null)
    if(status)candidates.push({status,until_at:native.deban_at,checked_at:native.blocked_at,source:'accounts',reason:native.is_shadowbanned&&status==='restricted'?'Restriction de visibilité signalée dans l’onglet Comptes.':'Statut enregistré dans l’onglet Comptes.'})
  }
  const result=candidates.sort((a,b)=>(rank[b.status]??0)-(rank[a.status]??0)||(validTime(b.checked_at)||0)-(validTime(a.checked_at)||0))[0]||{status:'unknown',source:null,reason:'Aucune confirmation de l’accès au compte.'}
  const until=validTime(result.until_at),dateReached=healthHasDeadline(result.status)&&result.until_date&&parisHealthDay(now)>=result.until_date
  const expired=Boolean(healthHasDeadline(result.status)&&until!==null&&until<=now||dateReached)
  const status=expired?'review':result.status
  return {...result,status,label:dateReached?'Date annoncée atteinte · accès à vérifier':expired?'Fin du délai · accès à vérifier':healthLabels[status],attention:!['unknown','ok'].includes(status),expired}
}
export function remainingHealthTime(until,now=Date.now(),untilDate=null){
  if(untilDate){const [y,m,d]=untilDate.split('-');return `Jusqu’au ${d}/${m}/${y} · heure non précisée`}
  const end=validTime(until);if(end===null)return 'Date de fin non communiquée'
  if(end<=now)return 'Délai écoulé : confirme le rétablissement dans Vinted.'
  const minutes=Math.ceil((end-now)/60000),days=Math.floor(minutes/1440),hours=Math.floor(minutes%1440/60)
  return `Fin annoncée dans ${days?`${days} j `:''}${hours?`${hours} h `:''}${minutes%60} min`
}
