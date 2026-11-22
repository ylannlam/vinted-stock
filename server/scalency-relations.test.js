import test from 'node:test'
import assert from 'node:assert/strict'
import {connectedRecords,draftSource} from './scalency-relations.js'

function database(tables){
  return {from(name){
    assert.ok(Object.hasOwn(tables,name),'Table inattendue '+name)
    let rows=[...tables[name]]
    const q={select(){return q},order(){return q},limit(n){rows=rows.slice(0,n);return q},
      eq(k,v){rows=rows.filter(r=>r[k]===v);return q},maybeSingle(){assert.ok(rows.length<=1);return {data:rows[0]||null}},
      then(done,fail){return Promise.resolve({data:rows}).then(done,fail)}}
    return q
  }}
}
test('Une pièce vendue ne peut plus servir de source à un brouillon',async()=>{
  const db=database({scalency_physical_catalog:[{id:'p',status:'en_stock'}],scalency_inventory:[{item_id:'p',linked_sale:true}]})
  await assert.rejects(draftSource(db,'p'),e=>e.status===409)
})
test('Le brouillon refuse un SKU appartenant à une autre référence',async()=>{
  const db=database({scalency_physical_catalog:[{id:'p',status:'en_stock',product_id:'a',supplier_id:'10'}],scalency_inventory:[],
    scalency_product_library:[{id:'a',supplier_id:'10'}],scalency_product_keys:[{sku:'abc',product_id:'b'}]})
  await assert.rejects(draftSource(db,'p',null,'ABC'),e=>e.status===409)
})
test('Deux annonces homonymes sur deux comptes gardent leurs ventes distinctes',async()=>{
  const db=database({scalency_catalog_inventory:[{remote_id:'12',account:'a',payload:{title:'Robe'}},{remote_id:'12',account:'b',payload:{title:'Robe'}}],
    scalency_order_products:[{listing:'12',account_id:'a',order_id:'7',login:'premier'},{listing:'12',account_id:'b',order_id:'9',login:'autre'}]})
  const result=await connectedRecords(db,{},'stock',{entity:'items',account:'a',id:'12'})
  assert.deepEqual(result.links.map(l=>l.params),[{id:'7',account:'premier'}])
  assert.deepEqual(result.suggestions,[])
})
test('Un identifiant de vente archivée conserve les séparateurs et le login',async()=>{
  const db=database({scalency_order_products:[{archive_line:'item:45',order_id:'10',login:'a.b'}]})
  const r=await connectedRecords(db,{},'stock',{entity:'archive',id:'item:45',account:'a.b'})
  assert.equal(r.links[0].params.id,'10')
})
