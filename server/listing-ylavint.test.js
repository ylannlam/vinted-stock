import test from 'node:test'
import assert from 'node:assert/strict'
import {publicationBundle,publicationResult,queueYlavintListing,cancelYlavintListing,publicationStatus} from './listing-ylavint.js'
import {handleListingStudio,listingStep} from './listing-studio.js'

const owner='11111111-1111-4111-8111-111111111111',account='22222222-2222-4222-8222-222222222222',id='33333333-3333-4333-8333-333333333333'
const photo={path:`${owner}/55555555-5555-4555-8555-555555555555.png`,type:'image/png',size:10}
const fields={account_id:account,sku:'SKU1',title:'Robe courte noire',description:'Une robe noire en bon état.',price:'20',catalog_id:10,brand_id:1,brand_title:'Sans marque',size_id:4,status_id:2,package_size_id:1,color_ids:[1],item_attributes:[]}
const options={catalog:{id:10},size_groups:[{sizes:[{id:4}]}],conditions:[{id:2}],package_sizes:[{id:1}],attributes:[]}
function fixture(){
 const d={id,owner_id:owner,version:1,state:'draft',fields,photos:[photo]},settings={account_id:account,enabled:true,paused:false,features:{publish:true},extension_version:'3.8.0'}
 const state={listing_drafts:[d],publication_accounts:[{id:account}],vinted_agent_settings:[settings],adspower_preferences:[{owner_id:owner,profiles:[{id:'p81',number:'81',name:'compte-test'}]}],publication_profile_links:[{owner_id:owner,profile_id:'p81',account_id:account}]},calls=[]
 const db={state,calls,from(table){let filters=[],patch;const q={select(){return q},eq(k,v){filters.push(r=>r[k]===v);return q},neq(k,v){filters.push(r=>r[k]!==v);return q},limit(){return q},in(k,v){filters.push(r=>v.includes(r[k]));return q},update(p){patch=p;return q},then(ok){const rows=(state[table]||[]).filter(r=>filters.every(f=>f(r)));if(patch)rows.forEach(r=>Object.assign(r,patch));return Promise.resolve({data:structuredClone(rows)}).then(ok)},async maybeSingle(){const r=await q;return {data:r.data[0]||null}},single(){return q.maybeSingle()}};return q},
  rpc:async(name,p)=>{calls.push({name,p});if(name==='queue_ylavint_listing'){if(d.version!==p.p_version||d.state!=='draft')return {data:[]};Object.assign(d,{publish_provider:'ylavint',publication_task_id:crypto.randomUUID(),state:'scheduled',version:2});return {data:[structuredClone(d)]}}return {data:[]}},
  storage:{from:()=>({info:async()=>({data:{contentType:'image/png',size:10}}),createSignedUrls:async paths=>({data:paths.map(path=>({path,signedUrl:'https://files.test/'+path}))})})}}
 const read=async(path,args={})=>{calls.push({path,method:args.method||'GET'});if(path==='accounts')return {data:[{id:account,login:'compte-test',country:'FR',bridge:{connected:false}}]};if(path.startsWith('catalogs?'))return {data:[{id:10,title:'Robes'}]};if(path.startsWith('catalogs/'))return options;if(path.startsWith('colors'))return {data:[{id:1}]};throw Error(path)}
 return {db,d,settings,read,settingsReader:async()=>({effective:{spacing_minutes:15}})}
}
test('YlaVint validates all listing fields and owned photos, then queues a frozen snapshot without any Dotb write',async()=>{
 const {db,d,read,settingsReader}=fixture()
 const out=await queueYlavintListing(db,{id:owner},d,{mode:'draft',read,settings:settingsReader})
 assert.equal(out.state,'scheduled');assert.ok(db.calls.filter(x=>x.path).every(x=>x.method==='GET'))
 const {p}=db.calls.find(x=>x.name==='queue_ylavint_listing');assert.equal(p.p_live,false);assert.equal(p.p_spacing,0);assert.equal(p.p_payload.fields.price,'20.00');assert.deepEqual(p.p_payload.photos,[photo]);assert.equal(p.p_owner,owner)
 await assert.rejects(queueYlavintListing(db,{id:owner},d,{read,settings:settingsReader}),/déjà transmise/)
})
test('invalid options, foreign photos, unselected accounts and unknown modes never reach the queue',async()=>{
 for(const change of [d=>d.fields={...fields,size_id:999},d=>d.photos=[{...photo,path:photo.path.replace(owner,account)}]]){
  const {db,d,read,settingsReader}=fixture();change(d);await assert.rejects(queueYlavintListing(db,{id:owner},d,{read,settings:settingsReader}));assert.ok(!db.calls.some(c=>c.name))
 }
 const {db,d,read}=fixture();db.state.adspower_preferences[0].profiles=[]
 await assert.rejects(queueYlavintListing(db,{id:owner},d,{read}),/sélectionne|sélection|choisis/i)
 await assert.rejects(queueYlavintListing(db,{id:owner},d,{mode:'unknown',read}),/Choisis/)
})
test('dispatch binds the snapshot to the owner, account and task; missing photo links fail closed',async()=>{
 const {db,d}=fixture(),task={id:crypto.randomUUID(),account_id:account,created_by:owner,payload:{draft_id:id,live:false,listing:{assisted:true,fields,photos:[photo]}},lease_until:new Date(Date.now()+600000).toISOString()}
 Object.assign(d,{publish_provider:'ylavint',publication_task_id:task.id,state:'preparing'})
 const bundle=await publicationBundle(db,task);assert.equal(bundle.assisted,true);assert.equal(bundle.photos[0].type,'image/png')
 for(const patch of [{created_by:account},{account_id:owner},{id:crypto.randomUUID()}])await assert.rejects(publicationBundle(db,{...task,...patch}),/correspond/)
 db.storage.from=()=>({createSignedUrls:async()=>({data:[{path:photo.path,signedUrl:null}]})});await assert.rejects(publicationBundle(db,task),/photo est inaccessible/)
})
test('a prepared form is never reported as a published listing; uncertain publications cannot be cancelled, edited, deleted or sent by Dotb',async()=>{
 assert.equal(publicationResult({payload:{listing:{assisted:true}}},{prepared:true,missing:[]}).prepared,true)
 for(const result of [{vinted_id:'123',draft:false,confirmed:true},{vinted_id:'123',draft:true},{vinted_id:'oops',draft:true,confirmed:true}])assert.throws(()=>publicationResult({payload:{live:false}},result),/confirmée/)
 const {db,d,read}=fixture();Object.assign(d,{state:'attention',publish_provider:'ylavint',publication_task_id:crypto.randomUUID()})
 await assert.rejects(cancelYlavintListing(db,d),/Seul un envoi/)
 for(const action of ['save','discard','publish','mark_published'])await assert.rejects(handleListingStudio({method:'POST',body:{action,id,version:d.version}},{db,user:{id:owner}},{read}),/confiée à YlaVint/)
 d.state='preparing';assert.equal(await listingStep(db,d,{read}),d);assert.equal(db.calls.length,0)
})
test('publication availability reports old extensions and waiting profiles without guessing a connection',async()=>{
 const {db,settings}=fixture();assert.equal((await publicationStatus(db,account)).ready,true);assert.equal((await publicationStatus(db,account)).online,false)
 settings.extension_version='3.6.0';assert.equal((await publicationStatus(db,account)).ready,false)
 settings.extension_version='3.10.0';settings.paused=true;settings.pause_reason='Vérification du compte';assert.match((await publicationStatus(db,account)).waiting,/Vérification/)
})

test('PC publication requires its own compatible connector even with a recent extension',async()=>{
 const {db,settings,d,read}=fixture();settings.messaging={executor:'desktop'}
 const state=await publicationStatus(db,account);assert.equal(state.ready,false);assert.match(state.reason,/connecteur 1.5/)
 await assert.rejects(queueYlavintListing(db,{id:owner},d,{read}),/connecteur 1.5/)
 assert.equal(db.calls.length,0)
})

test('PC mode prepares by default; only explicit per-listing authorization freezes a publish request',async()=>{
 for(const submit of [false,true]){
  const {db,settings,d,read}=fixture();settings.messaging={executor:'desktop'};settings.extension_version='pc-1.5.0'
  assert.equal((await publicationStatus(db,account)).executor,'desktop')
  await queueYlavintListing(db,{id:owner},d,{read,...(submit?{desktopSubmit:true}:{})})
  const snap=db.calls.find(c=>c.name==='queue_ylavint_listing').p.p_payload
  assert.equal(snap.execution,'desktop');assert.equal(snap.submit,submit)
 }
 const t={payload:{listing:{assisted:true,execution:'desktop',submit:true}}}
 assert.throws(()=>publicationResult(t,{prepared:true,missing:[]}),/pas confirmée/)
 assert.equal(publicationResult(t,{confirmed:true,vinted_id:'123'}).vinted_id,'123')
 assert.throws(()=>publicationResult({...t,payload:{listing:{...t.payload.listing,submit:false}}},{confirmed:true,vinted_id:'123'}),/pas été confirmée/)
})

test('only a prepared form can be marked published by an explicit user action with a Vinted link',async()=>{
 const {db,d,read}=fixture();Object.assign(d,{state:'attention',publish_provider:'ylavint',publication_task_id:crypto.randomUUID(),payload:{assisted:true,form_ready:true}})
 const r=await handleListingStudio({method:'POST',body:{action:'mark_published',id,version:d.version,url:'https://www.vinted.fr/items/123456'}},{db,user:{id:owner}},{read})
 assert.equal(r.draft.state,'published');assert.equal(d.vinted_id,'123456');assert.match(d.message,/à la main/)
 assert.equal(db.calls.length,0,'no Vinted or Dotb request is made to record the user confirmation')
})
