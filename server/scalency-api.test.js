import test from 'node:test'
import assert from 'node:assert/strict'
import {snapshot,draftPayload,remoteId,remote} from './scalency-api.js'
import {submitBatchDraft} from '../src/lib/submitBatchDraft.js'

test('Une limite Scalency retarde le même envoi avant de passer à la fiche suivante',async t=>{
 const previous=process.env.SCALENCY_API_KEY
 process.env.SCALENCY_API_KEY='test-local'
 t.after(()=>{if(previous===undefined)delete process.env.SCALENCY_API_KEY;else process.env.SCALENCY_API_KEY=previous})
 const responses=[new Response('{}',{status:429,headers:{'Retry-After':'18'}}),new Response('{"job":{"id":1}}')]
 const sent=[],pauses=[],waits=[]
 const fetcher=async (_url,request)=>{sent.push(JSON.parse(request.body).sku);return responses.shift()}
 const result=await submitBatchDraft(()=>remote('items',{method:'POST',body:{sku:'TEST'},fetcher}),s=>pauses.push(s),()=>true,async ms=>waits.push(ms))
 assert.equal(result.job.id,1)
 assert.deepEqual(sent,['TEST','TEST'])
 assert.deepEqual(pauses,[18])
 assert.deepEqual(waits,[18000])
})

test('Une réponse de publication incertaine ou une validation refusée ne sont jamais rejouées',async()=>{
 for(const error of [new Error('connexion interrompue'),Object.assign(new Error('catégorie invalide'),{status:409})]){
   let calls=0
   await assert.rejects(submitBatchDraft(async()=>{calls++;throw error},assert.fail,()=>true,assert.fail),e=>e===error)
   assert.equal(calls,1)
 }
})

test('Un quota durable arrête les reprises et quitter l’atelier interrompt une reprise en attente',async()=>{
 const error=Object.assign(new Error('limite'),{retryAfterSeconds:2})
 let calls=0
 const send=async()=>{calls++;throw error}
 await assert.rejects(submitBatchDraft(send,()=>{},()=>true,async()=>{}),e=>e===error)
 assert.equal(calls,3)
 let active=true
 await assert.rejects(submitBatchDraft(send,()=>{},()=>active,async()=>{active=false}),/interrompu/)
 assert.equal(calls,4)
})

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
