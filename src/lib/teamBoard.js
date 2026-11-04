import {accountGroup,nextAccountAction} from './accountOverview.js'

// Où ranger un compte dans l'onglet « Alicia ».
// now     : compte en création dont l'annonce du jour est due (Jour 1 / Jour 2)
// feed    : compte prêt (ou pas encore relié à « Comptes ») à alimenter
// rest    : compte en création qui n'attend rien aujourd'hui
// blocked : bloqué, banni, suspendu ou archivé (shadowban) : ne pas publier
export function boardSection(row,now=Date.now()) {
  const v=row.vinted
  if(row.health?.attention)return 'blocked'
  if(!v)return 'feed'
  if(v.deleted_at)return 'blocked'
  const group=accountGroup(v)
  if(group==='blocked'||group==='shadowban')return 'blocked'
  if(group==='ready')return 'feed'
  const due=!v.creation_next_at||Date.parse(v.creation_next_at)<=now
  return ['post1','post2'].includes(v.creation_stage)&&due&&!row.today?'now':'rest'
}
export const BOARD_SECTIONS=[
  {key:'now',title:'À faire maintenant',hint:'Comptes en création : publie l’annonce prévue aujourd’hui.'},
  {key:'feed',title:'À alimenter',hint:'Commence par le haut : ceux qui n’ont rien reçu depuis le plus longtemps.'},
  {key:'rest',title:'En pause',hint:'Comptes en création qui n’attendent rien aujourd’hui.'},
  {key:'blocked',title:'Bloqués ou archivés',hint:'Ne rien publier sur ces comptes.'}
]
const time=value=>{const t=Date.parse(value);return Number.isFinite(t)?t:null}
export function groupBoard(rows,{now=Date.now(),search=''}={}) {
  const term=search.trim().toLowerCase()
  const visible=rows.filter(r=>!term||[r.login,r.profile?.number,r.profile?.name].some(v=>String(v??'').toLowerCase().includes(term)))
  const sections=Object.fromEntries(BOARD_SECTIONS.map(s=>[s.key,[]]))
  for(const row of visible)sections[boardSection(row,now)].push(row)
  // Jamais publié d'abord, puis la dernière publication la plus ancienne, puis le moins publié aujourd'hui.
  sections.feed.sort((a,b)=>(time(a.last_at)??-Infinity)-(time(b.last_at)??-Infinity)||a.today-b.today||a.login.localeCompare(b.login,'fr'))
  for(const key of ['now','rest'])sections[key].sort((a,b)=>(time(a.vinted?.creation_next_at)??0)-(time(b.vinted?.creation_next_at)??0)||a.login.localeCompare(b.login,'fr'))
  sections.blocked.sort((a,b)=>a.login.localeCompare(b.login,'fr'))
  return BOARD_SECTIONS.map(s=>({...s,rows:sections[s.key]}))
}
// Libellé pensé pour publier : « Prêt à publier » plutôt que l'étape de préparation du compte.
export const stateLabel=row=>row.health?.attention?row.health.label:!row.vinted?'À relier dans « Comptes »':row.vinted.deleted_at?'Archivé · ne plus utiliser':accountGroup(row.vinted)==='ready'?'Prêt à publier':accountGroup(row.vinted)==='isolation'&&['post1','post2'].includes(row.vinted.creation_stage)&&row.today?'Annonce du jour notée':nextAccountAction(row.vinted)
export function sinceLabel(value,now=Date.now()) {
  const t=time(value)
  if(t==null)return 'Jamais'
  const day=v=>new Intl.DateTimeFormat('en-CA',{timeZone:'Europe/Paris'}).format(new Date(v))
  const days=Math.round((Date.parse(day(now))-Date.parse(day(t)))/86400000)
  return days<=0?'Aujourd’hui':days===1?'Hier':`Il y a ${days} jours`
}
