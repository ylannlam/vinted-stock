export const ACCOUNT_VIEWS = [
  {key:'ready',label:'Prêts'}, {key:'isolation',label:'Isolement'},
  {key:'blocked',label:'Bloqués'}, {key:'shadowban',label:'Shadowban'},
]
export function accountGroup(a) {
  if(a.is_shadowbanned)return 'shadowban'
  if(['banni_temp','banni_def','suspendu'].includes(a.statut)||a.creation_stage==='blocked')return 'blocked'
  if(a.creation_stage==='ready'||(!a.creation_stage&&a.is_ready))return 'ready'
  return 'isolation'
}
export function nextAccountAction(a) {
  const group=accountGroup(a)
  if(group==='shadowban')return 'Archivé · ne plus utiliser'
  if(group==='blocked')return ({banni_temp:'Bannissement temporaire',banni_def:'Bannissement définitif',suspendu:'Compte suspendu'})[a.statut]||'Compte bloqué'
  if(group==='ready')return 'Prêt · passage sur proxy possible'
  return ({post1:'Jour 1 · première annonce',post2:'Jour 2 · deuxième annonce',wait:'Jour 3 · fin de l’isolement'})[a.creation_stage]||'Préparation à renseigner'
}
export function isAccountDue(a,now=Date.now()) {
  return accountGroup(a)==='isolation'&&!!a.creation_next_at&&Date.parse(a.creation_next_at)<=now
}
export function selectAccounts(accounts,{view='ready',search='',sort='priority',dueOnly=false,now=Date.now()}={}) {
  const normalize=value=>String(value||'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase()
  const needle=normalize(search).trim()
  const selected=accounts.filter(a=>accountGroup(a)===view&&(!dueOnly||isAccountDue(a,now))&&normalize([a.pseudo,a.email,a.telephone,a.ads_power_num,a.browser].join(' ')).includes(needle))
  const collator=new Intl.Collator('fr',{numeric:true,sensitivity:'base'})
  const number=a=>a.ads_power_num?Number(a.ads_power_num):Infinity
  return selected.sort((a,b)=>{
    if(sort==='name')return collator.compare(a.pseudo||'',b.pseudo||'')
    if(sort==='adspower')return number(a)-number(b)||collator.compare(a.pseudo||'',b.pseudo||'')
    if(sort==='newest')return (Date.parse(b.created_at)||0)-(Date.parse(a.created_at)||0)
    return Number(isAccountDue(b,now))-Number(isAccountDue(a,now))||(Date.parse(a.creation_next_at)||Infinity)-(Date.parse(b.creation_next_at)||Infinity)||collator.compare(a.pseudo||'',b.pseudo||'')
  })
}
