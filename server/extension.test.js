import test from 'node:test'
import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'
import {createEngine,initialState,allowedPage,jobUrl,resultError,callApi} from '../extensions/shein/engine.js'
import {validateCollection} from './collector.js'

const sku='sz25052272411726746',url='https://fr.shein.com/Dress-p-90176146.html'
const row={id:'job-1',lease:'lease-1',input:url,expected_sku:sku,expected_supplier_id:'90176146'}
const product=()=>({supplier_url:url,supplier_sku:sku,title:'Robe',price:'32.64',price_text:'32,64€',currency:'EUR',color:'Nude',selected_size:'',photos:['https://img.ltwebstatic.com/photo.webp'],sizes:[],details:[],description:'',observed_at:new Date().toISOString()})
function fixture(job=row) {
  let saved={...initialState(),enabled:true},time=Date.now(),current=null,status='queued',value=product(),lost=false
  const requests=[],navigations=[],reads=[]
  const port={load:async()=>structuredClone(saved),save:async s=>{saved=structuredClone(s)},now:()=>time,
    createTab:async()=>{current={id:7,url:'about:blank',status:'complete'};return 7},tab:async id=>current?.id===id?current:null,
    navigate:async(id,target)=>{assert.equal(id,7);navigations.push(target);current={id,url:target,status:'complete'}},
    read:async(id,kind)=>{reads.push(kind);return kind==='search'?{urls:[url]}:structuredClone(value)},
    api:async body=>{
      requests.push(structuredClone(body))
      if(body.action==='claim'){if(status==='queued')status='running';return {job:status==='running'?structuredClone(job):null}}
      if(body.action==='heartbeat')return {enabled:true}
      if(body.action==='complete'){
        assert.equal(body.lease,job.lease);validateCollection(body.result,job);status='completed'
        if(lost){lost=false;throw Error('Connexion interrompue')}
        return {saved:true}
      }
      if(body.action==='fail'){status='blocked';return {saved:true}}
      if(body.action==='resume_blocked'){assert.equal(status,'blocked');status='running';job={...job,lease:'renewed'};return {job}}
      throw Error('Unexpected action')
    }}
  return {port,engine:createEngine(port),requests,navigations,reads,get state(){return saved},get status(){return status},
    set value(v){value=v},advance:ms=>{time+=ms},lostReply:()=>{lost=true},close:()=>{current=null},visit:u=>{current.url=u}}
}
test('link -> owned tab -> verified product -> library without per-product user action',async()=>{
  const f=fixture();await f.engine.tick();assert.equal(f.state.phase,'product')
  await f.engine.tick();assert.equal(f.state.phase,'idle');assert.equal(f.state.completed,1)
  assert.equal(f.requests.filter(r=>r.action==='complete').length,1)
  assert.deepEqual(f.navigations,[url]);assert.deepEqual(f.requests.at(-1).result.photos,product().photos)
})
test('SKU searches candidates and confirms exact SKU before saving',async()=>{
  const f=fixture({...row,input:sku,expected_supplier_id:null})
  await f.engine.tick();assert.equal(f.state.phase,'search')
  await f.engine.tick();await f.engine.tick()
  assert.deepEqual(f.navigations,[`https://fr.shein.com/pdsearch/${sku}/`,url]);assert.equal(f.state.completed,1)
})

test('single-color product opens its description before mandatory color validation',async()=>{
  const f=fixture();f.value={...product(),color:'',photos:[]};let expanded=0
  f.port.enrich=async()=>{expanded++;return {...product(),description:'Couleur: Nude'}}
  await f.engine.tick();await f.engine.tick()
  assert.equal(expanded,1);assert.equal(f.state.completed,1)
  for(const patch of [{supplier_sku:'wrong'},{error:'human_check'},{selected_size:'M'}]) {
    const other=fixture();other.value={...product(),...patch};other.port.enrich=()=>assert.fail('do not expand before identity and state validation')
    await other.engine.tick();await other.engine.tick()
    assert.equal(other.state.completed,0)
  }
})
test('wrong SKU never enters the library and does not stall the remaining queue',async()=>{
  const f=fixture();f.value={...product(),supplier_sku:'wrong'}
  await f.engine.tick();await f.engine.tick();assert.equal(f.state.phase,'idle');assert.equal(f.status,'blocked')
  assert.equal(f.requests.some(r=>r.action==='complete'),false)
  await f.engine.tick();assert.equal(f.requests.at(-1).action,'claim')
})
test('CAPTCHA pauses the entire queue; resume reads the same tab without reloading',async()=>{
  const f=fixture();await f.engine.tick();f.value={error:'human_check'};await f.engine.tick()
  assert.equal(f.state.phase,'blocked');const navs=f.navigations.length,reads=f.reads.length
  await createEngine(f.port).tick();assert.equal(f.reads.length,reads)
  await f.engine.command('resume');assert.equal(f.state.phase,'blocked');assert.equal(f.navigations.length,navs)
  f.value=product();await f.engine.command('resume')
  assert.equal(f.state.completed,1);assert.equal(f.navigations.length,navs)
  assert.equal(f.requests.find(r=>r.action==='resume_blocked').keep_page,true)
  assert.equal(f.requests.at(-1).lease,'renewed')
})
test('lost completion reply survives worker restart and reuses the same lease and result',async()=>{
  const f=fixture();await f.engine.tick();f.lostReply();await f.engine.tick()
  assert.equal(f.state.outbox.action,'complete');const original=structuredClone(f.state.outbox)
  await createEngine(f.port).tick();assert.equal(f.state.completed,1);assert.deepEqual(f.requests.at(-1),original)
  assert.equal(f.navigations.length,1)
})
test('a bad product is left for review automatically, but a CAPTCHA cannot be skipped',async()=>{
  const f=fixture();await f.engine.tick();f.value={...product(),supplier_sku:'wrong'};await f.engine.tick()
  await f.engine.command('skip');assert.equal(f.state.phase,'idle');assert.equal(f.status,'blocked')
  const captcha=fixture();await captcha.engine.tick();captcha.value={error:'human_check'};await captcha.engine.tick()
  await captcha.engine.command('skip');assert.equal(captcha.state.phase,'blocked');assert.equal(captcha.navigations.length,1)
})
test('expired or excluded job drops the stale result and stops, without claiming another',async()=>{
  const f=fixture();await f.engine.tick();f.port.api=async()=>{throw Object.assign(Error('Récupération expirée'),{status:409})}
  await f.engine.tick();assert.equal(f.state.enabled,false);assert.equal(f.state.job,null);assert.equal(f.state.outbox,null)
})
test('revoked credentials stop the collector',async()=>{
  const f=fixture();f.port.api=async()=>{throw Object.assign(Error('Revoked'),{status:401})}
  await f.engine.tick();assert.equal(f.state.enabled,false)
})
test('closing or redirecting the owned tab blocks, never takes over another tab',async()=>{
  for(const method of ['close','redirect']){
    const f=fixture();await f.engine.tick();if(method==='close')f.close();else f.visit('https://example.com/')
    await f.engine.tick();assert.equal(f.state.phase,'blocked');assert.equal(f.reads.length,0);assert.equal(f.navigations.length,1)
  }
})
test('selected-size, missing-color, missing-photo and unreadable-price observations never save',async()=>{
  for(const patch of [{selected_size:'M'},{color:''},{photos:[]},{error:'price_unreadable'}]){
    const f=fixture();await f.engine.tick();f.advance(61000);f.value={...product(),...patch};await f.engine.tick()
    assert.equal(f.state.phase,'idle');assert.equal(f.status,'blocked');assert.equal(f.requests.some(r=>r.action==='complete'),false)
  }
})
test('missing color in the first item does not prevent automatic completion of the next one',async()=>{
  const f=fixture(),queue=[{...row,id:'missing-color'},{...row,id:'next-product'}],finished=[]
  f.port.api=async body=>{
    if(body.action==='claim')return {job:queue.shift()||null}
    if(body.action==='heartbeat')return {enabled:true}
    if(body.action==='complete')validateCollection(body.result,row)
    if(['fail','complete'].includes(body.action)){finished.push([body.job_id,body.action]);return {saved:true}}
    throw Error('Unexpected action')
  }
  f.port.read=async()=>({...product(),color:f.state.job.id==='missing-color'?'':'Nude'})
  await f.engine.tick();f.advance(61000);await f.engine.tick()
  assert.equal(f.state.job,null);assert.equal(f.state.phase,'idle')
  await f.engine.tick();await f.engine.tick()
  assert.deepEqual(finished,[['missing-color','fail'],['next-product','complete']])
  assert.equal(f.state.completed,1);assert.equal(f.state.reviewed,1)
})
test('loading gets time to finish; a slow unreadable page then blocks',async()=>{
  const f=fixture();await f.engine.tick();f.value={error:'page_unavailable'}
  await f.engine.tick();assert.equal(f.state.phase,'product');f.advance(61000)
  await f.engine.tick();assert.equal(f.state.phase,'blocked')
})
test('a local pause prevents reads and API calls until Start',async()=>{
  const f=fixture();await f.engine.command('pause');await f.engine.tick();assert.equal(f.requests.length,0)
  await f.engine.command('start');assert.equal(f.state.phase,'product')
})
test('device disabled on the site stops before visiting Shein',async()=>{
  const f=fixture();f.port.api=async()=>({paused:true,job:null});await f.engine.tick()
  assert.equal(f.state.enabled,false);assert.equal(f.navigations.length,0)
})
test('URLs, manifest permissions and API credential destination remain constrained',async()=>{
  for(const value of ['https://evil.test/','http://fr.shein.com/','https://user:pass@fr.shein.com/','https://fr.shein.com:8080/','https://fr.shein.com.evil.test/'])assert.equal(allowedPage(value),false)
  assert.throws(()=>jobUrl({input:'https://evil.test',expected_sku:'../../'}))
  assert.equal(resultError({...product(),supplier_url:'https://evil.test/'},row),'page_unavailable')
  await callApi('test-only',{action:'claim'},async(target,options)=>{
    assert.equal(target,'https://vinted-stock.vercel.app/api/collector');assert.equal(options.redirect,'error');assert.equal(options.credentials,'omit');assert.equal(options.headers.Authorization,'Bearer test-only');return {ok:true,json:async()=>({job:null})}
  })
  const manifest=JSON.parse(readFileSync(new URL('../extensions/shein/manifest.json',import.meta.url)))
  assert.deepEqual(manifest.permissions,['storage','alarms','scripting'])
  assert.deepEqual(manifest.host_permissions,['https://fr.shein.com/*','https://www.shein.com/*','https://vinted-stock.vercel.app/*'])
  assert.equal(manifest.externally_connectable,undefined)
  assert.equal(readFileSync(new URL('../extensions/shein/extract.mjs',import.meta.url),'utf8'),readFileSync(new URL('../tools/shein-collector/extract.mjs',import.meta.url),'utf8'))
})
