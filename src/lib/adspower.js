import {authenticatedFetch} from './api'
import {supabase} from './supabase'
import {createAdsPowerRequest} from './adspowerConnection'
export {COMPANION} from './adspowerConnection'
export const adsPowerRequest=createAdsPowerRequest({
  getSession:async()=>{const {data:{session}}=await supabase.auth.getSession();return session},
  issueTicket:async()=>{
    const response=await authenticatedFetch('/api/adspower',{signal:AbortSignal.timeout(45000)}),value=await response.json()
    if(!response.ok)throw Error(value.error||'Connexion administrateur nécessaire.')
    return value
  }
})
export {launchStates,isLaunching} from './adspowerStatus'
