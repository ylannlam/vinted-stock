import {authenticatedFetch} from './api'
import {supabase} from './supabase'
export const COMPANION='http://127.0.0.1:17442'
let capability=null,owner=null
export async function adsPowerRequest(path='/state',body){
  const {data:{session}}=await supabase.auth.getSession()
  if(!session)throw Error('Connecte-toi au site pour utiliser AdsPower.')
  if(owner!==session.user.id){capability=null;owner=session.user.id}
  if(!capability||capability.expires_at<Date.now()+15000){
    const response=await authenticatedFetch('/api/adspower');const value=await response.json()
    if(!response.ok)throw Error(value.error||'Connexion administrateur nécessaire.')
    capability=value
  }
  let response
  try{response=await fetch(COMPANION+path,{method:body?'POST':'GET',headers:{Authorization:`Bearer ${capability.ticket}`,...(body?{'Content-Type':'application/json'}:{})},...(body?{body:JSON.stringify(body)}:{}),credentials:'omit',redirect:'error',signal:AbortSignal.timeout(path==='/profiles'?120000:20000)})}
  catch{throw Error('Le connecteur ne répond pas sur ce PC. Lance-le, puis autorise l’accès au réseau local si ton navigateur le demande.')}
  const result=await response.json().catch(()=>({}))
  if(!response.ok){if(response.status===401)capability=null;throw Error(result.error||'La connexion AdsPower a été interrompue.')}
  return result
}
export const launchStates={queued:'En attente',opening:'Ouverture',vinted:'Vinted',dotb:'Démarrage Dotb',started:'Dotb démarré',attention:'À vérifier',cancelled:'Annulé'}
export const isLaunching=job=>['queued','opening','vinted','dotb'].includes(job?.state)
