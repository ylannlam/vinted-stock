// Réglages et catalogue des tâches de YlaVint : module sans accès réseau ni base, partagé avec la démo du site.
import {AppError} from './dotb.js'
import {DESKTOP_DEFAULTS,DESKTOP_BOUNDS,DESKTOP_LABELS} from '../src/lib/ylavintExecution.js'

// Tâches. « needs » : recettes indispensables, apprises sur le vrai site. « uses » : lectures qui ont une recette par défaut.
export const KINDS={
  scan_wardrobe:{writes:false,label:'Lecture du dressing',needs:[],uses:['wardrobe']},
  sync_orders:{writes:false,label:'Lecture des ventes',needs:[],uses:['orders_list','order_detail']},
  fetch_label:{writes:false,label:'Bordereau',needs:['order_label'],uses:['order_detail']},
  scan_likes:{writes:false,label:'Lecture des likes',needs:[],uses:['likes_list']},
  sync_inbox:{writes:false,label:'Lecture de la messagerie',needs:[],uses:['inbox_list','conversation_read']},
  unmask_item:{writes:true,label:'Démasquage',needs:['item_form','item_edit','photo_upload']},
  reprice_item:{writes:true,label:'Baisse de prix',needs:['item_form','item_edit']},
  publish_item:{writes:true,label:'Préparation du formulaire',needs:[]},
  like_message:{writes:true,label:'Message après un like',needs:['conversation_create','message_send'],uses:['user_read','conversation_read']},
  reply_message:{writes:true,label:'Réponse à un acheteur',needs:['message_send'],uses:['conversation_read']},
  accept_offer:{writes:true,label:'Acceptation d’une offre',needs:['offer_accept','conversation_read']},
  order_message:{writes:true,label:'Message de commande',needs:['message_send']},
  order_extension:{writes:true,label:'Demande de délai',needs:['shipping_extension'],uses:['order_detail']},
  order_cancel:{writes:true,label:'Annulation de commande',needs:['order_cancel'],uses:['order_detail']},
  order_review:{writes:true,label:'Évaluation de l’acheteur',needs:['feedback_send']},
  item_delete:{writes:true,label:'Suppression de l’article vendu',needs:['item_delete']},
}
// Actions facultatives d'une tâche : utilisées si elles ont été apprises, sinon ignorées (ex. l'offre après un like).
export const OPTIONAL={like_message:['offer_send']}
// Lectures que le site Vinted fait lui-même à chaque visite : utilisées tant qu'aucune recette n'a été relevée.
export const DEFAULT_RECIPES={
  // Formulaire officiel Vinted vérifié le 08/11/2026 : les brouillons ont leur propre route.
  photo_upload:{method:'POST',path:'/api/v2/photos',body:'form',fields:['photo[type]','photo[file]','photo[temp_uuid]']},
  item_create:{method:'POST',path:'/api/v2/item_upload/items',headers:{'x-upload-form':'true'},body:'json'},
  draft_create:{method:'POST',path:'/api/v2/item_upload/drafts',body:'json'},
  wardrobe:{method:'GET',path:'/api/v2/wardrobe/{id}/items',query:{order:'relevance'},headers:{},body:'none'},
  orders_list:{method:'GET',path:'/api/v2/my_orders',query:{type:'sold',status:'all'},headers:{},body:'none'},
  // Détail d'une vente : articles, envoi (identifiant, transporteur, date limite). Lu par le site Vinted à l'ouverture d'une vente.
  order_detail:{method:'GET',path:'/api/v2/transactions/{id}',query:{},headers:{},body:'none'},
  likes_list:{method:'GET',path:'/inbox-notifications/v1/notifications',origin:'https://api.vinted.fr',query:{},headers:{platform:'web','x-next-app':'marketplace-web',locale:'fr-FR'},body:'none'},
  inbox_list:{method:'GET',path:'/api/v2/inbox',query:{},headers:{},body:'none'},
  conversation_read:{method:'GET',path:'/api/v2/conversations/{id}',query:{},headers:{},body:'none'},
  user_read:{method:'GET',path:'/api/v2/users/{id}',query:{},headers:{},body:'none'},
  // Actions prêtes à l'emploi : utilisées tant que l'extension n'a pas relevé la requête exacte de Vinted.
  conversation_create:{method:'POST',path:'/api/v2/conversations',query:{},headers:{},body:'json',template:{initiator:'seller_enters_notification',item_id:0,opposite_user_id:0}},
  message_send:{method:'POST',path:'/api/v2/conversations/{id}/replies',query:{},headers:{},body:'json',template:{reply:{body:'',photo_temp_uuids:null,is_personal_data_sharing_check_skipped:false}}},
  offer_send:{method:'POST',path:'/api/v2/transactions/{id}/offers',query:{},headers:{},body:'json',template:{offer:{price:'',currency:'EUR'}},id_from:'transaction'},
  offer_accept:{method:'PUT',path:'/api/v2/transactions/{id}/offer_requests/{offer_id}/accept',query:{},headers:{},body:'none'},
  item_delete:{method:'POST',path:'/api/v2/items/{id}/delete',query:{},headers:{},body:'none',id_from:'item'},
  order_detail:{method:'GET',path:'/api/v2/transactions/{id}',query:{},headers:{},body:'none'},
}
// Recettes relevées en mode apprentissage, avec le geste à faire à la main une fois sur Vinted.
export const RECIPES={
  draft_create:{label:'Création d’un brouillon Vinted',how:'Enregistre une annonce dans tes brouillons Vinted.'},
  wardrobe:{label:'Dressing',how:'Ouvre ton profil Vinted (ton dressing).'},
  orders_list:{label:'Liste des ventes',how:'Ouvre Mes commandes, onglet Ventes.'},
  order_detail:{label:'Détail d’une vente',how:'Ouvre une vente depuis Mes commandes.'},
  order_label:{label:'Bordereau',how:'Ouvre une vente et affiche son bordereau d’envoi.'},
  likes_list:{label:'Likes',how:'Ouvre la cloche des notifications.'},
  inbox_list:{label:'Messagerie',how:'Ouvre la messagerie Vinted.'},
  conversation_read:{label:'Lecture d’une conversation',how:'Ouvre une conversation dans la messagerie.'},
  item_form:{label:'Ouverture d’une annonce',how:'Clique sur Modifier sur une de tes annonces.'},
  item_edit:{label:'Enregistrement d’une annonce',how:'Change un détail de l’annonce puis enregistre.'},
  photo_upload:{label:'Envoi d’une photo',how:'Ajoute une photo dans le formulaire d’annonce.'},
  item_create:{label:'Création d’une annonce',how:'Publie une annonce à la main.'},
  conversation_create:{label:'Ouverture d’une conversation',how:'Depuis une notification de like, clique sur Envoyer un message.'},
  message_send:{label:'Envoi d’un message',how:'Envoie un message dans une conversation.'},
  user_read:{label:'Profil d’un membre',how:'Ouvre le profil d’un membre.'},
  offer_send:{label:'Envoi d’une offre',how:'Dans une conversation avec un membre qui a liké, clique sur Faire une offre et envoie-la.'},
  offer_accept:{label:'Acceptation d’une offre',how:'Accepte une offre depuis une conversation Vinted.'},
  shipping_extension:{label:'Demande de délai d’envoi',how:'Dans une vente à expédier, demande un délai supplémentaire à l’acheteur.'},
  order_cancel:{label:'Annulation d’une vente',how:'Annule une vente à la main (choisis un motif qui correspond à la réalité).'},
  feedback_send:{label:'Évaluation d’un acheteur',how:'Laisse une évaluation à un acheteur sur une vente terminée.'},
  item_delete:{label:'Suppression d’une annonce',how:'Supprime une annonce de ton dressing.'},
}
// Valeurs prudentes par défaut : on monte progressivement en observant la santé des comptes.
export const DEFAULTS={
  features:{inbox:false,ai:false,orders:false,sales:false,labels:false,dressing:false,unmask:false,pricing:false,publish:false,likes:false},
  limits:{writes_per_day:15,unmask_item_per_day:5,reprice_item_per_day:5,publish_item_per_day:5,like_message_per_day:10,
    order_message_per_day:30,order_extension_per_day:10,order_cancel_per_day:5,order_review_per_day:20,item_delete_per_day:10,min_gap_minutes:12,from_hour:0,to_hour:0},
  unmask:{price_drop:1,max_drop:2,floor:2,max_repairs:3,wait_hours:24},
  pricing:{after_days:7,step:1,every_days:4,max_drop:5,floor:3},
  likes:{history_hours:0,history_since:null,wait_minutes:30,messages:[likeStep('Bonjour ! Merci pour ton like. Si l’article t’intéresse, je peux te faire un petit prix.')],
    per_item:{enabled:false,max:10},cooldown_days:1,min_rating:{enabled:false,value:4},skip_unrated:false,ignored:[]},
  order_flow:{confirm:{enabled:false,message:'Merci pour ton achat @username ! Je prépare ton colis avec soin.'},labels:{ignore_carriers:[]},
    extension:{enabled:false,after_days:3,message:'Bonjour, je rencontre un petit souci pour l’envoi du colis. Peux-tu m’accorder un peu plus de temps ? Merci beaucoup :)',relance1:'',relance2:''},
    cancel:{enabled:false,minutes_before:30},
    pickup:{enabled:false,first_days:1,first:'Bonjour @username, ton colis est arrivé au point relais :)',second_days:3,second:''},
    review:{enabled:false,after_days:1,text:'Parfait, merci !',end_message:''},delete_sold:false},
  messaging:{sync_seconds:20,sync_minutes:1,reply_unlimited:true,history_hours:0,history_since:null,reply_per_day:80,reply_gap_seconds:40,action_gap_min:30,action_gap_max:45,desktop:{...DESKTOP_DEFAULTS},
    offers:{enabled:false,history_hours:0,history_since:null,single_discount:20,bundle_discount:20,max_per_buyer:5,period_days:1}},
}
const BOUNDS={
  limits:{writes_per_day:[0,200],unmask_item_per_day:[0,100],reprice_item_per_day:[0,100],publish_item_per_day:[0,100],like_message_per_day:[0,1000000],
    order_message_per_day:[0,200],order_extension_per_day:[0,100],order_cancel_per_day:[0,50],order_review_per_day:[0,200],item_delete_per_day:[0,100],min_gap_minutes:[1,240],from_hour:[0,23],to_hour:[0,23]},
  unmask:{price_drop:[0,10],max_drop:[0,50],floor:[1,1000],max_repairs:[0,10],wait_hours:[1,168]},
  pricing:{after_days:[1,90],step:[0.5,20],every_days:[1,60],max_drop:[0,200],floor:[1,1000]},
  likes:{history_hours:[0,720],wait_minutes:[0,1440],cooldown_days:[0,365]},
  messaging:{sync_seconds:[20,7200],history_hours:[0,720],sync_minutes:[1,120],reply_per_day:[0,300],reply_gap_seconds:[10,600],action_gap_min:[5,3600],action_gap_max:[5,3600]},
}
const LABELS={writes_per_day:'modifications par jour',min_gap_minutes:'écart entre deux modifications',from_hour:'heure de début',to_hour:'heure de fin',
  price_drop:'baisse par réparation',max_drop:'baisse maximale',floor:'prix plancher',max_repairs:'réparations maximales',wait_hours:'attente entre deux réparations',
  after_days:'délai avant la première baisse',step:'baisse',every_days:'écart entre deux baisses',wait_minutes:'attente après le like',
  sync_minutes:'la lecture de la messagerie',reply_per_day:'les réponses par jour',reply_gap_seconds:'l’écart entre deux réponses',action_gap_min:'le délai minimum entre deux envois (secondes)',action_gap_max:'le délai maximum entre deux envois (secondes)'}

export function normalizeSettings(input={}){
  const out=structuredClone(DEFAULTS)
  for(const key of Object.keys(DEFAULTS.features))if(input.features&&key in input.features){
    if(typeof input.features[key]!=='boolean')throw new AppError('Réglage de fonction invalide.');out.features[key]=input.features[key]}
  for(const group of ['limits','unmask','pricing','likes','messaging'])for(const [key,[min,max]] of Object.entries(BOUNDS[group])){
    const value=input[group]?.[key];if(value===undefined)continue
    const n=Number(value)
    if(!Number.isFinite(n)||n<min||n>max)throw new AppError(`Choisis ${LABELS[key]||key} entre ${min} et ${max}.`)
    out[group][key]=['price_drop','max_drop','floor','step'].includes(key)?Math.round(n*100)/100:Math.round(n)
  }
  if(input.messaging?.sync_seconds===undefined&&input.messaging?.sync_minutes!==undefined)out.messaging.sync_seconds=out.messaging.sync_minutes*60
  if(input.messaging?.reply_unlimited!==undefined&&typeof input.messaging.reply_unlimited!=='boolean')throw new AppError('Réponses illimitées : choix invalide.')
  out.messaging.reply_unlimited=input.messaging?.reply_unlimited??(input.messaging?.reply_per_day===undefined)
  if(input.messaging?.executor!==undefined&&!['extension','desktop'].includes(input.messaging.executor))throw new AppError('Choisis l’extension ou l’assistant PC.')
  out.messaging.executor=input.messaging?.executor||'extension'
  const desktop=input.messaging?.desktop??{}
  if(!desktop||typeof desktop!=='object'||Array.isArray(desktop))throw new AppError('Réglages de rythme invalides.')
  if(desktop.browse_enabled!==undefined&&typeof desktop.browse_enabled!=='boolean')throw new AppError('Consultation des annonces : choix invalide.')
  out.messaging.desktop.browse_enabled=desktop.browse_enabled===true
  for(const [key,[min,max]] of Object.entries(DESKTOP_BOUNDS))if(desktop[key]!==undefined){
    const value=Number(desktop[key]);if(!Number.isInteger(value)||value<min||value>max)throw new AppError(`${DESKTOP_LABELS[key]} : choisis une valeur entre ${min} et ${max}.`)
    out.messaging.desktop[key]=value
  }
  for(const group of ['likes','messaging'])out[group].history_since=historyDate(input[group]?.history_since)
  normalizeLikes(input.likes||{},out.likes)
  out.messaging.offers=normalizeOffers(input.messaging?.offers)
  out.order_flow=normalizeFlow(input.order_flow||{})
  if(out.messaging.action_gap_max<out.messaging.action_gap_min)throw new AppError('Le délai maximum entre deux envois doit être au moins égal au minimum.')
  if(out.unmask.floor<1||out.pricing.floor<1)throw new AppError('Le prix plancher doit être d’au moins 1 €.')
  return out
}
// Réglages enregistrés (colonnes jsonb) → réglages complets, en gardant les valeurs par défaut pour ce qui manque.
export const effectiveSettings=row=>normalizeSettings({features:row?.features||{},limits:row?.limits||{},unmask:row?.unmask||{},pricing:row?.pricing||{},likes:row?.likes||{},messaging:row?.messaging||{},order_flow:row?.order_flow||{}})

// ---------- Likes et flux de commande (façon Dotb) ----------
function likeStep(message=''){return {message,discount:{mode:'none',amount:3,unit:'eur',rounding:'none'},followup:{enabled:false,delay_hours:24,message:'',discount:{mode:'none',amount:3,unit:'eur',rounding:'none'}}}}
const str=(v,max,label,{min=0}={})=>{
  if(v===undefined||v===null)return ''
  if(typeof v!=='string')throw new AppError(`${label} : texte attendu.`)
  const t=v.trim();if(t.length>max)throw new AppError(`${label} : ${max} caractères maximum.`);if(t&&t.length<min)throw new AppError(`${label} : ${min} caractères minimum.`)
  return t
}
const num=(v,min,max,label,fallback,{round=true}={})=>{
  if(v===undefined||v===null||v==='')return fallback
  const n=Number(v);if(!Number.isFinite(n)||n<min||n>max)throw new AppError(`Choisis ${label} entre ${min} et ${max}.`)
  return round?Math.round(n):Math.round(n*100)/100
}
const bool=(v,fallback)=>v===undefined?fallback:v===true
const historyDate=v=>typeof v==='string'&&Number.isFinite(Date.parse(v))?new Date(v).toISOString():null
export function normalizeOffers(input={}){
  const d=DEFAULTS.messaging.offers
  if(!input||typeof input!=='object'||Array.isArray(input))throw new AppError('Réglages des offres invalides.')
  if(input.enabled!==undefined&&typeof input.enabled!=='boolean')throw new AppError('Activation des offres invalide.')
  return {enabled:input.enabled===true,history_hours:num(input.history_hours,0,720,'l’historique (heures)',0),history_since:historyDate(input.history_since),
    single_discount:num(input.single_discount,0,80,'la remise article seul (%)',d.single_discount,{round:false}),
    bundle_discount:num(input.bundle_discount,0,80,'la remise lot (%)',d.bundle_discount,{round:false}),
    max_per_buyer:num(input.max_per_buyer,1,100,'les offres par acheteur',d.max_per_buyer),
    period_days:num(input.period_days,1,30,'la période des offres (jours)',d.period_days)}
}
export function acceptableOffer(o,config){
  if(!config?.enabled||!o||o.currency!=='EUR'||typeof o.is_bundle!=='boolean')return false
  const price=Number(o.price),original=Number(o.original_price)
  if(!Number.isFinite(price)||!Number.isFinite(original)||price<1||original<1||price>original)return false
  const pct=o.is_bundle?config.bundle_discount:config.single_discount
  if(!Number.isFinite(pct)||pct<0||pct>80)return false
  return Math.round(price*100)>=Math.ceil(Math.round(original*100)*(10000-Math.round(pct*100))/10000)
}
function discount(input={},label){
  const mode=['none','simple'].includes(input.mode)?input.mode:'none',unit=input.unit==='pct'?'pct':'eur'
  return {mode,unit,amount:num(input.amount,0.5,unit==='pct'?80:200,`${label} (montant de la réduction)`,3,{round:false}),rounding:['none','half','euro'].includes(input.rounding)?input.rounding:'none'}
}
function normalizeLikes(input,out){
  let steps=Array.isArray(input.messages)?input.messages:input.message!==undefined?[{message:input.message}]:null
  if(steps){
    if(!steps.length||steps.length>3)throw new AppError('Entre 1 et 3 messages après un like.')
    out.messages=steps.map((m,i)=>{
      const label=`Message ${i+1}`,d=discount(m?.discount,label),f=m?.followup||{}
      const step={message:str(m?.message,500,label,{min:2}),discount:d,followup:{enabled:f.enabled===true,delay_hours:num(f.delay_hours,1,168,`le délai de relance du ${label.toLowerCase()} (heures)`,24),
        message:str(f.message,500,`Relance du ${label.toLowerCase()}`),discount:discount(f.discount,`Relance du ${label.toLowerCase()}`)}}
      if(!step.message&&step.discount.mode==='none')throw new AppError(`${label} : écris un message ou ajoute une réduction.`)
      if(step.followup.enabled&&!step.followup.message&&step.followup.discount.mode==='none')throw new AppError(`Relance du ${label.toLowerCase()} : écris un message ou ajoute une réduction.`)
      return step
    })
  }
  if(input.per_item)out.per_item={enabled:input.per_item.enabled===true,max:num(input.per_item.max,1,1000,'la limite de messages par article',out.per_item.max)}
  if(input.min_rating)out.min_rating={enabled:input.min_rating.enabled===true,value:num(input.min_rating.value,1,5,'la note minimale',out.min_rating.value)}
  out.skip_unrated=bool(input.skip_unrated,out.skip_unrated)
  if(input.ignored!==undefined){
    const list=Array.isArray(input.ignored)?input.ignored:String(input.ignored||'').split(/[,\n]/)
    out.ignored=[...new Set(list.map(x=>String(x||'').trim().replace(/^@/,'').toLowerCase()).filter(x=>/^[a-z0-9._-]{2,40}$/.test(x)))].slice(0,300)
  }
}
function normalizeFlow(input){
  const d=DEFAULTS.order_flow,c=input.confirm||{},e=input.extension||{},x=input.cancel||{},p=input.pickup||{},r=input.review||{}
  const pick=(v,def)=>v===undefined?def:v
  const out={
    confirm:{enabled:bool(c.enabled,d.confirm.enabled),message:str(pick(c.message,d.confirm.message),1000,'Message de confirmation')},
    labels:{ignore_carriers:[...new Set((Array.isArray(input.labels?.ignore_carriers)?input.labels.ignore_carriers:[]).map(x=>String(x||'').trim().toLowerCase()).filter(x=>x.length>=2&&x.length<=40))].slice(0,20)},
    extension:{enabled:bool(e.enabled,d.extension.enabled),after_days:num(e.after_days,1,5,'le délai avant la demande (jours)',d.extension.after_days),
      message:str(pick(e.message,d.extension.message),200,'Message de demande de délai'),relance1:str(e.relance1,500,'Relance à +1 jour'),relance2:str(e.relance2,500,'Relance à +2 jours')},
    cancel:{enabled:bool(x.enabled,d.cancel.enabled),minutes_before:num(x.minutes_before,15,720,'le délai avant la date limite (minutes)',d.cancel.minutes_before)},
    pickup:{enabled:bool(p.enabled,d.pickup.enabled),first_days:num(p.first_days,0,14,'le délai du message 1 (jours)',d.pickup.first_days),first:str(pick(p.first,d.pickup.first),1000,'Message 1 de retrait'),
      second_days:num(p.second_days,1,14,'le délai du message 2 (jours)',d.pickup.second_days),second:str(p.second,1000,'Message 2 de retrait')},
    review:{enabled:bool(r.enabled,d.review.enabled),after_days:num(r.after_days,0,14,'le délai avant l’évaluation (jours)',d.review.after_days),text:str(pick(r.text,d.review.text),500,'Texte de l’évaluation'),end_message:str(r.end_message,1000,'Message de fin')},
    delete_sold:bool(input.delete_sold,d.delete_sold),
  }
  if(out.confirm.enabled&&!out.confirm.message)throw new AppError('Écris le message de confirmation de commande.')
  if(out.extension.enabled&&out.extension.message.length<5)throw new AppError('Écris le message de demande de délai.')
  if(out.pickup.enabled&&!out.pickup.first)throw new AppError('Écris le message 1 de retrait.')
  if(out.pickup.second&&out.pickup.second_days<=out.pickup.first_days)throw new AppError('Le message 2 de retrait doit partir après le message 1.')
  return out
}
// Textes des messages automatiques : @username, {article} et {prix}.
export function fillTemplate(template,{login,title,price}={}){
  return String(template||'').replace(/@username/gi,login?`@${login}`:'').replace(/\{article\}/g,title||'cet article')
    .replace(/\{prix\}/g,price?`${Number(price).toFixed(2).replace('.',',')} €`:'le prix affiché').replace(/\{[a-z_]+\}/g,'').replace(/[ \t]{2,}/g,' ').trim()
}
// Prix de l'offre : réduction en € ou en %, arrondie vers le bas (0,50 € ou 1 €), jamais sous 1 €.
export function offerPrice(price,d){
  const p=Number(price);if(!d||d.mode==='none'||!Number.isFinite(p)||p<=1)return null
  let v=d.unit==='pct'?p*(1-d.amount/100):p-d.amount
  if(d.rounding==='half')v=Math.floor(v*2)/2;else if(d.rounding==='euro')v=Math.floor(v)
  v=Math.round(v*100)/100
  return v>=1&&v<p?v:null
}

