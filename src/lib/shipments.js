export const SHIPMENT_STATES={pending:'À suivre',processing:'En cours de traitement',in_transit:'En transit',delivered:'Livré chez toi',exception:'Incident',returned:'Retourné'}
export const shipmentState=s=>SHIPMENT_STATES[s.manual_status||s.status]||'À suivre'
export function shipmentLink(s){return s.carrier==='gofo'?`https://www.gofo.com/fr/tracking-results/?id=${encodeURIComponent(s.tracking_number)}`:null}
export function shipmentInput(body){
  const carrier=body.carrier,number=typeof body.tracking_number==='string'?body.tracking_number.replace(/\s/g,'').toUpperCase():''
  if(!['gofo','other'].includes(carrier)||!/^[A-Z0-9][A-Z0-9-]{4,59}$/.test(number))throw Error('Renseigne le transporteur et un numéro de suivi valide (5 à 60 caractères).')
  const text=(v,max)=>{if(v==null)return null;if(typeof v!=='string'||v.length>max)throw Error('Le texte saisi est trop long.');return v.trim()||null}
  const manual=body.manual_status||null
  if(manual&&!Object.hasOwn(SHIPMENT_STATES,manual))throw Error('Statut du colis invalide.')
  return {carrier,tracking_number:number,order_ref:text(body.order_ref,200),eta:text(body.eta,100),manual_status:manual}
}
