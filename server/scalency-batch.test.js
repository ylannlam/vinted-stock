import test from 'node:test'
import assert from 'node:assert/strict'
import {scalencyHandler} from './scalency-workspace.js'
import {batchImages,reviewMetadata} from './scalency-batch.js'

test('la génération transmet les octets des photos privées de leur propriétaire',async()=>{
  const owner='79eafe37-47f9-42eb-835b-de39800f5288',path=owner+'/d130e154-92e7-4bd9-92e4-2f38db67d3a7.png'
  const db={storage:{from:()=>({download:async p=>{assert.equal(p,path);return {data:new Blob(['photo'])}}})}}
  assert.deepEqual(await batchImages(db,owner,[{path,type:'image/png',size:5}]),['data:image/png;base64,cGhvdG8='])
  await assert.rejects(batchImages(db,'8bfada63-c207-4c9d-bf8b-b66c11d70391',[{path}]),/photo/)
})

// Exercise the normal route, including validation, reservation and queue receipts,
// without creating any jobs on a seller account.
function database(tables){
  return {storage:{from:()=>({createSignedUrls:async paths=>({data:paths.map(()=>({signedUrl:'https://example.test/photo.jpg'}))})})},
    from(name){
      const table=tables[name];assert.ok(table,name)
      const filters=[];let patch
      const execute=()=>{
        const matches=table.filter(r=>filters.every(([k,v])=>r[k]===v))
        if(patch)matches.forEach(r=>Object.assign(r,patch))
        return {data:structuredClone(matches)}
      }
      const query={select(){return query},eq(k,v){filters.push([k,v]);return query},update(v){patch=v;return query},
        insert(v){if(table.some(r=>r.request_id===v.request_id))return {error:{code:'23505'}};table.push({...v});return {data:v}},
        upsert(v){table.push(...v);return {data:v}},maybeSingle(){return {data:execute().data[0]||null}},
        single(){return query.maybeSingle()},then(resolve,reject){return Promise.resolve(execute()).then(resolve,reject)}}
      return query
    }}
}
test('le lot envoie une seule fois les versions relues du même compte',async t=>{
  const account='compte',user={id:'proprietaire'}
  const options={catalog:{id:10,title:'Robes de soirée'},conditions:[{id:2}],size_groups:[{sizes:[{id:3,title:'S'}]}],package_sizes:[{id:1,title:'Petit'}]}
  const fields={account_id:account,brand_title:'Maison',sku:'ref',price:'25',size_text:'S',title:'Robe noire S',description:'Robe noire à sequins.',catalog_id:10,status_id:2,size_id:3,color_ids:[1],package_size_id:1}
  const drafts=Array.from({length:10},(_,i)=>({id:'draft-'+i,owner_id:user.id,version:3,state:'draft',fields:{...fields,sku:'ref-'+i},photos:[{path:'photo'}],payload:{batch:reviewMetadata(options,[])}}))
  const db=database({listing_drafts:drafts,scalency_settings:[{id:'listing-brand:'+account,value:{name:'Maison'}}],
    scalency_records:[{kind:'accounts',remote_id:account,payload:{linked:true}}],scalency_product_keys:[],scalency_commands:[]})
  const previous=process.env.SCALENCY_API_KEY;process.env.SCALENCY_API_KEY='test-fixture'
  t.after(()=>{if(previous===undefined)delete process.env.SCALENCY_API_KEY;else process.env.SCALENCY_API_KEY=previous})
  let posts=0
  t.mock.method(globalThis,'fetch',async(url,request)=>{
    if(url.pathname.endsWith('/catalogs/10'))return Response.json(options)
    assert.ok(url.pathname.endsWith('/items'));const body=JSON.parse(request.body)
    if(body.dry_run)return Response.json({dry_run:true,would_queue:true})
    posts++;return Response.json({job:{id:posts,status:'queued',type:'publish',account_id:account}})
  })
  const send=(id,overrides={})=>scalencyHandler({method:'POST',query:{},body:{action:'batch-submit',id,version:3,account,...overrides}},{json:r=>r},{db,user,role:'admin'})
  await assert.rejects(send('draft-0',{account:'autre'}),/autre compte/)
  await assert.rejects(send('draft-0',{version:2}),/changé/)
  drafts[0].payload.batch=reviewMetadata(options,['Taille'])
  await assert.rejects(send('draft-0'),/Vérifie/);assert.equal(posts,0)
  drafts[0].payload.batch=reviewMetadata(options,[])
  for(const row of drafts){const result=await send(row.id);assert.ok(result.job.id)}
  assert.ok(drafts.every(r=>r.state==='scheduled'))
  await assert.rejects(send('draft-0'),/changé/)
  assert.equal(posts,10)
})
