import test from 'node:test'
import assert from 'node:assert/strict'
import {parseHTML} from 'linkedom'
import {renderedPage,readThread} from './ylavint-visible.mjs'
import {withinOfferLimit,pendingOfferMatches,acceptVisibleOffer} from './ylavint-offers.mjs'
import {acceptableOffer} from '../../server/vinted-agent-config.js'

const id='01a1dc97-0355-7cfe-8019-3360f59e2f8b'
function fixture(status='pending'){
 const {document,HTMLElement}=parseHTML(`<html><body><button data-testid="user-menu-button"><img alt="maniloum"></button><div data-testid="conversation-header"><a href="https://www.vinted.fr/member/44">buyer</a></div><a data-testid="hero-message" href="https://www.vinted.fr/items/101">Combinaison<br>44,80 €</a><div data-testid="conversation-content"><div>il y a 11 heures</div><div class="conversation-message-container"><div class="web_ui__Bubble__bubble"><span data-testid="offer-current-price-label">40,30 €</span> <span data-testid="offer-original-price-label">44,80 €</span>${status==='pending'?"<button>Accepter l'offre</button><button>Refuser l'offre</button>":status==='accepted'?'Acceptée':'Annulée'}</div></div></div><textarea data-testid="composer--input"></textarea></body></html>`)
 HTMLElement.prototype.getClientRects=function(){return [{}]}
 const before={document:globalThis.document,location:globalThis.location,getComputedStyle:globalThis.getComputedStyle}
 Object.assign(globalThis,{document,location:{href:'https://www.vinted.fr/inbox/'+id},getComputedStyle:()=>({visibility:'visible',display:'block'})})
 try{return readThread(renderedPage(),Date.parse('2026-11-15T12:00:00Z'))}finally{Object.assign(globalThis,before)}
}
const pending=fixture(),offer=pending.offers[0],config={enabled:true,single_discount:15,bundle_discount:20},payload={desktop_offer:true,conversation_id:id,offer,offer_settings:config,message:'Merci !'}
test('visible reader recognizes a pending offer, exact prices, buyer, article and accepted status',()=>{
 assert.equal(pending.offers.length,1);assert.equal(offer.price,40.3);assert.equal(offer.original_price,44.8);assert.equal(offer.buyer_id,'44');assert.equal(offer.item_id,'101');assert.equal(pending.pending_offer,true)
 assert.equal(fixture('accepted').offers.length,0);assert.equal(fixture('accepted').messages[0].offer_accepted,true);assert.equal(fixture('cancelled').messages[0].offer_accepted,false)
})
test('PC and server agree at the exact-cent threshold and reject changed or ambiguous offers',()=>{
 for(const price of [0,1,38.07,38.08,40.3,44.8,45,NaN])assert.equal(withinOfferLimit({...offer,price},config),acceptableOffer({...offer,price},config))
 assert.equal(pendingOfferMatches(pending,payload),true)
 for(const patch of [{offers:[]},{offers:[offer,offer]},{offers:[{...offer,price:40}]}])assert.equal(pendingOfferMatches({...pending,...patch},payload),false)
 assert.throws(()=>pendingOfferMatches({...pending,other:{id:'45'}},payload));assert.throws(()=>pendingOfferMatches({...pending,item:{id:'102'}},payload))
})
function runner({confirm=true,messageError=false,replayed=false,changed=false}={}){
 let clicks=0,sends=0;const steps=[];const accepted=fixture('accepted')
 const button={filter(){return this},count:async()=>1,isEnabled:async()=>true,click:async()=>{clicks++}}
 const reader={page:{getByRole:()=>button},thread:async()=>clicks&&confirm?accepted:changed?{...pending,offers:[]}:pending,identity:async()=>{},sleep:async()=>{},check:()=>{},update:()=>{}}
 const ui={open:async()=>{},send:async()=>{sends++;if(messageError)throw Error('Champ indisponible');return {reply:{id:'ui:sent'}}}}
 return {context:{reader,ui,authorize:async()=>{},task:{id:'task'},journal:{read:async()=>({steps:replayed?{accept_offer:'submitting'}:{}}),step:async(_id,name,state)=>steps.push([name,state])}},stats:()=>({clicks,sends,steps})}
}
test('acceptance is confirmed before messaging and never retries an uncertain click',async()=>{
 const good=runner(),r=await acceptVisibleOffer(good.context,payload)
 assert.equal(r.accepted,true);assert.equal(r.message_id,'ui:sent');assert.deepEqual(good.stats().steps,[['accept_offer','submitting'],['accept_offer','confirmed']]);assert.equal(good.stats().clicks,1)
 const unknown=runner({confirm:false});await assert.rejects(acceptVisibleOffer(unknown.context,payload),/non confirmée/);assert.equal(unknown.stats().clicks,1);assert.equal(unknown.stats().sends,0)
 const previous=runner({replayed:true});await assert.rejects(acceptVisibleOffer(previous.context,payload),/déjà/);assert.equal(previous.stats().clicks,0)
 const changed=runner({changed:true});assert.ok((await acceptVisibleOffer(changed.context,payload)).skipped);assert.equal(changed.stats().clicks,0)
 const partial=runner({messageError:true});const result=await acceptVisibleOffer(partial.context,payload);assert.equal(result.accepted,true);assert.match(result.message_error,/Champ/)
})
