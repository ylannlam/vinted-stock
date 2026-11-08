import test from 'node:test'
import assert from 'node:assert/strict'
import {selectionProfiles,matchSelectedAccounts,handleProfileSelection,selectedListingAccounts} from './adspower-selection.js'
const profile={id:'profile-77',number:'77',name:'Camille',group:'Vinted'}
test('a selected historical account remains available for YlaVint when Dotb no longer returns it',async()=>{
 const tables={adspower_preferences:[{owner_id:'owner',profiles:[profile]}],publication_profile_links:[{owner_id:'owner',profile_id:profile.id,account_id:'old'}],creative_accounts:[{id:'old',login:'ancien',country:'fr'},{id:'unknown',login:'autre',country:'FR'}],publication_accounts:[{id:'old',login:'ancien'}]}
 const db={from(table){let rows=tables[table];const q={select(){return q},eq(k,v){rows=rows.filter(r=>r[k]===v);return q},maybeSingle:async()=>({data:rows[0]||null}),then(ok,no){return Promise.resolve({data:rows}).then(ok,no)}};return q}}
 const result=await selectedListingAccounts(db,'owner',[])
 assert.equal(result.accounts.length,1);assert.equal(result.accounts[0].id,'old');assert.equal(result.accounts[0].country,'FR');assert.equal(result.accounts[0].connected,false);assert.equal(result.accounts[0].dotb_available,false)
 assert.deepEqual((await selectedListingAccounts(db,'other',[])).accounts,[])
 const live=await selectedListingAccounts(db,'owner',[{id:'old',login:'ancien-renommé',country:'BE',connected:true}])
 assert.equal(live.accounts[0].country,'BE');assert.equal(live.accounts[0].connected,true)
})
test('listing accounts use only selected profiles, explicit links or one exact login',()=>{
 const accounts=[{id:'a',login:'camille'},{id:'b',login:'autre'}]
 assert.deepEqual(matchSelectedAccounts([],accounts,[]),[])
 assert.deepEqual(matchSelectedAccounts([profile],accounts,[]).map(a=>a.id),['a'])
 assert.deepEqual(matchSelectedAccounts([profile],accounts,[{profile_id:profile.id,account_id:'b'}]).map(a=>a.id),['b'])
 assert.deepEqual(matchSelectedAccounts([profile],accounts,[{profile_id:profile.id,account_id:'removed'}]),[])
 assert.deepEqual(matchSelectedAccounts([profile],[...accounts,{id:'c',login:'Camille'}],[]),[])
 assert.deepEqual(matchSelectedAccounts([{...profile,name:'Camill'}],accounts,[]),[])
})
test('saved profiles contain no credentials and reject invalid or duplicate entries',()=>{
 assert.deepEqual(selectionProfiles([{...profile,token:'secret',proxy:'secret'}]),[profile])
 assert.throws(()=>selectionProfiles([profile,profile]))
 assert.throws(()=>selectionProfiles([{...profile,id:'../invalid'}]))
 assert.deepEqual(selectionProfiles([]),[])
})
function database(){
 const rows=[]
 return {rows,from(){let filters=[],patch,insert,single=false
  const execute=()=>{let result=rows.filter(r=>filters.every(([k,v])=>r[k]===v));if(insert){if(rows.some(r=>r.owner_id===insert.owner_id))return {error:{code:'23505'}};rows.push(insert);result=[insert]}if(patch)result.forEach(r=>Object.assign(r,patch));return {data:structuredClone(single?result[0]||null:result)}}
  const q={select(){return q},eq(k,v){filters.push([k,v]);return q},update(p){patch=p;return q},insert(p){insert=p;return q},single(){single=true;return Promise.resolve(execute())},maybeSingle(){return q.single()},then(ok,no){return Promise.resolve(execute()).then(ok,no)}};return q
 }}
}
test('selection is owner-scoped; first migration and concurrent edits never overwrite an existing choice',async()=>{
 const db=database(),auth={db,user:{id:'owner'}},call=body=>handleProfileSelection({method:'POST',body},auth)
 const first=await call({version:0,profiles:[profile]});assert.equal(first.selection.version,1)
 assert.equal((await call({version:0,profiles:[]})).selection.profiles.length,1)
 await assert.rejects(call({version:5,profiles:[]}),/autre onglet/)
 const empty=await call({version:1,profiles:[]});assert.deepEqual(empty.selection.profiles,[])
 assert.equal((await handleProfileSelection({method:'GET'},{db,user:{id:'other'}})).selection,null)
 assert.equal(db.rows[0].owner_id,'owner')
})
