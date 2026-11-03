export const paidStates=new Set(['processing','shipped','delivered'])
const norm=v=>String(v||'').normalize('NFD').replace(/[\u0300-\u036f\s]/g,'').toLowerCase()
const size=v=>norm(String(v||'').replace(/^\s*\d+\s*\(([^)]+)\)\s*$/,'$1'))
export function associationReasons(item,line,order) {
  const reasons=[]
  if(!item.present||!paidStates.has(item.status))reasons.push('Paiement ou état de l’achat à vérifier')
  if(line.blocked)reasons.push('Vente annulée, suspendue ou en retour')
  if(line.item_id)reasons.push('Vente déjà associée à un achat')
  if(line.order_ref&&line.order_ref!==order.ref)reasons.push('Autre commande déjà renseignée')
  if(!line.size||!item.size)reasons.push('Taille manquante')
  else if(size(line.size)!==size(item.size))reasons.push('Taille différente')
  if(!line.color||!item.color)reasons.push('Couleur manquante')
  else if(norm(line.color)!==norm(item.color))reasons.push('Couleur différente')
  if(line.sale_date&&new Intl.DateTimeFormat('en-CA',{timeZone:'Europe/Paris'}).format(new Date(line.sale_date))>order.order_date)reasons.push('Achat antérieur à la vente')
  if((item.links?.length||0)>=item.quantity)reasons.push('Tous les exemplaires sont déjà associés')
  return reasons.length?reasons:['Correspondance à confirmer : la quantité disponible ou une exclusion manuelle peut empêcher l’association automatique']
}
export function sheinAlerts({cart,runs=[],now=Date.now()}) {
  const alerts=[]
  const latest=runs[0]
  if(latest&&(['partial','blocked'].includes(latest.state)||latest.state==='running'&&now-Date.parse(latest.updated_at)>900000))alerts.push({key:'sync',tone:'warning',text:latest.state==='blocked'?'Shein attend une intervention.':latest.state==='partial'?'Certaines commandes restent à vérifier.':'La synchronisation ne donne plus de nouvelles.',action:'orders'})
  for(const g of cart?.groups||[]){
    if(g.state==='unavailable')alerts.push({key:'stock:'+g.key,tone:'warning',text:`${g.title} · ${g.size} : taille indisponible au dernier relevé.`,action:'cart'})
    if(g.price_change_percent>=10)alerts.push({key:'price:'+g.key,tone:'warning',text:`${g.title} : prix en hausse de ${Math.round(g.price_change_percent)} % depuis le relevé précédent.`,action:'cart'})
    if(g.urgent)alerts.push({key:'urgent:'+g.key,tone:'warning',text:`${g.title} : échéance d’expédition proche ou dépassée.`,action:'cart'})
  }
  return alerts
}
