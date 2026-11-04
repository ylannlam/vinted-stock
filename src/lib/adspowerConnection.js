export const COMPANION='http://127.0.0.1:17442'

// A small desktop window can still use the local connector.
export function isMobileDevice(device=globalThis.navigator){
  return !!device&&(device.userAgentData?.mobile===true||/Android|iPhone|iPad|iPod/i.test(device.userAgent||'')||(device.platform==='MacIntel'&&device.maxTouchPoints>1))
}
export class AdsPowerConnectionError extends Error{
  constructor(message,code){super(message);this.name='AdsPowerConnectionError';this.code=code}
}
const failure=(message,code)=>new AdsPowerConnectionError(message,code)

export function createAdsPowerRequest({getSession,issueTicket,fetcher=globalThis.fetch,device=()=>globalThis.navigator,now=Date.now}){
  let owner=null,capability=null,pending=null
  async function ticketFor(user,expired){
    if(owner!==user)throw failure('Le compte connecté a changé. Actualise le site.','session')
    if(expired&&capability===expired)capability=null
    if(capability?.expires_at>now()+15000)return capability
    if(pending?.user===user)return pending.promise
    const entry={user}
    entry.promise=(async()=>{
      let value
      try{value=await issueTicket()}catch(error){throw failure(error.message||'Le site ne répond pas. Réessaie.','site')}
      if(!value?.ticket||!Number.isFinite(value.expires_at)||value.expires_at<=now())throw failure('L’autorisation du site est indisponible. Actualise la page.','site')
      if(owner===user)capability=value
      return value
    })().finally(()=>{if(pending===entry)pending=null})
    pending=entry;return entry.promise
  }
  return async function request(path='/state',body){
    const currentDevice=device()
    if(isMobileDevice(currentDevice))throw failure('Le lancement AdsPower se fait sur l’ordinateur où le connecteur est installé. Sur mobile, le suivi reste consultable.','mobile')
    if(currentDevice?.onLine===false)throw failure('Cet appareil est hors connexion. La liaison sera retentée au retour du réseau.','offline')
    const session=await getSession()
    if(!session)throw failure('Connecte-toi au site pour utiliser AdsPower.','session')
    const user=session.user.id
    if(owner!==user){owner=user;capability=null;pending=null}
    let ticket=await ticketFor(user)
    for(let attempt=0;attempt<2;attempt++){
      if(owner!==user)throw failure('Le compte connecté a changé. Actualise le site.','session')
      let response
      try{
        response=await fetcher(COMPANION+path,{method:body?'POST':'GET',headers:{Authorization:`Bearer ${ticket.ticket}`,...(body?{'Content-Type':'application/json'}:{})},...(body?{body:JSON.stringify(body)}:{}),credentials:'omit',redirect:'error',signal:AbortSignal.timeout(path==='/profiles'?120000:20000)})
      }catch(error){
        if(['TimeoutError','AbortError'].includes(error.name))throw failure('Le connecteur met trop de temps à répondre. La liaison sera retentée automatiquement ; cela ne signifie pas qu’AdsPower est fermé.','timeout')
        let denied=false
        try{denied=(await currentDevice?.permissions?.query({name:'local-network-access'}))?.state==='denied'}catch{}
        throw failure(denied?'L’accès au réseau local est refusé dans ce navigateur. Autorise-le pour Stock Vinted dans les réglages du site, puis clique sur Actualiser.':'Impossible de joindre le connecteur depuis ce navigateur. Sur le PC où AdsPower est installé, vérifie que run.bat est lancé et que l’accès au réseau local est autorisé.','local')
      }
      const result=await response.json().catch(()=>null)
      // Authorization rejection is safe to retry; a timed-out launch is never replayed.
      if(response.status===401&&attempt===0){ticket=await ticketFor(user,ticket);continue}
      if(!response.ok){if(response.status===401&&capability===ticket)capability=null;throw failure(result?.error||'Le connecteur a refusé la demande. Réessaie.',response.status===401?'authorization':'connector')}
      if(!result||typeof result!=='object')throw failure('La réponse du connecteur est illisible. Actualise la page.','response')
      return result
    }
  }
}

// A reachable connector and an unavailable profile list are different states.
export async function readAdsPowerConnection(request,{loadProfiles=false,onState=()=>{}}={}){
  const state=await request('/state')
  if(typeof state?.configured!=='boolean')throw failure('La réponse du connecteur est incomplète. Actualise la page.','response')
  onState(state)
  if(!state.configured||!loadProfiles)return {state}
  try{
    const result=await request('/profiles')
    if(!Array.isArray(result?.profiles))throw failure('La liste des profils est illisible. Réessaie.','profiles')
    return {state,profiles:result.profiles}
  }catch(profilesError){return {state,profilesError}}
}
