import test from 'node:test'
import assert from 'node:assert/strict'
import {verifyTicket,createTicketVerifier} from './authorization.mjs'

const ticket='svads_test.'+'A'.repeat(43)
const reply=(status,data)=>({status,ok:status>=200&&status<300,json:async()=>data})
const options=fetcher=>({site:'https://site.test',now:()=>1000,fetcher})

test('only a denied or expired ticket is reported as expired authorization',async()=>{
  for(const status of [401,403])await assert.rejects(verifyTicket(ticket,options(async()=>reply(status,{}))),e=>e.status===401&&e.code==='authorization_expired')
  await assert.rejects(verifyTicket(ticket,options(async()=>reply(200,{user_id:'admin',expires_at:1000}))),e=>e.status===401)
  let calls=0
  await assert.rejects(verifyTicket('malformed',options(async()=>{calls++})),e=>e.status===401)
  assert.equal(calls,0)
})

test('server outages, rate limits, network errors and incomplete replies remain temporary failures',async()=>{
  const unavailable=e=>e.status===503&&e.code==='verification_unavailable'
  for(const status of [429,500,502,503])await assert.rejects(verifyTicket(ticket,options(async()=>reply(status,{}))),unavailable)
  await assert.rejects(verifyTicket(ticket,options(async()=>{throw Error('network')})),unavailable)
  for(const data of [null,{}, {user_id:'admin'}, {user_id:'admin',expires_at:'90000'}])await assert.rejects(verifyTicket(ticket,options(async()=>reply(200,data))),unavailable)
  await assert.rejects(verifyTicket(ticket,options(async()=>({ok:true,status:200,json:async()=>{throw Error('invalid JSON')}}))),unavailable)
})

test('parallel requests share verification and reuse it only until the original expiry',async()=>{
  let clock=1000,calls=0,resolve
  const authorize=createTicketVerifier(()=>{calls++;return new Promise(r=>{resolve=r})},{now:()=>clock})
  const first=authorize(ticket),second=authorize(ticket)
  await new Promise(r=>setImmediate(r));assert.equal(calls,1)
  resolve({user_id:'admin',expires_at:2000})
  assert.deepEqual(await first,await second)
  clock=1999;await authorize(ticket);assert.equal(calls,1)
  clock=2000
  const expired=assert.rejects(authorize(ticket),e=>e.status===401)
  await new Promise(r=>setImmediate(r));assert.equal(calls,2)
  resolve({user_id:'admin',expires_at:2000});await expired
})

test('an outage never extends a cached authorization or gets cached as a success',async()=>{
  let clock=1000,calls=0,unavailable=false
  const authorize=createTicketVerifier(async()=>{calls++;if(unavailable)throw Error('offline');return {user_id:'admin',expires_at:200000}},{now:()=>clock})
  await authorize(ticket);unavailable=true
  clock=90999;await authorize(ticket);assert.equal(calls,1)
  clock=91000;await assert.rejects(authorize(ticket),/offline/)
  await assert.rejects(authorize(ticket),/offline/);assert.equal(calls,3)
  unavailable=false;await authorize(ticket);assert.equal(calls,4)
})

test('verification finishing after expiry fails closed and pending capacity is bounded',async()=>{
  let clock=1000,resolve
  const authorize=createTicketVerifier(()=>new Promise(r=>{resolve=r}),{now:()=>clock,maxEntries:1})
  const first=assert.rejects(authorize('one'),e=>e.status===401)
  await assert.rejects(authorize('two'),e=>e.status===429&&e.code==='verification_busy')
  await new Promise(r=>setImmediate(r));clock=2000
  resolve({user_id:'admin',expires_at:2000});await first
  const next=authorize('two');await new Promise(r=>setImmediate(r))
  resolve({user_id:'admin',expires_at:3000});assert.equal((await next).user_id,'admin')
})

test('the verified cache evicts old entries when its capacity is reached',async()=>{
  const calls=[]
  const authorize=createTicketVerifier(async value=>{calls.push(value);return {user_id:'admin',expires_at:3000}},{now:()=>1000,maxEntries:1})
  await authorize('one');await authorize('two');await authorize('two');await authorize('one')
  assert.deepEqual(calls,['one','two','one'])
})
