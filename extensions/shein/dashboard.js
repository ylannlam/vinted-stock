export const reviewLabels={human_check:'Vérification Shein',page_unavailable:'Fiche inaccessible',sku_mismatch:'Référence différente',sku_not_found:'Référence introuvable',selected_size:'Taille sélectionnée',color_unreadable:'Couleur à vérifier',photos_unreadable:'Photos à vérifier',price_unreadable:'Prix à vérifier'}
export function presentation(s) {
  if(!s.connected)return {label:'Connexion nécessaire',tone:'neutral'}
  if(s.phase==='blocked')return {label:s.blockedCode==='human_check'?'Shein attend ta vérification':'Une fiche demande ton attention',tone:'warning'}
  if(!s.enabled)return {label:'Imports en pause',tone:'neutral'}
  if(s.retryAt)return {label:'Reconnexion automatique',tone:'warning'}
  return {label:s.job?'Récupération en cours':'Prêt pour les prochains articles',tone:'success'}
}
export function stepFor(s) {
  if(!s.job)return -1
  if(s.phase==='submit')return 3
  if(['blocked','validate'].includes(s.phase))return 2
  if(s.phase==='product')return 1
  return 0
}
export function diagnostic(s,now=new Date().toISOString()) {
  return {generatedAt:now,version:s.version,connected:!!s.connected,enabled:!!s.enabled,phase:s.phase,blockedCode:s.blockedCode||null,
    completed:s.completed||0,reviewed:s.reviewed||0,lastContactAt:s.lastContactAt||null,retryAt:s.retryAt||null,hasTab:!!s.hasTab}
}
