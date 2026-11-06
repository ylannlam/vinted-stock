import test from 'node:test'
import assert from 'node:assert/strict'
import {handleListingStudio,soldCatalogIds,accountManualMessage,manualRestoredMessage,listingStep} from './listing-studio.js'
import {catalogRoots,scheduleResult,generateListingText,listingInstructions,listingFields,dressCatalogId} from './listing-studio-core.js'
import {readListingSettings,saveListingSettings,reserveListingSlot,listingTitleExamples} from './listing-settings.js'
import {cleanListingSettings,effectiveListingSettings,applyListingPresets,tidyListingTitle,composeListingDescription,DEFAULT_LISTING_SETTINGS} from '../src/lib/listingSettings.js'
import {listingIssues} from '../src/lib/listingStudio.js'
import {readListingPicker} from './listing-picker.js'

const owner='11111111-1111-4111-8111-111111111111',other='99999999-9999-4999-8999-999999999999'
const account='33333333-3333-4333-8333-333333333333',account2='55555555-5555-4555-8555-555555555555',remoteId='44444444-4444-4444-8444-444444444444'
const photo={path:`${owner}/66666666-6666-4666-8666-666666666666.png`,type:'image/png',size:10}
const options={catalog:{id:10},conditions:[{id:6,title:'Neuf avec étiquette'},{id:2,title:'Très bon état'},{id:3,title:'Bon état'}],size_groups:[{sizes:[{id:4,title:'M / 38'},{id:5,title:'L / 40'}]}],package_sizes:[{id:1,title:'Petit'},{id:2,title:'Moyen'}],attributes:[{code:'material',title:'Matière',required:false,selection_limit:1,options:[{id:8,title:'Coton'}]}]}
const fields=patch=>listingFields({account_id:account,sku:'sku-test',price:'24,90',size_text:'M',...patch})
const draft=(patch={})=>({id:crypto.randomUUID(),owner_id:owner,state:'draft',version:1,fields:fields(),photos:[photo],uploaded:0,ai_count:0,lease:null,lease_until:null,inflight:null,dotb_item_id:null,vinted_id:null,planned_at:null,created_at:new Date().toISOString(),updated_at:new Date().toISOString(),...patch})

// Small in-memory stand-in for the Supabase client: enough filters for these queries, nothing remote.
function database({drafts=[],settings=[],titles={own:[],others:[]}}={}){
 const tables={listing_drafts:drafts.map(r=>structuredClone(r)),listing_settings:settings.map(r=>structuredClone(r)),adspower_preferences:[{owner_id:owner,version:1,profiles:[{id:'profile-a',number:'78',name:'compte-test'}]}],publication_profile_links:[{owner_id:owner,profile_id:'profile-a',account_id:account}]}
 const value=(row,key)=>key.startsWith('fields->>')?row.fields?.[key.slice(9)]??null:row[key]
 return {tables,rpcCalls:[],
  rpc(name,args){this.rpcCalls.push([name,args]);if(name==='reserve_listing_slot'){const r=tables.listing_drafts.find(r=>r.id===args.p_id&&r.owner_id===args.p_owner&&r.version===args.p_version&&r.state==='draft');if(!r)return Promise.resolve({data:[],error:null});const last=Math.max(0,...tables.listing_drafts.filter(x=>x.fields.account_id===r.fields.account_id&&x.planned_at&&['preparing','scheduled','published'].includes(x.state)).map(x=>Date.parse(x.planned_at)));Object.assign(r,{state:'preparing',payload:args.p_payload,planned_at:new Date(Math.max(Date.now(),last+args.p_spacing*60000)).toISOString(),version:r.version+1});return Promise.resolve({data:[structuredClone(r)],error:null})}return Promise.resolve(name==='listing_title_examples'?{data:titles,error:null}:{data:null,error:{message:'unknown'}})},
  from(table){
   const rows=tables[table]||[];let tests=[],patch=null,insert=null,remove=false,single=false,sort=null,limit=Infinity,start=0
   const run=()=>{
    if(insert){if(rows.some(r=>(r.id??r.scope)===(insert.id??insert.scope)))return {data:null,error:{code:'23505'}};const created=table==='listing_drafts'?draft({...insert}):{...insert};rows.push(created);return {data:structuredClone(created),error:null}}
    let data=rows.filter(r=>tests.every(t=>t(r)))
    if(remove){for(const r of data)rows.splice(rows.indexOf(r),1);return {data:single?data[0]||null:data,error:null}}
    if(patch)data.forEach(r=>Object.assign(r,structuredClone(patch)))
    if(sort)data=[...data].sort((a,b)=>String(value(a,sort.key)).localeCompare(String(value(b,sort.key)))*(sort.ascending===false?-1:1))
    const count=data.length;data=data.slice(start,start+limit)
    return {data:structuredClone(single?data[0]||null:data),count,error:null}
   }
   const q={select(){return q},or(filter){const cutoff=Date.parse(filter.match(/published_at.gt.([^,]+)/)[1]);tests.push(r=>r.state!=='published'||Date.parse(r.published_at||r.updated_at)>cutoff);return q},eq(k,v){tests.push(r=>value(r,k)===v);return q},neq(k,v){tests.push(r=>value(r,k)!==v);return q},in(k,v){tests.push(r=>v.includes(value(r,k)));return q},not(k,op,v){tests.push(r=>op==='is'&&v===null?value(r,k)!=null:true);return q},
    order(key,o={}){sort??={key,ascending:o.ascending};return q},limit(n){limit=n;return q},range(a,b){start=a;limit=b-a+1;return q},insert(p){insert=p;return q},update(p){patch=p;return q},delete(){remove=true;return q},
    maybeSingle(){single=true;return Promise.resolve(run())},single(){return q.maybeSingle()},then(resolve,reject){return Promise.resolve(run()).then(resolve,reject)}}
   return q
  },
  storage:{from:()=>({info:async()=>({data:{contentType:'image/png',size:10}}),download:async()=>({data:new Blob(['x'],{type:'image/png'})}),createSignedUrls:async paths=>({data:paths.map(path=>({path,signedUrl:`https://example.test/${path}`}))})})}}
}
function dotb(){
 const calls=[],item={id:remoteId,vinted_account_id:account,status:'pending',photos:[],vinted_id:null}
 const read=async(path,args={})=>{
  calls.push([path,args.method||'GET',args.body])
  if(path==='accounts')return {data:[{id:account,login:'compte-test',country:'FR',bridge:{connected:true}}]}
  if(path.startsWith('catalogs/'))return options
  if(path.startsWith('catalogs?'))return {data:[{id:1,title:'Femmes'},{id:10,parent_id:1,title:'Bodies'}]}
  if(path.startsWith('colors'))return {data:[{id:1,title:'Noir'}]}
  if(path===`items/${remoteId}/schedule`)return {item_id:remoteId,vinted_account_id:account,status:'scheduled',publish:args.body.publish,scheduled_at:args.body.scheduled_at}
  throw Error(`unexpected ${path}`)
 }
 return {read,calls,item}
}
const handle=(db,req,opts={})=>handleListingStudio({query:{},body:null,...req},{db,user:{id:owner}},{read:opts.read||dotb().read,allowDotb:opts.allowDotb??true,generate:opts.generate,...(opts.soldCatalogs?{soldCatalogs:opts.soldCatalogs}:{})})

test('presets are validated, account presets only apply when chosen, and broken values fall back to defaults',()=>{
 assert.deepEqual(cleanListingSettings({}),DEFAULT_LISTING_SETTINGS)
 assert.equal(DEFAULT_LISTING_SETTINGS.condition,'Très bon état')
 for(const bad of [{condition:'Comme neuf'},{package:'Énorme'},{title_rules:'x'.repeat(601)},{no_brand:'oui'},{ai_model:'autre-modele'}])assert.throws(()=>cleanListingSettings(bad))
 assert.throws(()=>cleanListingSettings({spacing_minutes:-1},{account:true}),/écart/)
 assert.throws(()=>cleanListingSettings({spacing_minutes:1.5},{account:true}),/écart/)
 // Without « custom », only the Dotb choice is kept for the account.
 assert.deepEqual(cleanListingSettings({dotb:true,condition:'Bon état'},{account:true}),{dotb:true,spacing_minutes:30,custom:false})
 const global={...DEFAULT_LISTING_SETTINGS,description_footer:'Envoi soigné'}
 assert.equal(effectiveListingSettings(global,{dotb:true}).description_footer,'Envoi soigné')
 const own=effectiveListingSettings(global,{custom:true,condition:'Bon état',description_footer:'Signé Lilou',dotb:false,spacing_minutes:15})
 assert.equal(own.condition,'Bon état');assert.equal(own.description_footer,'Signé Lilou');assert.equal(own.spacing_minutes,15);assert.equal(own.ai_model,global.ai_model)
 assert.equal(effectiveListingSettings({condition:42},{dotb:'yes'}).condition,'Très bon état')
 assert.equal(effectiveListingSettings(null,{dotb:'yes'}).dotb,false)
})

test('presets fill the missing choices from the category options and keep a choice that is still valid',()=>{
 const filled=applyListingPresets({...fields(),catalog_id:10},options,DEFAULT_LISTING_SETTINGS)
 assert.equal(filled.brand_id,1);assert.equal(filled.brand_title,'Sans marque')
 assert.equal(filled.status_id,2,'« Très bon état » by name');assert.equal(filled.package_size_id,1);assert.equal(filled.size_id,4)
 const manual=applyListingPresets({...fields(),catalog_id:10,status_id:6,size_id:5,package_size_id:2,brand_id:99,brand_title:'Zara',item_attributes:[{code:'material',ids:[8]},{code:'old',ids:[1]}]},options,DEFAULT_LISTING_SETTINGS)
 assert.deepEqual([manual.status_id,manual.size_id,manual.package_size_id,manual.brand_id],[6,5,2,99])
 assert.deepEqual(manual.item_attributes,[{code:'material',ids:[8]}])
 assert.equal(applyListingPresets({...fields(),catalog_id:10},{...options,parcel_measurements:{}},DEFAULT_LISTING_SETTINGS).package_size_id,null)
 // Options of another category are never used to fill this listing.
 assert.equal(applyListingPresets({...fields(),catalog_id:11},options,DEFAULT_LISTING_SETTINGS).status_id,null)
 assert.equal(applyListingPresets({...fields(),catalog_id:10},options,{...DEFAULT_LISTING_SETTINGS,no_brand:false}).brand_id,null)
})

test('titles follow Vinted limits and the team footer is kept whole',()=>{
 assert.equal(tidyListingTitle('  Robe 🌸 longue #soirée   noire  '),'Robe longue soirée noire')
 const shouting=tidyListingTitle('ROBE LONGUE NOIRE TULLE BUSTIER Y2K taille S')
 assert.equal(shouting,'Robe Longue Noire Tulle Bustier Y2K taille S')
 assert.ok(listingIssues({...fields(),title:shouting},[photo],null).every(i=>i.key!=='title'))
 assert.ok(listingIssues({...fields(),title:'ROBE LONGUE NOIRE'},[photo],null).some(i=>i.key==='title'))
 const long=tidyListingTitle(`Robe ${'longue '.repeat(30)}fin`)
 assert.equal(tidyListingTitle('x'.repeat(150)).length,100)
 assert.ok(long.length<=100&&!long.endsWith(' ')&&long.endsWith('longue'))
 const footer='Envoi sous 48 h, colis soigné.'
 const text=composeListingDescription('x'.repeat(2500),footer)
 assert.equal(text.length,2000);assert.ok(text.endsWith(`\n\n${footer}`))
 assert.equal(composeListingDescription(' Robe noire. ',''),'Robe noire.')
})

test('the writing rules carry the SEO prompt and follow the presets',()=>{
 const rules=listingInstructions(DEFAULT_LISTING_SETTINGS)
 assert.match(rules,/100 caractères maximum/);assert.match(rules,/termine par « taille »/)
 assert.match(rules,/Laissez vous envouter par l allure/);assert.match(rules,/exactement deux paragraphes/);assert.match(rules,/exactement 16 hashtags/)
 assert.match(rules,/Taille : X \| État : Très bon état \| Mesures : sur demande/)
 const plain=listingInstructions({...DEFAULT_LISTING_SETTINGS,size_in_title:false,condition:'Bon état',title_rules:'Toujours écrire femme après le type.'})
 assert.doesNotMatch(plain,/termine par « taille »/);assert.match(plain,/État : Bon état \|/);assert.match(plain,/Toujours écrire femme/)
})

test('the writer sends sold titles as data, uses the chosen model, never the SKU, and appends the footer',async()=>{
 let sent
 const fetcher=async(_url,request)=>{sent=JSON.parse(request.body);return {ok:true,json:async()=>({choices:[{message:{content:JSON.stringify({title:'Body noir effet cuir décolleté V laçage côtés Y2K taille M 🖤',description:'Body noir effet cuir.\n– Décolleté V',catalog_id:10,color_ids:[1],review_notes:''})}}]})}}
 const row=draft()
 const value=await generateListingText(row,['https://example.test/a'],[{id:1,title:'Femmes'},{id:10,parent_id:1,title:'Bodies'}],[{id:1,title:'Noir'}],{fetcher,token:'test-only',settings:{...DEFAULT_LISTING_SETTINGS,ai_model:'gemini-3.5-flash',description_footer:'Merci pour ta visite'},examples:{own:['Robe midi bordeaux bustier taille S'],others:[]}})
 assert.equal(sent.model,'gemini-3.5-flash');assert.equal(sent.reasoning_effort,'low')
 assert.match(sent.messages[1].content[0].text,/Robe midi bordeaux bustier taille S/)
 assert.equal(JSON.stringify(sent).includes('sku-test'),false)
 assert.equal(value.title,'Body noir effet cuir décolleté V laçage côtés Y2K taille M')
 assert.ok(value.description.endsWith('\n\nMerci pour ta visite'))
 await generateListingText(row,[],[],[],{fetcher,token:'test-only',settings:{...DEFAULT_LISTING_SETTINGS,ai_model:'non-autorise'}})
 assert.equal(sent.model,'gemini-3.5-flash-lite');assert.equal(sent.reasoning_effort,'minimal')
})

test('preparing an article applies the presets and the account’s sold titles',async()=>{
 const row=draft(),db=database({drafts:[row],titles:{own:['Combinaison noire effet cuir moulante taille S'],others:[]}})
 let received
 const generate=async(_row,_urls,_c,_col,args)=>{received=args;return {title:'Body noir effet cuir décolleté taille M',description:'Body noir.',catalog_id:10,color_ids:[1],review_notes:'Matière à vérifier.'}}
 const {draft:result}=await handle(db,{method:'POST',body:{action:'generate',id:row.id,version:1}},{generate})
 assert.deepEqual(received.examples.own,['Combinaison noire effet cuir moulante taille S'])
 assert.equal(received.settings.condition,'Très bon état')
 assert.deepEqual([result.fields.status_id,result.fields.package_size_id,result.fields.size_id,result.fields.brand_id],[2,1,4,1])
 assert.equal(result.message,'Matière à vérifier.')
 assert.deepEqual(listingIssues(result.fields,result.photos,options),[])
})

test('Dotb publishes only for accounts whose switch is on, and only when the server allows it',async()=>{
 const row=draft({fields:fields({title:'Body noir effet cuir taille M',description:'Body noir effet cuir.',catalog_id:10,brand_id:1,brand_title:'Sans marque',size_id:4,status_id:2,package_size_id:1,color_ids:[1]})})
 const off=database({drafts:[row]}),s=dotb()
 await assert.rejects(handle(off,{method:'POST',body:{action:'publish',id:row.id,version:1,confirmation_account_id:account}},{read:s.read}),e=>e.status===409&&e.message===accountManualMessage)
 assert.equal(s.calls.length,0);assert.equal(off.tables.listing_drafts[0].state,'draft')
 // A listing waiting to be sent when the switch is turned off returns to an editable draft.
 const waiting=database({drafts:[draft({state:'preparing',payload:{}})]})
 const {draft:back}=await handle(waiting,{method:'POST',body:{action:'step',id:waiting.tables.listing_drafts[0].id}},{read:s.read})
 assert.equal(back.state,'draft');assert.equal(back.message,manualRestoredMessage);assert.equal(s.calls.length,0)
 // Switch on: the listing is accepted and gets its planned time.
 const on=database({drafts:[row],settings:[{scope:account,version:0,settings:{dotb:true,spacing_minutes:20},version:1}]})
 const {draft:sent}=await handle(on,{method:'POST',body:{action:'publish',id:row.id,version:1,confirmation_account_id:account}},{read:s.read})
 assert.equal(sent.state,'preparing');assert.ok(Date.parse(sent.planned_at)<=Date.now())
 // Metadata tells the screen which accounts publish through Dotb.
 const read=async path=>path==='accounts'?{data:[{id:account,login:'a',country:'FR',bridge:{connected:true}}],has_more:false}:s.read(path)
 assert.equal((await handle(on,{method:'GET',query:{action:'metadata'}},{read})).accounts[0].dotb,true)
 assert.equal((await handle(on,{method:'GET',query:{action:'metadata'}},{read,allowDotb:false})).accounts[0].dotb,false)
})

test('publications of one account are spaced, and Dotb receives the planned time',async()=>{
 const later=new Date(Date.now()+40*60000).toISOString()
 const db=database({drafts:[draft({state:'scheduled',planned_at:later}),draft({state:'scheduled',planned_at:new Date(Date.now()+10*60000).toISOString()}),draft({state:'scheduled',planned_at:later,fields:fields({account_id:account2})})]})
 const candidate=draft();db.tables.listing_drafts.push(candidate)
 const reserved=await reserveListingSlot(db,structuredClone(candidate),{},30),slot=reserved.planned_at
 assert.equal(Date.parse(slot),Date.parse(later)+30*60000)
 await assert.rejects(reserveListingSlot(db,{...candidate,version:1},{},30),e=>e.status===409)
 const row=draft({state:'preparing',dotb_item_id:remoteId,uploaded:1,planned_at:slot})
 const run=database({drafts:[row]}),s=dotb()
 const read=async(path,args)=>path===`items/${remoteId}`?{...s.item,photos:[{}]}:s.read(path,args)
 const result=await listingStep(run,run.tables.listing_drafts[0],{read,allowDotb:true})
 assert.equal(result.state,'scheduled');assert.equal(Date.parse(result.scheduled_at),Date.parse(slot))
 assert.equal(s.calls.find(([p])=>p.endsWith('/schedule'))[2].scheduled_at,new Date(slot).toISOString())
 assert.match(result.message,/planifiée/)
})

test('a session lists my articles of one account, with this account’s presets',async()=>{
 const old=new Date(Date.now()-3*86400000).toISOString()
 const mine=draft(),done=draft({state:'published',vinted_id:'123',published_at:new Date().toISOString()}),stale=draft({state:'published',vinted_id:'124',published_at:old})
 const many=Array.from({length:155},()=>draft({state:'published',published_at:old}));mine.created_at=old
 const db=database({drafts:[...many,mine,done,stale,draft({fields:fields({account_id:account2})}),draft({owner_id:other})],settings:[{scope:'default',version:0,settings:{...DEFAULT_LISTING_SETTINGS,description_footer:'Bisous'},version:3},{scope:account,version:0,settings:{dotb:true,spacing_minutes:45},version:1}]})
 const result=await handle(db,{method:'GET',query:{action:'session',account_id:account.toUpperCase()}})
 assert.deepEqual(result.drafts.map(d=>d.id).sort(),[mine.id,done.id].sort())
 assert.equal(result.settings.effective.description_footer,'Bisous');assert.equal(result.settings.effective.spacing_minutes,45)
 assert.equal(result.dotb,true)
 assert.equal((await handle(db,{method:'GET',query:{action:'session',account_id:account}},{allowDotb:false})).dotb,false)
 await assert.rejects(handle(db,{method:'GET',query:{action:'session',account_id:'pas-un-compte'}}),/Compte invalide/)
})

test('settings are saved for everyone or one account, validated and protected against overwrites',async()=>{
 const db=database()
 const shared=await handle(db,{method:'POST',body:{action:'settings',scope:'default',version:0,settings:{...DEFAULT_LISTING_SETTINGS,description_footer:'Merci !'}}})
 assert.equal(shared.effective.description_footer,'Merci !');assert.equal(db.tables.listing_settings[0].updated_by,owner)
 await assert.rejects(handle(db,{method:'POST',body:{action:'settings',scope:'default',version:7,settings:{}}}),e=>e.status===409)
 await assert.rejects(handle(db,{method:'POST',body:{action:'settings',scope:'n’importe quoi',settings:{}}}),/compte/)
 await assert.rejects(handle(db,{method:'POST',body:{action:'settings',scope:account,version:0,settings:{dotb:true,spacing_minutes:9999}}}),/écart/)
 const own=await handle(db,{method:'POST',body:{action:'settings',scope:account,version:0,settings:{dotb:true,spacing_minutes:10,custom:true,...DEFAULT_LISTING_SETTINGS,condition:'Bon état',ai_model:undefined}}})
 assert.equal(own.effective.condition,'Bon état');assert.equal(own.effective.dotb,true);assert.equal(own.effective.description_footer,'')
 await assert.rejects(saveListingSettings(db,{id:owner},{scope:'default',settings:{}}),e=>e.status===409)
 await assert.rejects(saveListingSettings(db,{id:owner},{scope:'default',version:0,settings:{}}),e=>e.status===409)
 assert.equal((await readListingSettings(db,account)).global.version,1)
 await saveListingSettings(db,{id:owner},{scope:'default',version:1,settings:{condition:'Neuf avec étiquette'}})
 assert.equal((await readListingSettings(db,account2)).effective.condition,'Neuf avec étiquette')
})

test('only an article never sent can be removed from the session',async()=>{
 const free=draft(),sent=draft({dotb_item_id:remoteId}),db=database({drafts:[free,sent]})
 assert.deepEqual(await handle(db,{method:'POST',body:{action:'discard',id:free.id,version:1}}),{removed:free.id})
 assert.equal(db.tables.listing_drafts.some(r=>r.id===free.id),false)
 await assert.rejects(handle(db,{method:'POST',body:{action:'discard',id:sent.id,version:1}}),/transmise/)
 await assert.rejects(handle(db,{method:'POST',body:{action:'discard',id:sent.id,version:4}}),/changé/)
 assert.equal(db.tables.listing_drafts.length,1)
})

test('title examples never break the preparation when the history cannot be read',async()=>{
 const db=database({titles:{own:['Robe longue noire tulle taille S',42,'x'.repeat(120)],others:'invalide'}})
 assert.deepEqual(await listingTitleExamples(db,account),{own:['Robe longue noire tulle taille S'],others:[]})
 assert.deepEqual(await listingTitleExamples({rpc:()=>Promise.reject(Error('offline'))},account),{own:[],others:[]})
})

test('before the migration, settings fall back to the defaults and Dotb stays off',async()=>{
 const missing={from:()=>{const q={select:()=>q,in:()=>q,neq:()=>q,then:(resolve,reject)=>Promise.resolve({data:null,error:{code:'PGRST205'}}).then(resolve,reject)};return q}}
 const value=await readListingSettings(missing,account)
 assert.equal(value.effective.condition,'Très bon état');assert.equal(value.effective.dotb,false)
 const broken={from:()=>{const q={select:()=>q,in:()=>q,then:(resolve,reject)=>Promise.resolve({data:null,error:{code:'57014',message:'timeout'}}).then(resolve,reject)};return q}}
 await assert.rejects(readListingSettings(broken,account),e=>e.code==='57014','other database errors are not hidden')
})

test('Dotb can create a Vinted draft instead of publishing, then the link is noted once it is online',async()=>{
 const ready=fields({title:'Body noir effet cuir taille M',description:'Body noir effet cuir.',catalog_id:10,brand_id:1,brand_title:'Sans marque',size_id:4,status_id:2,package_size_id:1,color_ids:[1]})
 const row=draft({fields:ready}),s=dotb()
 const db=database({drafts:[row],settings:[{scope:account,settings:{dotb:true,spacing_minutes:0},version:1}]})
 db.rpc=function(name,args){
  // Same behaviour as reserve_listing_slot: version-checked switch to « preparing ».
  if(name!=='reserve_listing_slot')return Promise.resolve({data:null,error:null})
  const target=db.tables.listing_drafts.find(r=>r.id===args.p_id&&r.version===args.p_version&&r.state==='draft')
  if(!target)return Promise.resolve({data:[],error:null})
  Object.assign(target,{state:'preparing',payload:args.p_payload,planned_at:new Date().toISOString(),version:target.version+1})
  return Promise.resolve({data:[structuredClone(target)],error:null})
 }
 await assert.rejects(handle(db,{method:'POST',body:{action:'publish',id:row.id,version:1,confirmation_account_id:account,mode:'autre'}},{read:s.read}),/brouillon Vinted/)
 const {draft:sent}=await handle(db,{method:'POST',body:{action:'publish',id:row.id,version:1,confirmation_account_id:account,mode:'draft'}},{read:s.read})
 assert.equal(sent.state,'preparing');assert.equal(sent.dotb_publish,false)
 // The schedule asks Dotb for a Vinted draft (publish:false), not a live listing.
 const stored=db.tables.listing_drafts[0]
 Object.assign(stored,{dotb_item_id:remoteId,uploaded:1})
 const read=async(path,args)=>path===`items/${remoteId}`?{...s.item,photos:[{}]}:s.read(path,args)
 const scheduled=await listingStep(db,structuredClone(stored),{read,allowDotb:true})
 assert.equal(s.calls.find(([p])=>p.endsWith('/schedule'))[2].publish,false)
 assert.equal(scheduled.state,'scheduled');assert.match(scheduled.message,/Brouillon/)
 // Done as a draft: never counted as published.
 const job={item_id:remoteId,vinted_account_id:account,publish:false,status:'done',vinted_id:555}
 assert.equal(scheduleResult(job,{...scheduled,dotb_item_id:remoteId}).state,'vinted_draft')
 assert.equal(scheduleResult({...job,publish:true},{...scheduled,dotb_item_id:remoteId}),null,'a live job does not match a draft request')
 assert.equal(scheduleResult({...job,publish:true},{...scheduled,dotb_item_id:remoteId,dotb_publish:true}).state,'published')
 // A lost schedule reply is reconciled using the matching mode, never resubmitted.
 Object.assign(db.tables.listing_drafts[0],{state:'preparing',inflight:'schedule'})
 let scheduledWrites=0
 const recovered=await listingStep(db,structuredClone(db.tables.listing_drafts[0]),{allowDotb:true,read:async(path,args)=>{
  if(args?.method==='POST'){scheduledWrites++;throw Error('No second schedule expected')}
  assert.ok(path.startsWith('scheduled-publishes?'))
  return {data:[{...job,publish:true},job],has_more:false}
 }})
 assert.equal(recovered.state,'vinted_draft');assert.equal(recovered.vinted_id,'555');assert.equal(scheduledWrites,0)
 db.tables.publication_accounts=[{id:account}];db.tables.publication_items=[]
 const version=db.tables.listing_drafts[0].version
 await assert.rejects(handle(db,{method:'POST',body:{action:'mark_published',id:row.id,version,url:'https://www.vinted.fr/items/777-autre'}}),/ne correspond pas/)
 const {draft:online}=await handle(db,{method:'POST',body:{action:'mark_published',id:row.id,version,url:'https://www.vinted.fr/items/555-body'}})
 assert.equal(online.state,'published');assert.equal(online.url,'https://www.vinted.fr/items/555')
 const {draft:retried}=await handle(db,{method:'POST',body:{action:'mark_published',id:row.id,version,url:'https://www.vinted.fr/items/555-body'}})
 assert.equal(retried.version,online.version);assert.equal(retried.published_at,online.published_at)
})

test('writing is faster: only the shop’s universes, a compact list and 3 photos are sent',async()=>{
 const catalogs=[{id:1,title:'Femmes'},{id:2,parent_id:1,title:'Vêtements'},{id:10,parent_id:2,title:'Robes'},{id:5,title:'Hommes'},{id:6,parent_id:5,title:'Pulls'},{id:7,title:'Maison'},{id:8,parent_id:7,title:'Bougies'}]
 assert.deepEqual([...catalogRoots(catalogs,[10,10,'6',999])].sort(),[1,5])
 let sent
 const fetcher=async(_url,request)=>{sent=JSON.parse(request.body);return {ok:true,json:async()=>({choices:[{message:{content:JSON.stringify({title:'Robe longue noire tulle taille M',description:'Robe longue noire.',catalog_id:8,color_ids:[],review_notes:''})}}]})}}
 const urls=['https://example.test/1','https://example.test/2','https://example.test/3','https://example.test/4']
 const value=await generateListingText(draft(),urls,catalogs,[],{fetcher,token:'test-only',roots:new Set([1])})
 const data=JSON.parse(sent.messages[1].content[0].text)
 assert.deepEqual(data.categories,['10 Femmes › Vêtements › Robes'],'only the Femmes branch, one short line per category')
 assert.equal(sent.messages[1].content.filter(p=>p.type==='image_url').length,3)
 assert.equal(value.catalog_id,null,'a category outside the list is refused')
 await generateListingText(draft(),urls,catalogs,[],{fetcher,token:'test-only',roots:new Set([42])})
 assert.equal(JSON.parse(sent.messages[1].content[0].text).categories.length,3,'unknown universes fall back to the full list')
})

test('the AI needs only the photos and the size; sold categories are read in parallel and cached',async()=>{
 const row=draft({fields:fields({sku:'',price:''})}),db=database({drafts:[row]})
 let received
 const generate=async(_row,urls,_c,_col,args)=>{received={urls,...args};return {title:'Body noir effet cuir décolleté taille M',description:'Body noir.',catalog_id:10,color_ids:[1],review_notes:''}}
 const {draft:result}=await handle(db,{method:'POST',body:{action:'generate',id:row.id,version:1}},{generate,soldCatalogs:async()=>[10]})
 assert.equal(result.fields.title,'Body noir effet cuir décolleté taille M','written without SKU or price')
 assert.deepEqual([...received.roots],[1]);assert.equal(received.urls.length,1)
 const empty=database({drafts:[draft({fields:fields({size_text:''})})]})
 await assert.rejects(handle(empty,{method:'POST',body:{action:'generate',id:empty.tables.listing_drafts[0].id,version:1}},{generate}),/la taille/)
 let reads=0
 const shop={from:()=>{reads++;const q={select:()=>q,not:()=>q,order:()=>q,limit:()=>Promise.resolve({data:[{catalog_id:'10'},{catalog_id:'10'},{catalog_id:'x'}],error:null})};return q}}
 const later=Date.now()+86400000
 assert.deepEqual(await soldCatalogIds(shop,later),[10]);assert.deepEqual(await soldCatalogIds(shop,later+60000),[10]);assert.equal(reads,1,'cached for 10 minutes')
})

test('choosing an account shows each account’s background, today’s count, articles in progress and accounts to avoid',async()=>{
 const bg='88888888-8888-4888-8888-888888888888',archived='99999999-9999-4999-8999-999999999990'
 const tables={
  creative_accounts:[{id:account,background_id:bg},{id:account2,background_id:archived}],
  creative_resources:[{id:bg,title:'Chambre claire',image_bucket:'creative-assets',image_path:'owner/bg.png',archived_at:null},{id:archived,title:'Ancien',image_bucket:'creative-assets',image_path:'owner/old.png',archived_at:'2026-01-01'}],
  listing_drafts:[{id:'d1',owner_id:owner,state:'draft',fields:{account_id:account}},{id:'d2',owner_id:owner,state:'scheduled',fields:{account_id:account}},{id:'d3',owner_id:owner,state:'published',fields:{account_id:account}},{id:'d4',owner_id:other,state:'draft',fields:{account_id:account}}]
 }
 const db={from(table){const tests=[];let lo=0,hi=Infinity;const run=()=>{const rows=(tables[table]||[]).filter(r=>tests.every(t=>t(r)));return {data:rows.slice(lo,hi+1),count:rows.length,error:null}};const q={select:()=>q,order:()=>q,eq(k,v){tests.push(r=>r[k]===v);return q},neq(k,v){tests.push(r=>r[k]!==v);return q},in(k,v){tests.push(r=>v.includes(r[k]));return q},range(a,b){lo=a;hi=b;return q},then:(res,rej)=>Promise.resolve(run()).then(res,rej)};return q},
  rpc:async(name)=>name==='team_board_counts'?{data:{stats:[{account_id:account,today:2,week:5,last_at:'2026-11-05T08:00:00Z'}]},error:null}:{data:null,error:{message:'unknown'}},
  storage:{from:()=>({createSignedUrls:async paths=>({data:paths.map(path=>({path,signedUrl:`https://example.test/${path}`})),error:null})})}}
 const health=async()=>({accounts:[{id:account2,health:{status:'restricted',label:'Compte restreint',attention:true}},{id:account,health:{status:'ok',label:'Accès confirmé',attention:false}}]})
 const {accounts}=await readListingPicker(db,{id:owner},{health,now:new Date('2026-11-05T10:00:00Z')})
 assert.equal(accounts[account].background.title,'Chambre claire')
 assert.match(accounts[account].background.url,/^https:\/\/example\.test\//)
 assert.deepEqual([accounts[account].today,accounts[account].week,accounts[account].in_progress],[2,5,2],'my drafts not yet published, never someone else’s')
 assert.equal(accounts[account2].background,null,'an archived background is not shown')
 assert.equal(accounts[account2].health.attention,true)
 const broken=await readListingPicker(db,{id:owner},{health:async()=>{throw Error('offline')}})
 assert.equal(broken.accounts[account].health,null,'health is optional');assert.equal(broken.accounts[account].today,2)
 assert.equal(broken.health_unavailable,true,'an unavailable restriction reading is explicitly reported')
})

test('every dress is filed under « Robes de bal » when voluminous and « Robes de soirée » otherwise',async()=>{
 const catalogs=[{id:1,title:'Femmes'},{id:2,parent_id:1,title:'Vêtements'},{id:3,parent_id:2,title:'Robes'},{id:30,parent_id:3,title:'Robes longues'},{id:31,parent_id:3,title:'Robes de soirée'},{id:32,parent_id:3,title:'Robes de bal'},{id:33,parent_id:3,title:'Robes de mariée'},{id:50,title:'Hommes'},{id:51,parent_id:50,title:'Robes de soirée'}]
 assert.equal(dressCatalogId(catalogs,{ball:true,hint:30}),32)
 assert.equal(dressCatalogId(catalogs,{ball:false,hint:30}),31)
 assert.equal(dressCatalogId(catalogs,{ball:false,roots:new Set([50])}),51,'the universe of the shop is respected')
 assert.equal(dressCatalogId(catalogs.filter(c=>c.id!==32),{ball:true,hint:30}),31,'without a ball category, evening dresses')
 assert.equal(dressCatalogId(catalogs.filter(c=>![31,32,51].includes(c.id)),{ball:true,hint:30}),null,'nothing to choose: the AI choice is kept')
 const answer=extra=>async()=>({ok:true,json:async()=>({choices:[{message:{content:JSON.stringify({title:'Robe longue noire tulle bustier taille M',description:'Laissez vous envouter par l allure de cette robe.',catalog_id:30,color_ids:[],review_notes:'',...extra})}}]})})
 const run=extra=>generateListingText(draft(),['https://example.test/a'],catalogs,[],{fetcher:answer(extra),token:'test-only',roots:new Set([1])})
 assert.equal((await run({is_dress:true,is_ball_gown:true})).catalog_id,32)
 assert.equal((await run({is_dress:true,is_ball_gown:false})).catalog_id,31)
 assert.equal((await run({is_dress:false,is_ball_gown:true})).catalog_id,30,'not a dress: the AI choice stays')
 assert.equal((await run({})).catalog_id,30,'an answer without the new fields keeps the AI choice')
 assert.match(listingInstructions(DEFAULT_LISTING_SETTINGS),/Robes de bal[\s\S]*Robes de soirée/)
})
