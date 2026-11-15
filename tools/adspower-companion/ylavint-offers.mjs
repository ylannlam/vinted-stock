import {review} from './ylavint-ui.mjs'
import {euros} from './ylavint-visible.mjs'

export function withinOfferLimit(offer,config){
 if(!config?.enabled||offer?.desktop!==true||offer.is_bundle!==false||offer.currency!=='EUR')return false
 const {price,original_price:original}=offer,pct=config.single_discount
 return [price,original,pct].every(Number.isFinite)&&price>=1&&original>=1&&price<=original&&pct>=0&&pct<=80&&Math.round(price*100)>=Math.ceil(Math.round(original*100)*(10000-Math.round(pct*100))/10000)
}
export function pendingOfferMatches(thread,payload){
 const o=payload.offer
 if(thread.id!==payload.conversation_id||thread.other?.id!==o?.buyer_id||thread.item?.id!==o?.item_id)throw review('Le membre, l’article ou la conversation de l’offre a changé.')
 if(!withinOfferLimit(o,payload.offer_settings))return false
 if(thread.offers.length!==1)return false
 const actual=thread.offers[0]
 return actual.id===o.id&&actual.price===o.price&&actual.original_price===o.original_price&&actual.buyer_id===o.buyer_id&&actual.item_id===o.item_id
}
export async function acceptVisibleOffer({reader,ui,authorize,journal,task},payload){
 if(payload.desktop_offer!==true||!/^ui:[a-f0-9]{48}$/.test(payload.offer?.id||''))throw review('Cette offre ne provient pas d’une lecture visible confirmée.')
 const {conversation_id:id,offer}=payload
 await ui.open(id);await authorize()
 let thread=await reader.thread()
 if(!pendingOfferMatches(thread,payload))return {skipped:'Offre modifiée, absente ou hors de ton pourcentage.',conversation_id:id}
 const button=reader.page.getByRole('button',{name:/^Accepter l[’']offre$/i}).filter({visible:true})
 if(await button.count()!==1||!await button.isEnabled())throw review('Le bouton d’acceptation n’est pas identifiable sans ambiguïté.')
 await reader.identity();await authorize();thread=await reader.thread()
 if(!pendingOfferMatches(thread,payload))return {skipped:'L’offre a changé avant son acceptation.',conversation_id:id}
 const saved=await journal.read(task.id)
 if(saved?.steps?.accept_offer)throw review('Cette acceptation a déjà été tentée. Vérifie son résultat dans Vinted.')
 reader.update({state:'preparing',message:'Acceptation de l’offre selon ton pourcentage'})
 await journal.step(task.id,'accept_offer','submitting')
 reader.check();await button.click({timeout:5000})
 let accepted=false,acceptedThread
 for(let i=0;i<15;i++){
  await reader.sleep(1000);reader.check();await reader.identity();acceptedThread=await reader.thread()
  if(acceptedThread.id!==id||acceptedThread.other?.id!==offer.buyer_id||acceptedThread.item?.id!==offer.item_id)throw review('La conversation a changé après le clic : résultat à vérifier.')
  accepted=acceptedThread.messages.some(m=>m.kind==='offer'&&!m.from_me&&m.offer_accepted&&euros(m.price)===offer.price&&euros(m.offer_original)===offer.original_price&&!thread.messages.some(old=>old.id===m.id))
  if(accepted)break
 }
 if(!accepted)throw Object.assign(review('Acceptation cliquée mais non confirmée sur Vinted. Aucun second clic automatique.'),{keep_page:true})
 await journal.step(task.id,'accept_offer','confirmed')
 const result={accepted:true,offer_id:offer.id,conversation_id:id}
 if(!payload.message)return result
 // A new buyer message after acceptance cancels the canned follow-up, never the accepted price.
 const baseline=JSON.stringify(acceptedThread.messages.map(m=>m.id))
 ui.recheck=async()=>{await reader.identity();const current=await reader.thread();return current.id!==id||current.other?.id!==offer.buyer_id||!current.allow_reply||JSON.stringify(current.messages.map(m=>m.id))!==baseline?{cancelled:'La conversation a changé après l’acceptation. Message à vérifier.'}:{ok:true}}
 try{
  const sent=await ui.send({task_id:task.id,conversation_id:id,body:payload.message})
  return sent?.reply?.id?{...result,message:payload.message,message_id:sent.reply.id}:{...result,message_error:sent?.desktop_cancelled||'Message après acceptation non confirmé.'}
 }catch(e){return {...result,message_error:String(e.message).slice(0,300)}}
}
