import test from 'node:test'
import assert from 'node:assert/strict'
import {PDFDocument} from 'pdf-lib'
import {getDocument} from 'pdfjs-dist/legacy/build/pdf.mjs'
import {LABEL_SIZE} from './shipping-label-pdf.js'
import {applyDesktopLabel,desktopLabelLink} from './ylavint-commerce.js'
import {desktopLabelPrint} from './ylavint-thermal.js'

const account='11111111-1111-4111-8111-111111111111',conversation='123'
function database(){
 const row={account_id:account,conversation_id:conversation,title:'Robe longue bordeaux taille M',status:'À expédier'},files=new Map(),writes=[]
 const db={row,files,writes,from(){let filters=[];const q={select:()=>q,eq:(k,v)=>{filters.push(r=>r[k]===v);return q},maybeSingle:async()=>({data:filters.every(f=>f(row))?{...row}:null}),update:value=>{q.value=value;return q},then:resolve=>{if(filters.every(f=>f(row)))Object.assign(row,q.value);return Promise.resolve({error:null}).then(resolve)}};return q},storage:{from:()=>({upload:async(path,bytes)=>{files.set(path,new Uint8Array(bytes));writes.push(path);return {data:{path}}},download:async path=>({data:new Blob([files.get(path)])}),createSignedUrl:async path=>({data:{signedUrl:'https://storage.example/'+path}})})}}
 return db
}
async function source(size=LABEL_SIZE){const pdf=await PDFDocument.create();pdf.addPage(size).drawText('ORIGINAL LABEL',{x:10,y:20,size:10});return pdf.save()}
test('a retrieved label retains its original and automatically gains a 100x150 PDF with the actual item title',async()=>{
 const db=database(),bytes=await source(),task={account_id:account,payload:{conversation_id:conversation}}
 await applyDesktopLabel(db,task,{conversation_id:conversation,pdf_base64:Buffer.from(bytes).toString('base64')})
 assert.equal(db.files.size,2);assert.deepEqual(db.files.get(db.row.label_path),bytes);assert.equal(db.row.thermal_title,db.row.title)
 const print=await desktopLabelPrint(db,account,conversation),pdfBytes=Buffer.from(print.pdf,'base64'),pdf=await PDFDocument.load(pdfBytes)
 assert.deepEqual(pdf.getPage(0).getSize(),{width:LABEL_SIZE[0],height:LABEL_SIZE[1]});assert.equal(pdf.catalog.getOrCreateViewerPreferences().getPrintScaling(),'None')
 const parsed=await getDocument({data:new Uint8Array(pdfBytes),useSystemFonts:true,isEvalSupported:false}).promise
 try{const {items}=await (await parsed.getPage(1)).getTextContent();const text=items.map(i=>i.str).join(' ');assert.ok(text.includes(db.row.title));assert.ok(text.includes('ORIGINAL LABEL'))}finally{await parsed.destroy()}
 assert.equal(Buffer.from(print.preview,'base64').subarray(1,4).toString(),'PNG')
 assert.equal(db.writes.length,2,'printing uses the stored thermal version')
 db.row.title='Titre corrigé';await desktopLabelPrint(db,account,conversation);assert.equal(db.row.thermal_title,'Titre corrigé');assert.equal(db.writes.length,3)
 await assert.rejects(desktopLabelPrint(db,'other-account',conversation),/pas encore/)
 db.row.status='Commande annulée';await assert.rejects(desktopLabelPrint(db,account,conversation),/vérifiée/)
})
test('an unknown layout preserves the original and reports a preparation error instead of inventing a crop',async()=>{
 const db=database(),bytes=await source([595,842])
 const result=await applyDesktopLabel(db,{account_id:account,payload:{conversation_id:conversation}},{conversation_id:conversation,pdf_base64:Buffer.from(bytes).toString('base64')})
 assert.equal(db.files.size,1);assert.ok(db.row.label_path);assert.match(db.row.thermal_error,/pas encore reconnu/);assert.equal(result.thermal_path,null)
 await assert.rejects(desktopLabelPrint(db,account,conversation),/pas encore reconnu/)
 assert.match((await desktopLabelLink(db,account,conversation)).url,/visible-123.pdf/)
})
