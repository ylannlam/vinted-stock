import test from 'node:test'
import assert from 'node:assert/strict'
import {scalencyPurchaseCart} from '../src/lib/scalencyPurchaseCart.js'
import {shopBoard} from './shop-board.js'

const day='2026-11-26'
const base={accountId:'seller',account:'vendeur',date:'2026-11-25T23:05:00Z',state:'to_order',status:'payment_received'}
const line={id:'line',sku:'sz123',title:'Robe bordeaux taille XL',size:'XL',quantity:1}
const product='https://fr.shein.com/Robe-p-123456.html'
const sale=(id,lines=[line],patch={})=>({...base,id,lines,...patch})

test('panier de Paris : lots, quantités, variantes et lignes déjà commandées',()=>{
  const sales=[sale('a',[{...line,quantity:2},{...line,id:'s',size:'S'},{...line,id:'old',state:'ordered'}]),
    sale('b'),sale('c',[line],{state:'cancelled'}),sale('d',[line],{status:'shipped'}),sale('e',[line],{date:'2026-11-26T23:00:00Z'}),
    sale('f',[],{}),sale('g',[line],{state:'to_pack'})]
  const cart=scalencyPurchaseCart(sales,day)
  assert.equal(cart.orders,2)
  assert.equal(cart.units,4)
  assert.deepEqual(cart.groups.map(g=>[g.size,g.quantity]),[['XL',3],['S',1]])
  assert.equal(cart.groups[0].search,'https://fr.shein.com/pdsearch/sz123/')
  assert.deepEqual(cart.incomplete.map(s=>s.id),['f'])
})

test('les références et liens SHEIN des ventes alimentent le panier même sans fiche de stock',()=>{
  const orders=[{id:'o',account:'seller',order_date:base.date,state:base.state,normalized_status:base.status,
    items:[{...line,size:null,quantity:2},{id:'link',sku:product+'?track=A',title:'Veste taille M',state:'to_order'},
      {id:'unknown',title:'Veste',supplier_link:'https://example.org/fake-p-123.html'}]}]
  const data=shopBoard({accounts:[{id:'seller',login:'vendeur'}],inventory:[],jobs:[],orders,drafts:[],
    references:{manual:[],ads:[],drafts:[],lines:[],products:[{supplier_sku:'SZ123',supplier_url:product+'?tracking=1'}]}})
  const cart=scalencyPurchaseCart(data.sales,day)
  assert.equal(cart.groups[0].size,'XL')
  assert.equal(cart.groups[0].product,product)
  assert.equal(cart.groups[1].size,'M')
  assert.equal(cart.groups[1].product,product)
  assert.equal(cart.groups[2].size,'')
  assert.ok(!cart.groups[2].product&&!cart.groups[2].search)
})
