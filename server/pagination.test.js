import test from 'node:test'
import assert from 'node:assert/strict'
import { readPage } from './pagination.js'
function query(count) {
  return head => head ? Promise.resolve({count}) : {range: async (from,to) => {
    if(from>=count&&from>0)return {error:{code:'PGRST103'}}
    return {count,data: Array.from({length:Math.max(0,Math.min(to+1,count)-from)},(_,i)=>({id:from+i}))}
  }}
}
test('empty catalog alongside 2221 sales can be read across all pages', async()=>{
  let total=0
  for(let offset=0;offset<2221;offset+=250) {
    const sales=await readPage(query(2221),offset)
    const catalog=await readPage(query(0),offset)
    total+=sales.data.length
    assert.deepEqual(catalog,{data:[],count:0})
  }
  assert.equal(total,2221)
})
test('catalog can have more pages than sales',async()=>{
  assert.deepEqual(await readPage(query(1),250),{data:[],count:1})
  assert.equal((await readPage(query(400),250)).data.length,150)
})
test('database errors are not hidden as an empty page',async()=>{
  await assert.rejects(readPage(()=>({range:async()=>({error:new Error('denied')})}),0),/denied/)
})

test('a regular page needs one database request, including its count',async()=>{
  let calls=0
  const result=await readPage(head=>{calls++;assert.equal(head,false);return query(300)(head)},0)
  assert.equal(calls,1);assert.equal(result.count,300);assert.equal(result.data.length,250)
})
