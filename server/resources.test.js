import test from 'node:test'
import assert from 'node:assert/strict'
import {resourceValue,uploadTarget,ownedAsset,checkAssetInfo,ensureAssetBucket,attachImages,MAX_ASSET_BYTES} from './resources.js'
import handler,{resourcesHandler} from '../api/resources.js'
import {filterResources,validateImage} from '../src/lib/resources.js'
const userId='11111111-1111-4111-8111-111111111111',id='22222222-2222-4222-8222-222222222222'
const asset=`${userId}/33333333-3333-4333-8333-333333333333.png`
const form=(patch={})=>({id,kind:'prompt',title:'Mon prompt',category:'Robes',content:'  Place cet article sur le fond.\nConserve les détails.  ',notes:'',image_path:null,...patch})
const response=()=>({code:200,headers:{},setHeader(k,v){this.headers[k]=v},status(code){this.code=code;return this},json(body){this.body=body;return this},end(){return this}})

test('resource forms preserve prompt formatting and require an actual image for a background',()=>{
  assert.equal(resourceValue(form()).content,form().content)
  for(const patch of [{title:'  '},{content:'\n '},{content:'x'.repeat(50001)},{kind:'bad'},{id:'bad'},{kind:'background',image_path:null}])assert.throws(()=>resourceValue(form(patch)))
  assert.equal(resourceValue(form({kind:'background',content:'',image_path:asset})).kind,'background')
})
test('uploads are limited to owned raster images of 10 MB, both before and after upload',()=>{
  const path=uploadTarget(userId,{type:'image/png',size:10})
  assert.ok(ownedAsset(path,userId));assert.equal(ownedAsset(path,id),false)
  for(const path of [`${userId}/../other.png`,`other/${asset}`,`${userId}/bad.svg`])assert.equal(ownedAsset(path,userId),false)
  for(const file of [{type:'image/svg+xml',size:10},{type:'constructor',size:10},{type:'image/png',size:0},{type:'image/png',size:MAX_ASSET_BYTES+1}]){
    assert.throws(()=>validateImage(file));assert.throws(()=>uploadTarget(userId,file));assert.throws(()=>checkAssetInfo({contentType:file.type,size:file.size}))
  }
  checkAssetInfo({contentType:'image/png',size:10})
})
test('storage creation remains private and image failures do not hide saved prompts',async()=>{
  let created=false
  const db={storage:{getBucket:async()=>created?{data:{public:false}}:{error:Error('missing')},createBucket:async(name,options)=>{assert.equal(name,'creative-assets');assert.equal(options.public,false);assert.equal(options.fileSizeLimit,MAX_ASSET_BYTES);created=true;return {data:{}}},from:()=>({createSignedUrls:async()=>({error:Error('unavailable')})})}}
  await ensureAssetBucket(db);assert.ok(created)
  assert.equal((await attachImages(db,[{image_bucket:'creative-assets',image_path:asset,content:'preserved'}]))[0].content,'preserved')
  db.storage.getBucket=async()=>({data:{public:true}})
  await assert.rejects(ensureAssetBucket(db),/privé/)
})
test('search covers prompts and notes, ignores accents, and keeps archived resources separate',()=>{
  const rows=[{id:1,title:'Été',content:'Robe',notes:'Lumière douce',kind:'background',favorite:true,category:'Studio',updated_at:'2026-10-30'},
    {id:2,title:'Ancien',content:'Robe',kind:'prompt',archived_at:'2026-10-31',updated_at:'2026-10-31'}]
  assert.deepEqual(filterResources(rows,{search:'lumiere'}).map(r=>r.id),[1])
  assert.equal(filterResources(rows,{tab:'prompt'}).length,0)
  assert.deepEqual(filterResources(rows,{tab:'archived'}).map(r=>r.id),[2])
  assert.equal(filterResources(rows,{category:'Extérieur'}).length,0)
})

function database(initial=[]) {
  const rows=structuredClone(initial)
  const db={rows,from(table){
    assert.equal(table,'creative_resources')
    let filters=[],patch=null,insert=null,head=false,single=false,start=0,end=Infinity
    const result=()=>{
      let data=rows.filter(r=>filters.every(([k,v])=>r[k]===v))
      if(insert){if(rows.some(r=>r.id===insert.id))return {error:{code:'23505'}};const row={version:1,favorite:false,archived_at:null,...insert};rows.push(row);data=[row]}
      if(patch)data.forEach(r=>Object.assign(r,patch))
      const count=data.length;data=data.slice(start,end+1)
      return {data:head?null:structuredClone(single?data[0]||null:data),count,error:null}
    }
    const q={select(_s,options={}){head=!!options.head;return q},order(){return q},eq(k,v){filters.push([k,v]);return q},range(a,b){start=a;end=b;return q},update(p){patch=p;return q},insert(p){insert=p;return q},maybeSingle(){single=true;return Promise.resolve(result())},single(){return q.maybeSingle()},then(resolve){return Promise.resolve(result()).then(resolve)}};return q
  },storage:{getBucket:async()=>({data:{public:false}}),from(bucket){return {
    info:async path=>{assert.equal(bucket,'creative-assets');return {data:{contentType:'image/png',size:100}}},
    createSignedUrls:async paths=>({data:paths.map(path=>({path,signedUrl:`https://example.test/${path}`}))}),
    createSignedUrl:async(path,expires,options)=>({data:{signedUrl:`https://example.test/${path}?download=${options.download}`}}),
    createSignedUploadUrl:async path=>({data:{token:'test-only',path}})
  }}}}
  return db
}
async function call(db,body,method='POST') {
  const res=response()
  const run=resourcesHandler(async(req,res,roles)=>{assert.deepEqual(roles,['admin']);return {db,user:{id:userId},role:'admin'}})
  await run({method,body,headers:{},query:{}},res);return res
}
test('API saves and retries a prompt without duplication, rejects stale changes, archives and restores it',async()=>{
  const db=database(),body={...form(),action:'save'}
  const saved=await call(db,body);assert.equal(saved.code,200);assert.equal(db.rows.length,1)
  assert.equal((await call(db,body)).code,200);assert.equal(db.rows.length,1)
  const updated=await call(db,{...body,version:1,content:'Nouveau texte'});assert.equal(updated.body.resource.version,2)
  assert.equal((await call(db,{...body,version:1})).code,409);assert.equal(db.rows[0].content,'Nouveau texte')
  assert.equal((await call(db,{id,version:2,action:'favorite',favorite:true},'PATCH')).body.resource.favorite,true)
  assert.ok((await call(db,{id,version:3,action:'archive',archived:true},'PATCH')).body.resource.archived_at)
  assert.equal((await call(db,{id,version:4,action:'archive',archived:false},'PATCH')).body.resource.archived_at,null)
  assert.equal(db.rows.length,1)
})
test('API accepts only the current legacy image or an owned verified upload, and signs downloads',async()=>{
  const db=database([{...form({kind:'background',image_path:'legacy.png'}),image_bucket:'fonds',version:1,created_by:userId}])
  assert.equal((await call(db,{...form({kind:'background',image_path:'legacy.png'}),version:1,action:'save'})).body.resource.image_bucket,'fonds')
  assert.equal((await call(db,{...form({kind:'background',image_path:`${id}/33333333-3333-4333-8333-333333333333.png`}),version:2,action:'save'})).code,400)
  const replaced=await call(db,{...form({kind:'background',image_path:asset}),version:2,action:'save'})
  assert.equal(replaced.body.resource.image_bucket,'creative-assets')
  assert.match((await call(db,{action:'download',id})).body.url,/download=Mon prompt.png/)
  assert.equal((await call(db,{action:'upload',type:'image/png',size:100})).code,200)
})
test('resource API refuses unauthenticated reads, uploads, saves, downloads and archives',async()=>{
  for(const [method,action] of [['GET',null],['POST','upload'],['POST','save'],['POST','download'],['PATCH','archive']]){
    const res=response();await handler({method,headers:{},body:{action},query:{}},res)
    assert.equal(res.code,401);assert.equal(res.headers['Cache-Control'],'no-store')
  }
})
