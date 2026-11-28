import {authenticatedFetch} from './api'
export async function query(view,fields={},body){
  const params=new URLSearchParams({scope:'scalency',view,...fields})
  const response=await authenticatedFetch('/api/sales?'+params,body?{method:'POST',body:JSON.stringify(body)}:{})
  if(response.ok&&view==='label')return response.blob()
  const result=await response.json().catch(()=>({}))
  if(!response.ok){
    const error=new Error(result.error||'Connexion interrompue. Actualise les données.')
    if(response.status===429 && result.retryAfterSeconds>0)error.retryAfterSeconds=result.retryAfterSeconds
    throw error
  }
  return result
}
export const act=(action,fields={})=>query('',{},{action,...fields})
const euros=new Intl.NumberFormat('fr-FR',{style:'currency',currency:'EUR'})
export const formatMoney=(v,currency='EUR')=>v==null||v===''?'—':(currency==='EUR'?euros:new Intl.NumberFormat('fr-FR',{style:'currency',currency})).format(Number(v))
export const formatDate=v=>v?new Date(v).toLocaleString('fr-FR',{day:'numeric',month:'short',hour:'2-digit',minute:'2-digit'}):'—'
