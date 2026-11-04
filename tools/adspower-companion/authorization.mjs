import {LocalError} from './adspower.mjs'

export async function verifyTicket(ticket,{site,fetcher=fetch,now=Date.now}={}){
  if(typeof ticket!=='string'||!/^svads_[A-Za-z0-9_-]+\.[A-Za-z0-9_-]{43}$/.test(ticket)||ticket.length>1500)throw new LocalError('Connecte-toi au site pour utiliser AdsPower.',401,'authorization_expired')
  let response
  try{response=await fetcher(`${site}/api/adspower`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({action:'verify',ticket}),redirect:'error',signal:AbortSignal.timeout(12000)})}
  catch{throw new LocalError('Le site ne répond pas à la vérification de connexion. Le connecteur reste ouvert ; la liaison sera retentée.',503,'verification_unavailable')}
  if([401,403].includes(response.status))throw new LocalError('Autorisation expirée. Actualise le site.',401,'authorization_expired')
  // A rate limit or an unavailable server must not be mistaken for a bad ticket.
  if(!response.ok)throw new LocalError('La vérification côté site est momentanément indisponible. Le connecteur reste ouvert ; réessaie dans quelques instants.',503,'verification_unavailable')
  const result=await response.json().catch(()=>null)
  if(!result?.user_id||!Number.isFinite(result.expires_at))throw new LocalError('La réponse du site est incomplète. Le connecteur reste ouvert ; réessaie.',503,'verification_unavailable')
  if(result.expires_at<=now())throw new LocalError('Autorisation expirée. Actualise le site.',401,'authorization_expired')
  return result
}

// The server validates signature + expiry, without a revocation lookup. Reuse
// that decision only within the ticket's original 90-second lifetime.
export function createTicketVerifier(verify,{now=Date.now,maxEntries=20}={}){
  const verified=new Map(),pending=new Map()
  return async ticket=>{
    const current=now()
    for(const [key,entry] of verified)if(entry.until<=current)verified.delete(key)
    const cached=verified.get(ticket)
    if(cached)return cached.auth
    if(pending.has(ticket))return pending.get(ticket)
    if(pending.size>=maxEntries)throw new LocalError('Plusieurs connexions sont en cours. Réessaie dans quelques instants.',429,'verification_busy')
    const work=Promise.resolve().then(()=>verify(ticket)).then(auth=>{
      if(!auth?.user_id||!Number.isFinite(auth.expires_at)||auth.expires_at<=now())throw new LocalError('Autorisation expirée. Actualise le site.',401,'authorization_expired')
      verified.set(ticket,{auth,until:Math.min(auth.expires_at,now()+90000)})
      if(verified.size>maxEntries)verified.delete(verified.keys().next().value)
      return auth
    }).finally(()=>pending.delete(ticket))
    pending.set(ticket,work);return work
  }
}
