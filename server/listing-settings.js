import {AppError,isId} from './dotb.js'
import {cleanListingSettings,effectiveListingSettings} from '../src/lib/listingSettings.js'

const check=result=>{if(result.error)throw result.error;return result.data}
const TABLE='listing_settings'
// Tant que la migration n'est pas appliquée, la table manque : on garde les valeurs par défaut (Dotb coupé).
const missingTable=error=>['42P01','PGRST205'].includes(error?.code)
const readRows=async query=>{const result=await query;if(missingTable(result.error))return [];return check(result)||[]}

// Réglages communs + réglages du compte, et ce qui s'applique réellement à ce compte.
export async function readListingSettings(db,accountId){
 const scopes=['default',...(isId(accountId)?[accountId.toLowerCase()]:[])]
 const rows=(await readRows(db.from(TABLE).select('scope,settings,version,updated_at').in('scope',scopes))).filter(r=>typeof r.scope==='string')
 const global=rows.find(r=>r.scope==='default')||null,account=rows.find(r=>r.scope===scopes[1])||null
 return {global,account,effective:effectiveListingSettings(global?.settings,account?.settings)}
}

// Comptes dont l'interrupteur « Publier via Dotb » est allumé.
export async function dotbAccounts(db){
 const rows=await readRows(db.from(TABLE).select('scope,settings').neq('scope','default'))
 return new Set(rows.filter(r=>typeof r.scope==='string'&&effectiveListingSettings(null,r.settings).dotb===true).map(r=>r.scope))
}

export async function saveListingSettings(db,user,body){
 const scope=body?.scope==='default'?'default':isId(body?.scope)?body.scope.toLowerCase():null
 if(!scope)throw new AppError('Choisis à quel compte s’appliquent ces réglages.')
 if(!Number.isSafeInteger(body.version)||body.version<0)throw new AppError('Rouvre les réglages avant de les enregistrer.',409)
 let settings
 try{settings=cleanListingSettings(body.settings,{account:scope!=='default'})}catch(e){throw new AppError(e.message)}
 const current=check(await db.from(TABLE).select('scope,version').eq('scope',scope).maybeSingle())
 if(body.version!==(current?.version??0))throw new AppError('Ces réglages viennent d’être modifiés par quelqu’un d’autre. Rouvre-les avant d’enregistrer.',409)
 const row={scope,settings,updated_by:user.id,updated_at:new Date().toISOString()}
 const result=current
  ?await db.from(TABLE).update({...row,version:current.version+1}).eq('scope',scope).eq('version',current.version).select('scope,settings,version,updated_at').maybeSingle()
  :await db.from(TABLE).insert({...row,version:1}).select('scope,settings,version,updated_at').maybeSingle()
 if(result.error?.code==='23505')throw new AppError('Ces réglages viennent d’être modifiés par quelqu’un d’autre. Rouvre-les avant d’enregistrer.',409)
 const saved=check(result)
 if(!saved)throw new AppError('Ces réglages viennent d’être modifiés par quelqu’un d’autre. Rouvre-les avant d’enregistrer.',409)
 return saved
}

// Titres vendus récemment (ce compte, puis les autres) : un exemple de style, jamais une consigne.
export async function listingTitleExamples(db,accountId){
 try{
  const value=check(await db.rpc('listing_title_examples',{p_account:accountId}))
  const list=rows=>(Array.isArray(rows)?rows:[]).filter(t=>typeof t==='string'&&t.length<=100).slice(0,8)
  return {own:list(value?.own),others:list(value?.others)}
 }catch{return {own:[],others:[]}}
}

// Le verrou par compte et la réservation sont dans la même transaction, même depuis deux onglets.
export async function reserveListingSlot(db,row,payload,spacing,notBefore=null){
 const rows=check(await db.rpc('reserve_listing_slot',{p_id:row.id,p_owner:row.owner_id,p_version:row.version,p_payload:payload,p_spacing:spacing,...(notBefore?{p_not_before:notBefore}:{})}))
 if(!rows?.[0])throw new AppError('Cette fiche a changé. Actualise la session avant de reprendre l’envoi.',409)
 return rows[0]
}

// Réglages effectifs de tous les comptes en une seule lecture (onglet Publication).
export async function allListingSettings(db){
 const rows=await readRows(db.from(TABLE).select('scope,settings'))
 const global=rows.find(r=>r.scope==='default')?.settings||null
 const accounts=new Map(rows.filter(r=>typeof r.scope==='string'&&r.scope!=='default').map(r=>[r.scope,effectiveListingSettings(global,r.settings)]))
 return {effective:id=>accounts.get(String(id||'').toLowerCase())||effectiveListingSettings(global,null)}
}
