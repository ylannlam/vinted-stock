export const HOME_KEY='ylavint.assistant-home.v1'
export const sessionActive=s=>['opening','reading','typing','preparing','confirming','running','waiting','browsing','break','user_wait','stopping'].includes(s?.state)
export function companionCurrent(version){const [a,b,c]=String(version||'0').split('.').map(Number);return a>1||a===1&&(b>8||b===8&&c>=13)}
export function readHome(storage){
 try{const x=JSON.parse(storage.getItem(HOME_KEY));if(!x||!Array.isArray(x.ids))return null;return {ids:x.ids.filter(id=>typeof id==='string'),bindings:x.bindings&&typeof x.bindings==='object'?x.bindings:{},selected:typeof x.selected==='string'?x.selected:''}}catch{return null}
}
export function profileFor(accountId,bindings,sessions=[]){return bindings[accountId]||sessions.find(s=>s.account_id===accountId)?.profile_id||''}
export function managedAccounts(accounts,ids,sessions=[]){
 const wanted=new Set([...ids,...sessions.filter(sessionActive).map(s=>s.account_id)])
 return accounts.filter(a=>wanted.has(a.id)).sort((a,b)=>ids.indexOf(a.id)-ids.indexOf(b.id))
}
export function launchBlock(account,profile,profiles,sessions,connected){
 if(!connected)return 'Ouvre le connecteur sur ce PC.'
 if(!profile||!profiles.some(p=>p.id===profile))return 'Associe le profil AdsPower de ce compte.'
 if(account.settings?.messaging?.executor!=='desktop'||!account.settings?.enabled)return 'Active ce compte dans Activation & horaires.'
 if(account.alert)return account.alert.title||'Ce compte demande une vérification.'
 const other=sessions.find(s=>sessionActive(s)&&s.account_id!==account.id)
 if(other)return 'Arrête l’autre session avant de démarrer ce compte.'
 return null
}

export async function launchAssistant({account,profile,request,pair,resume,checkOnly=false,rehearse=false}){
 const live=await request('/state')
 if(!companionCurrent(live.version))throw Error('Mets à jour le connecteur avant de démarrer cet assistant.')
 if((live.assistants||[]).some(sessionActive))throw Error('Une session est déjà ouverte. Arrête-la avant de démarrer à nouveau.')
 if(!profile)throw Error('Associe le profil AdsPower de ce compte.')
 if(!checkOnly&&!rehearse&&account.settings?.paused)await resume({action:'resume',account_id:account.id})
 const binding=await pair('POST',{action:'desktop_pair',account_id:account.id,profile_id:profile})
 return request('/ylavint/start',{...binding,check_only:checkOnly,rehearse})
}
