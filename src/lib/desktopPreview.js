// Demo transport: never contacts the local connector or Vinted.
let assistants=[]
export async function desktopPreview(route,body){
 if(route==='/state')return {version:'1.2.0',configured:true,ylavint:true,assistants:structuredClone(assistants)}
 if(route==='/profiles')return {profiles:[{id:'demo42',number:42,name:'Compte de démonstration'}]}
 if(route==='/ylavint/start')assistants=[{account_id:body.account_id,profile_id:body.profile_id,state:body.check_only?'checked':'waiting',message:body.check_only?'Démo : compte confirmé, aucun envoi.':'Démo : en attente des prochains favoris et messages.'}]
 if(route==='/ylavint/stop')assistants=assistants.map(s=>s.account_id===body.account_id?{...s,state:'stopped',message:'Démo : assistant arrêté.'}:s)
 return {assistants:structuredClone(assistants)}
}
export async function desktopPairPreview(_method,body){
 if(body?.action==='desktop_pair')return {account_id:body.account_id,profile_id:body.profile_id,member_id:'1001',token:'demo'}
 if(body?.action==='download')return {filename:'ylavint.zip',zip_base64:''}
 return {keys:[{id:'k1',created_at:new Date().toISOString(),last_seen_at:new Date().toISOString(),last_login:'test_lili'}]}
}
