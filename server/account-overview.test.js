import test from 'node:test'
import assert from 'node:assert/strict'
import {accountGroup,isAccountDue,selectAccounts} from '../src/lib/accountOverview.js'

test('blocked status overrides readiness and legacy accounts remain accessible',()=>{
  assert.equal(accountGroup({statut:'suspendu',creation_stage:'ready',is_ready:true}),'blocked')
  assert.equal(accountGroup({is_ready:true}),'ready')
  assert.equal(accountGroup({proxy_id:'p'}),'isolation')
  assert.equal(accountGroup({}),'isolation')
  assert.equal(isAccountDue({statut:'banni_temp',creation_stage:'post1',creation_next_at:'2020-01-01'}),false)
})
test('search ignores accents and remains within the selected group',()=>{
  const accounts=[{id:'1',pseudo:'Été',browser:'Safari',creation_stage:'ready',ads_power_num:12},{id:'2',pseudo:'Autre',telephone:'0612345678'}]
  for(const search of ['ete','Safari','12'])assert.deepEqual(selectAccounts(accounts,{search}).map(a=>a.id),['1'])
  assert.equal(selectAccounts(accounts,{view:'isolation',search:'0612345678'})[0].id,'2')
  assert.equal(selectAccounts(accounts,{search:'0612345678'}).length,0)
})
test('overdue work appears first and AdsPower sorting is numeric',()=>{
  const accounts=[{id:'a',ads_power_num:12,creation_stage:'ready'},{id:'b',ads_power_num:2,creation_stage:'post2',creation_next_at:'2020-01-01'},{id:'c',creation_stage:'post1'}]
  assert.deepEqual(selectAccounts(accounts,{view:'isolation'}).map(a=>a.id),['b','c'])
  assert.deepEqual(selectAccounts(accounts,{view:'isolation',sort:'adspower'}).map(a=>a.id),['b','c'])
  assert.deepEqual(selectAccounts(accounts,{view:'isolation',dueOnly:true}).map(a=>a.id),['b'])
})

test('shadowban always wins and never leaks into ready or isolation views',()=>{
  const a={id:'shadow',is_shadowbanned:true,creation_stage:'ready',is_ready:true,statut:'actif',creation_next_at:'2020-01-01'}
  assert.equal(accountGroup(a),'shadowban')
  assert.equal(isAccountDue(a),false)
  assert.deepEqual(selectAccounts([a]),[])
  assert.deepEqual(selectAccounts([a],{view:'isolation'}),[])
  assert.equal(selectAccounts([a],{view:'shadowban'}).length,1)
})
