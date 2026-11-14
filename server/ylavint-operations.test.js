import test from 'node:test'
import assert from 'node:assert/strict'
import {PDFDocument} from 'pdf-lib'
import {visibleDeadline,todayItems,resultMetrics} from '../src/lib/ylavintOperations.js'
import {selectedOrders,mergeLabelPdfs,queueExtension,extensionResult,extensionPayload} from './ylavint-operations.js'
import {pickingHtml} from '../src/lib/ylavintPicking.js'

const a='11111111-1111-4111-8111-111111111111',b='22222222-2222-4222-8222-222222222222',now=Date.parse('2026-11-14T12:00:00Z'),iso=offset=>new Date(now+offset*36e5).toISOString()
test('visible deadlines use Paris, handle year boundaries and reject absent or invalid dates',()=>{
 assert.equal(visibleDeadline('avant le 16 nov. 15:22',now),'2026-11-16T14:22:00.000Z')
 assert.equal(visibleDeadline('avant le 14 juil. 10:00',Date.parse('2026-07-10')),'2026-07-14T08:00:00.000Z')
 assert.equal(visibleDeadline('avant le 2 janv. 10:00',Date.parse('2026-12-30')),'2027-01-02T09:00:00.000Z')
 for(const bad of ['',null,'avant le 31 fevr. 10:00','avant le 20 nov. 29:00','envoi dans quelques jours'])assert.equal(visibleDeadline(bad,now),null)
})
test('today distinguishes unknown deadlines, excludes shipped orders, and keeps account identities',()=>{
 const base={conversation_id:'123',normalized:'label_sent',title:'Robe',label_path:null}
 const items=todayItems([{...base,account_id:a,ship_deadline:iso(2)},{...base,account_id:b,ship_deadline:null},{...base,account_id:a,conversation_id:'124',normalized:'shipped',ship_deadline:iso(-1)}],[],[],now)
 assert.equal(items.length,4);assert.equal(new Set(items.map(i=>i.id)).size,4)
 assert.equal(items.filter(i=>i.kind==='deadline').length,1);assert.equal(items.filter(i=>i.kind==='deadline_unknown').length,1)
})
test('results exclude failures, pre-contact responses, other accounts, refunds and undated purchases; a sale counts once',()=>{
 const outgoing={account_id:a,conversation_id:'123',from_me:true,kind:'message',state:'sent',source:'likes',sent_at:iso(-10)}
 const incoming={...outgoing,from_me:false,source:'vinted',state:'vinted'}
 const order={account_id:a,conversation_id:'123',normalized:'completed',price:20,order_date:iso(-7)}
 const r=resultMetrics({from:now-864e5,to:now,messages:[outgoing,{...outgoing,sent_at:iso(-8)},{...outgoing,state:'failed'},{...incoming,sent_at:iso(-12)},{...incoming,account_id:b,sent_at:iso(-9)},{...incoming,sent_at:iso(-6)}],orders:[order,order,{...order,account_id:b},{...order,conversation_id:'456'},{...order,normalized:'returning'},{...order,order_date:null}],offers:[{finished_at:iso(-8),result:{offer_sent:true,expected_price:25,offer_price:20}},{finished_at:iso(-8),result:{offer_sent:true}}]})
 assert.equal(r.messages_sent,2);assert.equal(r.conversations,1);assert.equal(r.responses,1);assert.equal(r.sales,1);assert.equal(r.revenue,20);assert.equal(r.unknown_sale_dates,1);assert.equal(r.discount_count,2);assert.equal(r.discount_known,1);assert.equal(r.discount_total,5)
 const no=resultMetrics({from:now-864e5,to:now,messages:[outgoing,{...incoming,sent_at:iso(-12)}],orders:[{...order,order_date:iso(-11)}]});assert.equal(no.responses,0);assert.equal(no.sales,0)
})
test('parcel selection is scoped to account, unique, bounded, open and grouped deterministically',()=>{
 const rows=[{account_id:a,conversation_id:'123',normalized:'label_sent',carrier:'Z'},{account_id:b,conversation_id:'123',normalized:'label_sent',carrier:'A'}],select=account_id=>({account_id,order_key:'conversation:123'})
 assert.equal(selectedOrders(rows,[select(a),select(b)])[0].account_id,b)
 assert.throws(()=>selectedOrders(rows,[select(a),select(a)]),/doublon/)
 assert.throws(()=>selectedOrders([{...rows[0],normalized:'shipped'}],[select(a)]),/vérifier/)
 assert.throws(()=>selectedOrders(rows,Array(21).fill(select(a))));assert.throws(()=>selectedOrders(rows,[]))
})
test('label merging preserves vectors, page order and exact 100x150 size without print scaling',async()=>{
 const files=[];for(let i=0;i<2;i++){const doc=await PDFDocument.create();doc.addPage([100*72/25.4,150*72/25.4]).drawText(`COLIS ${i+1}`);files.push(await doc.save())}
 const bytes=await mergeLabelPdfs(files),result=await PDFDocument.load(bytes)
 assert.equal(result.getPageCount(),2);assert.equal(result.catalog.getOrCreateViewerPreferences().getPrintScaling(),'None')
 const {getDocument}=await import('pdfjs-dist/legacy/build/pdf.mjs'),parsed=await getDocument({data:bytes,useSystemFonts:true,isEvalSupported:false}).promise
 try{for(let i=1;i<=2;i++){const page=await parsed.getPage(i);assert.ok(Math.abs(page.view[2]-100*72/25.4)<.01);assert.match((await page.getTextContent()).items.map(i=>i.str).join(' '),new RegExp(`COLIS ${i}`))}}finally{await parsed.destroy()}
 const a4=await PDFDocument.create();a4.addPage();await assert.rejects(mergeLabelPdfs([await a4.save()]),/100 × 150/)
})
test('picking sheet escapes arbitrary titles, locations and image attributes',()=>{
 const html=pickingHtml([{title:'<script>alert(1)</script>',photo_url:'javascript:alert(1)',login:'a&b',preparation:{location:'<img onerror=x>',sku:'" x'}}])
 assert.ok(!html.includes('<script>'));assert.ok(!html.includes('src="javascript'));assert.ok(html.includes('&lt;img'));assert.ok(html.includes('a&amp;b'))
})
function database(){
 const state={ylavint_desktop_orders:[{account_id:a,conversation_id:'123',item_id:'9',title:'Robe',status:'À expédier',extension_state:'unknown'}],vinted_agent_settings:[{account_id:a,enabled:true,messaging:{executor:'desktop'},extension_version:'pc-1.8.0'}],vinted_agent_tasks:[]}
 const db={state,from(name){let filters=[],patch,insert;const q={select:()=>q,eq:(k,v)=>{filters.push(r=>r[k]===v);return q},update:v=>{patch=v;return q},insert:v=>{insert=v;return q},maybeSingle:()=>q.single(),single:()=>q.then(r=>({...r,data:Array.isArray(r.data)?r.data[0]||null:r.data})),then(resolve){let rows=state[name].filter(r=>filters.every(f=>f(r)));if(insert){if(state[name].length)return Promise.resolve({error:{code:'23505'}}).then(resolve);const r={id:'new-task',...insert};state[name].push(r);rows=[r]}if(patch)rows.forEach(r=>Object.assign(r,patch));return Promise.resolve({data:rows,error:null}).then(resolve)}};return q}};return db
}
test('extension requests require a matching open sale, current PC and one attempt; result cannot invent confirmation',async()=>{
 const db=database(),request={account_id:a,conversation_id:'123',days:5,reason:''}
 await assert.rejects(queueExtension(db,{...request,account_id:b},{id:a}),/Relis/)
 db.state.vinted_agent_settings[0].extension_version='pc-1.7.0';await assert.rejects(queueExtension(db,request,{id:a}),/1.8/)
 db.state.vinted_agent_settings[0].extension_version='pc-1.8.0';await queueExtension(db,request,{id:a});await assert.rejects(queueExtension(db,request,{id:a}),/déjà/)
 const task=db.state.vinted_agent_tasks[0];assert.equal((await extensionPayload(db,task)).item_id,'9')
 await assert.rejects(extensionResult(db,task,{requested:true,conversation_id:'other',days:5,extension_state:'pending'}))
 await extensionResult(db,task,{requested:true,conversation_id:'123',days:5,extension_state:'pending'},now)
 assert.equal(db.state.ylavint_desktop_orders[0].extension_state,'pending');assert.ok((await extensionPayload(db,task)).skip)
})
