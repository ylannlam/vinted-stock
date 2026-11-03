import test from 'node:test'
import assert from 'node:assert/strict'
import {normalizeLiveItems,normalizePublicationAccounts,handlePublications,readPublicationSource} from './publications.js'
import {parisDay,validDay,publicationAccount} from '../src/lib/publications.js'
import {adsPowerHandler} from '../api/adspower.js'
const account='00000000-0000-4000-8000-000000000077'
const item={id:123,title:'Robe',status:'active',created_at:'2026-11-03T10:09:46Z',photo_url:'https://images1.vinted.net/a.jpg',price:'42.50',currency:'EUR'}
const body=(data=[item])=>({page:1,total_pages:1,data})
test('publication import supports unsaved items, separates drafts and missing or implausible dates',()=>{
  const result=normalizeLiveItems(body([item,{...item,id:124,status:'draft',created_at:null},{...item,id:125,status:'sold',created_at:'2099-01-01'}]),1)
  assert.equal(result.items[0].published,true);assert.equal(result.items[1].published,false)
  assert.equal(result.items[1].estimated_at,null);assert.equal(result.items[2].estimated_at,null)
  assert.equal(result.items[2].published,true);assert.equal(result.items[0].url,'https://www.vinted.fr/items/123')
})
test('invalid and incomplete pages never advance a scan',()=>{
  for(const value of [{...body(),page:2},{...body(),total_pages:null},body([item,item]),body([{...item,id:Number.MAX_SAFE_INTEGER+1}]),body([{...item,status:'unexpected'}]),{...body([]),total_pages:2}])assert.throws(()=>normalizeLiveItems(value,1))
  assert.deepEqual(normalizeLiveItems({page:1,total_pages:0,data:[]},1),{total_pages:0,items:[]})
})
test('unsafe photo URLs are discarded; sensitive and irrelevant source fields are not retained',()=>{
  const result=normalizeLiveItems(body([{...item,photo_url:'javascript:alert(1)',buyer:{email:'private'},photos:['unneeded']}]),1).items[0]
  assert.equal(result.photo_url,null);assert.equal('buyer' in result,false);assert.equal('photos' in result,false)
})
test('day counts use Paris midnight including daylight-saving changes',()=>{
  assert.equal(parisDay('2026-11-02T23:30:00Z'),'2026-11-03')
  assert.equal(parisDay('2026-07-02T22:30:00Z'),'2026-07-03')
  assert.equal(parisDay('2026-10-25T00:30:00Z'),'2026-10-25')
  assert.equal(validDay('2026-02-30'),false);assert.equal(validDay('2026-11-03'),true)
})
test('account association is exact and ambiguity requires an explicit link',()=>{
  const a=[{id:'a',login:'Romanec471',source_present:true},{id:'b',login:'Romanec471',source_present:true}]
  const p={id:'profile77',name:'romanec471'}
  assert.equal(publicationAccount(p,a),null);assert.equal(publicationAccount(p,[a[0]]).id,'a')
  assert.equal(publicationAccount(p,a,[{profile_id:'profile77',account_id:'b'}]).id,'b')
  assert.equal(publicationAccount({...p,name:'77 romanec471'},[a[0]]),null)
})
test('only bridge connectivity is taken from account metadata; incomplete directories are rejected',()=>{
  assert.deepEqual(normalizePublicationAccounts({data:[{id:account,login:'romane',bridge:{connected:true},secret:'ignored'}]})[0],{id:account,login:'romane',vinted_id:null,bridge_connected:true})
  assert.throws(()=>normalizePublicationAccounts({data:[],has_more:true}))
})
test('every publications route requires administrator authorization before reading or changing data',async()=>{
  for(const method of ['GET','POST']){
    let calls=0,roles
    const handler=adsPowerHandler(async(req,res,wanted)=>{roles=wanted;return null},()=>'',async()=>{calls++})
    await handler({method,query:{action:method==='GET'?'publications':'publication-sync'}},{setHeader(){}})
    assert.deepEqual(roles,['admin']);assert.equal(calls,0)
  }
})
test('failed source reads retain the cursor and do not save or delete items',async()=>{
  const calls=[]
  const db={rpc:async(name,args)=>{calls.push({name,args});return {data:name==='publication_claim_scan'?{page:2}:true}}}
  await assert.rejects(()=>handlePublications({method:'POST',body:{action:'publication-sync',account_id:account}},{db,user:{id:account}},{read:async()=>{throw Error('offline')}}))
  assert.deepEqual(calls.map(c=>c.name),['publication_claim_scan','publication_fail_scan'])
})
test('successful reads save only the claimed page and never modify Vinted',async()=>{
  const calls=[],paths=[]
  const db={rpc:async(name,args)=>{calls.push({name,args});return {data:name==='publication_claim_scan'?{page:1}:true}}}
  const r=await handlePublications({method:'POST',body:{action:'publication-sync',account_id:account}},{db,user:{id:account}},{read:async path=>{paths.push(path);return body()}})
  assert.equal(r.complete,true);assert.equal(calls[1].name,'publication_save_page');assert.match(paths[0],/live-items\?page=1&per_page=100$/)
})
test('Dotb access is read-only, does not follow redirects and respects retry delays',async()=>{
  let options
  await assert.rejects(()=>readPublicationSource('accounts',{token:'test',fetcher:async(url,o)=>{options=o;return {ok:false,status:429,headers:{get:()=>120}}}}),e=>e.status===429&&e.retrySeconds===120)
  assert.equal(options.redirect,'error');assert.equal(options.method,undefined)
})
test('failed directory saves release the lease and report a publication error without exposing database details',async()=>{
  const calls=[],logs=[]
  const db={rpc:async name=>{calls.push(name);return name==='publication_save_directory'?{error:{code:'21000',message:'UPDATE requires a WHERE clause',details:'private SQL'}}:{data:true}}}
  const handler=adsPowerHandler(async()=>({db,user:{id:account}}),()=>'',(req,auth)=>handlePublications(req,auth,{read:async()=>({data:[{id:account,login:'romane'}]})}))
  let status,result
  const res={setHeader(){},status(value){status=value;return this},json(value){result=value;return this}}
  const original=console.error;console.error=(...args)=>logs.push(args)
  try{await handler({method:'POST',body:{action:'publication-accounts'}},res)}finally{console.error=original}
  assert.equal(status,500);assert.match(result.error,/suivi des annonces/)
  assert.doesNotMatch(JSON.stringify(result),/UPDATE|private SQL|21000/)
  assert.deepEqual(calls,['publication_claim_directory','publication_save_directory','publication_fail_directory'])
  assert.deepEqual(logs,[['Publication request failed',{code:'21000'}]])
})
