import test from 'node:test'
import assert from 'node:assert/strict'
import {presentation,stepFor,diagnostic} from '../extensions/shein/dashboard.js'
import {extensionNeedsUpdate} from '../src/lib/collector.js'

test('dashboard distinguishes connection, pause, challenge and network wait',()=>{
  const s={connected:true,enabled:true,phase:'idle'}
  assert.equal(presentation({...s,connected:false}).label,'Connexion nécessaire')
  assert.equal(presentation({...s,enabled:false}).label,'Imports en pause')
  assert.equal(presentation({...s,phase:'blocked',blockedCode:'human_check'}).label,'Shein attend ta vérification')
  assert.equal(presentation({...s,retryAt:123}).label,'Reconnexion automatique')
  assert.equal(presentation({...s,job:{id:'1'}}).label,'Récupération en cours')
  assert.equal(stepFor(s),-1)
  assert.deepEqual(['search','product','validate','submit'].map(phase=>stepFor({...s,job:{},phase})),[0,1,2,3])
})
test('diagnostic never exports credentials, references, article titles or history',()=>{
  const result=JSON.stringify(diagnostic({version:'0.5.0',token:'SECRET',device_id:'PRIVATE',message:'PRIVATE',job:{lease:'SECRET',input:'PRIVATE'},history:[{title:'PRIVATE'}]}))
  assert.equal(result.includes('SECRET'),false);assert.equal(result.includes('PRIVATE'),false)
})
test('update notice compares full numeric versions and leaves newer builds alone',()=>{
  for(const version of ['0.5.0','0.4.0','0.3.9',undefined,'invalid'])assert.equal(extensionNeedsUpdate(version),true)
  for(const version of ['0.8.0','0.8.0','0.10.0','1.0.0'])assert.equal(extensionNeedsUpdate(version),false)
})
