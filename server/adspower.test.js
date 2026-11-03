import test from 'node:test'
import assert from 'node:assert/strict'
import {issueAdsPowerTicket,verifyAdsPowerTicket} from './adspower-ticket.js'
import {adsPowerHandler} from '../api/adspower.js'
const id='00000000-0000-4000-8000-000000000001',key='test-server-secret'
test('AdsPower capabilities expire and cannot be forged or used as database sessions',()=>{
  const issued=issueAdsPowerTicket(id,key,10000)
  assert.deepEqual(verifyAdsPowerTicket(issued.ticket,key,10001),{user_id:id,expires_at:100000})
  assert.throws(()=>verifyAdsPowerTicket(issued.ticket,key,100000));assert.throws(()=>verifyAdsPowerTicket(issued.ticket,'wrong',10001))
  assert.throws(()=>verifyAdsPowerTicket(issued.ticket.replace(/.$/,'!'),key,10001))
  assert.equal(issued.ticket.includes(key),false);assert.equal(issued.ticket.startsWith('svads_'),true)
})
test('only administrator authorization issues a local capability',async()=>{
  let roles,answer,status=200
  const res={setHeader(){},status(v){status=v;return this},json(v){answer=v;return this}}
  await adsPowerHandler(async(req,res,wanted)=>{roles=wanted;return {user:{id}}},()=>key)({method:'GET'},res)
  assert.deepEqual(roles,['admin']);assert.ok(answer.ticket)
  await adsPowerHandler()({method:'POST',body:{action:'verify',ticket:'wrong'}},res);assert.equal(status,401)
})
