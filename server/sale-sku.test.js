import test from 'node:test'
import assert from 'node:assert/strict'
import {validateSaleSku} from './dotb.js'

const sale={id:'sale:item',updated_at:'2026-11-01T20:00:00Z'}
test('a SKU can be entered after sale without any purchase fields',()=>{
  assert.equal(validateSaleSku({...sale,sku:'  sz25052272411726746  '}),'sz25052272411726746')
})
test('SKU entry rejects URLs, empty references and malformed versions',()=>{
  for(const sku of ['',null,42,'https://fr.shein.com/Test-p-123.html','SKU with spaces','x'.repeat(201)]) {
    assert.throws(()=>validateSaleSku({...sale,sku}),/SKU Shein seul/)
  }
  assert.throws(()=>validateSaleSku({...sale,sku:'sz123',updated_at:null}),/version/)
  assert.throws(()=>validateSaleSku({...sale,sku:'sz123',id:''}),/version/)
})
