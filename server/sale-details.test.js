import test from 'node:test'
import assert from 'node:assert/strict'
import {retrievalState,variantAvailability,saleMargin,draftSupplierUrl} from '../src/lib/saleDetails.js'
import {supplierOf,photoOf} from '../src/lib/fulfillment.js'
import {collectorConnectionState} from '../src/lib/collector.js'
import {saleVariant} from './workspace.js'
import {workspaceHandler} from '../api/workspace.js'

test('a failed refresh remains visible even with a previously saved price',()=>{
 const product={price:10,retrieval_status:'blocked',retrieval_message:'Vérification sur Shein'}
 assert.deepEqual(retrievalState('sz123',product),{label:'Vérification sur Shein',tone:'amber',retry:true})
 assert.equal(retrievalState('sz123',{...product,retrieval_status:'queued'}).retry,false)
 assert.equal(retrievalState('',product).label,'SKU à renseigner')
})
test('availability requires matching colour, exact size and a fresh dated observation',()=>{
 const now=Date.parse('2026-11-02T12:00:00Z'),product={color:'Beige',sizes:[{size:'M',availability:'available'},{size:'L',availability:'unavailable'}],observed_at:new Date(now-60000).toISOString()}
 assert.equal(variantAvailability(' m ',' BEIGE ',product,now).tone,'teal')
 assert.equal(variantAvailability('L','Beige',product,now).tone,'red')
 assert.equal(variantAvailability('M','Noir',product,now).tone,'amber')
 assert.equal(variantAvailability('XS','Beige',product,now).tone,'amber')
 assert.equal(variantAvailability('M','Beige',{...product,observed_at:'2026-10-30'},now).tone,'amber')
 assert.equal(variantAvailability('M','Beige',{...product,sizes:null},now).tone,'amber')
})
test('unknown costs are not zero, while a deliberately entered zero is valid',()=>{
 const line={source:{selling_price:'30'},actual_cost:'12',fees_amount:'2',refund_amount:'3'}
 assert.equal(saleMargin(line),13)
 assert.equal(saleMargin({...line,actual_cost:''}),null)
 assert.equal(saleMargin({...line,actual_cost:0}),25)
 assert.equal(saleMargin({...line,source:{}}),null)
})
test('changing SKU cannot keep the source link of the previous article',()=>{
 const line={source:{sku:'old',supplier_link:'https://fr.shein.com/Old-p-123.html'},sku_override:'new'}
 assert.equal(supplierOf(line,[]),null)
 assert.equal(supplierOf(line,[{sku:'new',supplier_url:'https://fr.shein.com/New-p-456.html'}]),'https://fr.shein.com/New-p-456.html')
})

test('the sale keeps its original photo until its own SKU has a collected photo',()=>{
 const original='https://images.example.com/vinted.jpg',shein='https://img.ltwebstatic.com/shein.jpg'
 const line={source:{sku:'old',thumbnail_url:original},sku_override:'new'}
 const unrelated={sku:'old',photo_url:'https://images.example.com/wrong.jpg'}
 assert.equal(photoOf(line,[unrelated,{sku:'new',retrieval_status:'queued'}]),original)
 assert.equal(photoOf(line,[unrelated,{sku:'new',photo_url:shein}]),shein)
 assert.equal(photoOf(line,[{sku:'new',photo_url:'javascript:bad',photos:[shein]}]),shein)
 assert.equal(photoOf(line,[{sku:'new',photo_url:'invalid'}]),original)
 assert.equal(photoOf({...line,sku_override:'different'},[{sku:'new',photo_url:shein}]),original)
})

test('a collected link fills an untouched sale draft without overwriting edits or keeping another SKU link',()=>{
 const draft={sku:'new',sku_override:'new',source:{sku:'old',supplier_link:'https://fr.shein.com/Old-p-123.html'},notes:'Keep this note'}
 const before=structuredClone(draft),url='https://fr.shein.com/New-p-456.html'
 const catalog=[{sku:'new',supplier_url:url}]
 assert.equal(draftSupplierUrl(draft,[]),'')
 assert.equal(draftSupplierUrl(draft,catalog),url)
 assert.deepEqual(draft,before)
 assert.equal(draftSupplierUrl({...draft,supplier_url:'https://fr.shein.com/Manual-p-789.html'},catalog),'https://fr.shein.com/Manual-p-789.html')
 assert.equal(draftSupplierUrl({...draft,supplier_url:''},catalog),'')
 assert.equal(draftSupplierUrl({...draft,sku:'different'},catalog),'')
})
test('a paired but disconnected or stale collector is not shown as actively connected',()=>{
 const now=Date.parse('2026-11-02T12:00:00Z'),browser={connected:true,enabled:true,lastContactAt:new Date(now-60000).toISOString()}
 assert.equal(collectorConnectionState(browser,[],now).active,true)
 assert.equal(collectorConnectionState({...browser,lastContactAt:now-60000},[],now).active,true)
 for(const patch of [{lastContactAt:null},{lastContactAt:'2026-11-01'},{retryAt:now+3000},{phase:'blocked'},{enabled:false}])assert.equal(collectorConnectionState({...browser,...patch},[],now).active,false)
 assert.equal(collectorConnectionState(null,[],now).active,false)
})
test('sale variants validate independently of the common SKU',()=>{
 assert.deepEqual(saleVariant({supplier_size:' M ',supplier_color:' Noir '}),{size:'M',color:'Noir'})
 assert.deepEqual(saleVariant({}),{size:null,color:null})
 assert.throws(()=>saleVariant({supplier_size:12}))
 assert.throws(()=>saleVariant({supplier_color:'x'.repeat(81)}))
})
test('action queue validates category and page before querying the database',async()=>{
 let calls=0,params
 const handler=workspaceHandler(async()=>({role:'stock',db:{rpc:async(name,args)=>{assert.equal(name,'workspace_actions');params=args;calls++;return {data:{rows:[],counts:{},count:0}}}}}))
 const res={status(code){this.code=code;return this},json(value){this.value=value;return this}}
 await handler({method:'GET',query:{view:'actions',category:'ship',page:'2'}},res)
 assert.deepEqual(params,{p_category:'ship',p_page:2})
 for(const query of [{category:'unknown'},{category:['ship']},{page:'-1'},{page:'1.5'}]){await handler({method:'GET',query:{view:'actions',...query}},res);assert.equal(res.code,400)}
 assert.equal(calls,1)
})
