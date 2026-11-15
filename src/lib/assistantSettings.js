import {DESKTOP_DEFAULTS} from './ylavintExecution.js'

export const ASSISTANT_SECTIONS=[
 {id:'general',title:'Activation & horaires',hint:'Compte, jours et plages d’activité',icon:'monitor',tone:'blue'},
 {id:'likes',title:'Favoris & réductions',hint:'Message après un favori, offre et filtres',icon:'heart',tone:'red'},
 {id:'offers',title:'Offres reçues',hint:'Pourcentage accepté et message après acceptation',icon:'chart',tone:'green'},
 {id:'messages',title:'Réponses IA',hint:'Réponses aux acheteurs et ton de la boutique',icon:'message',tone:'violet'},
 {id:'followups',title:'Relances',hint:'Délai, texte et réduction de rappel',icon:'clock',tone:'amber'},
 {id:'publication',title:'Publication',hint:'Annonces, saisie et plafonds',icon:'box',tone:'blue'},
 {id:'navigation',title:'Rythme & navigation',hint:'Clavier, consultations et pauses',icon:'spark',tone:'violet'},
 {id:'orders',title:'Commandes & bordereaux',hint:'Ventes, étiquettes et demandes de délai',icon:'bag',tone:'green'},
 {id:'wallet',title:'Porte-monnaie',hint:'Deux relevés par jour',icon:'chart',tone:'green'},
]
export const settingsSection=value=>ASSISTANT_SECTIONS.some(s=>s.id===value)?value:({agent:'messages',flux:'orders',all:'general'})[value]||'general'
const merge=(base,value)=>Object.fromEntries([...new Set([...Object.keys(base||{}),...Object.keys(value||{})])].map(key=>{
 const a=base?.[key],b=value?.[key]
 return [key,b===undefined?structuredClone(a):a&&b&&typeof a==='object'&&typeof b==='object'&&!Array.isArray(a)&&!Array.isArray(b)?merge(a,b):structuredClone(b)]
}))
// A section edits a single shared draft; moving between sections never resets another one.
export function assistantSettingsDraft(defaults,stored){
 const draft=merge(defaults,stored||{})
 draft.enabled=stored?.enabled===true
 draft.messaging={...draft.messaging,executor:'desktop',desktop:{...DESKTOP_DEFAULTS,...draft.messaging?.desktop}}
 return draft
}
export function sectionStatus(id,settings){
 const f=settings?.features||{},pace=settings?.messaging?.desktop||{}
 if(id==='general')return settings?.paused?'En pause':settings?.enabled?'Autorisé':'Arrêté'
 if(id==='followups')return settings?.likes?.messages?.some(m=>m.followup?.enabled)?'Réglées':'Désactivées'
 if(id==='navigation')return pace.browse_enabled?'Consultations actives':'Pauses & clavier'
 if(id==='offers')return settings?.messaging?.offers?.enabled?'Activées':'Désactivées'
 const feature=({likes:'likes',messages:'ai',publication:'publish',orders:'orders',wallet:'wallet'})[id]
 return f[feature]?'Activé':'Désactivé'
}
