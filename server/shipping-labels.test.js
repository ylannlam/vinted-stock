import test from 'node:test'
import assert from 'node:assert/strict'
import {PDFDocument} from 'pdf-lib'
import {labelSource,downloadLabel,shippingLabel} from './shipping-labels.js'
import {thermalLabel,LABEL_SIZE,identifyLabel} from './shipping-label-pdf.js'
import handler from '../api/sales.js'

const id='11111111-1111-4111-8111-111111111111',url='https://dotb-storage.s3.eu-central-003.backblazeb2.com/test.pdf'
function database({status='label_sent',label_url=url,missing=false}={}){
  const writes=[]
  return {writes,from(table){return {select(){return this},eq(){return this},async maybeSingle(){return {data:missing?null:{id:id+':item',order_id:id,order:{status,label_url}}}},update(data){writes.push({table,data});return this},then(resolve){resolve({error:null})}}}}
}
const pdfResponse=()=>new Response('%PDF-test',{headers:{'content-type':'application/pdf'}})
const convert=async()=>({bytes:Buffer.from('%PDF-ready'),carrier:'Test'})

test('label source cannot proxy private networks, credentials, other buckets or redirects',async()=>{
  for(const bad of ['http://'+url.slice(8),'https://127.0.0.1/a','https://dotb.io/a','https://dotb-storage.s3.eu-central-003.backblazeb2.com.evil.test/a',url.replace('https://','https://user:password@'),url.replace('.com/','.com:8443/')])assert.throws(()=>labelSource(bad))
  await downloadLabel(url,async(input,options)=>{assert.equal(input,url);assert.equal(options.redirect,'error');assert.equal(options.headers.Authorization,undefined);return pdfResponse()})
})
test('non PDF and oversized carrier responses fail before conversion',async()=>{
  await assert.rejects(downloadLabel(url,async()=>new Response('<html>Not a PDF</html>')),/PDF/)
  await assert.rejects(downloadLabel(url,async()=>new Response('%PDF-test',{headers:{'content-length':'99999999'}})),/volumineux/)
})
test('existing label retrieves only the requested tracked sale without creating another Vinted label',async()=>{
  const db=database(),result=await shippingLabel(db,id+':item',{fetcher:async()=>pdfResponse(),readOrder:async()=>{throw Error('unnecessary API call')},convert})
  assert.equal(Buffer.from(result.pdf,'base64').toString(),'%PDF-ready');assert.match(result.filename,/100x150.pdf$/);assert.equal(db.writes.length,0)
})
test('missing and cancelled sales cannot download a label',async()=>{
  for(const state of [{missing:true},{status:'cancelled'},{status:'returning'},{status:'suspended'}])await assert.rejects(shippingLabel(database(state),'sale',{fetcher:async()=>{throw Error('must not fetch')}}),/vente/)
})
test('a missing label is read from Dotb and saved to its order without changing preparation',async()=>{
  const db=database({label_url:null})
  await shippingLabel(db,'sale',{fetcher:async()=>pdfResponse(),readOrder:async path=>{assert.equal(path,`orders/${id}`);return {id,shipping_label_url:url,normalized_status:'label_sent'}},convert})
  assert.deepEqual(db.writes,[{table:'sales_orders',data:{label_url:url}}])
})
test('unavailable, mismatched or newly cancelled Dotb labels never get printed',async()=>{
  for(const order of [{id,shipping_label_url:null},{id:'foreign',shipping_label_url:url},{id,shipping_label_url:url,normalized_status:'cancelled'}]){
    const db=database({label_url:null})
    await assert.rejects(shippingLabel(db,'sale',{readOrder:async()=>order,fetcher:async()=>{throw Error('must not download')}}))
    assert.equal(db.writes.length,0)
  }
})
test('an expired URL is refreshed once and only once',async()=>{
  let reads=0,downloads=0
  await shippingLabel(database(),'sale',{readOrder:async()=>{reads++;return {id,shipping_label_url:url}},fetcher:async()=>{downloads++;return downloads===1?new Response('',{status:403}):pdfResponse()},convert})
  assert.equal(reads,1);assert.equal(downloads,2)
})
test('thermal PDFs are exactly 100 x 150 mm with print scaling disabled',async()=>{
  const source=await PDFDocument.create();source.addPage([150*72/25.4,100*72/25.4]).drawText('TEST LABEL',{x:15,y:35,size:12})
  const result=await thermalLabel(await source.save(),{preview:true}),pdf=await PDFDocument.load(result.bytes)
  assert.equal(Buffer.from(result.preview).subarray(1,4).toString(),'PNG')
  assert.equal(pdf.getPageCount(),1);assert.equal(pdf.getPage(0).getWidth(),LABEL_SIZE[0]);assert.equal(pdf.getPage(0).getHeight(),LABEL_SIZE[1]);assert.equal(pdf.catalog.getOrCreateViewerPreferences().getPrintScaling(),'None')
})
test('unknown layouts and multiple pages are never silently cut',async()=>{
  assert.throws(()=>identifyLabel({width:595,height:842,items:[]}),/pas encore reconnu/)
  assert.throws(()=>identifyLabel({width:595,height:842,rotation:90,items:[]}),/pas encore reconnu/)
  const source=await PDFDocument.create();source.addPage();source.addPage()
  await assert.rejects(thermalLabel(await source.save()),/pas encore reconnu/)
})
test('label endpoint requires authentication and forbids response caching',async()=>{
  const res={headers:{},setHeader(k,v){this.headers[k]=v},status(n){this.code=n;return this},json(body){this.body=body;return this}}
  await handler({method:'POST',body:{action:'shipping_label',id},headers:{}},res)
  assert.equal(res.code,401);assert.equal(res.headers['Cache-Control'],'no-store')
})
