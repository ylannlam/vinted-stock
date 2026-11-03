import { supabase } from './supabase'
import {createReadPool} from './requestPool'
const reads=createReadPool()

export async function authenticatedFetch(url, options = {}) {
  const { data: { session } } = await supabase.auth.getSession()
  if (!session) throw new Error('Session expirée. Reconnectez-vous.')
  const method=(options.method||'GET').toUpperCase(),headers={
    'Content-Type': 'application/json', ...options.headers,
    Authorization: `Bearer ${session.access_token}`,
  }
  const send=async()=>{
    const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),45000)
    try{return await fetch(url,{...options,headers,signal:options.signal||controller.signal})}
    catch(error){throw new Error(error.name==='AbortError'?'Le serveur met trop de temps à répondre. Tes données sont conservées ; réessaie.':'Connexion interrompue. Vérifie ta connexion puis réessaie.')}
    finally{clearTimeout(timer)}
  }
  if(method==='GET'&&!options.signal)return reads.read(JSON.stringify([url,headers]),send)
  if(method!=='GET')reads.clear()
  try{return await send()}finally{if(method!=='GET')reads.clear()}
}

export async function workspaceRequest(view='overview',query={},body) {
  const params=new URLSearchParams({view,...query})
  const response=await authenticatedFetch(`/api/workspace?${params}`,{method:body?'PATCH':'GET',...(body?{body:JSON.stringify(body)}:{})})
  const result=await response.json().catch(()=>({}))
  if(!response.ok)throw new Error(result.error||'Les données sont indisponibles. Réessaie.')
  return result
}

export async function salesRequest(method = 'GET', body, query = '') {
  const response = await authenticatedFetch(`/api/sales${query}`, {
    method, ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  })
  const result = await response.json().catch(() => ({}))
  if (!response.ok) throw new Error(result.error || 'Le serveur est indisponible. Réessayez.')
  return result
}

export async function catalogRequest(method = 'GET', body, query = '') {
  const response = await authenticatedFetch(`/api/catalog${query}`, {
    method, ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  })
  const result = await response.json().catch(() => ({}))
  if (!response.ok) throw new Error(result.error || 'Le catalogue est indisponible. Réessayez.')
  return result
}

export async function collectorRequest(method='GET',body) {
  const response=await authenticatedFetch('/api/collector',{method,...(body===undefined?{}:{body:JSON.stringify(body)})})
  const result=await response.json().catch(()=>({}))
  if(!response.ok)throw new Error(result.error||'La récupération Shein est indisponible.')
  return result
}

export async function resourcesRequest(method='GET',body,query='') {
  const response=await authenticatedFetch(`/api/resources${query}`,{method,...(body===undefined?{}:{body:JSON.stringify(body)})})
  const result=await response.json().catch(()=>({}))
  if(!response.ok)throw new Error(result.error||'La bibliothèque est indisponible. Ton formulaire est conservé.')
  return result
}

export async function listingStudioRequest(method='GET',body,query='') {
  const response=await authenticatedFetch(`/api/resources?scope=listings${query?`&${query.replace(/^\?/, '')}`:''}`,{method,...(body===undefined?{}:{body:JSON.stringify(body)})})
  const result=await response.json().catch(()=>({}))
  if(!response.ok)throw new Error(result.error||'L’annonce n’a pas pu être préparée. Ton brouillon est conservé.')
  return result
}
export async function uploadListingPhoto(file) {
  const ticket=await listingStudioRequest('POST',{action:'upload',type:file.type,size:file.size})
  const {error}=await supabase.storage.from('creative-assets').uploadToSignedUrl(ticket.path,ticket.token,file,{contentType:file.type})
  if(error)throw new Error('La photo n’a pas pu être envoyée. Réessaie.')
  return {path:ticket.path,type:file.type,size:file.size}
}

export async function creativeAccountsRequest(method='GET',body,query='') {
  const response=await authenticatedFetch(`/api/creative-accounts${query}`,{method,...(body===undefined?{}:{body:JSON.stringify(body)})})
  const result=await response.json().catch(()=>({}))
  if(!response.ok)throw new Error(result.error||'Les directions artistiques sont indisponibles. Tes modifications sont conservées.')
  return result
}

export async function uploadResourceImage(file,request=resourcesRequest) {
  const ticket=await request('POST',{action:'upload',type:file.type,size:file.size})
  const {error}=await supabase.storage.from('creative-assets').uploadToSignedUrl(ticket.path,ticket.token,file,{contentType:file.type})
  if(error)throw new Error('L’image n’a pas pu être envoyée. Ton texte est conservé ; vérifie ta connexion puis réessaie.')
  return {path:ticket.path}
}
