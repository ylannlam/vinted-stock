import {AppError} from './dotb.js'
import {publicationAccount} from '../src/lib/publications.js'

const table='adspower_preferences'
const checked=r=>{if(r.error)throw r.error;return r.data}
export function selectionProfiles(value){
 if(!Array.isArray(value)||value.length>1000)throw new AppError('Choisis au maximum 1 000 comptes.')
 const profiles=value.map(p=>{
  if(!p||typeof p.id!=='string'||!/^[-a-zA-Z0-9_]{1,100}$/.test(p.id))throw new AppError('Un profil AdsPower est invalide.')
  const text=(key,max)=>{if(typeof p[key]!=='string'||p[key].length>max)throw new AppError('Un profil AdsPower est invalide.');return p[key].trim()}
  return {id:p.id,number:text('number',30),name:text('name',200),group:text('group',200)}
 })
 if(new Set(profiles.map(p=>p.id)).size!==profiles.length)throw new AppError('Un compte figure plusieurs fois dans la sélection.')
 return profiles
}
export async function getProfileSelection(db,owner){return checked(await db.from(table).select('version,profiles,updated_at').eq('owner_id',owner).maybeSingle())}
export async function handleProfileSelection(req,{db,user}){
 if(req.method==='GET')return {selection:await getProfileSelection(db,user.id)}
 if(req.method!=='POST')throw new AppError('Méthode indisponible.',405)
 const {version,profiles:input}=req.body||{},profiles=selectionProfiles(input)
 if(!Number.isSafeInteger(version)||version<0)throw new AppError('Actualise ta sélection avant de la modifier.',409)
 const payload={profiles,version:version+1,updated_at:new Date().toISOString()}
 if(version===0){
  const result=await db.from(table).insert({...payload,owner_id:user.id}).select('version,profiles,updated_at').single()
  // A second device migrating its old local choice must not overwrite the saved choice.
  if(result.error?.code==='23505')return {selection:await getProfileSelection(db,user.id)}
  return {selection:checked(result)}
 }
 const selection=checked(await db.from(table).update(payload).eq('owner_id',user.id).eq('version',version).select('version,profiles,updated_at').maybeSingle())
 if(!selection)throw new AppError('Tes comptes ont changé dans un autre onglet. Actualise avant de réessayer.',409)
 return {selection}
}
export function matchSelectedAccounts(profiles,accounts,links){
 const seen=new Set(),matched=[]
 for(const profile of profiles){
  const account=publicationAccount(profile,accounts.map(a=>({...a,source_present:true})),links)
  if(account&&!seen.has(account.id)){seen.add(account.id);matched.push({...account,profile_id:profile.id,profile_number:profile.number,profile_name:profile.name})}
 }
 return matched
}
export async function selectedListingAccounts(db,owner,accounts){
 const [selection,links,saved,directory]=await Promise.all([getProfileSelection(db,owner),db.from('publication_profile_links').select('profile_id,account_id').eq('owner_id',owner),db.from('creative_accounts').select('id,login,country'),db.from('publication_accounts').select('id,login')])
 // L'absence de la liste Dotb ne supprime pas un ancien compte du parcours YlaVint.
 // Seuls des identifiants déjà enregistrés sont repris, jamais un nom approximatif.
 const known=new Set((checked(directory)||[]).map(a=>a.id)),live=new Set(accounts.map(a=>a.id))
 const historical=(checked(saved)||[]).filter(a=>known.has(a.id)&&!live.has(a.id)).map(a=>({...a,country:a.country?.toUpperCase()||null,connected:false,dotb_available:false}))
 return {selection,accounts:matchSelectedAccounts(selection?.profiles||[],[...accounts,...historical],checked(links))}
}
export async function requireSelectedAccount(db,owner,id,accounts){
 const selected=await selectedListingAccounts(db,owner,accounts)
 const account=selected.accounts.find(a=>a.id===id)
 if(!account)throw new AppError('Ce compte ne fait plus partie de tes comptes AdsPower choisis. Sélectionne-le dans AdsPower avant de publier.',409)
 return account
}
