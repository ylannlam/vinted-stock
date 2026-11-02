import test from 'node:test'
import assert from 'node:assert/strict'
import {parseGofo,refreshShipment,saveShipment} from './supplier-shipments.js'
import {shipmentInput,shipmentLink,shipmentState} from '../src/lib/shipments.js'
const number='GFR123456789',id='11111111-1111-4111-8111-111111111111'
test('tracking validation accepts parcel numbers, never URLs; links always use the carrier host',()=>{
 assert.equal(shipmentInput({carrier:'gofo',tracking_number:' gfr 123456789 '}).tracking_number,number)
 assert.throws(()=>shipmentInput({carrier:'gofo',tracking_number:'https://localhost/admin'}))
 assert.throws(()=>shipmentInput({carrier:'evil',tracking_number:number}))
 assert.throws(()=>shipmentInput({carrier:'gofo',tracking_number:number,manual_status:'shipped_to_buyer'}))
 assert.equal(new URL(shipmentLink({carrier:'gofo',tracking_number:number})).hostname,'www.gofo.com')
 assert.equal(shipmentLink({carrier:'other',tracking_number:number}),null)
 assert.equal(shipmentState({status:'delivered'}),'Livré chez toi')
})
test('only the exact parcel contributes sanitized status and events, not recipient details',()=>{
 const r=parseGofo({data:[{trackingNumber:number,lastTrackEvent:{processCode:205},trackEventList:[{processDate:'2026-11-02 12:00',processContent:'<b>Livré</b>'}],address:'PRIVATE',podImgList:['PRIVATE']} ]},number)
 assert.deepEqual(r,{status:'delivered',events:[{date:'2026-11-02 12:00',text:'Livré'}]});assert.ok(!JSON.stringify(r).includes('PRIVATE'))
 assert.equal(parseGofo({data:[]},number),null)
 assert.equal(parseGofo({data:[{trackingNumber:'OTHER',lastTrackEvent:{processCode:205}}]},number),null)
 assert.equal(parseGofo({data:[{trackingNumber:number,status:'Not Found'}]},number),null)
 assert.throws(()=>parseGofo({data:{unexpected:true}},number))
})
function dbMock(claim){const patches=[];return {patches,from(){let patch;const q={update(p){patch=p;patches.push(p);return q},eq(){return q},lte(){return q},select(){return q},async maybeSingle(){return {data:claim}},then(resolve){return Promise.resolve({error:null}).then(resolve)}};return q}}}
test('refresh uses a fixed carrier endpoint, a cooldown, and preserves the last good events on errors',async()=>{
 const db=dbMock({tracking_number:number});await refreshShipment(db,id,{fetcher:async(url,options)=>{assert.equal(new URL(url).host,'www.gofo.com');assert.equal(options.redirect,'error');return {ok:true,text:async()=>'{"data":[]}'}}})
 assert.match(db.patches[1].last_error,/pas encore/);assert.equal(db.patches[1].events,undefined);assert.equal(db.patches[1].status,undefined);assert.ok(db.patches[0].refresh_after)
 const cached=dbMock(null);assert.deepEqual(await refreshShipment(cached,id,{fetcher:()=>{throw Error('must not query')}}),{refreshed:false})
 const offline=dbMock({tracking_number:number});await refreshShipment(offline,id,{fetcher:()=>{throw Error('offline')}});assert.match(offline.patches[1].last_error,/indisponible/)
})
test('new parcels require a bounded, versioned, unique selection',async()=>{
 const db={rpc(){throw Error('must not save')}}
 for(const lines of [[],[{id:'x'}],[{id:'x',updated_at:'2026-11-01'},{id:'x',updated_at:'2026-11-01'}]])await assert.rejects(()=>saveShipment(db,{carrier:'gofo',tracking_number:number,lines},id),/Sélection/)
})
