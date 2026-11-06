export const directionPrompts=(account,background)=>({
 front:account.prompt_front??background?.content??'',
 back:account.prompt_back??background?.content_back??'',
})
export function filterCreativeAccounts(accounts,search='',view='selected') {
 const fold=s=>String(s||'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase()
 return accounts.filter(a=>(view==='all'||(view==='selected'?a.enabled:!a.enabled))&&fold(`${a.login} ${a.country||''}`).includes(fold(search.trim())))
  .sort((a,b)=>a.login.localeCompare(b.login,'fr'))
}
// Atelier : couleur et rang d'un compte selon son état Vinted (bloqué en dernier, inconnu au milieu).
export function accountTone(health){
 if(!health)return {key:'unknown',label:'État inconnu',dot:'bg-slate-300',chip:'bg-slate-100 text-slate-500'}
 if(health.attention)return {key:'blocked',label:health.label||'À surveiller',dot:'bg-rose-500',chip:'bg-rose-50 text-rose-700'}
 if(health.status==='ok')return {key:'ok',label:health.label||'Actif',dot:'bg-emerald-500',chip:'bg-emerald-50 text-emerald-800'}
 return {key:'unverified',label:health.label||'Non vérifié',dot:'bg-slate-400',chip:'bg-slate-100 text-slate-600'}
}
const RANK={ok:0,unverified:1,unknown:1,blocked:2}
export function sortAtelierAccounts(accounts,stats={}){
 return [...accounts].sort((a,b)=>RANK[accountTone(stats[a.id]?.health).key]-RANK[accountTone(stats[b.id]?.health).key]||a.login.localeCompare(b.login,'fr'))
}
// Fonds : quels comptes utilisent chaque fond (id du fond → logins).
export function backgroundUsage(accounts=[]){
 const usage=new Map()
 for(const a of accounts)if(a.enabled&&a.background_id)usage.set(a.background_id,[...(usage.get(a.background_id)||[]),a.login])
 return usage
}
