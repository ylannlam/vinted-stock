import { supabase } from './supabase'

export async function authenticatedFetch(url, options = {}) {
  const { data: { session } } = await supabase.auth.getSession()
  if (!session) throw new Error('Session expirée. Reconnectez-vous.')
  return fetch(url, { ...options, headers: {
    'Content-Type': 'application/json', ...options.headers,
    Authorization: `Bearer ${session.access_token}`,
  } })
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

export async function uploadResourceImage(file,request=resourcesRequest) {
  const ticket=await request('POST',{action:'upload',type:file.type,size:file.size})
  const {error}=await supabase.storage.from('creative-assets').uploadToSignedUrl(ticket.path,ticket.token,file,{contentType:file.type})
  if(error)throw new Error('L’image n’a pas pu être envoyée. Ton texte est conservé ; vérifie ta connexion puis réessaie.')
  return {path:ticket.path}
}
