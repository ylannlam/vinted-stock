// Demo transport: never contacts the local connector or Vinted.
import {agentPreview} from './agentPreview'
let assistants=[]
export async function desktopPreview(route,body){
 if(route==='/state')return {version:'1.4.0',configured:true,ylavint:true,visible_vinted:true,rhythm_controls:true,assistants:structuredClone(assistants)}
 if(route==='/profiles')return {profiles:[{id:'demo42',number:42,name:'Compte de démonstration'}]}
 if(route==='/ylavint/start')assistants=[{account_id:body.account_id,profile_id:body.profile_id,state:body.rehearse?'rehearsed':body.check_only?'checked':'waiting',message:body.rehearse?'Démo : répétition terminée, aucun envoi.':body.check_only?'Démo : compte confirmé, aucun envoi.':'Démo : en attente des prochains favoris et messages.',summary:{conversations_read:3,articles_read:14,likes_read:5,messages_sent:0,offers_sent:0,actions_cancelled:0,articles_browsed:0,photos_opened:0},actions_preview:body.rehearse?(await agentPreview('GET',undefined,'&view=actions&account_id='+body.account_id)).actions:[]}]
 if(route==='/ylavint/stop')assistants=assistants.map(s=>s.account_id===body.account_id?{...s,state:'stopped',message:'Démo : assistant arrêté.'}:s)
 if(route==='/ylavint/takeover')assistants=assistants.map(s=>s.account_id===body.account_id?{...s,state:'manual',message:'Démo : tu as la main, aucune reprise automatique.'}:s)
 return {assistants:structuredClone(assistants)}
}
export async function desktopPairPreview(_method,body){
 if(body?.action==='desktop_pair')return {account_id:body.account_id,profile_id:body.profile_id,member_id:'1001',token:'demo'}
 if(body?.action==='download')return {filename:'ylavint.zip',zip_base64:''}
 return {keys:[{id:'k1',created_at:new Date().toISOString(),last_seen_at:new Date().toISOString(),last_login:'test_lili'}]}
}
