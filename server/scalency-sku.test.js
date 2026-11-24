import test from 'node:test'
import assert from 'node:assert/strict'
import {buildSkuActivity,skuFeeds} from '../src/lib/skuActivity.js'
import {skuFeed,skuSourceRows,linkSku} from './scalency-sku.js'

const feeds=overrides=>({...Object.fromEntries(skuFeeds.map(k=>[k,[]])),comptes:[{id:'a1',login:'alice'},{id:'b2',login:'brune'}],...overrides})
const order=(id,lines,extra={})=>({id,account:'alice',transaction:id,date:'2026-11-20',status:'completed',state:'shipped',lines,...extra})
test('articles publiés, variantes, lots, transactions doublonnées, retours et liens sur le bon compte',()=>{
  const sale=order('v',[{id:'l1',listing:'11',quantity:2},{id:'l2',sku:'B',quantity:1}])
  const data=feeds({annonces:[{id:'10',account:'a1',sku:' Ab ',status:'active',replaced:'11'},{id:'10',account:'b2',sku:'B',status:'active'}],
    supprimees:[{id:'10',account:'a1',sku:'Ab',status:'deleted'}],republications:[{id:'11',previous:'10',account:'a1'}],
    commandes:[sale,{...sale,id:'duplicate'},order('cancel',[{sku:'Ab'}],{status:'cancelled'}),order('return',[{sku:'Ab'}],{state:'returning'}),
      order('pending',[{sku:'ab'}],{state:'to_pack',status:'label_sent'}),order('empty',[])]})
  const result=buildSkuActivity(data)
  const a=result.rows.find(g=>g.key==='ab'),b=result.rows.find(g=>g.key==='b')
  assert.deepEqual([a.published,a.online,a.completed,a.pending],[2,0,2,1])
  assert.deepEqual([b.published,b.online,b.completed],[1,1,1])
  assert.equal(result.emptyOrders.length,1)
  assert.equal(buildSkuActivity(data,{},'brune').rows[0].completed,0)
})
test('sans preuve les homonymes restent à identifier, une association manuelle rattache aussi la vente',()=>{
  const data=feeds({annonces:[{id:'u',account:'a1',title:'Robe',status:'active'},{id:'a',account:'a1',sku:'S',title:'Robe',status:'active'}],
    commandes:[order('o',[{id:'i',listing:'u',title:'Robe'}]),order('other',[{id:'k',title:'Robe'}])]})
  assert.equal(buildSkuActivity(data).rows.find(g=>!g.key).completed,2)
  const manual=[{kind:'listing',account:'alice',id:'u',line:'',sku:'X'}]
  const report=buildSkuActivity(data,{manual})
  assert.equal(report.rows.find(g=>g.key==='x').completed,1)
  assert.equal(report.rows.find(g=>!g.key).completed,1)
})
test('une chaîne de reposts contradictoire ne transmet aucun SKU aux annonces inconnues',()=>{
  const data=feeds({annonces:[{id:'1',account:'a1',sku:'A',replaced:'2'},{id:'3',account:'a1',sku:'B'}],
    republications:[{id:'3',previous:'2',account:'a1'}]})
  assert.deepEqual(buildSkuActivity(data).rows.find(g=>!g.key).listings.map(x=>x.id),['2'])
})
test('vente sans lignes reliée à une transaction exacte, sans compter la sauvegarde deux fois',()=>{
  const data=feeds({annonces:[{id:'x',sku:'A',account:'a1',sold:true,saleState:'terminee',transaction:'tx'}],
    commandes:[order('o',[],{transaction:'tx'})]})
  assert.equal(buildSkuActivity(data).rows[0].completed,1)
  assert.equal(buildSkuActivity(data).emptyOrders.length,0)
})
test('pagination explicite et données commerciales minimales',async()=>{
  let params
  const page=await skuFeed('publications','abc',async(kind,p)=>{params=[kind,p.query];return {has_more:false,data:[
    {id:1,type:'publish',status:'queued',new_item_id:'2'},{id:2,type:'publish',status:'done',account_id:'a1',new_item_id:'3',refs:{sku:'A',supplier_link:'private'}}]}})
  assert.equal(params[0],'jobs');assert.equal(params[1].cursor,'abc')
  assert.equal(page.rows.length,1);assert.equal(page.rows[0].sku,'A');assert.equal(page.next,null)
  await assert.rejects(skuFeed('annonces','abc',async()=>({data:[],has_more:true,next_cursor:'abc'})),/incomplet/)
  await assert.rejects(skuFeed('not-a-feed',''),/invalide/)
  assert.ok(!JSON.stringify(skuSourceRows('orders',[{id:'o',ship_name:'PRIVATE',items:[{title:'Robe',product:{notes:'PRIVATE'}}]}])).includes('PRIVATE'))
  await assert.rejects(linkSku({}, {kind:'sale',sku:'SKU',account:'a',id:'1'}),/invalide/)
})
