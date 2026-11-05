import test from 'node:test'
import assert from 'node:assert/strict'
import {mkdtemp,readFile,rm} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import path from 'node:path'
import {createFactoryJournal} from './factory-journal.mjs'
const cleanup=async dir=>{const target=path.resolve(dir),root=path.resolve(tmpdir())+path.sep;if(!target.startsWith(root)||!path.basename(target).startsWith('factory-journal-'))throw Error('Unsafe test cleanup');await rm(target,{recursive:true,force:true})}

test('factory results survive a restart without storing credentials or replaying writes',async()=>{
 const dir=await mkdtemp(path.join(tmpdir(),'factory-journal-'))
 try{
  const id=crypto.randomUUID(),operation={route:'create',password:'PRIVATE-PASSWORD'},result={profile_id:'one',profile_no:'41'};let writes=0
  const first=await createFactoryJournal(dir)
  assert.deepEqual(await first(id,operation,async dispatch=>{await dispatch();writes++;return result}),result)
  const restarted=await createFactoryJournal(dir)
  assert.deepEqual(await restarted(id,operation,()=>{writes++;throw Error('should not run')}),result)
  assert.equal(writes,1)
  assert.equal((await readFile(path.join(dir,'profile-operations.json'),'utf8')).includes(operation.password),false)
  await assert.rejects(restarted(id,{route:'fingerprint'},()=>{}),/autre opération/)
 }finally{await cleanup(dir)}
})
test('uncertain writes stay blocked after restart; failures before dispatch remain retryable',async()=>{
 const dir=await mkdtemp(path.join(tmpdir(),'factory-journal-'))
 try{
  const id=crypto.randomUUID(),first=await createFactoryJournal(dir)
  await assert.rejects(first(id,'create',()=>{throw Error('precheck')}),/precheck/)
  await assert.rejects(first(id,'create',async dispatch=>{await dispatch();throw Error('lost response')}),/lost response/)
  const restarted=await createFactoryJournal(dir)
  await assert.rejects(restarted(id,'create',()=>{throw Error('must not run')}),e=>e.code==='factory_uncertain')
 }finally{await cleanup(dir)}
})
