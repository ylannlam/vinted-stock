import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import vm from 'node:vm'
import { validateObservation, validateSupplierAssociation, normalizeDotbItems, readDotbItems, recoverDotbSupplierLinks } from './catalog.js'
import { sheinProduct, supplierLink, sheinSearchUrl, parsePrice, observationChange } from '../src/lib/catalog.js'
import handler from '../api/catalog.js'
const id='11111111-1111-4111-8111-111111111111', url='https://fr.shein.com/Dress-p-123456.html?ref=tracking'
const now=Date.parse('2026-10-31T12:00:00Z')
const observation=()=>({capture_id:id,supplier_url:url,title:'Robe',price:'18,08',currency:'EUR',size:'M',color:'Nude',availability:'available',observed_at:new Date(now).toISOString(),confirmed:true})
test('only full Shein product URLs are accepted and tracking is stripped',()=>{
  assert.deepEqual(sheinProduct(url),{supplier_id:'123456',supplier_url:url.split('?')[0]})
  for(const value of ['https://fr.shein.com/','https://fr.shein.com/store/home','https://fr.shein.com.evil.test/Dress-p-123.html','https://user:pass@fr.shein.com/Dress-p-123.html','javascript:alert(1)','http://fr.shein.com/Dress-p-123.html'])assert.equal(sheinProduct(value),null)
})
test('localized prices stay distinct from missing, zero or malformed prices',()=>{
  for(const [value,expected] of [['18,08 €',18.08],['1.234,56',1234.56],['1,234.56',1234.56],['',null],[null,null]])assert.equal(parsePrice(value),expected)
  for(const value of ['0','-1','18.081',18.081,0.001,'gratuit',Infinity,'100000'])assert.ok(Number.isNaN(parsePrice(value)))
  assert.equal(observationChange({price:null,previous_price:18}),null)
  assert.equal(observationChange({price:19,previous_price:18}).amount,1)
})
test('observations require review and never guess stock without a variant',()=>{
  const row=validateObservation(observation(),now)
  assert.equal(row.observation.price,18.08);assert.equal(row.product.supplier_id,'123456')
  for(const patch of [{confirmed:false},{price:'0'},{currency:'USD'},{color:''},{size:''},{observed_at:'2026-10-29T12:00:00Z'},{observed_at:'2027-01-01'},{photo_url:'javascript:alert(1)'},{capture_id:'bad'}])assert.throws(()=>validateObservation({...observation(),...patch},now))
  assert.equal(validateObservation({...observation(),size:'',color:'',availability:'unknown',price:''},now).observation.price,null)
})
test('Dotb SKU is kept intact; selling price is never a supplier observation',()=>{
  const row=normalizeDotbItems([{id,sku:' sz25052272411726746 ',supplier_link:url,price:'92',currency:'EUR',title:'Robe'}])[0]
  assert.equal(row.sku,'sz25052272411726746');assert.equal(row.supplier_id,'123456');assert.equal(row.price,'92')
  assert.equal('observation' in row,false)
  assert.throws(()=>normalizeDotbItems([{id},{id}]))
  assert.equal(normalizeDotbItems([{id,sku:'',price:'999999999999'}])[0].price,null)
})
test('supplier links accept copied Markdown and Shein links without a scheme',()=>{
  for(const value of [url,`[Robe](${url})`,`<${url}>`,url.replace('https://',''),url.replace('https:','http:')]){
    const link=supplierLink(value);assert.equal(link.product.supplier_id,'123456');assert.equal(link.status,'recognized')
    assert.equal(normalizeDotbItems([{id,sku:'sz123',supplier_link:value}])[0].supplier_id,'123456')
  }
  assert.equal(supplierLink(null).status,'missing')
  assert.equal(supplierLink('javascript:alert(1)').status,'invalid')
  assert.equal(supplierLink('https://user:pass@fr.shein.com/Dress-p-123.html').status,'invalid')
  assert.equal(supplierLink('https://fr.shein.com/pdsearch/sz123/').status,'unrecognized')
  assert.equal(supplierLink('https://fr.shein.com.evil.test/Dress-p-123.html').product,null)
  assert.equal(sheinSearchUrl('sz25052272411726746'),'https://fr.shein.com/pdsearch/sz25052272411726746/')
  assert.equal(sheinSearchUrl('../malicious'),null)
})
test('a supplier association requires a real product but no invented price',()=>{
  const valid=validateSupplierAssociation({sku:'sz123',supplier_url:url,updated_at:null})
  assert.equal(valid.supplier_id,'123456');assert.equal('price' in valid,false)
  assert.throws(()=>validateSupplierAssociation({sku:'sz123',supplier_url:'https://fr.shein.com/pdsearch/sz123/',updated_at:null}))
  assert.throws(()=>validateSupplierAssociation({sku:'sz123',supplier_url:url,updated_at:'bad'}))
})
test('missing list links are recovered only from the same Dotb item and SKU',async()=>{
  const data=[{id,sku:'sz123',supplier_link:null}],options={token:'test',sleep:async()=>{}}
  const recover=detail=>recoverDotbSupplierLinks(data,{...options,fetcher:async()=>({ok:true,json:async()=>detail})})
  assert.equal((await recover({id,sku:'sz123',supplier_link:url}))[0].supplier_link,url)
  assert.equal((await recover({id,sku:'other',supplier_link:url}))[0].supplier_link,null)
  assert.equal((await recover({id:'22222222-2222-4222-8222-222222222222',sku:'sz123',supplier_link:url}))[0].supplier_link,null)
  const failure=await recoverDotbSupplierLinks(data,{...options,fetcher:async()=>{throw Error('timeout')}})
  assert.equal(failure[0].supplier_link,null);assert.equal(data[0].supplier_link,null)
})
test('detail recovery is bounded, stops on rate limit and skips usable links',async()=>{
  let calls=0
  const data=Array.from({length:8},(_,i)=>({id:`11111111-1111-4111-8111-${String(i).padStart(12,'0')}`,sku:'sz123'}))
  const opts={token:'test',sleep:async()=>{},fetcher:async()=>{calls++;return {ok:false,status:404}}}
  await recoverDotbSupplierLinks(data,opts);assert.equal(calls,5)
  calls=0;await recoverDotbSupplierLinks(data,{...opts,fetcher:async()=>{calls++;return {ok:false,status:429}}});assert.equal(calls,1)
  calls=0;await recoverDotbSupplierLinks([{id,sku:'sz123',supplier_link:url},{id,sku:32}],opts);assert.equal(calls,0)
})
test('Dotb pagination fails safely on a repeating cursor or malformed response',async()=>{
  const fake=body=>async()=>({ok:true,json:async()=>body})
  await assert.rejects(readDotbItems('same',fake({data:[{id}],has_more:true,next_cursor:'same'}),'test'))
  await assert.rejects(readDotbItems(null,fake({data:[],has_more:true,next_cursor:'next'}),'test'))
  await assert.rejects(readDotbItems(null,async()=>({ok:false,status:429}),'test'),/Limite Dotb/)
  assert.equal((await readDotbItems(null,fake({data:[],has_more:false}),'test')).has_more,false)
})
const extractor=vm.runInNewContext(readFileSync(new URL('../extensions/shein/extractor.js',import.meta.url),'utf8')+'\nextractSheinProduct',{URL,Date})
function doc(products){return {querySelectorAll:()=>[{textContent:JSON.stringify(products)}],querySelector:()=>null}}
test('extension ignores recommendations, multiple offers and foreign currency',()=>{
  const product={'@type':'Product',url,name:'Robe',sku:'sz123',offers:{'@type':'Offer',price:'18.08',priceCurrency:'EUR'}}
  assert.equal(extractor(doc(product),url).price,'18.08')
  assert.equal(extractor(doc(product),url).availability,'unknown')
  assert.equal(extractor(doc({...product,offers:[product.offers,{...product.offers,price:'22'}]}),url).price,'')
  assert.equal(extractor(doc({...product,offers:{...product.offers,priceCurrency:'USD'}}),url).price,'')
  assert.equal(extractor(doc({...product,url:'https://fr.shein.com/Other-p-99.html'}),url).price,'')
  assert.throws(()=>extractor(doc(product),'https://fr.shein.com/risk/challenge'))
})
test('catalogue is never readable or writable without authentication',async()=>{
  for(const method of ['GET','POST','PATCH']){
    const res={setHeader(){},status(n){this.code=n;return this},json(body){this.body=body;return this}}
    await handler({method,headers:{},body:{action:'sync'}},res);assert.equal(res.code,401)
  }
})
