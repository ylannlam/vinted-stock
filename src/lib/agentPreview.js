// Données fictives de l'onglet Agent (mode démo, aucune requête réelle).
import {DEFAULTS,RECIPES,KINDS,normalizeSettings} from '../../server/vinted-agent.js'

const ago=m=>new Date(Date.now()-m*60000).toISOString()
const ids=['a0000000-0000-4000-8000-000000000001','a0000000-0000-4000-8000-000000000002','a0000000-0000-4000-8000-000000000003','a0000000-0000-4000-8000-000000000004']
const settings=(over={})=>({...normalizeSettings(over),enabled:true,paused:false,pause_reason:null,last_seen_at:ago(2),extension_version:'2.0.0',version:1})
const state={
  accounts:[
    {id:ids[0],login:'test_lili',vinted_id:'1001',settings:settings({features:{orders:true,labels:true,unmask:true}}),today:{writes:3,unmask_item:2,sync_orders:4},alert:null},
    {id:ids[1],login:'boutique_emma',vinted_id:'1002',settings:{...settings({features:{unmask:true,pricing:true}}),paused:true,pause_reason:'vérification Vinted (captcha) à faire à la main dans ce profil'},today:{writes:1},alert:null},
    {id:ids[2],login:'dressing_lou',vinted_id:'1003',settings:null,today:{writes:0},alert:{status:'restricted',title:'Compte restreint jusqu’au 09/11/2026'}},
    {id:ids[3],login:'mode_nina',vinted_id:'1004',settings:null,today:{writes:0},alert:null},
  ],
  recipes:Object.entries(RECIPES).map(([kind,info],i)=>({kind,...info,learned_at:i<5?ago(300+i*20):null,learned_login:i<5?'test_lili':null,samples:i<5?1:0,method:i<5?(['GET','GET','GET','GET','GET'][i]):null,path:i<5?['/api/v2/wardrobe/{id}/items','/api/v2/my_orders','/api/v2/shipments/{id}/label_url','/web/api/notifications/notifications','/api/v2/item_upload/items/{id}'][i]:null})),
  tasks:[
    {id:'t1',account_id:ids[0],kind:'unmask_item',state:'queued',not_before:ago(-25),created_at:ago(5)},
    {id:'t2',account_id:ids[0],kind:'scan_wardrobe',state:'done',started_at:ago(12),finished_at:ago(11)},
    {id:'t3',account_id:ids[0],kind:'fetch_label',state:'done',started_at:ago(40),finished_at:ago(40)},
    {id:'t4',account_id:ids[1],kind:'reprice_item',state:'failed',error:'vérification Vinted (captcha) à faire à la main dans ce profil',started_at:ago(60),finished_at:ago(60)},
  ],
  log:[
    {id:4,account_id:ids[0],level:'info',event:'done',message:'Lecture du dressing · 48 annonce(s) lue(s), 2 masquée(s), 1 action(s) prévue(s).',created_at:ago(11)},
    {id:3,account_id:ids[0],level:'info',event:'done',message:'Bordereau · Bordereau enregistré.',created_at:ago(40)},
    {id:2,account_id:ids[1],level:'warn',event:'captcha',message:'Agent mis en pause : vérification Vinted (captcha) à faire à la main dans ce profil',created_at:ago(60)},
    {id:1,account_id:null,level:'info',event:'learned',message:'Recette apprise : Dressing (GET /api/v2/wardrobe/{id}/items).',created_at:ago(300)},
  ],
  orders:[
    {transaction_id:'90001',account_id:ids[0],status:'À expédier',title:'Robe longue fleurie',price:18,order_date:ago(90),label_path:'agent-labels/x.pdf'},
    {transaction_id:'90002',account_id:ids[0],status:'Payée',title:'Top côtelé noir',price:9,order_date:ago(30),label_path:null},
  ],
  hidden:[
    {account_id:ids[0],item_id:'5001',title:'Jean taille haute',price:14,state:'hidden',hidden_since:ago(600),repairs:0,total_drop:0},
    {account_id:ids[0],item_id:'5002',title:'Pull maille beige',price:11,state:'repairing',hidden_since:ago(1600),repairs:1,total_drop:1},
  ],
  drafts:[
    {id:'d1',state:'draft',title:'Robe satinée verte',account_id:ids[0],price:'22',photos:3},
    {id:'d2',state:'draft',title:'Gilet court crème',account_id:ids[3],price:'15',photos:2},
  ],
}
export async function agentPreview(method='GET',body){
  await new Promise(r=>setTimeout(r,150))
  if(method==='GET')return {...structuredClone(state),kinds:Object.fromEntries(Object.entries(KINDS).map(([k,v])=>[k,{label:v.label,writes:v.writes,needs:v.needs}])),defaults:DEFAULTS}
  const a=state.accounts.find(x=>x.id===body.account_id)
  if(body.action==='save_settings'){a.settings={...normalizeSettings(body.settings),enabled:body.enabled,paused:false,last_seen_at:a.settings?.last_seen_at||null,version:(a.settings?.version||0)+1};return {saved:true}}
  if(body.action==='pause'){a.settings.paused=true;a.settings.pause_reason='mise en pause depuis le site';return {saved:true}}
  if(body.action==='resume'){a.settings.paused=false;a.settings.pause_reason=null;return {saved:true}}
  if(body.action==='pause_all'){let n=0;for(const x of state.accounts)if(x.settings?.enabled&&!x.settings.paused){x.settings.paused=true;x.settings.pause_reason='arrêt général depuis le site';n++}return {paused:n}}
  if(body.action==='enqueue'){state.tasks.unshift({id:crypto.randomUUID(),account_id:a.id,kind:body.kind,state:'queued',not_before:new Date().toISOString()});return {queued:1}}
  if(body.action==='cancel'){const t=state.tasks.find(t=>t.id===body.task_id);if(t)t.state='cancelled';return {cancelled:1}}
  if(body.action==='publish_drafts')return {queued:0,refused:body.ids.map(id=>({id,reason:'démo : apprends d’abord la création d’annonce'}))}
  if(body.action==='forget_recipe'){const r=state.recipes.find(r=>r.kind===body.kind);if(r)r.learned_at=null;return {saved:true}}
  return {}
}
