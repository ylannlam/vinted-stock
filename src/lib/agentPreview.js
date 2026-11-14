// Données fictives de l'onglet Agent (mode démo, aucune requête réelle).
import {DEFAULTS,RECIPES,KINDS,DEFAULT_RECIPES,normalizeSettings} from '../../server/vinted-agent-config.js'
// Démo : versions simplifiées (le module serveur YlaVint n'est pas chargé dans le navigateur).
const AI_DEFAULTS={enabled:false,mode:'suggest',instructions:'',signature:'',delay_min_seconds:60,delay_max_seconds:240,max_auto_per_conversation:3,group_seconds:45,memory_messages:40,human_keywords:'remboursement, litige, arnaque, perdu, pas reçu, abîmé, cassé, retour',model:'gemini-3.5-flash-lite'}
const normalizeAi=(v={})=>({...AI_DEFAULTS,...v})
const orderStatus=t=>/annul/i.test(t)?'cancelled':/expédi|à expédier/i.test(t)?'label_sent':'payment_received'
import {LISTING_AI_MODELS} from './listingSettings.js'
import {previewPhotos} from './previewPhotos'

const ago=m=>new Date(Date.now()-m*60000).toISOString()
const ids=['a0000000-0000-4000-8000-000000000001','a0000000-0000-4000-8000-000000000002','a0000000-0000-4000-8000-000000000003','a0000000-0000-4000-8000-000000000004']
const settings=(over={})=>({...normalizeSettings(over),enabled:true,paused:false,pause_reason:null,last_seen_at:ago(2),extension_version:'3.0.0',version:1})
const state={
  accounts:[
    {id:ids[0],login:'test_lili',vinted_id:'1001',settings:settings({features:{inbox:true,ai:true,orders:true,sales:true,labels:true,dressing:true,unmask:true}}),last_seen_at:ago(2),extension_version:'3.0.0',today:{writes:3,unmask_item:2,sync_orders:4},alert:null},
    {id:ids[1],login:'boutique_emma',vinted_id:'1002',settings:{...settings({features:{unmask:true,pricing:true}}),paused:true,pause_reason:'vérification Vinted (captcha) à faire à la main dans ce profil'},last_seen_at:ago(4),extension_version:'3.0.0',today:{writes:1},alert:null},
    {id:ids[2],login:'dressing_lou',vinted_id:'1003',settings:null,today:{writes:0},alert:{status:'restricted',title:'Compte restreint jusqu’au 09/11/2026'}},
    {id:ids[3],login:'mode_nina',vinted_id:'1004',settings:null,last_seen_at:ago(7),extension_version:'3.0.0',today:{writes:0},alert:null},
  ],
  recipes:Object.entries(RECIPES).map(([kind,info],i)=>({kind,...info,default:!!DEFAULT_RECIPES[kind],learned_at:i<5?ago(300+i*20):null,learned_login:i<5?'test_lili':null,samples:i<5?1:0,method:i<5?(['GET','GET','GET','GET','GET'][i]):null,path:i<5?['/api/v2/wardrobe/{id}/items','/api/v2/my_orders','/api/v2/shipments/{id}/label_url','/web/api/notifications/notifications','/api/v2/item_upload/items/{id}'][i]:null})),
  planned:[
    {id:'p1',account_id:ids[0],login:'test_lili',kind:'like_message',state:'queued',recipient:'julie.mode',item_title:'Robe longue fleurie',body:'Bonjour Julie, merci pour ton favori ! Je peux te proposer la robe à 16,20 € si elle te plaît.',offer_requested:true,offer_price:16.2,reason:'Premier contact après un favori.',not_before:ago(-8),executor:'desktop'},
    {id:'p2',account_id:ids[1],login:'boutique_emma',kind:'reply_message',state:'queued',recipient:'sarah_m',item_title:'Jean taille haute',body:'Bonjour, je vérifie les mesures et je reviens vers toi.',reason:'Réponse validée depuis la messagerie.',not_before:ago(-15),executor:'desktop',blocked_reason:'Compte en pause.'},
  ],
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
const photo=n=>previewPhotos[n%previewPhotos.length][0]
const convs=[
  {account_id:ids[0],conversation_id:'7001',other_login:'camille.b',item_title:'Robe longue fleurie',item_price:18,transaction_status:null,last_message:'Bonjour ! Elle taille comment ? Je fais du 38 habituellement',last_message_at:ago(3),last_from_me:false,unread:true,site_read_at:null,needs_human:false,ai_state:'drafted',ai_draft:'Coucou ! Elle taille normalement, prends ta taille habituelle 😊 Elle est dispo, tu peux l’acheter directement.',allow_reply:true},
  {account_id:ids[1],conversation_id:'7002',other_login:'sarah_m',item_title:'Jean taille haute',item_price:14,transaction_status:'Payée',last_message:'Mon colis est arrivé abîmé, je veux un remboursement',last_message_at:ago(25),last_from_me:false,unread:true,site_read_at:null,needs_human:true,ai_state:'human',ai_reason:'Mot sensible : « rembours ». À traiter toi-même.',ai_draft:'Je suis vraiment désolée ! Peux-tu m’envoyer une photo ? Je regarde tout de suite avec toi.',allow_reply:true},
  {account_id:ids[0],conversation_id:'7003',other_login:'lea.vtg',item_title:'Top côtelé noir',item_price:9,transaction_status:null,last_message:'Merci beaucoup, bonne journée !',last_message_at:ago(140),last_from_me:true,unread:false,site_read_at:ago(100),needs_human:false,ai_state:'sent',allow_reply:true},
]
const messages={
  '7001':[{id:1,message_id:'1',from_me:true,body:'Merci pour ton like sur Robe longue fleurie ! Si elle t’intéresse, je peux te faire un petit prix.',kind:'message',sent_at:ago(60),state:'sent',source:'likes'},{id:2,message_id:'2',from_me:false,body:'Bonjour ! Elle taille comment ? Je fais du 38 habituellement',kind:'message',sent_at:ago(3),state:'vinted',source:'vinted'}],
  '7002':[{id:3,message_id:'3',from_me:false,body:'Bonjour, commande reçue',kind:'message',sent_at:ago(30),state:'vinted',source:'vinted'},{id:4,message_id:'4',from_me:false,body:'Mon colis est arrivé abîmé, je veux un remboursement',kind:'message',sent_at:ago(25),state:'vinted',source:'vinted'}],
  '7003':[{id:5,message_id:'5',from_me:false,body:'Il est toujours dispo ?',kind:'message',sent_at:ago(150),state:'vinted',source:'vinted'},{id:6,message_id:'6',from_me:true,body:'Oui ! Tu peux l’acheter directement 😊',kind:'message',sent_at:ago(146),state:'sent',source:'ai'},{id:7,message_id:'7',from_me:false,body:'Merci beaucoup, bonne journée !',kind:'message',sent_at:ago(140),state:'vinted',source:'vinted'}],
}
let ai={...normalizeAi({enabled:true,mode:'suggest',instructions:'Toujours tutoyer. Envoi sous 24 h.'}),version:1}
const wardrobe=Array.from({length:14},(_,i)=>({item_id:String(5000+i),title:['Robe longue fleurie','Jean taille haute','Pull maille beige','Top côtelé noir','Robe satin verte','Gilet court crème','Jupe plissée'][i%7],price:9+i,currency:'EUR',photo_url:photo(i),
  state:i===1?'hidden':i===2?'repairing':i===5?'sold':i===9?'draft':'visible',hidden_since:i===1?ago(600):null,total_drop:i===2?1:0,repairs:i===2?1:0,listed_at:ago(600*(i+1)),busy:false}))
export async function agentPreview(method='GET',body,query=''){
  await new Promise(r=>setTimeout(r,150))
  const q=Object.fromEntries(new URLSearchParams(query.replace(/^&/,'')))
  const names=new Map(state.accounts.map(a=>[a.id,a.login]))
  if(method==='GET'&&q.view==='actions')return structuredClone({actions:state.planned.filter(a=>a.state==='queued'&&(!q.account_id||a.account_id===q.account_id))})
  if(method==='GET'&&q.view==='inbox'){
    let list=convs.filter(c=>!q.account_id||c.account_id===q.account_id).map(c=>({...c,login:names.get(c.account_id),unseen:!c.last_from_me&&!c.site_read_at}))
    if(q.filter==='unread')list=list.filter(c=>c.unseen);if(q.filter==='human')list=list.filter(c=>c.needs_human);if(q.filter==='ai')list=list.filter(c=>['drafted','queued','human'].includes(c.ai_state))
    return structuredClone({conversations:list,ai:{enabled:ai.enabled,mode:ai.mode}})
  }
  if(method==='GET'&&q.view==='thread'){const c=convs.find(c=>c.conversation_id===q.conversation_id);if(q.read!=='0')c.site_read_at=new Date().toISOString();return structuredClone({conversation:{...c,login:names.get(c.account_id)},messages:messages[c.conversation_id]||[],agent:{enabled:true,paused:false}})}
  if(method==='GET'&&q.view==='ai')return structuredClone({config:ai,defaults:AI_DEFAULTS,models:LISTING_AI_MODELS,ready:true})
  if(method==='GET'&&q.view==='wardrobe'){const counts={};for(const l of wardrobe)counts[l.state]=(counts[l.state]||0)+1;const a=state.accounts.find(x=>x.id===q.account_id);return structuredClone({listings:wardrobe,counts,last_scan:ago(40),settings:a?.settings||null})}
  if(method==='GET'&&q.view==='sales')return structuredClone({orders:state.orders.map(o=>({...o,login:names.get(o.account_id),normalized:orderStatus(o.status),sales_order_id:o.label_path?'x':null}))})
  if(body?.action==='reply'||body?.action==='ai_send'){const c=convs.find(c=>c.conversation_id===body.conversation_id);const m={id:Date.now(),message_id:'local:'+Date.now(),from_me:true,body:body.body||c.ai_draft,kind:'message',sent_at:new Date().toISOString(),state:'queued',source:'site'};(messages[c.conversation_id]||=[]).push(m);Object.assign(c,{last_message:m.body,last_message_at:m.sent_at,last_from_me:true,ai_state:'none',ai_draft:null,needs_human:false});return {message:'Message envoyé à YlaVint : il part dès que le profil AdsPower est ouvert.'}}
  if(body?.action==='ai_suggest'){const c=convs.find(c=>c.conversation_id===body.conversation_id);Object.assign(c,{ai_state:'drafted',ai_draft:'Bonjour ! Oui elle est toujours disponible 😊'});return {state:'drafted',reply:c.ai_draft,message:'Proposition prête.'}}
  if(body?.action==='remember_reply'){const c=convs.find(c=>c.conversation_id===body.conversation_id),a=state.accounts.find(a=>a.id===body.account_id);a.settings.messaging.reply_examples=[...(a.settings.messaging.reply_examples||[]),{before:c.ai_draft,after:body.body}].slice(-3);a.settings.version++;return {saved:true,message:'Correction retenue pour ce compte. Aucun message envoyé.'}}
  if(body?.action==='ai_discard'||body?.action==='human_done'){const c=convs.find(c=>c.conversation_id===body.conversation_id);Object.assign(c,{ai_draft:null,ai_state:'skipped',needs_human:false});return {saved:true}}
  if(body?.action==='save_ai'){ai={...normalizeAi(body.config),version:ai.version+1};return {saved:true,version:ai.version,config:ai}}
  if(body?.action==='test_ai')return {reply:'Coucou ! Elle taille normalement, prends ta taille habituelle. Pour le prix, je peux te faire 22 € si tu la prends aujourd’hui 😊',needs_human:false,reason:''}
  if(['item_unmask','item_reprice','refresh_conversation','cancel_message','retry_message','label_link'].includes(body?.action))return {queued:1,message:'Démo : demandé à YlaVint.'}
  if(method==='GET')return {...structuredClone(state),unread_total:convs.filter(c=>!c.last_from_me&&!c.site_read_at).length,unread_by_account:{[ids[0]]:1,[ids[1]]:1},human_total:convs.filter(c=>c.needs_human).length,ai:{enabled:ai.enabled,mode:ai.mode},ai_ready:true,kinds:Object.fromEntries(Object.entries(KINDS).map(([k,v])=>[k,{label:v.label,writes:v.writes,needs:v.needs}])),defaults:DEFAULTS}
  const a=state.accounts.find(x=>x.id===body.account_id)
  if(body.action==='save_settings'){a.settings={...normalizeSettings(body.settings),enabled:body.enabled,paused:false,last_seen_at:a.settings?.last_seen_at||null,version:(a.settings?.version||0)+1};return {saved:true}}
  if(body.action==='pause'){a.settings.paused=true;a.settings.pause_reason='mise en pause depuis le site';return {saved:true}}
  if(body.action==='resume'){a.settings.paused=false;a.settings.pause_reason=null;return {saved:true}}
  if(body.action==='pause_all'){let n=0;for(const x of state.accounts)if(x.settings?.enabled&&!x.settings.paused){x.settings.paused=true;x.settings.pause_reason='arrêt général depuis le site';n++}return {paused:n}}
  if(body.action==='enqueue'){state.tasks.unshift({id:crypto.randomUUID(),account_id:a.id,kind:body.kind,state:'queued',not_before:new Date().toISOString()});return {queued:1}}
  if(body.action==='cancel'){const planned=state.planned.find(t=>t.id===body.task_id);if(planned)planned.state='cancelled';const t=state.tasks.find(t=>t.id===body.task_id);if(t)t.state='cancelled';return {cancelled:1}}
  if(body.action==='publish_drafts')return {queued:0,refused:body.ids.map(id=>({id,reason:'démo : apprends d’abord la création d’annonce'}))}
  if(body.action==='forget_recipe'){const r=state.recipes.find(r=>r.kind===body.kind);if(r)r.learned_at=null;return {saved:true}}
  return {}
}
