// Réglages et catalogue des tâches de YlaVint : module sans accès réseau ni base, partagé avec la démo du site.
import {AppError} from './dotb.js'

// Tâches. « needs » : recettes indispensables, apprises sur le vrai site. « uses » : lectures qui ont une recette par défaut.
export const KINDS={
  scan_wardrobe:{writes:false,label:'Lecture du dressing',needs:[],uses:['wardrobe']},
  sync_orders:{writes:false,label:'Lecture des ventes',needs:[],uses:['orders_list','order_detail']},
  fetch_label:{writes:false,label:'Bordereau',needs:['order_label']},
  scan_likes:{writes:false,label:'Lecture des likes',needs:[],uses:['likes_list']},
  sync_inbox:{writes:false,label:'Lecture de la messagerie',needs:[],uses:['inbox_list','conversation_read']},
  unmask_item:{writes:true,label:'Démasquage',needs:['item_form','item_edit','photo_upload']},
  reprice_item:{writes:true,label:'Baisse de prix',needs:['item_form','item_edit']},
  publish_item:{writes:true,label:'Publication',needs:['photo_upload','item_create']},
  like_message:{writes:true,label:'Message après un like',needs:['conversation_create','message_send']},
  reply_message:{writes:true,label:'Réponse à un acheteur',needs:['message_send']},
}
// Lectures que le site Vinted fait lui-même à chaque visite : utilisées tant qu'aucune recette n'a été relevée.
export const DEFAULT_RECIPES={
  wardrobe:{method:'GET',path:'/api/v2/wardrobe/{id}/items',query:{order:'relevance'},headers:{},body:'none'},
  orders_list:{method:'GET',path:'/api/v2/my_orders',query:{type:'sold',status:'all'},headers:{},body:'none'},
  likes_list:{method:'GET',path:'/api/v2/notifications',query:{},headers:{},body:'none'},
  inbox_list:{method:'GET',path:'/api/v2/inbox',query:{},headers:{},body:'none'},
  conversation_read:{method:'GET',path:'/api/v2/conversations/{id}',query:{},headers:{},body:'none'},
}
// Recettes relevées en mode apprentissage, avec le geste à faire à la main une fois sur Vinted.
export const RECIPES={
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
}
// Valeurs prudentes par défaut : on monte progressivement en observant la santé des comptes.
export const DEFAULTS={
  features:{inbox:false,ai:false,orders:false,sales:false,labels:false,dressing:false,unmask:false,pricing:false,publish:false,likes:false},
  limits:{writes_per_day:15,unmask_item_per_day:5,reprice_item_per_day:5,publish_item_per_day:5,like_message_per_day:10,min_gap_minutes:12,from_hour:9,to_hour:22},
  unmask:{price_drop:1,max_drop:2,floor:2,max_repairs:3,wait_hours:24},
  pricing:{after_days:7,step:1,every_days:4,max_drop:5,floor:3},
  likes:{message:'Bonjour ! Merci pour ton like. Si l’article t’intéresse, je peux te faire un petit prix.',wait_minutes:30},
  messaging:{sync_minutes:5,reply_per_day:80,reply_gap_seconds:40},
}
const BOUNDS={
  limits:{writes_per_day:[0,200],unmask_item_per_day:[0,100],reprice_item_per_day:[0,100],publish_item_per_day:[0,100],like_message_per_day:[0,100],min_gap_minutes:[1,240],from_hour:[0,23],to_hour:[0,23]},
  unmask:{price_drop:[0,10],max_drop:[0,50],floor:[1,1000],max_repairs:[0,10],wait_hours:[1,168]},
  pricing:{after_days:[1,90],step:[0.5,20],every_days:[1,60],max_drop:[0,200],floor:[1,1000]},
  likes:{wait_minutes:[5,1440]},
  messaging:{sync_minutes:[2,120],reply_per_day:[0,300],reply_gap_seconds:[10,600]},
}
const LABELS={writes_per_day:'modifications par jour',min_gap_minutes:'écart entre deux modifications',from_hour:'heure de début',to_hour:'heure de fin',
  price_drop:'baisse par réparation',max_drop:'baisse maximale',floor:'prix plancher',max_repairs:'réparations maximales',wait_hours:'attente entre deux réparations',
  after_days:'délai avant la première baisse',step:'baisse',every_days:'écart entre deux baisses',wait_minutes:'attente après le like',
  sync_minutes:'la lecture de la messagerie',reply_per_day:'les réponses par jour',reply_gap_seconds:'l’écart entre deux réponses'}

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
  if(input.likes?.message!==undefined){
    const message=typeof input.likes.message==='string'?input.likes.message.trim():''
    if(message.length<2||message.length>500)throw new AppError('Le message après un like doit faire entre 2 et 500 caractères.')
    out.likes.message=message
  }
  if(out.unmask.floor<1||out.pricing.floor<1)throw new AppError('Le prix plancher doit être d’au moins 1 €.')
  return out
}
// Réglages enregistrés (colonnes jsonb) → réglages complets, en gardant les valeurs par défaut pour ce qui manque.
export const effectiveSettings=row=>normalizeSettings({features:row?.features||{},limits:row?.limits||{},unmask:row?.unmask||{},pricing:row?.pricing||{},likes:row?.likes||{},messaging:row?.messaging||{}})

