import test from 'node:test'
import assert from 'node:assert/strict'
import {legacySelection,readProfileVisibility,displayedProfiles,visibleLaunchIds} from '../src/lib/adspowerVisibility.js'
const profiles=[{id:'78'},{id:'77'},{id:'76'}]
test('visibility fails closed before a choice, preserves an empty choice and tolerates unavailable storage',()=>{
  for(const value of [null,'broken','{}','[42]'])assert.equal(readProfileVisibility({getItem:()=>value},'key'),null)
  assert.equal(readProfileVisibility({getItem(){throw Error('unavailable')}},'key'),null)
  assert.deepEqual(readProfileVisibility({getItem:()=>'[]'},'key'),[])
  const value=readProfileVisibility({getItem:()=>'["77","77"]'},'key')
  assert.deepEqual(displayedProfiles(profiles,value),[{id:'77'}])
  assert.deepEqual(displayedProfiles(profiles,[]),[])
  assert.deepEqual(displayedProfiles(profiles,null),[])
})
test('hidden or removed accounts cannot be launched by a stale selection or an error retry',()=>{
  assert.deepEqual(visibleLaunchIds(profiles,['77'],['78','77','77','deleted']),['77'])
  assert.deepEqual(visibleLaunchIds(profiles,[],['78','77']),[])
  assert.deepEqual(visibleLaunchIds(profiles,null,['78','77']),[])
})

test('old explicit visibility takes precedence, including empty; launch selection is the migration fallback',()=>{
 const store=values=>({getItem:key=>values[key]??null})
 assert.deepEqual(legacySelection(store({'adspower-visible:u':'[]','adspower-selection:u':'["77"]'}),'u'),[])
 assert.deepEqual(legacySelection(store({'adspower-visible:u':'["78"]','adspower-selection:u':'["77"]'}),'u'),['78'])
 assert.deepEqual(legacySelection(store({'adspower-visible:u':'null','adspower-selection:u':'["77"]'}),'u'),['77'])
 assert.deepEqual(legacySelection(store({}),'u'),[])
})
