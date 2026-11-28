import test from 'node:test'
import assert from 'node:assert/strict'
import {uploadListingGroups} from '../src/lib/listingPhotoUpload.js'
import {createReadPool} from '../src/lib/requestPool.js'
import {clearViewCache,setViewCacheScope,readViewCache,writeViewCache,viewCacheEpoch} from '../src/lib/viewCache.js'

test('parallel listing uploads preserve the selected cover and successful siblings on failure',async()=>{
 const files=['cover','back','detail','last']
 const release=new Map(),added=[]
 const transfer=file=>new Promise((resolve,reject)=>release.set(file,{resolve,reject}))
 const work=uploadListingGroups(files,transfer,group=>added.push(...group.map(row=>row.photo)),()=>true)
 assert.deepEqual([...release.keys()],files.slice(0,3))
 release.get('detail').resolve('detail')
 release.get('back').reject(Error('upload failed'))
 release.get('cover').resolve('cover')
 await assert.rejects(work,/upload failed/)
 assert.deepEqual(added,['cover','detail'])
 assert.equal(release.has('last'),false)
 await uploadListingGroups(files,async file=>file,group=>added.push(...group.map(row=>row.photo)),()=>true)
 assert.deepEqual(added.slice(2),files)
})

test('simultaneous identical reads share a request but have independent response bodies',async()=>{
 const pool=createReadPool();let calls=0
 const fetcher=async()=>{calls++;return Response.json({count:12})}
 const [a,b]=await Promise.all([pool.read('user-a/sales',fetcher),pool.read('user-a/sales',fetcher)])
 assert.equal(calls,1);assert.deepEqual(await a.json(),{count:12});assert.deepEqual(await b.json(),{count:12})
 await pool.read('user-a/sales',fetcher);assert.equal(calls,2)
 await Promise.all([pool.read('user-a/sales',fetcher),pool.read('user-b/sales',fetcher)]);assert.equal(calls,4)
})
test('a single reader consumes the original response stream',async()=>{
 const response=Response.json({id:42})
 const result=await createReadPool().read('board',()=>response)
 assert.equal(result,response)
 assert.deepEqual(await result.json(),{id:42})
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
