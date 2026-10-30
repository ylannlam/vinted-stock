export const ACCOUNT_VIEWS = [
  {key:'all',label:'Tous'}, {key:'prepare',label:'À préparer'},
  {key:'waiting',label:'En attente'}, {key:'ready',label:'Prêts'}, {key:'blocked',label:'Bloqués'},
]
export function accountGroup(a) {
  if (['banni_temp','banni_def','suspendu'].includes(a.statut) || a.creation_stage==='blocked') return 'blocked'
  if (a.creation_stage==='ready' || (!a.creation_stage && a.is_ready)) return 'ready'
  if (a.creation_stage==='wait') return 'waiting'
  if (['post1','post2'].includes(a.creation_stage)) return 'prepare'
  return a.proxy_id ? 'waiting' : 'prepare'
}
export function nextAccountAction(a) {
  if(accountGroup(a)==='blocked') return ({banni_temp:'Bannissement temporaire',banni_def:'Bannissement définitif',suspendu:'Compte suspendu'})[a.statut] || 'Compte bloqué'
  if(accountGroup(a)==='ready')return 'Prêt à utiliser'
  return ({post1:'Poster la 1re annonce',post2:'Poster la 2e annonce',wait:'Vérifier le compte'})[a.creation_stage] || (a.proxy_id?'Vérifier le compte':'Renseigner la préparation')
}
export function isAccountDue(a, now=Date.now()) {
  return ['prepare','waiting'].includes(accountGroup(a)) && !!a.creation_next_at && new Date(a.creation_next_at).getTime()<=now
}
export function selectAccounts(accounts, proxies, {view='all',search='',proxy='all',sort='priority',dueOnly=false,now=Date.now()}={}) {
  const normalize=value=>String(value||'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase()
  const needle=normalize(search).trim()
  const byProxy=new Map(proxies.map(p=>[p.id,p]))
  const selected=accounts.filter(a=>{
    const p=byProxy.get(a.proxy_id)
    return (view==='all'||accountGroup(a)===view) && (!dueOnly||isAccountDue(a,now)) &&
      (proxy==='all'||(proxy==='none'?!a.proxy_id:proxy==='assigned'?!!a.proxy_id:a.proxy_id===proxy)) &&
      normalize([a.pseudo,a.email,a.telephone,a.ads_power_num,a.browser,p?.nom,p?.adresse].join(' ')).includes(needle)
  })
  const collator=new Intl.Collator('fr',{numeric:true,sensitivity:'base'})
  const number=a=>a.ads_power_num ? Number(a.ads_power_num) : Infinity
  const priority=a=>isAccountDue(a,now)?0:({prepare:1,waiting:2,ready:3,blocked:4})[accountGroup(a)]
  return selected.sort((a,b)=>{
    if(sort==='name')return collator.compare(a.pseudo||'',b.pseudo||'')
    if(sort==='adspower')return (number(a)-number(b))||collator.compare(a.pseudo||'',b.pseudo||'')
    if(sort==='newest')return (Date.parse(b.created_at)||0)-(Date.parse(a.created_at)||0)
    return priority(a)-priority(b)||(Date.parse(a.creation_next_at)||Infinity)-(Date.parse(b.creation_next_at)||Infinity)||collator.compare(a.pseudo||'',b.pseudo||'')
  })
}
