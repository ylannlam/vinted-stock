// Keep stored extension settings intact while exposing only what this executor can run.
export const DESKTOP_KINDS=['scan_wardrobe','scan_likes','sync_inbox','like_message','reply_message']
export const DESKTOP_FEATURES=['inbox','ai','dressing','likes']
export const isDesktop=settings=>settings?.messaging?.executor==='desktop'
export const supportsTask=(settings,kind)=>!isDesktop(settings)||DESKTOP_KINDS.includes(kind)
export const supportsFeature=(settings,feature)=>!isDesktop(settings)||DESKTOP_FEATURES.includes(feature)
export const EXTENSION_REQUIRED='Cette action nécessite le mode Extension. Le mode Assistant PC couvre le dressing, les favoris, les réductions, les relances et les réponses.'
export const DESKTOP_DEFAULTS={typing_delay_ms:70,page_wait_seconds:3,session_minutes:25,pause_minutes:5,browse_enabled:false,browse_every_minutes:30,browse_items:3,browse_item_seconds:8,browse_scrolls:2,
 active_days:[1,2,3,4,5,6,7],absent_until:null,browse_keywords:'',browse_price_min:0,browse_price_max:0,browse_photos:false,browse_memory_hours:24,reply_max_age_hours:24}
export const DESKTOP_BOUNDS={typing_delay_ms:[30,150],page_wait_seconds:[1,15],session_minutes:[5,120],pause_minutes:[1,60],browse_every_minutes:[5,240],browse_items:[1,10],browse_item_seconds:[3,30],browse_scrolls:[1,5],browse_price_min:[0,10000],browse_price_max:[0,10000],browse_memory_hours:[1,168],reply_max_age_hours:[1,72]}
export const DESKTOP_LABELS={typing_delay_ms:'Temps entre les caractères',page_wait_seconds:'Temps de lecture après une page',session_minutes:'Durée d’activité avant une pause',pause_minutes:'Durée de la pause',browse_every_minutes:'Intervalle entre les consultations',browse_items:'Annonces par consultation',browse_item_seconds:'Temps par annonce',browse_scrolls:'Défilements par annonce',browse_price_min:'Prix minimum',browse_price_max:'Prix maximum (0 = aucun)',browse_memory_hours:'Éviter les annonces déjà consultées pendant',reply_max_age_hours:'Revoir les réponses en attente après'}
export function executionSettings(settings){
 if(!isDesktop(settings))return settings
 return {...settings,
  features:Object.fromEntries(Object.entries(settings.features||{}).map(([key,value])=>[key,value&&DESKTOP_FEATURES.includes(key)])),
  messaging:{...settings.messaging,offers:{...settings.messaging.offers,enabled:false}},
  order_flow:Object.fromEntries(Object.entries(settings.order_flow||{}).map(([key,value])=>[key,key==='delete_sold'?false:value&&typeof value==='object'?{...value,enabled:false}:value]))}
}
