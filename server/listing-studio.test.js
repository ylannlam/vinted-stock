import test from 'node:test'
import assert from 'node:assert/strict'
import {AppError} from './dotb.js'
import {handleListingStudio,listingStep} from './listing-studio.js'
import {listingFields,verifiedPhotos,listingPayload,scheduleResult,generateListingText,dotbListingRequest} from './listing-studio-core.js'
import {matchingSize,catalogChoices} from '../src/lib/listingStudio.js'
const owner='11111111-1111-4111-8111-111111111111',id='22222222-2222-4222-8222-222222222222',account='33333333-3333-4333-8333-333333333333',remoteId='44444444-4444-4444-8444-444444444444'
const photo={path:`${owner}/55555555-5555-4555-8555-555555555555.png`,type:'image/png',size:10}
const opts={catalog:{id:10},conditions:[{id:2,title:'Bon état'}],size_groups:[{sizes:[{id:4,title:'M / 38'}]}],package_sizes:[{id:1,title:'Petit'}],attributes:[{code:'length',title:'Longueur',required:true,selection_limit:1,options:[{id:8,title:'Court'}]}]}
const fields=()=>listingFields({account_id:account,sku:'sku-test',price:'12,50',size_text:'M',title:'Robe noire courte',description:'Robe noire à manches courtes. Taille M.',brand_id:1,brand_title:'Sans marque',catalog_id:10,size_id:4,status_id:2,package_size_id:1,color_ids:[1],item_attributes:[{code:'length',ids:[8]}]})
const base=(patch={})=>({id,owner_id:owner,state:'draft',version:1,fields:fields(),photos:[photo],uploaded:0,ai_count:0,lease:null,lease_until:null,inflight:null,dotb_item_id:null,created_at:new Date().toISOString(),updated_at:new Date().toISOString(),...patch})
function database(row=base()){
 const rows=[structuredClone(row)]
 return {rows,from(){let filters=[],patch,insert,single=false,head=false,start=0,end=Infinity
  const run=()=>{let data=rows.filter(r=>filters.every(([k,v])=>r[k]===v));if(insert){if(rows.some(r=>r.id===insert.id))return {error:{code:'23505'}};const created=base({...insert,photos:[],fields:insert.fields});rows.push(created);data=[created]}if(patch)data.forEach(r=>Object.assign(r,patch));const count=data.length;data=data.slice(start,end+1);return {data:head?null:structuredClone(single?data[0]||null:data),count,error:null}}
  const q={select(_s,o={}){head=!!o.head;return q},eq(k,v){filters.push([k,v]);return q},order(){return q},range(a,b){start=a;end=b;return q},insert(p){insert=p;return q},update(p){patch=p;return q},maybeSingle(){single=true;return Promise.resolve(run())},single(){return q.maybeSingle()},then(resolve,reject){return Promise.resolve(run()).then(resolve,reject)}};return q
 },storage:{from:()=>({info:async()=>({data:{contentType:'image/png',size:10}}),download:async()=>({data:new Blob(['test-image'],{type:'image/png'})}),createSignedUrls:async paths=>({data:paths.map(path=>({path,signedUrl:`https://example.test/${path}`}))})})}}
}
function source(){const calls=[],item={id:remoteId,vinted_account_id:account,status:'pending',photos:[],vinted_id:null},jobs=[]
 const read=async(path,args={})=>{calls.push([path,args.method||'GET']);if(path==='accounts')return {data:[{id:account,login:'compte-test',country:'FR',bridge:{connected:true}}]};if(path.startsWith('catalogs/'))return opts;if(path.startsWith('catalogs?'))return {data:[{id:10,title:'Robes'}]};if(path.startsWith('colors'))return {data:[{id:1,title:'Noir'}]};if(path.startsWith('scheduled-publishes'))return {data:jobs,has_more:false};if(path===`items/${remoteId}/photos`){item.photos.push({image_no:item.photos.length+1,url:'https://example.test/photo'});return structuredClone(item)}if(path===`items/${remoteId}/schedule`){const job={item_id:remoteId,vinted_account_id:account,status:'waiting',publish:true};jobs.push(job);return {...job,status:'scheduled'}}if(path==='items'||path===`items/${remoteId}`)return structuredClone(item);throw Error(path)}
 return {read,calls,item,jobs}
}
const call=(db,body,source,method='POST',query={})=>handleListingStudio({method,body,query},{db,user:{id:owner}},{read:source.read})

test('field validation rejects unsafe IDs, duplicate attributes and foreign photo paths',async()=>{
 assert.equal(fields().price,'12.50')
 for(const patch of [{account_id:'wrong'},{catalog_id:-1},{color_ids:[1,1]},{item_attributes:[{code:'x',ids:[1,1]}]}])assert.throws(()=>listingFields({...fields(),...patch}))
 const db=database();await assert.rejects(verifiedPhotos(db,owner,[{...photo,path:`${account}/55555555-5555-4555-8555-555555555555.png`}]),/appartient/)
 await assert.rejects(verifiedPhotos(db,owner,[photo,photo]),/différentes/)
 assert.equal((await verifiedPhotos(db,owner,[photo]))[0].size,10)
})
test('publishing uses exact category options, target and required attributes',()=>{
 const a={id:account,country:'FR'};assert.equal(listingPayload(fields(),[photo],opts,[{id:1}],a).vinted_account_id,account)
 for(const change of [{size_id:99},{item_attributes:[]},{item_attributes:[{code:'length',ids:[99]}]},{account_id:owner},{color_ids:[99]}])assert.throws(()=>listingPayload({...fields(),...change},[photo],opts,[{id:1}],a))
 assert.throws(()=>listingPayload(fields(),[photo],{...opts,parcel_measurements:{}},[{id:1}],a),/dimensions/)
 assert.equal(matchingSize('M',opts),4);assert.equal(matchingSize('S',opts),null)
 assert.deepEqual(catalogChoices([{id:1,title:'Femmes'},{id:2,parent_id:1,title:'Robes'}]).map(c=>c.label),['Femmes › Robes'])
})
test('saving and reading a draft never create a remote listing',async()=>{
 const db=database(),s=source()
 await call(db,{action:'save',id,version:1,fields:fields(),photos:[photo]},s)
 await call(db,null,s,'GET',{action:'draft',id})
 assert.equal(s.calls.length,0)
 await assert.rejects(call(db,{action:'save',id,version:1,fields:fields(),photos:[photo]},s),/changé/)
 const other={db,user:{id:account}}
 await assert.rejects(handleListingStudio({method:'GET',query:{action:'draft',id}},other,{read:s.read}),/introuvable/)
})
test('offline or mismatched account cannot create a remote item',async()=>{
 const db=database(),s=source()
 await assert.rejects(call(db,{action:'publish',id,version:1,confirmation_account_id:owner},s),/compte/)
 const read=async path=>path==='accounts'?{data:[{id:account,login:'test',country:'FR',bridge:{connected:false}}]}:s.read(path)
 await assert.rejects(call(db,{action:'publish',id,version:1,confirmation_account_id:account},{read}),/Bridge/)
 assert.equal(db.rows[0].state,'draft');assert.equal(s.calls.length,0)
})
test('one explicit publish creates one item, one photo and one schedule; it is not prematurely published',async()=>{
 const db=database(),s=source(),body={action:'publish',id,version:1,confirmation_account_id:account}
 let {draft}=await call(db,body,s);assert.equal(draft.state,'preparing')
 await call(db,body,s)
 for(let i=0;i<3;i++)({draft}=await call(db,{action:'step',id},s))
 assert.equal(draft.state,'scheduled');assert.equal(draft.url,null)
 await call(db,body,s);await call(db,{action:'step',id},s)
 assert.equal(s.calls.filter(([p,m])=>p==='items'&&m==='POST').length,1)
 assert.equal(s.calls.filter(([p,m])=>p.endsWith('/photos')&&m==='POST').length,1)
 assert.equal(s.calls.filter(([p,m])=>p.endsWith('/schedule')&&m==='POST').length,1)
 s.jobs[0].status='done';s.jobs[0].vinted_id=123456
 const result=await call(db,{action:'refresh',id},s)
 assert.equal(result.draft.state,'published');assert.equal(result.draft.url,'https://www.vinted.fr/items/123456')
})
test('concurrent workers cannot send the same photo twice',async()=>{
 const db=database(base({state:'preparing',dotb_item_id:remoteId})),s=source()
 const snapshot=structuredClone(db.rows[0])
 const results=await Promise.allSettled([listingStep(db,structuredClone(snapshot),{read:s.read}),listingStep(db,structuredClone(snapshot),{read:s.read})])
 assert.equal(results.filter(r=>r.status==='fulfilled').length,1)
 assert.equal(s.calls.filter(([p])=>p.endsWith('/photos')).length,1)
})
test('lost creation response stops rather than silently creating a duplicate',async()=>{
 const db=database(base({state:'preparing',payload:{}})),s=source()
 const read=async(path,args)=>{if(path==='items'){const e=new AppError('timeout',504);e.uncertain=true;throw e}return s.read(path,args)}
 let row=await listingStep(db,db.rows[0],{read});assert.equal(row.state,'attention')
 row=await listingStep(db,row,{read});assert.equal(row.state,'attention')
 const stale=database(base({state:'preparing',inflight:'create',lease_until:'2020-01-01'}))
 assert.equal((await listingStep(stale,stale.rows[0],{read:s.read})).state,'attention');assert.equal(s.calls.length,0)
})
test('lost photo response is reconciled before continuing, without uploading the image twice',async()=>{
 const db=database(base({state:'preparing',dotb_item_id:remoteId,inflight:'photo'})),s=source();s.item.photos=[{image_no:1}]
 const row=await listingStep(db,db.rows[0],{read:s.read})
 assert.equal(row.uploaded,1);assert.equal(row.state,'scheduled');assert.equal(s.calls.filter(([p])=>p.endsWith('/photos')).length,0)
})
test('uncertain schedule is reconciled and never enqueued again when history is missing',async()=>{
 const db=database(base({state:'preparing',dotb_item_id:remoteId,uploaded:1,inflight:'schedule'})),s=source()
 const row=await listingStep(db,db.rows[0],{read:s.read})
 assert.equal(row.state,'attention');assert.equal(s.calls.some(([,m])=>m==='POST'),false)
})
test('orphaned Vinted drafts and failed schedules are not labelled as published',()=>{
 for(const status of ['failed','draft_orphaned','cancelled']){
  const result=scheduleResult({item_id:remoteId,vinted_account_id:account,publish:true,status,vinted_id:123},base({dotb_item_id:remoteId}))
  assert.equal(result.state,'attention')
 }
 assert.equal(scheduleResult({item_id:remoteId,vinted_account_id:account,publish:false,status:'done',vinted_id:123},base({dotb_item_id:remoteId})),null)
})
test('AI output cannot inject unsupported category/color IDs; image request excludes secrets and private SKU',async()=>{
 let sent
 const fetcher=async(url,request)=>{assert.equal(url,'https://ai-gateway.vercel.sh/v1/chat/completions');sent=JSON.parse(request.body);return {ok:true,json:async()=>({choices:[{message:{content:JSON.stringify({title:'Robe noire courte',description:'Robe noire à manches courtes.',catalog_id:999,color_ids:[99,1,1],review_notes:'Vérifier la longueur.'})}}]})}}
 const value=await generateListingText(base(),['https://example.test/photo'],[{id:10,title:'Robes'}],[{id:1,title:'Noir'}],{fetcher,token:'test-only',model:'openai/gpt-4.1-mini'})
 assert.equal(value.catalog_id,null);assert.deepEqual(value.color_ids,[1]);assert.equal(sent.response_format.json_schema.strict,true);assert.equal(sent.messages[1].content[1].image_url.url,'https://example.test/photo')
 assert.equal(JSON.stringify(sent).includes('sku-test'),false)
})
test('AI failures release the draft lock and preserve the sellers text',async()=>{
 const db=database(),s=source()
 const result=await handleListingStudio({method:'POST',body:{action:'generate',id,version:1}},{db,user:{id:owner}},{read:s.read,generate:async()=>{throw new AppError('Crédit indisponible',503)}})
 assert.match(result.draft.last_error,/Crédit/);assert.equal(result.draft.version,db.rows[0].version)
 assert.equal(db.rows[0].lease,null);assert.equal(db.rows[0].state,'draft');assert.equal(db.rows[0].fields.title,fields().title)
 assert.equal(db.rows[0].ai_count,1);assert.equal(s.calls.some(([,m])=>m!=='GET'),false)
})
test('remote timeouts and ambiguous server failures are marked uncertain; rejected inputs are not',async()=>{
 for(const [status,uncertain] of [[422,false],[500,true],[403,false]])await assert.rejects(dotbListingRequest('items',{method:'POST',body:{},token:'test-only',fetcher:async()=>({ok:false,status,json:async()=>({error:{}})})}),e=>e.uncertain===uncertain)
 await assert.rejects(dotbListingRequest('items',{method:'POST',body:{},token:'test-only',fetcher:async()=>{throw Error('timeout')}}),e=>e.uncertain===true)
})
