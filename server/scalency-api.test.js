import test from 'node:test'
import assert from 'node:assert/strict'
import {snapshot,draftPayload,remoteId} from './scalency-api.js'

test('Deux comptes peuvent utiliser le même identifiant de conversation',()=>{
 const first=snapshot('conversations',{id:'123',account_id:'a',at:'2026-11-20T12:00:00Z'})
 const second=snapshot('conversations',{id:'123',account_id:'b'})
 assert.notEqual(first.account,second.account)
 assert.equal(first.remote_id,second.remote_id)
})
test('Une commande conserve les références de préparation sans recopier l’adresse du destinataire',()=>{
 const result=snapshot('orders',{id:'ag-7',account:'boutique',ship_name:'Privé',items:[{id:'x',sku:'M-7',vinted_id:312,location:'B2',product:{internal:'x'}}]})
 assert.deepEqual(result.payload.items,[{id:'x',sku:'M-7',location:'B2',vinted_id:312}])
 assert.equal(result.payload.ship_name,undefined)
})
test('La publication transmet les attributs et la date demandée',()=>{
 const p=draftPayload({fields:{title:'Une robe',description:'Robe longue',price:'12.40',sku:'S1',catalog_id:12,status_id:2,color_ids:[3]}},['https://example.com/image'],'acct-1','2026-12-01T12:00:00Z')
 assert.equal(p.price,12.4);assert.equal(p.sku,'S1');assert.equal(p.scheduled_at,'2026-12-01T12:00:00Z')
 assert.throws(()=>draftPayload({fields:{}},[],'acct-1'))
 assert.throws(()=>remoteId('../other'))
})
