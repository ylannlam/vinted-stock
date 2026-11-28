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
  return {storage:{from:()=>({info:async()=>({data:{contentType:'image/png',size:1024}}),
    createSignedUrls:async paths=>({data:paths.map(()=>({signedUrl:'https://example.test/photo.jpg'}))})})},
    rpc(name,p){
      assert.equal(name,'scalency_reserve_single')
      const row=tables.listing_drafts.find(r=>r.id===p.p_draft&&r.owner_id===p.p_owner&&r.version===p.p_version&&r.state==='draft'&&r.fields.account_id===p.p_account)
      if(row)Object.assign(row,{state:'preparing',fields:p.p_fields,scheduled_at:p.p_due})
      return {data:!!row}
    },
    from(name){
      const table=tables[name];assert.ok(table,name)
      const filters=[];let patch
      const execute=()=>{
        const matches=table.filter(r=>filters.every(matches=>matches(r)))
        if(patch)matches.forEach(r=>Object.assign(r,patch))
        return {data:structuredClone(matches)}
      }
      const query={select(){return query},is(k,v){return query.eq(k,v)},order(){return query},
        range(from,to){const {data}=execute();return {data:data.slice(from,to+1),count:data.length}},eq(k,v){filters.push(r=>r[k]===v);return query},like(k,v){filters.push(r=>r[k].startsWith(v.slice(0,-1)));return query},update(v){patch=v;return query},
        insert(v){if(table.some(r=>r.request_id===v.request_id))return {error:{code:'23505'}};table.push({...v});return {data:v}},
        upsert(v){table.push(...v);return {data:v}},maybeSingle(){return {data:execute().data[0]||null}},
        single(){return query.maybeSingle()},then(resolve,reject){return Promise.resolve(execute()).then(resolve,reject)}}
      return query
    }}
}
test('le lot envoie une seule fois les versions relues du même compte',async t=>{
  const account='vt-28',user={id:'proprietaire'}
  const options={catalog:{id:10,title:'Robes de soirée'},conditions:[{id:2,title:'Très bon état'},{id:6,title:'Neuf sans étiquette'}],size_groups:[{sizes:[{id:3,title:'S'}]}],package_sizes:[{id:1,title:'Petit'}]}
  const fields={account_id:account,brand_title:'Maison',sku:'ref',price:'25',size_text:'S',title:'Robe noire S',description:'Robe noire à sequins.',catalog_id:10,status_id:6,size_id:3,color_ids:[1],package_size_id:1}
  const drafts=Array.from({length:10},(_,i)=>({id:'draft-'+i,owner_id:user.id,version:3,state:'draft',fields:{...fields,sku:'ref-'+i},photos:[{path:'photo'}],payload:{batch:reviewMetadata(options,[])}}))
  const db=database({vinted_accounts:[],listing_drafts:drafts,scalency_settings:[{id:'profile-ban:restreint',value:{status:'banned',checked_at:'2026-11-23T22:50:57Z'}},{id:'listing-brand:'+account,value:{name:'Maison'}}],
    scalency_records:[{kind:'accounts',remote_id:account,payload:{linked:true}}],scalency_product_keys:[],scalency_commands:[]})
  const previous=process.env.SCALENCY_API_KEY;process.env.SCALENCY_API_KEY='test-fixture'
  t.after(()=>{if(previous===undefined)delete process.env.SCALENCY_API_KEY;else process.env.SCALENCY_API_KEY=previous})
  let posts=0
  t.mock.method(globalThis,'fetch',async(url,request)=>{
    if(url.pathname.endsWith('/accounts'))return Response.json({data:[
      {id:account,linked:true,agent:{publication_pause:null}},
      {id:'restreint',linked:true,agent:{publication_pause:null}}
    ]})
    if(url.pathname.endsWith('/catalogs/10'))return Response.json(options)
    assert.ok(url.pathname.endsWith('/items'));const body=JSON.parse(request.body)
    assert.equal(body.status_id,2)
    assert.match(body.description,/État : Neuf/)
    if(body.dry_run)return Response.json({dry_run:true,would_queue:true})
    posts++;return Response.json({job:{id:posts,status:'queued',type:'publish',account_id:account}})
  })
  const send=(id,overrides={})=>scalencyHandler({method:'POST',query:{},body:{action:'batch-submit',id,version:3,account,...overrides}},{json:r=>r},{db,user,role:'admin'})
  await assert.rejects(send('draft-0',{account:'autre'}),/autre compte/)
  await assert.rejects(send('draft-0',{version:2}),/changé/)
  drafts[0].payload.batch=reviewMetadata(options,['Taille'])
  await assert.rejects(send('draft-0'),/Vérifie/);assert.equal(posts,0)
  drafts[0].payload.batch=reviewMetadata(options,[])
  drafts[0].fields.account_id='restreint'
  for(const action of ['batch-generate','generate','autofill','autopost','validate','publish','batch-submit']){
    await assert.rejects(send(drafts[0].id,{action,account:'restreint'}),{status:423})
  }
  assert.equal(drafts[0].state,'draft');assert.equal(drafts[0].version,3);assert.equal(posts,0)
  drafts[0].fields.account_id=account
  for(const row of drafts){const result=await send(row.id);assert.ok(result.job.id)}
  assert.ok(drafts.every(r=>r.state==='scheduled'))
  await assert.rejects(send('draft-0'),/changé/)
  assert.equal(posts,10)
})

test('enregistrer puis vérifier une fiche prête conserve son statut et simule sans mise en file',async t=>{
  const user={id:'79eafe37-47f9-42eb-835b-de39800f5288'},account='vt-28'
  const fields={account_id:account,brand_title:'Maison',catalog_id:1835,size_id:1739,size_text:'M',status_id:2,
    package_size_id:1,color_ids:[1],price:'39.90',title:'Body noir taille M',description:'Body noir brodé.',sku:'article'}
  const photos=[{path:user.id+'/d130e154-92e7-4bd9-92e4-2f38db67d3a7.png',type:'image/png',size:1024}]
  const row={id:'7980482e-d558-456d-95e6-837f37472e29',owner_id:user.id,version:8,state:'draft',fields,photos,
    payload:{scalency_source:'stock-vinted',batch:{status:'ready',missing:[],ai_model:'fixture'}}}
  const db=database({vinted_accounts:[],listing_drafts:[row],scalency_settings:[{id:'listing-brand:'+account,value:{name:'Maison'}}],
    scalency_records:[{kind:'accounts',remote_id:account,payload:{linked:true}}],scalency_product_keys:[]})
  const key=process.env.SCALENCY_API_KEY
  process.env.SCALENCY_API_KEY='fixture'
  t.after(()=>{if(key===undefined)delete process.env.SCALENCY_API_KEY;else process.env.SCALENCY_API_KEY=key})
  let simulations=0,valid=true
  t.mock.method(globalThis,'fetch',async (url,request)=>{
    const path=new URL(url).pathname
    if(path.endsWith('/accounts'))return Response.json({data:[{id:account,linked:true,agent:{publication_pause:null}}]})
    if(path.endsWith('/options'))return Response.json({}, {status:503})
    if(path.includes('/catalogs/'))return Response.json({error:{message:'Le référentiel Vinted se charge'}},{status:429})
    assert.ok(path.endsWith('/items'))
    const body=JSON.parse(request.body)
    assert.equal(body.dry_run,true)
    assert.equal(body.size_id,1739)
    assert.equal(body.catalog_id,1835)
    simulations++
    return Response.json({dry_run:true,would_queue:valid,reason:valid?null:'Simulation refusée'})
  })
  const send=(action,extra={})=>scalencyHandler({method:'POST',query:{},body:{action,id:row.id,version:row.version,...extra}},{json:value=>value},{db,user,role:'admin'})
  const saved=await send('save',{fields,photos})
  assert.equal(saved.batch.status,'ready')
  assert.equal(saved.batch.ai_model,'fixture')
  assert.equal((await send('validate')).would_queue,true)
  valid=false
  await assert.rejects(send('validate'),/Simulation refusée/)
  assert.equal(simulations,2)
  assert.equal(row.state,'draft')
  assert.equal(row.version,9)
  assert.equal(row.payload.batch.status,'ready')
  await send('save',{fields:{...fields,color_ids:[]},photos})
  assert.deepEqual(row.payload.batch.missing,['Couleur'])
  assert.equal(row.payload.batch.status,'review')
  await send('save',{fields:{...fields,catalog_id:98765},photos})
  assert.equal(row.payload.batch.catalog_pending,true)
  assert.equal(row.payload.batch.catalog_issue,'Texte enregistré. Options de la catégorie Vinted en attente.')
  assert.equal(row.fields.description.includes('Body noir brodé.'),true)
  assert.equal(row.fields.status_id,2)
  assert.deepEqual(row.photos,photos)
})
