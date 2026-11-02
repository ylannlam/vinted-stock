import test from 'node:test'
import assert from 'node:assert/strict'
import {sizeFromTitle,sizeFromLabel} from '../src/lib/soldSize.js'
import {enrichSoldSizes} from './sold-sizes.js'
import {normalizeOrders} from './dotb.js'
const oid='11111111-1111-4111-8111-111111111111',iid='22222222-2222-4222-8222-222222222222',listing='33333333-3333-4333-8333-333333333333',account='44444444-4444-4444-8444-444444444444'
const input=()=>normalizeOrders([{id:oid,account:{id:account,country_code:'FR'},items:[{id:iid,vinted_item_id:listing,title:'Robe taille M'}]}])
const reply=data=>({ok:true,json:async()=>data})
test('title fallback requires an explicit terminal size, never a measurement or a size conversion',()=>{
  for(const [title,size] of [['Robe taille M','M'],['robe Taille : XXL.','XXL'],['Robe taille 38','38'],['Robe taille unique','Taille unique'],['Tour de taille 38',null],['Robe M',null],['taille 38 cm',null],['Robe taille S ou M',null]])assert.equal(sizeFromTitle(title),size,title)
  assert.equal(sizeFromLabel('M / 38 / 10'),'M');assert.equal(sizeFromLabel('38'),'38');assert.equal(sizeFromLabel(''),null)
})
test('exact listing, owner and catalog size are resolved; buyer data is never retained',async()=>{
 const calls=[],out=input();const fetcher=async url=>{calls.push(url);return reply(url.includes('/items/')?{id:listing,vinted_account_id:account,size_id:12,catalog_id:10,address:'PRIVATE'}:{size_groups:[{sizes:[{id:12,title:'S / 36 / 8'}]}]})}
 await enrichSoldSizes(out,{fetcher,token:'test'})
 assert.equal(out.lines[0].source.size,'S');assert.equal(out.lines[0].source.size_origin,'dotb');assert.equal(out.lines[0].source.size_label,'S / 36 / 8')
 assert.match(calls[1],/catalogs\/10\/options\?country=FR&locale=fr$/);assert.ok(!JSON.stringify(out).includes('PRIVATE'))
})
test('ambiguous, foreign or unavailable metadata leaves explicit title fallback intact',async()=>{
 for(const data of [{id:listing,vinted_account_id:'another',size_id:1,catalog_id:2},{id:'another',vinted_account_id:account,size_id:1,catalog_id:2}]){const out=input();await enrichSoldSizes(out,{token:'test',fetcher:async()=>reply(data)});assert.equal(out.lines[0].source.size,'M')}
 const out=input();await enrichSoldSizes(out,{token:'test',fetcher:async u=>reply(u.includes('/items/')?{id:listing,vinted_account_id:account,size_id:1,catalog_id:2}:{size_groups:[{sizes:[{id:1,title:'S'},{id:1,title:'M'}]}]})});assert.equal(out.lines[0].source.size_origin,'title')
})
test('repeated products reuse lookups; rate limits and request budget never block sale import',async()=>{
 const out=input();out.lines.push(structuredClone(out.lines[0]));let calls=0
 await enrichSoldSizes(out,{token:'test',fetcher:async url=>{calls++;return reply(url.includes('/items/')?{id:listing,vinted_account_id:account,size_id:1,catalog_id:2}:{size_groups:[{sizes:[{id:1,title:'L'}]}]})}});assert.equal(calls,2);assert.equal(out.lines[1].source.size,'L')
 for(const options of [{maxRequests:0},{fetcher:async()=>({ok:false,status:429})},{fetcher:async()=>{throw Error('offline')}}]){const x=input();await enrichSoldSizes(x,{token:'test',...options});assert.equal(x.lines.length,1);assert.equal(x.lines[0].source.size,'M')}
})
