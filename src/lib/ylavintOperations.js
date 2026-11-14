export const orderKey=o=>o.conversation_id?`conversation:${o.conversation_id}`:`transaction:${o.transaction_id}`
export const orderIdentity=o=>`${o.account_id}|${orderKey(o)}`
export const toPrepare=o=>['payment_received','label_sent'].includes(o.normalized)
export const extensionLabels={unknown:'À vérifier sur Vinted',available:'Demande possible',queued:'Demande en attente d’exécution',running:'Demande en cours',pending:'Réponse de l’acheteur attendue',accepted:'Prolongation acceptée',declined:'Prolongation refusée',unavailable:'Prolongation indisponible',failed:'Demande à vérifier',cancelled:'Demande retirée de la file'}
const plain=s=>String(s||'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase()

// A displayed deadline is interpreted in Paris, never as the computer's local timezone.
export function visibleDeadline(value,now=Date.now()){
 const match=plain(value).match(/avant le\s+(\d{1,2})\s+([a-z]+)\.?\s+(?:(20\d{2})\s+)?(\d{1,2}):(\d{2})/)
 if(!match)return null
 const months=['janv','fevr','mars','avr','mai','juin','juil','aout','sept','oct','nov','dec'],month=months.findIndex(m=>match[2].startsWith(m))
 const day=Number(match[1]),hour=Number(match[4]),minute=Number(match[5]);if(month<0||day<1||day>31||hour>23||minute>59)return null
 let year=Number(match[3]||new Date(now).getUTCFullYear()),wall=Date.UTC(year,month,day,hour,minute)
 if(!match[3]){if(wall-now>180*864e5)year--;if(now-wall>180*864e5)year++;wall=Date.UTC(year,month,day,hour,minute)}
 if(new Date(wall).getUTCMonth()!==month)return null
 const format=new Intl.DateTimeFormat('en-GB',{timeZone:'Europe/Paris',year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',second:'2-digit',hourCycle:'h23'})
 let utc=wall
 for(let i=0;i<2;i++){const p=Object.fromEntries(format.formatToParts(new Date(utc)).map(p=>[p.type,p.value]));utc=wall-(Date.UTC(+p.year,+p.month-1,+p.day,+p.hour,+p.minute,+p.second)-utc)}
 return new Date(utc).toISOString()
}

export function todayItems(orders,conversations,tasks,now=Date.now()){
 const items=[]
 for(const o of orders.filter(toPrepare)){
  const deadline=Date.parse(o.ship_deadline),hours=(deadline-now)/36e5
  const base={account_id:o.account_id,login:o.login,title:o.title,photo_url:o.photo_url,order:o}
  if(Number.isFinite(deadline)&&hours<=48)items.push({...base,id:`deadline:${orderIdentity(o)}`,kind:'deadline',tone:hours<24?'red':'amber',priority:hours<0?0:1,label:hours<0?'Délai dépassé':hours<24?'À expédier sous 24 h':'À expédier sous 48 h',detail:o.deadline_text||o.ship_deadline})
  if(!Number.isFinite(deadline))items.push({...base,id:`unknown:${orderIdentity(o)}`,kind:'deadline_unknown',tone:'zinc',priority:5,label:'Délai à relire',detail:'Aucune date limite confirmée sur les pages déjà consultées.'})
  if(!o.label_path)items.push({...base,id:`label:${orderIdentity(o)}`,kind:'label',tone:'amber',priority:3,label:'Bordereau manquant',detail:o.label_note||'La prochaine lecture vérifiera sa disponibilité.'})
  if(['queued','running','pending','failed'].includes(o.extension?.state))items.push({...base,id:`extension:${orderIdentity(o)}`,kind:'extension',tone:o.extension.state==='failed'?'red':'violet',priority:4,label:extensionLabels[o.extension.state],detail:o.extension.error||'Une seule demande par vente ; la réponse de l’acheteur reste nécessaire.'})
 }
 for(const c of conversations){if(c.needs_human||['drafted','error'].includes(c.ai_state))items.push({id:`conversation:${c.account_id}:${c.conversation_id}`,kind:'conversation',priority:2,tone:c.needs_human?'amber':'violet',account_id:c.account_id,login:c.login,title:c.item_title||c.other_login||'Conversation',photo_url:c.item_photo,label:c.needs_human?'Ton intervention est attendue':c.ai_state==='drafted'?'Réponse IA à valider':'Réponse IA à vérifier',detail:c.ai_reason||c.last_message,conversation:c})}
 for(const t of tasks.filter(t=>t.state==='failed'&&t.kind!=='order_extension'))items.push({id:`task:${t.id}`,kind:'task',priority:6,tone:'red',account_id:t.account_id,login:t.login,title:t.label||'Action de l’assistant',label:'Action en échec',detail:t.error||'Consulte le journal avant de relancer.'})
 return items.sort((a,b)=>a.priority-b.priority||a.id.localeCompare(b.id))
}

export function resultMetrics({messages=[],orders=[],offers=[],from,to=Date.now()}){
 const at=v=>Date.parse(v),inside=v=>at(v)>=from&&at(v)<=to,key=m=>`${m.account_id}|${m.conversation_id}`
 const sent=messages.filter(m=>m.from_me&&m.kind==='message'&&m.state==='sent'&&['site','ai','likes','flow'].includes(m.source)&&inside(m.sent_at))
 const contacts=new Map();for(const m of sent){const k=key(m);if(!contacts.has(k))contacts.set(k,[]);contacts.get(k).push(at(m.sent_at))}
 const afterContact=(k,date)=>Number.isFinite(date)&&contacts.get(k)?.some(t=>date>t&&date-t<=7*864e5)
 const replied=new Set(messages.filter(m=>!m.from_me&&m.kind==='message'&&m.state==='vinted'&&at(m.sent_at)<=to&&afterContact(key(m),at(m.sent_at))).map(key))
 const sales=new Map(),unknown=new Set()
 for(const o of orders){if(['cancelled','returning','suspended'].includes(o.normalized)||!contacts.has(key(o)))continue
  if(!Number.isFinite(at(o.order_date))){unknown.add(orderIdentity(o));continue}
  if(at(o.order_date)<=to&&afterContact(key(o),at(o.order_date)))sales.set(orderIdentity(o),o)
 }
 const amounts=offers.filter(t=>inside(t.finished_at)&&t.result?.offer_sent===true)
 const known=amounts.filter(t=>Number.isFinite(t.result.expected_price)&&Number.isFinite(t.result.offer_price)&&t.result.expected_price>=t.result.offer_price&&t.result.offer_price>0)
 const breakdown=['likes','ai','site','flow'].map(source=>({source,count:sent.filter(m=>m.source===source).length}))
 return {messages_sent:sent.length,conversations:contacts.size,responses:replied.size,response_rate:contacts.size?Math.round(replied.size/contacts.size*100):null,sales:sales.size,revenue:[...sales.values()].reduce((n,o)=>n+(Number(o.price)||0),0),unknown_sale_dates:unknown.size,discount_count:amounts.length,discount_known:known.length,discount_total:Math.round(known.reduce((n,t)=>n+t.result.expected_price-t.result.offer_price,0)*100)/100,breakdown}
}
