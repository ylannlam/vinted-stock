import {createHmac,randomUUID,timingSafeEqual} from 'node:crypto'

const audience='stock-vinted-adspower',lifetime=90000
const fail=()=>Object.assign(new Error('Autorisation expirée. Actualise le site.'),{status:401})
function signature(payload,key){
  if(!key)throw Object.assign(new Error('Connexion au serveur indisponible.'),{status:503})
  return createHmac('sha256',key).update(`${audience}:v1:${payload}`).digest()
}
export function issueAdsPowerTicket(userId,key,now=Date.now()){
  const expiresAt=now+lifetime
  const payload=Buffer.from(JSON.stringify({aud:audience,sub:userId,iat:now,exp:expiresAt,jti:randomUUID()})).toString('base64url')
  return {ticket:`svads_${payload}.${signature(payload,key).toString('base64url')}`,expires_at:expiresAt}
}
export function verifyAdsPowerTicket(ticket,key,now=Date.now()){
  if(typeof ticket!=='string'||ticket.length>1500)throw fail()
  const match=ticket.match(/^svads_([A-Za-z0-9_-]+)\.([A-Za-z0-9_-]{43})$/)
  if(!match||!timingSafeEqual(signature(match[1],key),Buffer.from(match[2],'base64url')))throw fail()
  let value;try{value=JSON.parse(Buffer.from(match[1],'base64url').toString())}catch{throw fail()}
  if(value.aud!==audience||!/^[-0-9a-f]{36}$/i.test(value.sub||'')||!Number.isFinite(value.iat)||!Number.isFinite(value.exp)||value.iat>now+5000||value.exp<=now||value.exp-value.iat!==lifetime)throw fail()
  return {user_id:value.sub,expires_at:value.exp}
}
