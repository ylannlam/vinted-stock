import test from 'node:test'
import assert from 'node:assert/strict'
import {normalizeAccounts,readDotbAccounts,selectionValue,directionValue} from './creative-accounts.js'
import {directionPrompts,filterCreativeAccounts} from '../src/lib/creativeAccounts.js'
import handler,{creativeAccountsHandler} from '../api/creative-accounts.js'
const id='11111111-1111-4111-8111-111111111111'
const bg='22222222-2222-4222-8222-222222222222'
const form={id,version:1,background_id:bg,prompt_front:null,prompt_back:'Dos\nspécifique',notes:'Ambiance crème'}
const response=()=>({code:200,setHeader(){},status(code){this.code=code;return this},json(body){this.body=body;return this},end(){return this}})
test('Dotb accounts keep only identity data and never mistake a disconnected bridge for a ban',()=>{
 assert.deepEqual(normalizeAccounts({data:[{id,login:' Boutique ',country:'FR',bridge:{connected:false},email:'private'}]}),[{id,login:'Boutique',country:'FR'}])
 for(const result of [{data:null},{data:[{id,login:'A'},{id,login:'B'}]},{data:[{id:'bad',login:'A'}]},{data:[],has_more:true}])assert.throws(()=>normalizeAccounts(result))
})
test('Dotb fetch requires a token, handles rate limits, and rejects malformed replies without mutating data',async()=>{
 await assert.rejects(readDotbAccounts(()=>{throw Error('must not fetch')},''),/activer/)
 await assert.rejects(readDotbAccounts(async()=>({ok:false,status:429}),'test'),e=>e.status===429)
 await assert.rejects(readDotbAccounts(async()=>({ok:true,json:async()=>({})}),'test'),/incomplète/)
 const accounts=await readDotbAccounts(async(url,options)=>{assert.equal(url,'https://dotb.io/api/public/v1/accounts');assert.equal(options.headers.Authorization,'Bearer test');assert.equal(options.redirect,'error');return {ok:true,json:async()=>({data:[{id,login:'A'}]})}},'test')
 assert.equal(accounts.length,1)
})
test('selection and DA validate IDs, versions and length without coercing text',()=>{
 assert.deepEqual(selectionValue([{id,version:1,enabled:false}]),[{id,version:1,enabled:false}])
 for(const c of [[{id,version:0,enabled:true}],[{id,version:1,enabled:'false'}],[{id,version:1,enabled:true},{id,version:1,enabled:false}]])assert.throws(()=>selectionValue(c))
 assert.equal(directionValue(form).prompt_back,form.prompt_back)
 for(const patch of [{background_id:'bad'},{prompt_front:undefined},{prompt_back:'x'.repeat(50001)},{notes:null},{version:0}])assert.throws(()=>directionValue({...form,...patch}))
})
test('inherited prompts update with the background while personal overrides and explicit empty prompts remain independent',()=>{
 assert.deepEqual(directionPrompts({prompt_front:null,prompt_back:'Dos perso'},{content:'Avant du fond',content_back:'Dos du fond'}),{front:'Avant du fond',back:'Dos perso'})
 assert.deepEqual(directionPrompts({prompt_front:'',prompt_back:null},null),{front:'',back:''})
 const rows=[{id,login:'Été',enabled:true},{id:bg,login:'Banni',enabled:false}]
 assert.equal(filterCreativeAccounts(rows,'ete').length,1)
 assert.equal(filterCreativeAccounts(rows,'banni').length,0)
 assert.equal(filterCreativeAccounts(rows,'banni','aside').length,1)
})
test('API requires authentication for reads, sync, selection and DA saves',async()=>{
 for(const [method,action] of [['GET',null],['POST','sync'],['PATCH','select'],['PATCH','save']]){const res=response();await handler({method,body:{action},headers:{}},res);assert.equal(res.code,401)}
})
test('API sync calls only the atomic metadata RPC and does not change selection or DA',async()=>{
 let called=false
 const db={rpc:async(name,args)=>{assert.equal(name,'sync_creative_accounts');assert.deepEqual(args,{p_accounts:[{id,login:'A',country:null}]});called=true;return {error:null}}}
 const run=creativeAccountsHandler(async(_req,_res,roles)=>{assert.deepEqual(roles,['admin']);return {db}},async()=>[{id,login:'A',country:null}])
 const res=response();await run({method:'POST',body:{action:'sync'}},res);assert.equal(res.code,200);assert.ok(called)
})
test('API preserves form on selection conflict and validates a referenced background',async()=>{
 const db={rpc:async()=>({error:Error('stale_account')}),from:()=>({select(){return this},eq(){return this},maybeSingle:async()=>({data:{id:bg,kind:'prompt'},error:null})})}
 const run=creativeAccountsHandler(async()=>({db}))
 const conflict=response();await run({method:'PATCH',body:{action:'select',changes:[{id,version:1,enabled:true}]}},conflict);assert.equal(conflict.code,409)
 const wrongKind=response();await run({method:'PATCH',body:{...form,action:'save'}},wrongKind);assert.equal(wrongKind.code,400)
})
