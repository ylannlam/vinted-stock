export let previewSelection={version:1,profiles:[{id:'demo-0',number:'01',name:'Dressing Camille',group:'Vinted · France'},{id:'demo-1',number:'02',name:'Atelier Léa',group:'Vinted · France'}]}
import {parisDay} from './publications'
const names=['Dressing Camille','Atelier Léa','Dressing Emma','Sélection Jade','Studio Louise','Dressing Alice']
const accounts=names.map((login,i)=>({id:`publication-demo-${i}`,login,source_present:true,bridge_connected:i<4,directory_checked_at:new Date().toISOString(),last_checked_at:i===4?null:new Date().toISOString(),last_complete_at:i===4?null:new Date().toISOString(),next_scan_at:new Date(Date.now()+3600000).toISOString(),scan_page:1,total_pages:1,last_error:i===3?'Ouvre ce profil et active le Bridge Dotb pour relever ses annonces.':null,day_count:[5,2,0,3,0,1][i],yesterday_count:[3,0,4,1,0,2][i],week_count:[18,9,16,12,0,8][i],undated_count:i===1?1:0,history_count:24+i,active_count:12+i}))
const images=['https://images.unsplash.com/photo-1515372039744-b8f02a3ae446?w=500&auto=format&fit=crop','https://images.unsplash.com/photo-1539008835657-9e8e9680c956?w=500&auto=format&fit=crop','https://images.unsplash.com/photo-1595777457583-95e059d581b8?w=500&auto=format&fit=crop']
export async function publicationPreview(action,query={},body){
  if(action==='profile-selection'){if(body)previewSelection={version:previewSelection.version+1,profiles:body.profiles};return {selection:structuredClone(previewSelection)}}
  if(action==='publications')return {date:query.date||parisDay(),accounts:structuredClone(accounts),links:[],directory_checked_at:new Date().toISOString()}
  if(action==='publication-details'){
    const a=accounts.find(a=>a.id===query.account_id),n=query.day==='undated'?a.undated_count:query.day==='all'?7:a.day_count
    return {items:Array.from({length:n},(_,i)=>({item_id:String(i),title:['Robe fleurie à manches longues','Robe de cérémonie bleu ciel','Robe vert sauge en tulle'][i%3],photo_url:images[i%3],url:'https://www.vinted.fr',price:String(35+i*5),currency:'EUR',status:i===5?'sold':'active',present:i!==6,estimated_at:query.day==='undated'?null:new Date(Date.now()-i*1200000).toISOString()})),count:n,page_size:40}
  }
  if(action==='publication-sync'){const a=accounts.find(a=>a.id===body.account_id);a.last_checked_at=new Date().toISOString();a.next_scan_at=new Date(Date.now()+3600000).toISOString();return {synced:true,complete:true}}
  if(action==='publication-accounts')return {refreshed:true}
  return {saved:true}
}
