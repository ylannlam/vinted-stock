import test from 'node:test'
import assert from 'node:assert/strict'
import {parcelFor,parcelSummary,attachParcels,readParcelBoard} from './parcels.js'

const parcel=(n,skus,extra={})=>({tracking_number:'GFFR'+n,carrier:'GOFO',skus,status_text:'En transit',steps:[{name:'A',done:true},{name:'B',done:false}],events:[{at:'2026-11-06T10:00:00Z',place:'Paris',text:'Arrivé'}],observed_at:'2026-11-06T11:00:00Z',...extra})

test('an item belongs to the parcel listing its SKU, or to the only parcel of its order',()=>{
  const order={shipment_observations:[parcel(1,['aa']),parcel(2,['BB'])]}
  assert.equal(parcelFor(order,'bb').tracking_number,'GFFR2')
  assert.equal(parcelFor(order,'zz'),null)
  assert.equal(parcelFor({shipment_observations:[parcel(3,[])]},'zz').tracking_number,'GFFR3')
  const s=parcelSummary(parcel(1,['aa']),'GREF00001')
  assert.deepEqual([s.steps_done,s.steps_total,s.last_event.place,s.order_ref],[1,2,'Paris','GREF00001'])
})

function fakeDb(tables){
  return {from(name){
    let rows=structuredClone(tables[name]||[])
    const q={select:()=>q,in:(col,vals)=>{rows=rows.filter(r=>vals.includes(r[col]));return q},gte:(c,v)=>{rows=rows.filter(r=>r[c]>=v);return q},neq:()=>q,order:()=>q,limit:()=>q,
      then:(ok,ko)=>Promise.resolve({data:rows,error:null}).then(ok,ko)}
    return q
  }}
}
test('each sale gets the parcel of its Shein item; the board lists parcels with their sales',async()=>{
  const db=fakeDb({
    shein_order_links:[{line_id:'l1',item_id:'i1'},{line_id:'l2',item_id:'i2'}],
    shein_order_items:[{id:'i1',order_ref:'GREF00001',sku:'aa'},{id:'i2',order_ref:'GREF00001',sku:'bb'}],
    shein_orders:[{ref:'GREF00001',order_date:'2026-11-05',shipment_observations:[parcel(1,['aa']),parcel(2,['bb'],{delivered:true,status_text:'Livré'})],
      shein_order_items:[{id:'i1',sku:'aa',title:'Robe',present:true,quantity:1},{id:'i2',sku:'bb',title:'Body',present:true,quantity:1}]}],
    workspace_sales:[{id:'l1',stage:'in_transit',order:{account_login:'lily'},source:{title:'Robe'}}],
  })
  const lines=await attachParcels(db,[{id:'l1'},{id:'l2'},{id:'l3',supplier_order_ref:'GREF00001',resolved_sku:'aa'},{id:'l4'}])
  assert.equal(lines[0].parcel.tracking_number,'GFFR1');assert.equal(lines[1].parcel.delivered,true)
  assert.equal(lines[2].parcel.tracking_number,'GFFR1','a sale with only the order number and SKU still finds its parcel')
  assert.equal(lines[3].parcel,undefined)
  const board=await readParcelBoard(db,{now:Date.parse('2026-11-06T12:00:00Z')})
  assert.deepEqual(board.parcels.map(p=>p.tracking_number),['GFFR1','GFFR2'],'parcels on the way come before delivered ones')
  assert.equal(board.parcels[0].items[0].sales[0].account,'lily');assert.equal(board.parcels[0].events.length,1)
})
