export function parisDay(value=new Date()) {
  return new Intl.DateTimeFormat('en-CA',{timeZone:'Europe/Paris',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date(value))
}
export function validDay(value) {
  return typeof value==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(value)&&Number.isFinite(Date.parse(value+'T12:00:00Z'))&&new Date(value+'T12:00:00Z').toISOString().slice(0,10)===value
}
export function dayBefore(day) { return new Date(Date.parse(day+'T12:00:00Z')-86400000).toISOString().slice(0,10) }
export function publicationAccount(profile,accounts,links=[]) {
  const link=links.find(l=>l.profile_id===profile.id)
  if(link)return accounts.find(a=>a.id===link.account_id)||null
  const name=String(profile.name||'').trim().toLocaleLowerCase('fr-FR')
  const matches=accounts.filter(a=>a.source_present&&a.login.toLocaleLowerCase('fr-FR')===name)
  return matches.length===1?matches[0]:null
}
export const publicationStatuses={active:'En ligne',reserved:'Réservée',sold:'Vendue',hidden:'Masquée',draft:'Brouillon',verification:'En vérification',processing:'En préparation'}
