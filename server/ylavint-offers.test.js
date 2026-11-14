import test from 'node:test'
import assert from 'node:assert/strict'
import {normalizeSettings,acceptableOffer} from './vinted-agent-config.js'
import {parseOffers,planOffers} from './ylavint-offers.js'
const offer={id:'30',transaction_id:'20',buyer_id:'88',price:40,original_price:50,currency:'EUR',is_bundle:false}

test('PC mode never queues automatic acceptance even with saved extension settings',async()=>{
 const config=normalizeSettings({messaging:{executor:'desktop',offers:{enabled:true}}})
 assert.equal(await planOffers({from(){assert.fail('unsupported acceptance must never enter the queue')}},'account',[],config),0)
})
test('offers disabled by default; exact cents and separate bundle threshold',()=>{
 const config=normalizeSettings().messaging.offers
 assert.equal(acceptableOffer(offer,config),false)
 config.enabled=true;config.bundle_discount=10
 assert.equal(acceptableOffer(offer,config),true)
 for(const change of [{price:39.99},{currency:'USD'},{is_bundle:true},{price:null},{original_price:null}])assert.equal(acceptableOffer({...offer,...change},config),false)
 assert.equal(acceptableOffer({...offer,price:12,original_price:15.01},config),false)
 assert.throws(()=>normalizeSettings({messaging:{offers:{single_discount:81}}}))
 assert.throws(()=>normalizeSettings({messaging:{offers:{enabled:'true'}}}))
 assert.equal(parseOffers([{...offer,id:'not-an-id'}]).length,0)
})
test('offers queue once and stop at buyer limit including pending tasks',async()=>{
 const rows=[],config=normalizeSettings({messaging:{offers:{enabled:true,max_per_buyer:1}}})
 const db={from(){let filters=[],inserting=null,head=false;const q={select(_,opts){head=!!opts?.head;return q},eq(k,v){filters.push(r=>(k==='payload->offer->>buyer_id'?r.payload.offer.buyer_id:r[k])===v);return q},neq(k,v){filters.push(r=>r[k]!==v);return q},gte(k,v){filters.push(r=>r[k]>=v);return q},limit(){return q},insert(r){inserting=r;return q},then(ok){if(inserting)rows.push({...inserting,id:'task',state:'queued',created_at:new Date().toISOString()});const matched=rows.filter(r=>filters.every(f=>f(r)));return Promise.resolve({data:head?null:matched,count:matched.length,error:null}).then(ok)}};return q}}
 const conv={id:'10',other_id:'88',transaction_id:'20',allow_reply:true,offers:[offer]}
 assert.equal(await planOffers(db,'account',[conv],config),1)
 assert.equal(await planOffers(db,'account',[conv],config),0)
 assert.equal(await planOffers(db,'account',[{...conv,offers:[{...offer,id:'31'}]}],config),0)
 assert.equal(rows.length,1)
})

test('offer history skips older or undated offers before accessing the task queue',async()=>{
 const config=normalizeSettings({messaging:{offers:{enabled:true,history_since:'2026-11-08T00:00:00Z'}}})
 const db={from(){throw new Error('Older offers must not be queued')}}
 for(const created_at of [null,'2026-11-07T23:59:59Z'])assert.equal(await planOffers(db,'account',[{id:'10',other_id:'88',transaction_id:'20',allow_reply:true,offers:[{...offer,created_at}]}],config),0)
})
