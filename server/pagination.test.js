import test from 'node:test'
import assert from 'node:assert/strict'
import { readPage } from './pagination.js'
function query(count) {
  return head => head ? Promise.resolve({count}) : {range: async (from,to) => {
    assert.ok(from < count, 'must not request an out-of-range page')
    return {data: Array.from({length:Math.min(to+1,count)-from},(_,i)=>({id:from+i}))}
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
  await assert.rejects(readPage(()=>Promise.resolve({error:new Error('denied')}),0),/denied/)
})
