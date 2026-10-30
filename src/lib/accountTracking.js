export const CREATION_STAGES = [
  {value:'post1', label:'Jour 1 · 1re annonce après 2 h'},
  {value:'post2', label:'Jour 2 · 2e annonce à poster'},
  {value:'wait', label:'Jour 3 · fin de l’isolement'},
  {value:'ready', label:'Prêt · passage sur proxy possible'},
  {value:'blocked', label:'Bloqué'},
]
export function accountDeadline(account, now = Date.now()) {
  if (account.is_shadowbanned || ['banni_temp','banni_def','suspendu'].includes(account.statut) || !account.creation_next_at || !['post1','post2','wait'].includes(account.creation_stage)) return null
  const diff = new Date(account.creation_next_at).getTime() - now
  if (diff <= 0) return account.creation_stage === 'wait' ? 'Délai écoulé · à vérifier' : 'Annonce à poster maintenant'
  const minutes = Math.max(1, Math.floor(diff / 60000))
  return `${Math.floor(minutes/1440)}j ${Math.floor(minutes%1440/60)}h ${minutes%60}min`
}
export function nextCreationStep(account, now = Date.now()) {
  const stage = {post1:'post2', post2:'wait', wait:'ready'}[account.creation_stage]
  if (!stage || account.is_shadowbanned || ['banni_temp','banni_def','suspendu'].includes(account.statut)) return null
  if (account.creation_next_at && Date.parse(account.creation_next_at)>now) return null
  return {creation_stage:stage, creation_next_at:stage==='ready'?null:new Date(now+86400000).toISOString(),
    is_ready:stage==='ready', ...(stage==='ready' && account.statut==='en_preparation' ? {statut:'actif'} : {})}
}
export const localDateInput = value => value ? new Date(new Date(value).getTime()-new Date(value).getTimezoneOffset()*60000).toISOString().slice(0,16) : ''

export function initialCreation(createdAt=Date.now()) {
 const created=new Date(createdAt).toISOString()
 return {created_at:created,creation_stage:'post1',creation_next_at:new Date(Date.parse(created)+7200000).toISOString(),is_ready:false,statut:'en_preparation'}
}

export function readyWithoutTracking(account) {
 if(account.creation_stage || account.is_ready || account.is_shadowbanned || ['banni_temp','banni_def','suspendu'].includes(account.statut))return null
 return {creation_stage:'ready',creation_next_at:null,is_ready:true,statut:'actif'}
}
