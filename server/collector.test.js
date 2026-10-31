import test from 'node:test'
import assert from 'node:assert/strict'
import vm from 'node:vm'
import {newCollectorToken,readCollectorToken,sameToken,validateCollection,resumeOpenCollection} from './collector.js'
import {collectionReferences,collectorOnline} from '../src/lib/collector.js'
import {readSheinPage,readSheinSearch} from '../tools/shein-collector/extract.mjs'
import {allowedPage,apiCall,collect,waitForOpenProduct} from '../tools/shein-collector/collector.mjs'
import handler from '../api/collector.js'
const now=Date.parse('2026-10-31T14:00:00Z'),sku='sz25052272411726746',url='https://fr.shein.com/Dress-p-90176146.html'
const result=()=>({supplier_url:url,supplier_sku:sku,title:'Robe',price:'32.64',price_text:'32,64€',currency:'EUR',color:'Nude',observed_at:new Date(now).toISOString(),photos:['https://img.ltwebstatic.com/product.webp'],sizes:[{size:'M',availability:'available'}]})
const job={expected_supplier_id:'90176146',expected_sku:sku}
test('references strip tracking, preserve SKU and reject unsafe or excessive inputs',()=>{
  assert.equal(collectionReferences(`${sku}\n${sku}\n${url}?x=1`).length,2)
  assert.equal(collectionReferences(url+'?x=1')[0].input,url)
  for(const value of ['',Array(51).fill(sku).join('\n'),'https://fr.shein.com.evil.test/Dress-p-1.html','../bad','https://fr.shein.com/'])assert.throws(()=>collectionReferences(value))
})
test('collector credentials are scoped, random and revocable without Dotb tokens',()=>{
  const a=newCollectorToken(),b=newCollectorToken()
  assert.notEqual(a.token,b.token);assert.equal(readCollectorToken(`Bearer ${a.token}`).id,a.id)
  assert.ok(sameToken(a.token,a.token_hash));assert.equal(sameToken(b.token,a.token_hash),false)
  assert.equal(readCollectorToken(`Bearer ${a.token} extra`),null);assert.equal(sameToken(a.token,'bad'),false)
  const device={last_seen_at:new Date(now-10000).toISOString(),expires_at:new Date(now+10000).toISOString()}
  assert.ok(collectorOnline(device,now));assert.equal(collectorOnline({...device,expires_at:new Date(now-1).toISOString()},now),false)
  assert.equal(collectorOnline({...device,revoked_at:'today'},now),false)
})
test('observations require exact product, visible EUR price, color and a fresh timestamp',()=>{
  const valid=validateCollection(result(),job,now)
  assert.equal(valid.price,32.64);assert.equal(valid.price_scope,'product');assert.equal(valid.supplier_id,'90176146')
  for(const patch of [{supplier_sku:'wrong'},{supplier_url:'https://fr.shein.com/Other-p-123.html'},{price:'18.08'},{price:0,price_text:'0€'},{currency:'USD'},{color:''},{observed_at:new Date(now-16*60000).toISOString()},{observed_at:new Date(now+120000).toISOString()},{price_text:'32,64€ 29,00€'}])assert.throws(()=>validateCollection({...result(),...patch},job,now))
  assert.deepEqual(validateCollection({...result(),photos:['https://evil.test/x','javascript:alert(1)','https://img.ltwebstatic.com.evil.test/x']},job,now).photos,[])
})
function domFixture({human=false,price='32,64€'}={}) {
  const attr=values=>({getAttribute:key=>values[key]??null})
  return {location:{href:url},URL,Date,document:{body:{innerText:human?'Veuillez vérifier que vous êtes humain':`Robe\nSKU: ${sku}`},
    getElementById:()=>({...attr({'aria-label':price}),innerText:price}),
    querySelector:q=>q==='h1'?{innerText:'Robe'}:q.includes('Color options')?{querySelector:()=>attr({'aria-label':'Nude'})}:q.includes('Taille')?{querySelectorAll:()=>[attr({'aria-label':'M','aria-disabled':'false'})]}:null,
    querySelectorAll:q=>q==='button'?[{...attr({'aria-label':`Copy SKU ${sku}`}),innerText:'Copier'}]:q==='img'?[{alt:'Robe - Nude - Voir 1',src:'https://img.ltwebstatic.com/p_thumbnail_220x293.webp'},{alt:'Robe - Nude - Voir 1',src:'https://img.ltwebstatic.com/p_thumbnail_900x.webp'},{alt:'Recommandation',src:'https://img.ltwebstatic.com/other.webp'}]:[]}}
}
test('rendered Shein DOM yields only the displayed product, selected color and photos',()=>{
  const value=vm.runInNewContext(`(${readSheinPage.toString()})()`,domFixture())
  assert.equal(value.price,'32.64');assert.equal(value.supplier_sku,sku);assert.equal(value.sizes[0].availability,'available')
  assert.equal(value.photos.length,1);assert.match(value.photos[0],/900x/)
  assert.equal(vm.runInNewContext(`(${readSheinPage.toString()})()`,domFixture({human:true})).error,'human_check')
  assert.equal(vm.runInNewContext(`(${readSheinPage.toString()})()`,domFixture({price:'Prix indisponible'})).error,'price_unreadable')
})
test('single-color pages use only a visible explicit heading and reject conflicting or hidden colors',()=>{
  for(const variant of ['text','label','hidden','conflict']) {
    const context=domFixture(),query=context.document.querySelector,all=context.document.querySelectorAll
    context.document.querySelector=q=>q.includes('Color options')?null:query(q)
    const heading=(color,visible=true)=>({innerText:`Couleur: ${color}`,getAttribute:()=>variant==='label'?`Couleur ${color}`:null,getClientRects:()=>visible?[{}]:[]})
    context.document.querySelectorAll=q=>q==='h2,h3,[role="heading"]'?(variant==='conflict'?[heading('Nude'),heading('Noir')]:[heading('Nude',variant!=='hidden')]):all(q)
    const actual=vm.runInNewContext(`(${readSheinPage.toString()})()`,context)
    assert.equal(actual.color,['hidden','conflict'].includes(variant)?'':'Nude')
    if(actual.color)assert.equal(actual.photos.length,1)
  }
})
test('challenge URLs pause both readers before challenge text has loaded',()=>{
  const context=domFixture();context.location={href:'https://fr.shein.com/risk/challenge?captcha_type=909',pathname:'/risk/challenge'}
  assert.equal(vm.runInNewContext(`(${readSheinPage.toString()})()`,context).error,'human_check')
  assert.equal(vm.runInNewContext(`(${readSheinSearch.toString()})()`,context).error,'human_check')
})

test('expanded product details support display:contents rows and exclude unrelated tables',()=>{
  const context=domFixture(),all=context.document.querySelectorAll
  const cell=text=>({innerText:text,getClientRects:()=>[{}]})
  const item={getClientRects:()=>[],querySelector:q=>cell(q.endsWith('textname')?'Composition:':'100% Polyester')}
  const region={innerText:'Composition: 100% Polyester',querySelectorAll:()=>[item]}
  const button={innerText:'Description\n#Looks festifs',getAttribute:k=>k==='aria-expanded'?'true':null,parentElement:{querySelector:()=>region}}
  const table={getClientRects:()=>[{}],querySelector:()=>({}),querySelectorAll:()=>[['Taille','Poitrine'],['S','82']].map(row=>({querySelectorAll:()=>row.map(cell)}))}
  const measures={getClientRects:()=>[{}],getAttribute:()=> 'Tailles & Mesures',querySelector:()=>cell('CM'),querySelectorAll:()=>[table]}
  context.document.querySelectorAll=q=>q==='button'?[...all(q),button]:q==='[role="group"]'?[measures]:q==='table'?assert.fail('must not read unrelated tables'):all(q)
  const value=vm.runInNewContext(`(${readSheinPage.toString()})()`,context)
  assert.equal(value.description,region.innerText)
  assert.deepEqual(JSON.parse(JSON.stringify(value.details)),[{name:'Composition',value:'100% Polyester'},{name:'Unité des mesures',value:'CM'},{name:'Taille · Poitrine',value:'S · 82'}])
  const query=context.document.querySelector
  context.document.querySelector=q=>q.includes('Color options')?null:query(q)
  item.querySelector=q=>cell(q.endsWith('textname')?'Couleur:':'Nude')
  const singleColor=vm.runInNewContext(`(${readSheinPage.toString()})()`,context)
  assert.equal(singleColor.color,'Nude');assert.equal(singleColor.photos.length,1)
})
test('search extraction deduplicates real product links and stops at human checks',()=>{
  const context={URL,document:{body:{innerText:''},querySelectorAll:()=>[{href:url},{href:url+'?tracking=1'},{href:'https://evil.test/Dress-p-1.html'}]}}
  assert.equal(vm.runInNewContext(`(${readSheinSearch.toString()})()`,context).urls.length,1)
  context.document.body.innerText='Je suis humain'
  assert.equal(vm.runInNewContext(`(${readSheinSearch.toString()})()`,context).error,'human_check')
})
test('PC sends its credential only to the fixed site and forbids redirects',async()=>{
  let called=false
  await apiCall('test-only',{action:'claim'},async(target,options)=>{called=true;assert.equal(target,'https://vinted-stock.vercel.app/api/collector');assert.equal(options.redirect,'error');return {ok:true,json:async()=>({job:null})}})
  assert.ok(called)
  for(const url of ['https://evil.test','https://user:pass@fr.shein.com/a','http://fr.shein.com/a'])assert.equal(allowedPage(url),false)
})
test('SKU search refuses a different SKU and stops on a human challenge',async()=>{
  let step=0,currentUrl
  const page={goto:async u=>{currentUrl=u},url:()=>currentUrl,waitForFunction:async()=>{},evaluate:async fn=>fn===readSheinSearch?{urls:[url]}:(step++,{error:'human_check'}),getByRole:()=>({first:()=>({count:async()=>0})})}
  assert.equal((await collect(page,{expected_sku:sku})).error,'human_check');assert.equal(step,1)
})
test('collector API rejects unsupported methods and prevents device tokens accessing admin actions',async()=>{
  let status,body
  const response={setHeader(){},status(s){status=s;return this},end(){},json(b){body=b;return this}}
  await handler({method:'DELETE',headers:{}},response);assert.equal(status,405)
  await handler({method:'POST',headers:{authorization:'Bearer svpc_invalid'},body:{action:'create_device'}},response)
  assert.equal(status,403);assert.match(body.error,/PC/)
})

test('French robot checks and visible challenge frames stop extraction',()=>{
  for(const phrase of ['Je ne suis pas un robot','Vérification de sécurité','Access denied']) {
    const context=domFixture();context.document.body.innerText=phrase
    assert.equal(vm.runInNewContext(`(${readSheinPage.toString()})()`,context).error,'human_check')
    assert.equal(vm.runInNewContext(`(${readSheinSearch.toString()})()`,context).error,'human_check')
  }
  const context=domFixture(),query=context.document.querySelectorAll
  context.document.querySelectorAll=q=>q==='iframe'?[{title:'Security challenge',src:'https://example.test/challenge',getClientRects:()=>[{}]}]:query(q)
  assert.equal(vm.runInNewContext(`(${readSheinPage.toString()})()`,context).error,'human_check')
})

test('navigation timeout preserves a visible human verification instead of changing product',async()=>{
  let navigations=0
  const page={goto:async()=>{navigations++;throw Error('Timeout')},evaluate:async()=>({error:'human_check'})}
  assert.equal((await collect(page,{...job,input:url})).error,'human_check')
  assert.equal(navigations,1)
})

test('manual recovery waits for a matching open product without any navigation or clicks',async()=>{
  const values=[{error:'human_check'},{...result(),supplier_sku:'wrong'},{...result(),supplier_url:'https://fr.shein.com/Other-p-1.html'},result()]
  let reads=0,prompts=0
  const page={url:()=>url,evaluate:async()=>values[reads++]}
  const recovered=await waitForOpenProduct(page,job,async()=>{prompts++;return ''},()=>{})
  assert.equal(recovered.result.supplier_sku,sku);assert.equal(reads,4);assert.equal(prompts,4)
  assert.deepEqual(await waitForOpenProduct(page,job,async()=>'Q'),{stop:true})
  assert.deepEqual(await waitForOpenProduct(page,job,async()=>'P'),{skip:true})
  assert.equal(reads,4)
})

test('resume renews only the blocked job owned by this PC, refusing paused or superseded jobs',async()=>{
  let update,filters=[]
  const query={update:p=>(update=p,query),eq:(k,v)=>(filters.push([k,v]),query),select:()=>query,maybeSingle:async()=>({data:{id:'job',lease:update.lease}})}
  const db={from:name=>{assert.equal(name,'catalog_collection_jobs');return query}}
  const row={id:'job',lease:'old'},device={id:'device',enabled:true}
  const saved=await resumeOpenCollection(db,device,row)
  assert.notEqual(saved.lease,'old');assert.equal(update.status,'running')
  assert.deepEqual(filters,[['id','job'],['collector_id','device'],['lease','old'],['status','blocked']])
  await assert.rejects(resumeOpenCollection(db,{...device,enabled:false},row),/pause/)
  query.maybeSingle=async()=>({data:null,error:{code:'23505'}})
  await assert.rejects(resumeOpenCollection(db,device,row),/relancée/)
  query.maybeSingle=async()=>({data:null})
  await assert.rejects(resumeOpenCollection(db,device,row),/relancée/)
})
