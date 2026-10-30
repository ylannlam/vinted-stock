export const CREATION_STAGES = [
  {value:'post1', label:'1re annonce à poster'},
  {value:'post2', label:'2e annonce à poster'},
  {value:'wait', label:'En validation'},
  {value:'ready', label:'Prêt à utiliser'},
  {value:'blocked', label:'Bloqué'},
]
export function accountDeadline(account, now = Date.now()) {
  if (!account.creation_next_at || !['post1','post2','wait'].includes(account.creation_stage)) return null
  const diff = new Date(account.creation_next_at).getTime() - now
  if (diff <= 0) return account.creation_stage === 'wait' ? 'Délai écoulé · à vérifier' : 'Annonce à poster maintenant'
  const minutes = Math.max(1, Math.floor(diff / 60000))
  return `${Math.floor(minutes/1440)}j ${Math.floor(minutes%1440/60)}h ${minutes%60}min`
}
export function nextCreationStep(account, now = Date.now()) {
  const stage = {post1:'post2', post2:'wait', wait:'ready'}[account.creation_stage]
  if (!stage || ['banni_temp','banni_def','suspendu'].includes(account.statut)) return null
  return {creation_stage:stage, creation_next_at:stage==='ready'?null:new Date(now+86400000).toISOString(),
    is_ready:stage==='ready', ...(stage==='ready' && account.statut==='en_preparation' ? {statut:'actif'} : {})}
}
export const localDateInput = value => value ? new Date(new Date(value).getTime()-new Date(value).getTimezoneOffset()*60000).toISOString().slice(0,16) : ''
