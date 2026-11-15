// Keep stored extension settings intact while exposing only what this executor can run.
export const DESKTOP_KINDS=['scan_wardrobe','scan_likes','sync_inbox','like_message','reply_message','publish_item','scan_wallet','sync_orders','fetch_label','order_extension']
export const DESKTOP_FEATURES=['inbox','ai','dressing','likes','publish','wallet','orders','labels']
export const isDesktop=settings=>settings?.messaging?.executor==='desktop'
export const supportsTask=(settings,kind)=>kind==='scan_wallet'?isDesktop(settings):!isDesktop(settings)||DESKTOP_KINDS.includes(kind)
export const supportsFeature=(settings,feature)=>feature==='wallet'?isDesktop(settings):!isDesktop(settings)||DESKTOP_FEATURES.includes(feature)
export const EXTENSION_REQUIRED='Cette ancienne action n’est pas prise en charge par l’Assistant PC. Il couvre le dressing, les favoris, les réductions, les relances, les réponses, les annonces, le porte-monnaie et les bordereaux.'
export const DESKTOP_DEFAULTS={typing_delay_ms:70,page_wait_seconds:3,session_minutes:25,pause_minutes:5,browse_enabled:false,browse_every_minutes:30,browse_items:3,browse_item_seconds:8,browse_scrolls:2,
 active_days:[1,2,3,4,5,6,7],absent_until:null,browse_keywords:'',browse_price_min:0,browse_price_max:0,browse_photos:false,browse_memory_hours:24,reply_max_age_hours:24,
 publication_typing_ms:250,publication_punctuation_ms:600,publication_field_seconds:2,publication_review_seconds:5,publication_corrections:false,wallet_hours:[9,18],
 browse_variety:true,browse_between_actions:true,browse_after_actions_min:3,browse_after_actions_max:7,browse_like_enabled:false,browse_like_keywords:'robe',browse_like_price_min:20,browse_like_price_max:50,browse_like_per_day:5,browse_like_percent:25,pause_close_percent:0}
export const DESKTOP_BOUNDS={typing_delay_ms:[30,150],page_wait_seconds:[1,15],session_minutes:[5,120],pause_minutes:[1,60],browse_every_minutes:[5,240],browse_items:[1,10],browse_item_seconds:[3,30],browse_scrolls:[1,5],browse_price_min:[0,10000],browse_price_max:[0,10000],browse_memory_hours:[1,168],reply_max_age_hours:[1,72]}
export const DESKTOP_LABELS={typing_delay_ms:'Temps entre les caractères',page_wait_seconds:'Temps de lecture après une page',session_minutes:'Durée d’activité avant une pause',pause_minutes:'Durée de la pause',browse_every_minutes:'Intervalle entre les consultations',browse_items:'Annonces par consultation',browse_item_seconds:'Temps par annonce',browse_scrolls:'Défilements par annonce',browse_price_min:'Prix minimum',browse_price_max:'Prix maximum (0 = aucun)',browse_memory_hours:'Éviter les annonces déjà consultées pendant',reply_max_age_hours:'Revoir les réponses en attente après'}
Object.assign(DESKTOP_BOUNDS,{publication_typing_ms:[200,350],publication_punctuation_ms:[200,1500],publication_field_seconds:[1,10],publication_review_seconds:[3,20]})
Object.assign(DESKTOP_LABELS,{publication_typing_ms:'Saisie des annonces',publication_punctuation_ms:'Pause de ponctuation',publication_field_seconds:'Pause entre les champs',publication_review_seconds:'Relecture de l’annonce'})
Object.assign(DESKTOP_BOUNDS,{browse_after_actions_min:[1,50],browse_after_actions_max:[1,50],browse_like_price_min:[0,10000],browse_like_price_max:[1,10000],browse_like_per_day:[1,20],browse_like_percent:[1,100],pause_close_percent:[0,100]})
Object.assign(DESKTOP_LABELS,{browse_after_actions_min:'Nombre minimum d’actions avant une consultation',browse_after_actions_max:'Nombre maximum d’actions avant une consultation',browse_like_price_min:'Prix minimum des favoris',browse_like_price_max:'Prix maximum des favoris',browse_like_per_day:'Plafond quotidien de favoris',browse_like_percent:'Fréquence des favoris',pause_close_percent:'Fréquence de fermeture pendant les pauses'})
export const DRESS_ROUTINE={browse_enabled:true,browse_variety:true,browse_between_actions:true,browse_after_actions_min:3,browse_after_actions_max:7,browse_like_enabled:true,browse_like_keywords:'robe',browse_like_price_min:20,browse_like_price_max:50,browse_like_per_day:5,browse_like_percent:25,pause_minutes:5,pause_close_percent:50}
export function executionSettings(settings){
 if(!isDesktop(settings))return settings
 return {...settings,
  features:Object.fromEntries(Object.entries(settings.features||{}).map(([key,value])=>[key,value&&DESKTOP_FEATURES.includes(key)])),
  messaging:{...settings.messaging,offers:{...settings.messaging.offers,enabled:false}},
  order_flow:Object.fromEntries(Object.entries(settings.order_flow||{}).map(([key,value])=>[key,key==='delete_sold'?false:value&&typeof value==='object'?{...value,enabled:false}:value]))}
}
