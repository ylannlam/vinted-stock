export const directionPrompts=(account,background)=>({
 front:account.prompt_front??background?.content??'',
 back:account.prompt_back??background?.content_back??'',
})
export function filterCreativeAccounts(accounts,search='',view='selected') {
 const fold=s=>String(s||'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase()
 return accounts.filter(a=>(view==='all'||(view==='selected'?a.enabled:!a.enabled))&&fold(`${a.login} ${a.country||''}`).includes(fold(search.trim())))
  .sort((a,b)=>a.login.localeCompare(b.login,'fr'))
}
