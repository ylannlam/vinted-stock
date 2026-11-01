import {AppError,isId} from './dotb.js'

export function normalizeAccounts(result) {
  if(!result||!Array.isArray(result.data)||result.has_more===true)throw new AppError('Liste Dotb incomplète. Les comptes enregistrés sont conservés.',502)
  const ids=new Set()
  return result.data.map(a=>{
    if(!a||!isId(a.id)||ids.has(a.id)||typeof a.login!=='string'||!a.login.trim()||a.login.length>200||a.country!=null&&(typeof a.country!=='string'||a.country.length>20))throw new AppError('Réponse Dotb invalide. Aucun compte modifié.',502)
    ids.add(a.id)
    // Bridge connectivity is not a ban status. Do not guess whether an account is banned.
    return {id:a.id,login:a.login.trim(),country:a.country||null}
  })
}
export async function readDotbAccounts(fetcher=fetch,token=process.env.DOTB_API_TOKEN) {
  if(!token)throw new AppError('La connexion Dotb reste à activer par l’administrateur.',503)
  let response
  try {response=await fetcher('https://dotb.io/api/public/v1/accounts',{headers:{Authorization:`Bearer ${token}`,Accept:'application/json'},signal:AbortSignal.timeout(12000),redirect:'error'})}
  catch {throw new AppError('Dotb ne répond pas. Tes choix et tes DA sont conservés.',504)}
  if(!response.ok)throw new AppError(response.status===429?'Limite Dotb atteinte. Réessaie dans quelques instants.':[401,402,403].includes(response.status)?'Dotb refuse l’accès aux comptes. Vérifie les droits de la connexion Dotb.':'Impossible de récupérer les comptes Dotb pour le moment.',response.status===429?429:502)
  return normalizeAccounts(await response.json().catch(()=>null))
}
export function selectionValue(changes) {
  if(!Array.isArray(changes)||changes.length>5000)throw new AppError('Sélection invalide.')
  const ids=new Set()
  return changes.map(c=>{
    if(!c||!isId(c.id)||ids.has(c.id)||!Number.isInteger(c.version)||c.version<1||typeof c.enabled!=='boolean')throw new AppError('Sélection invalide.')
    ids.add(c.id);return {id:c.id,version:c.version,enabled:c.enabled}
  })
}
export function directionValue(body) {
  if(!isId(body.id)||!Number.isInteger(body.version)||body.version<1)throw new AppError('Compte ou version manquante.')
  if(body.background_id!==null&&!isId(body.background_id))throw new AppError('Choisis un fond de ta bibliothèque.')
  for(const key of ['prompt_front','prompt_back'])if(body[key]!==null&&(typeof body[key]!=='string'||body[key].length>50000))throw new AppError('Prompt invalide ou trop long.')
  if(typeof body.notes!=='string'||body.notes.length>3000)throw new AppError('Notes invalides ou trop longues.')
  return {background_id:body.background_id,prompt_front:body.prompt_front,prompt_back:body.prompt_back,notes:body.notes}
}
