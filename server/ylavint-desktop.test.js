import test from 'node:test'
import assert from 'node:assert/strict'
import {authorizeDesktop,pairDesktop,desktopDriver} from './ylavint-desktop.js'
import {newWatchToken} from './vinted-watch.js'
import {copiedSettings} from './ylavint-settings-copy.js'
const account={id:'00000000-0000-4000-8000-000000000001',vinted_id:'123',login:'test'}
function db(){const inserted=[];return {inserted,from(table){const q={select:()=>q,eq:()=>q,maybeSingle:async()=>({data:table==='publication_accounts'?account:{messaging:{executor:'desktop'}}}),insert:async row=>{inserted.push(row);return {error:null}}};return q}}}
test('a native key is bound to the exact account and profile and cannot self-configure',async()=>{
 const d=db(),key={desktop_account_id:account.id,desktop_profile_id:'abc'},body={action:'agent_poll',profile_id:'abc',member_id:'123'}
 await authorizeDesktop(d,key,body)
 for(const patch of [{member_id:'999'},{profile_id:'other'},{action:'agent_self'},{action:'agent_learn'}])await assert.rejects(authorizeDesktop(d,key,{...body,...patch}))
 assert.equal(desktopDriver({}),'extension','a caller cannot request desktop authority using its request body')
})
test('pairing returns only a scoped token and stores its hash',async()=>{
 const d=db(),r=await pairDesktop(d,{id:'admin'},{account_id:account.id,profile_id:'abc'},newWatchToken)
 assert.equal(r.member_id,'123');assert.equal(d.inserted[0].desktop_account_id,account.id);assert.equal(d.inserted[0].desktop_profile_id,'abc')
 assert.ok(!JSON.stringify(d.inserted).includes(r.token))
})
test('copying messages and discounts never switches another account executor',()=>{
 assert.equal(copiedSettings({messaging:{executor:'desktop'}},{messaging:{executor:'extension'}},'all').messaging.executor,'extension')
})
