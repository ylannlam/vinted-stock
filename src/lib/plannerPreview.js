// Démo de l'onglet Publication et des Dépenses IA : données fictives, rien n'est envoyé.
import {previewPhotos} from './previewPhotos'
import {summarizeAiUsage} from './aiUsage'

const accounts=[
 {id:'a1000000-0000-4000-8000-000000000001',login:'lea.vintage',country:'FR',connected:true,dotb:true,spacing:35,health:null},
 {id:'a1000000-0000-4000-8000-000000000002',login:'maison.jade',country:'FR',connected:false,dotb:true,spacing:45,health:null},
 {id:'a1000000-0000-4000-8000-000000000003',login:'nina.closet',country:'FR',connected:true,dotb:true,spacing:35,health:{status:'restricted',until:new Date(Date.now()+2*86400000).toISOString()}},
 {id:'a1000000-0000-4000-8000-000000000004',login:'sofia.dress',country:'FR',connected:true,dotb:false,spacing:30,health:null},
]
for(const a of accounts)a.ylavint={ready:true,online:a.connected,limit:5,from_hour:9,to_hour:22}
const titles=['Robe longue satin bustier','Body noir effet cuir','Jupe longue plissée','Top dentelle col carré','Combinaison patchwork','Robe tulle princesse']
const skus=['sz2603311904','sz2602271748','sz2509019538','sz2603311904','sz2511089597','sz2505153203']
let drafts=[],scheduled=[],queue=[]
function seed(){
 drafts=[];scheduled=[];queue=[]
 let n=0
 accounts.forEach((a,i)=>{for(let k=0;k<(i===0?7:4);k++){const t=n++%titles.length;drafts.push({id:`d0000000-0000-4000-8000-${String(n).padStart(12,'0')}`,version:1,state:'draft',account_id:a.id,title:`${titles[t]} taille ${['S','M','L'][k%3]}`,sku:skus[t],photo:previewPhotos[t%previewPhotos.length]?.[0]||null,photos:3,created_at:new Date(Date.now()-(40-n)*3600000).toISOString(),issues:n===5?['le prix']:[],live:true})}})
 const at=Date.now()+26*3600000
 scheduled=[0,1,2].map(i=>({id:`s0000000-0000-4000-8000-00000000000${i}`,version:3,state:'scheduled',account_id:accounts[i%2].id,title:titles[i+2],sku:skus[i+2],photo:previewPhotos[i]?.[0]||null,scheduled_at:new Date(at+i*5400000).toISOString(),planned_at:new Date(at+i*5400000).toISOString(),live:i!==2}))
}
seed()
const reserved=new Map()
export async function plannerPreview(method='GET',body,query=''){
 await new Promise(r=>setTimeout(r,250))
 const q=new URLSearchParams(query),action=q.get('action')||body?.action
 if(action==='planner')return {accounts:structuredClone(accounts),dotb_publish_enabled:true,selection_configured:true,drafts:structuredClone(drafts),queue:structuredClone(queue),scheduled:structuredClone(scheduled),occupied:scheduled.map(r=>({account_id:r.account_id,sku:r.sku,at:Date.parse(r.scheduled_at)}))}
 if(action==='plan')return {results:body.items.map(item=>{
  const d=drafts.find(x=>x.id===item.id)
  if(!d)return {id:item.id,ok:false,error:'Fiche introuvable.'}
  drafts=drafts.filter(x=>x!==d)
  const row={...d,state:'preparing',version:d.version+1,planned_at:item.at,message:'Programmée (démo). Envoi à Dotb…',step:0}
  if(body.provider==='ylavint'){Object.assign(row,{state:'scheduled',publish_provider:'ylavint',scheduled_at:item.at,message:'Confiée à YlaVint (démo).'});scheduled.push(row);return {id:item.id,ok:true,state:row.state,version:row.version,planned_at:item.at,message:row.message}}
  queue.push(row);reserved.set(row.id,row)
  return {id:item.id,ok:true,state:'preparing',version:row.version,planned_at:item.at,message:row.message}
 })}
 if(action==='step'){
  const row=reserved.get(body.id)||queue.find(r=>r.id===body.id)
  if(!row)throw Error('Fiche introuvable.')
  row.step=(row.step||0)+1
  const account=accounts.find(a=>a.id===row.account_id)
  if(row.step<3)row.message=row.step===1?'Fiche créée (démo). Envoi des photos…':'Photos envoyées (démo).'
  else if(!account.connected){row.last_error='Ouvre ce compte dans AdsPower et active le Bridge Dotb, puis reprends l’envoi.';row.message=row.last_error}
  else {row.state='scheduled';row.scheduled_at=row.planned_at;row.message='Programmée chez Dotb (démo).';queue=queue.filter(r=>r!==row);scheduled.push(row);scheduled.sort((a,b)=>Date.parse(a.scheduled_at)-Date.parse(b.scheduled_at))}
  row.version++
  return {draft:{...structuredClone(row)}}
 }
 if(action==='unschedule'){
  const row=scheduled.find(r=>r.id===body.id);if(!row)throw Error('Annonce introuvable.')
  scheduled=scheduled.filter(r=>r!==row);drafts.push({...row,state:'draft',version:row.version+1,issues:[],scheduled_at:null,planned_at:null})
  return {draft:structuredClone(row)}
 }
 if(action==='ai_usage'){
  const days=Number(q.get('days')||30),rows=[]
  for(let i=0;i<days*3;i++)if(i%4!==3)rows.push({created_at:new Date(Date.now()-i*8*3600000).toISOString(),model:i%5?'gemini-3.5-flash-lite':'gemini-3.5-flash',input_tokens:5200+i*13%900,output_tokens:640+i*7%200,account_id:accounts[i%3].id})
  return {ready:true,...summarizeAiUsage(rows,aiPrices,{days,logins:new Map(accounts.map(a=>[a.id,a.login]))})}
 }
 if(action==='ai_price'){const p={model:body.model,input_per_million:Number(body.input_per_million),output_per_million:Number(body.output_per_million),updated_at:new Date().toISOString()};aiPrices=[...aiPrices.filter(x=>x.model!==p.model),p];return {price:p}}
 throw Error('Action indisponible dans la démo.')
}
let aiPrices=[{model:'gemini-3.5-flash-lite',input_per_million:0.3,output_per_million:2.5,updated_at:new Date().toISOString()},{model:'gemini-3.5-flash',input_per_million:1.5,output_per_million:9,updated_at:new Date().toISOString()}]
