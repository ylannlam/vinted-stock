import test from 'node:test'
import assert from 'node:assert/strict'
import {collectSalePhotos} from './sale-photos.js'
import {normalizeOrders,vintedId} from './dotb.js'
import {photoOf,salePhotos} from '../src/lib/fulfillment.js'
const orderId='11111111-1111-4111-8111-111111111111',lineId='22222222-2222-4222-8222-222222222222',account='33333333-3333-4333-8333-333333333333',listing='44444444-4444-4444-8444-444444444444'
const photo='https://images1.vinted.net/example/f800/photo.jpg'
const job=()=>({order_id:orderId,account_id:account,transaction_id:'1000',bridge_connected:false,items:{},lines:[{id:lineId,vinted_id:'12345',dotb_listing_id:null}]})
const reply=data=>({ok:true,json:async()=>data})

test('listing photo is first, then Shein and the original thumbnail as fallbacks',()=>{
 const line={source:{sku:'sku',thumbnail_url:'https://example.com/tiny.jpg'},listing_photo_url:photo}
 assert.deepEqual(salePhotos(line,[{sku:'sku',photo_url:'https://example.com/shein.jpg'}]),[photo,'https://example.com/shein.jpg',line.source.thumbnail_url])
 assert.equal(photoOf(line,[{sku:'another',photo_url:'https://example.com/wrong.jpg'}]),photo)
 assert.equal(photoOf({...line,listing_photo_url:'javascript:bad'}),line.source.thumbnail_url)
 assert.equal(photoOf({...line,source:{}}),photo)
})
test('order normalization retains numeric Vinted IDs separately from saved listing UUIDs',()=>{
 const out=normalizeOrders([{id:orderId,items:[{id:lineId,vinted_item_id:listing,vinted_id:12345}]}])
 assert.equal(out.lines[0].source.vinted_id,'12345');assert.equal(out.lines[0].source.dotb_listing_id,listing)
 for(const v of [null,{},-1,1.2,Number.MAX_SAFE_INTEGER+1,'../123','0',listing])assert.equal(vintedId(v),null)
})
test('cached AdsPower photo requires exact account and listing, with no remote call',async()=>{
 for(const cached of [[{account_id:account,item_id:'12345',photo_url:photo}],[{account_id:'other',item_id:'12345',photo_url:photo}],[{account_id:account,item_id:'67890',photo_url:photo}]]){
  let calls=0
  const result=await collectSalePhotos(job(),{token:'test',fetcher:async()=>{calls++;throw Error('unexpected')},readPhotos:async()=>cached})
  assert.equal(result[lineId].photo_url,cached[0].account_id===account&&cached[0].item_id==='12345'?photo:null);assert.equal(calls,0)
 }
})
test('old sales recover IDs only from their own exact order and line, bundles stay separate',async()=>{
 const j=job();j.lines[0].vinted_id=null;j.lines.push({id:'55555555-5555-4555-8555-555555555555',vinted_id:null})
 for(const owner of [account,'other']){
  const result=await collectSalePhotos(j,{token:'test',fetcher:async()=>reply({id:orderId,account:{id:owner},items:[{id:lineId,vinted_id:12345},{id:j.lines[1].id,vinted_id:67890}]}),readPhotos:async()=>[{account_id:account,item_id:'12345',photo_url:photo}]})
  assert.equal(result[lineId].photo_url,owner===account?photo:null)
  assert.equal(result[j.lines[1].id].photo_url,null)
 }
})
test('saved listing photos work without a bridge and must have the right owner',async()=>{
 for(const owner of [account,'other']){
  const j=job();j.lines[0].dotb_listing_id=listing
  const result=await collectSalePhotos(j,{token:'test',fetcher:async()=>reply({id:listing,vinted_account_id:owner,vinted_id:12345,photos:[{image_no:2,url:'https://example.com/second.jpg'},{image_no:1,url:photo}],buyer:'PRIVATE'})})
  assert.equal(result[lineId].photo_url,owner===account?photo:null);assert.ok(!JSON.stringify(result).includes('PRIVATE'))
 }
})
test('live sale photos need the correct seller transaction and exact item in the bundle',async()=>{
 for(const change of [{},{id:9999},{side:'buyer'},{order_id:'other'},{items:[{id:67890,photo_url:photo}]}]){
  const result=await collectSalePhotos({...job(),bridge_connected:true},{token:'test',fetcher:async()=>reply({id:1000,side:'seller',order_id:orderId,items:[{id:12345,photo_url:photo}],buyer:{login:'PRIVATE'},...change})})
  assert.equal(result[lineId].photo_url,Object.keys(change).length?null:photo);assert.ok(!JSON.stringify(result).includes('PRIVATE'))
 }
})
test('rate limit stops later calls, unavailable sources preserve cached photos and never block sales',async()=>{
 const j=job();j.lines[0].vinted_id=null;j.lines[0].dotb_listing_id=listing;j.bridge_connected=true;let calls=0
 const result=await collectSalePhotos(j,{token:'test',fetcher:async()=>{calls++;return {ok:false,status:429}}})
 assert.equal(calls,1);assert.equal(result[lineId].photo_url,null)
 const cached=job();cached.items[lineId]={vinted_id:'12345',photo_url:photo}
 assert.equal((await collectSalePhotos(cached,{token:'test'}))[lineId].photo_url,photo)
})
