import test from 'node:test'
import assert from 'node:assert/strict'
import {accountGroup,isAccountDue,selectAccounts} from '../src/lib/accountOverview.js'

test('blocked status overrides readiness and legacy accounts remain accessible',()=>{
  assert.equal(accountGroup({statut:'suspendu',creation_stage:'ready',is_ready:true}),'blocked')
  assert.equal(accountGroup({is_ready:true}),'ready')
  assert.equal(accountGroup({proxy_id:'p'}),'waiting')
  assert.equal(accountGroup({}),'prepare')
  assert.equal(isAccountDue({statut:'banni_temp',creation_stage:'post1',creation_next_at:'2020-01-01'}),false)
})
test('search ignores accents and combines proxy and state filters',()=>{
  const accounts=[{id:'1',pseudo:'Été',proxy_id:'p',creation_stage:'ready',ads_power_num:12},{id:'2',pseudo:'Autre',telephone:'0612345678'}]
  const proxies=[{id:'p',nom:'Paris',adresse:'proxy.example'}]
  assert.deepEqual(selectAccounts(accounts,proxies,{search:'ete',view:'ready',proxy:'assigned'}).map(a=>a.id),['1'])
  for(const search of ['Paris','proxy.example','12'])assert.ok(selectAccounts(accounts,proxies,{search}).some(a=>a.id==='1'))
  assert.equal(selectAccounts(accounts,proxies,{search:'0612345678'})[0].id,'2')
  assert.equal(selectAccounts(accounts,proxies,{search:'ete',proxy:'none'}).length,0)
})
test('overdue work appears first and AdsPower sorting is numeric',()=>{
  const accounts=[{id:'a',ads_power_num:12,creation_stage:'ready'},{id:'b',ads_power_num:2,creation_stage:'post2',creation_next_at:'2020-01-01'},{id:'c',creation_stage:'post1'}]
  assert.deepEqual(selectAccounts(accounts,[]).map(a=>a.id),['b','c','a'])
  assert.deepEqual(selectAccounts(accounts,[],{sort:'adspower'}).map(a=>a.id),['b','a','c'])
  assert.deepEqual(selectAccounts(accounts,[],{dueOnly:true}).map(a=>a.id),['b'])
})
