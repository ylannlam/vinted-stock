import test from 'node:test'
import assert from 'node:assert/strict'
import {createReadPool} from '../src/lib/requestPool.js'
import {clearViewCache,setViewCacheScope,readViewCache,writeViewCache,viewCacheEpoch} from '../src/lib/viewCache.js'

test('simultaneous identical reads share a request but have independent response bodies',async()=>{
 const pool=createReadPool();let calls=0
 const fetcher=async()=>{calls++;return Response.json({count:12})}
 const [a,b]=await Promise.all([pool.read('user-a/sales',fetcher),pool.read('user-a/sales',fetcher)])
 assert.equal(calls,1);assert.deepEqual(await a.json(),{count:12});assert.deepEqual(await b.json(),{count:12})
 await pool.read('user-a/sales',fetcher);assert.equal(calls,2)
 await Promise.all([pool.read('user-a/sales',fetcher),pool.read('user-b/sales',fetcher)]);assert.equal(calls,4)
})
test('a write invalidates in-flight reads for subsequent requests and errors remain retryable',async()=>{
 const pool=createReadPool();let finish
 const old=pool.read('sales',()=>new Promise(resolve=>{finish=resolve}));await Promise.resolve()
 pool.clear()
 const fresh=await pool.read('sales',async()=>Response.json({version:2}))
 finish(Response.json({version:1}));await old
 assert.equal((await fresh.json()).version,2)
 await assert.rejects(pool.read('error',()=>{throw Error('offline')}),/offline/)
 assert.equal((await pool.read('error',async()=>Response.json({ok:true}))).ok,true)
})
test('display snapshots expire, stay separate by filter and cannot cross users or roles',()=>{
 const request=()=>{},now=1000
 setViewCacheScope('first:admin');const version=viewCacheEpoch()
 writeViewCache(request,'sales/all',{count:3},version,now)
 assert.deepEqual(readViewCache(request,'sales/all',now+59000),{count:3})
 assert.equal(readViewCache(request,'sales/pending',now),undefined)
 assert.equal(readViewCache(request,'sales/all',now+60000),undefined)
 setViewCacheScope('second:stock')
 assert.equal(readViewCache(request,'sales/all',now),undefined)
 writeViewCache(request,'sales/all',{count:99},version,now)
 assert.equal(readViewCache(request,'sales/all',now),undefined)
 clearViewCache()
})
