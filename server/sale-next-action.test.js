import test from 'node:test'
import assert from 'node:assert/strict'
import {nextSaleAction,confirmPurchase} from '../src/lib/saleDetails.js'

const line={stage:'to_order',source:{sku:'sz123'},order:{status:'payment_received'}}
const catalog=[{sku:'sz123',supplier_url:'https://fr.shein.com/Dress-p-12345.html'}]

test('the main action follows the purchase prerequisites without skipping a step',()=>{
  assert.deepEqual(nextSaleAction({...line,source:{}}),{kind:'sku',label:'Ajouter le SKU Shein'})
  assert.deepEqual(nextSaleAction(line),{kind:'details',label:'Vérifier la fiche Shein'})
  assert.deepEqual(nextSaleAction(line,catalog),{kind:'order',label:'Commande passée'})
  assert.deepEqual(nextSaleAction({...line,supplier_order_ref:'ORDER-1'},catalog),{kind:'advance',label:'Commande passée'})
})

test('purchase confirmation uses the saved version and advances only the chosen sale',async()=>{
  const calls=[]
  const request=async(method,body,query)=>{calls.push({method,body,query});if(method==='GET')return {line:{...line,id:'sale-1',supplier_order_ref:'REF',updated_at:'new-version'}}}
  await confirmPurchase(request,{...line,id:'sale-1',updated_at:'old-version'},' REF ')
  assert.deepEqual(calls[0].body.lines,[{id:'sale-1',updated_at:'old-version'}])
  assert.deepEqual(calls[2].body,{action:'advance',id:'sale-1',updated_at:'new-version',stage:'ordered'})
})

test('purchase confirmation never advances a concurrent change and explains partial saves',async()=>{
  for(const changed of [{order:{status:'cancelled'}},{stage:'received'},{supplier_order_ref:'OTHER'}]){
    let patches=0
    const request=async(method)=>{if(method==='PATCH')patches++;return {line:{...line,supplier_order_ref:'REF',...changed}}}
    await assert.rejects(confirmPurchase(request,line,'REF'),/numéro de commande a été enregistré/)
    assert.equal(patches,1)
  }
  await assert.rejects(confirmPurchase(async()=>{throw Error('Version périmée')},line,'REF'),/Version périmée/)
})

test('blocked and remotely shipped sales never suggest a purchase or advancement',()=>{
  for(const status of ['cancelled','returning','suspended',null])assert.equal(nextSaleAction({...line,order:{status}},catalog).kind,'details')
  for(const status of ['shipped','ready_for_pickup','delivered','completed'])assert.equal(nextSaleAction({...line,order:{status}},catalog),null)
  assert.equal(nextSaleAction({...line,stage:'shipped'}),null)
})

test('subsequent steps and SKU overrides keep their existing semantics',()=>{
  for(const stage of ['ordered','in_transit','received','prepared'])assert.equal(nextSaleAction({...line,stage}).kind,'advance')
  assert.equal(nextSaleAction({...line,sku_override:'sz456',source:{...line.source,supplier_link:catalog[0].supplier_url}}).label,'Vérifier la fiche Shein')
})
