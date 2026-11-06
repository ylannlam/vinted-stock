import test from 'node:test'
import assert from 'node:assert/strict'
import {matchCode,candidatesFor,variantsFor,expectedItems,nextSlot,sizeKey,daySummary} from '../src/lib/reception.js'

const line=(id,o)=>({id,order_id:id,effective_stage:'in_transit',resolved_sku:'sz251111535310542462',supplier_size:'36(S)',supplier_color:'Rouge',source:{title:'Robe rouge'},...o})

test('a scanned or typed code finds the expected SKU, even partially or with extra characters',()=>{
 const skus=['sz251111535310542462','si2303081035232769','sz260302173070137356635']
 assert.deepEqual(matchCode('sz251111535310542462',skus),['sz251111535310542462'])
 assert.deepEqual(matchCode('SKU: sz251111535310542462-S',skus),['sz251111535310542462'],'label noise around the SKU')
 assert.deepEqual(matchCode('42462',skus),['sz251111535310542462'],'last digits')
 assert.deepEqual(matchCode('69',skus),[],'too short')
 assert.deepEqual(matchCode('9900112233',skus,{'9900112233':'si2303081035232769'}),['si2303081035232769'],'a remembered barcode')
})
test('sizes written differently by Shein and Vinted are the same size',()=>{
 assert.equal(sizeKey('36(S)'),'s');assert.equal(sizeKey('S'),'s');assert.equal(sizeKey(' m '),'m')
})
test('the sale to serve first: shippable now, then nearest deadline, then oldest sale',()=>{
 const lines=[
  line('late',{deadline_at:'2026-11-12T10:00:00Z',sale_date:'2026-11-01T10:00:00Z'}),
  line('soon',{deadline_at:'2026-11-09T10:00:00Z',sale_date:'2026-11-03T10:00:00Z'}),
  line('lot',{order_id:'L',deadline_at:'2026-11-08T10:00:00Z'}),line('lot-b',{order_id:'L',resolved_sku:'other'}),
  line('done',{effective_stage:'received'}),line('size',{supplier_size:'M',deadline_at:'2026-11-08T08:00:00Z'}),
 ]
 assert.deepEqual(candidatesFor(lines,'sz251111535310542462').map(c=>c.line.id),['size','soon','late','lot'],'an incomplete lot waits behind sales that can ship today')
 assert.deepEqual(candidatesFor(lines,'sz251111535310542462','s|rouge').map(c=>c.line.id),['soon','late','lot'])
 assert.deepEqual(variantsFor(lines,'sz251111535310542462').map(v=>[v.label,v.count]),[['M · Rouge',1],['36(S) · Rouge',3]])
 const lastOfLot=[line('a',{order_id:'L'}),line('b',{order_id:'L',resolved_sku:'x',effective_stage:'received'})]
 assert.equal(candidatesFor(lastOfLot,'sz251111535310542462')[0].ready,true,'the last missing piece completes the lot')
})
test('visual grid, waiting slots and day summary',()=>{
 const lines=[line('a',{deadline_at:'2026-11-10T00:00:00Z'}),line('b',{deadline_at:'2026-11-08T00:00:00Z'}),line('c',{resolved_sku:'zz',deadline_at:'2026-11-09T00:00:00Z'}),line('d',{effective_stage:'received',location:'A1'}),line('e',{effective_stage:'prepared',location:'a3'})]
 const grid=expectedItems(lines)
 assert.equal(grid.length,2);assert.equal(grid[0].lines.length,2);assert.equal(grid[1].sku,'zz')
 assert.equal(nextSlot(lines),'A2')
 const s=daySummary(lines,Date.parse('2026-11-07T12:00:00Z'))
 assert.deepEqual([s.waiting,s.received,s.toDeposit],[3,1,1])
})
test('receiving an article walks the sale to « Reçu » and packing frees the waiting slot',async()=>{
 const {receiveLine,packOrder}=await import('./reception.js')
 const order='11111111-1111-4111-8111-111111111111'
 const rows=[{id:'a',order_id:order,stage:'ordered',location:null,updated_at:'1',order:{status:'label_sent'}},{id:'b',order_id:order,stage:'received',location:'A2',updated_at:'1',order:{status:'label_sent'}}]
 const calls=[]
 const db={rpc:async(name,args)=>{calls.push(args.p_stage);const r=rows.find(x=>x.id===args.p_id);if(r.updated_at!==args.p_version)return {error:{message:'stale_version'}};r.stage=args.p_stage;r.updated_at=String(Number(r.updated_at)+1);return {error:null}},
  from(table){const q={f:[],select(){return q},eq(k,v){q.f.push(x=>x[k]===v);return q},in(k,v){q.f.push(x=>v.includes(x[k]));return q},
   update(patch){q.patch=patch;return q},
   async maybeSingle(){return {data:structuredClone(rows.find(x=>q.f.every(f=>f(x)))??null)}},
   then(resolve){const hit=rows.filter(x=>q.f.every(f=>f({...x,source_active:true}))); if(q.patch)hit.forEach(x=>Object.assign(x,q.patch));resolve({data:structuredClone(hit.map(x=>({...x,source_active:true}))),error:null})}};return q}}
 await receiveLine(db,'u',{id:'a',location:'A2'})
 assert.deepEqual(calls,['in_transit','received']);assert.equal(rows[0].location,'A2')
 await assert.rejects(receiveLine(db,'u',{id:'a'}),/n’attend plus/)
 const packed=await packOrder(db,'u',{order_id:order},{dotb:async path=>{assert.equal(path,`orders/${order}/pack`)}})
 assert.equal(packed.dotb_packed,true);assert.deepEqual(rows.map(r=>[r.stage,r.location]),[['prepared',null],['prepared',null]])
})
test('batch labels: one label per order, merged into a single PDF in list order',async()=>{
 const {labelTargets,mergeLabels}=await import('../src/lib/batchLabels.js')
 const {PDFDocument}=await import('pdf-lib')
 assert.deepEqual(labelTargets([{id:'a',order_id:'1'},{id:'b',order_id:'1'},{id:'c',order_id:'2'}]).map(l=>l.id),['a','c'])
 const one=async text=>{const d=await PDFDocument.create();d.addPage([283,425]).drawText(text);return d.saveAsBase64()}
 const merged=await PDFDocument.load(await mergeLabels([await one('A'),await one('B'),await one('C')]))
 assert.equal(merged.getPageCount(),3)
})
