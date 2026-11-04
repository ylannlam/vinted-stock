import test from 'node:test'
import assert from 'node:assert/strict'
import {normalizeHealthAlert,healthReportInput,syncHealth,handleAccountHealth,readHealth} from './account-health.js'
import {publicationAccount} from '../src/lib/publications.js'
import {healthView,remainingHealthTime} from '../src/lib/accountHealth.js'
import {boardSection} from '../src/lib/teamBoard.js'
import {resourcesHandler} from '../api/resources.js'
const id='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',account='bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',now=Date.parse('2026-11-04T18:00:00Z')
const alert=(patch={})=>({id,vinted_account_id:account,group:'vinted',severity:'blocking',resolved:false,created_at:'2026-11-04T17:00:00Z',title:'Votre compte est temporairement bloqué',body:'',...patch})
test('only an explicit account alert is classified as a ban; captcha and API failures are different',()=>{
  assert.equal(normalizeHealthAlert(alert()).status,'temporary')
  assert.equal(normalizeHealthAlert(alert({title:'Compte temporairement bloqué'})).status,'temporary')
  assert.equal(normalizeHealthAlert(alert({title:'Votre compte Vinted a été définitivement bloqué'})).status,'permanent')
  assert.equal(normalizeHealthAlert(alert({title:'Your account has been suspended'})).status,'blocked')
  assert.equal(normalizeHealthAlert(alert({group:'captchas',title:'Captcha demandé'})).status,'verification')
  for(const title of ['Annonce supprimée','Votre article a été bloqué','Cette annonce a été supprimée avant la synchronisation'])assert.equal(normalizeHealthAlert(alert({title})),null)
  assert.equal(normalizeHealthAlert(alert({title:'Si votre compte est banni, contactez le support'})).status,'review')
  assert.equal(normalizeHealthAlert(alert({title:'Bridge déconnecté',severity:'warning'})),null)
  assert.equal(normalizeHealthAlert({status:403}),null)
  assert.equal(normalizeHealthAlert(alert({vinted_account_id:null})),null)
})
test('a deadline expiring never declares the account restored, and absence of alerts means unknown',()=>{
  assert.equal(healthView({},now).status,'unknown')
  const report={status:'temporary',checked_at:'2026-11-03T17:00:00Z',until_at:'2026-11-04T17:00:00Z'}
  const h=healthView({report},now);assert.equal(h.status,'review');assert.equal(h.attention,true);assert.equal(h.expired,true)
  assert.equal(boardSection({health:h,vinted:{creation_stage:'ready'}},now),'blocked')
  assert.match(remainingHealthTime('2026-11-05T17:00:00Z',now),/23 h/)
  assert.match(remainingHealthTime(null,now),/non communiquée/)
})
test('manual confirmation acknowledges old alerts but new ones and native restrictions still win',()=>{
  const report={status:'ok',checked_at:new Date(now).toISOString()},a=normalizeHealthAlert(alert())
  assert.equal(healthView({report,alerts:[a]},now).status,'ok')
  assert.equal(healthView({report,alerts:[{...a,created_at:'2026-11-04T18:01:00Z'}]},now).status,'temporary')
  assert.equal(healthView({report,native:{statut:'banni_def'}},now).status,'permanent')
  assert.equal(healthView({alerts:[{...a,resolved:true}]},now).status,'unknown')
})
test('manual reports reject invalid identifiers, stale versions, dates and oversize notes',()=>{
  const base={account_id:account,version:0,status:'temporary',reason:'',until_at:'2026-11-05T18:00:00Z'}
  assert.equal(Date.parse(healthReportInput(base,now).until_at),Date.parse(base.until_at))
  for(const patch of [{account_id:'x'},{version:-1},{status:'active'},{until_at:'tomorrow'},{until_at:'2026-11-03T18:00:00Z'},{status:'ok'},{reason:'x'.repeat(1001)}])assert.throws(()=>healthReportInput({...base,...patch},now))
  assert.equal(healthReportInput({...base,until_at:null},now).until_at,null)
})
function dbMock({claim=true,conflict=false}={}){
  const writes=[]
  return {writes,from(table){let patch,filters=[],mode,one=false
    const q={select(){return q},eq(k,v){filters.push([k,v]);return q},lte(){return q},update(v){patch=v;mode='update';return q},upsert(v){patch=v;mode='upsert';return q},insert(v){patch=v;mode='insert';return q},maybeSingle(){one=true;return q},single(){one=true;return q},then(resolve){
      if(patch)writes.push({table,patch,mode,filters})
      const data=table==='publication_accounts'?{id:account}:table==='account_health_sync'&&patch?.last_attempt_at?claim?{id:true}:null:null
      return Promise.resolve({data,error:table==='account_health_reports'&&conflict?{code:'23505'}:null}).then(resolve)
    }};return q
  }}
}
test('notification sync is read-only on Dotb, follows pages and persists resolved notices',async()=>{
  const db=dbMock(),calls=[]
  const fetcher=async(url,opts)=>{calls.push({url,opts});assert.equal(opts.method,undefined);const q=new URL(url).searchParams;return {ok:true,json:async()=>q.get('group')==='captchas'?{data:[],has_more:false}:q.get('cursor')?{data:[alert({resolved:true,title:'Accès rétabli'})],has_more:false}:{data:[alert()],has_more:true,next_cursor:'next'}}}
  assert.deepEqual(await syncHealth(db,{fetcher,token:'test',now}),{refreshed:true})
  assert.equal(calls.length,3);assert.ok(calls.every(c=>!c.url.includes('live-')))
  assert.ok(db.writes.some(w=>w.table==='account_health_alerts'&&w.mode==='upsert'))
  assert.ok(db.writes.some(w=>w.patch.resolved===true&&w.filters.some(([k,v])=>k==='id'&&v===id)))
})
test('concurrent refresh uses cache; missing permission is explicit and never clears stored alerts',async()=>{
  assert.deepEqual(await syncHealth(dbMock({claim:false}),{fetcher:()=>{throw Error('must not fetch')},now}),{cached:true})
  const db=dbMock(),r=await syncHealth(db,{fetcher:async()=>({ok:false,status:403}),token:'test',now})
  assert.match(r.error,/notifications_read/);assert.ok(db.writes.every(w=>w.table==='account_health_sync'))
})
test('repeating cursor fails safely rather than looping or clearing old reports',async()=>{
  let calls=0;const result=await syncHealth(dbMock(),{token:'test',now,fetcher:async()=>{calls++;return {ok:true,json:async()=>({data:[alert()],has_more:true,next_cursor:'same'})}}})
  assert.equal(calls,2);assert.equal(result.refreshed,false)
})
test('saving a report requires optimistic concurrency and only updates the matching account',async()=>{
  const db=dbMock({conflict:true})
  await assert.rejects(handleAccountHealth({method:'POST',body:{action:'report',account_id:account,version:0,status:'review',reason:''}},{db,user:{id}}),/statut a changé/)
  await assert.rejects(handleAccountHealth({method:'DELETE'},{db,user:{id}}),/Méthode/)
})
test('health endpoint retains the existing administrator authorization boundary',async()=>{
  let roles;const res={setHeader(){},status(){return this},json(){throw Error('unauthorized request cannot read data')}}
  await resourcesHandler(async(req,res,r)=>{roles=r;return null})({method:'GET',query:{scope:'health'}},res)
  assert.deepEqual(roles,['admin'])
})
test('read status links to an AdsPower profile by exact login and keeps the native deadline',async()=>{
  const tables={publication_accounts:[{id:account,login:'Mode.Paris',source_present:true}],account_health_reports:[],account_health_alerts:[],account_health_sync:[{id:true,error:null}],vinted_accounts:[{id,pseudo:'mode.paris',statut:'banni_temp',deban_at:'2026-11-05T18:00:00Z',deleted_at:null}]}
  const db={from(name){let filters=[],start=0,end=999,single=false;const q={select(){return q},eq(k,v){filters.push(r=>r[k]===v);return q},is(k,v){filters.push(r=>(r[k]??null)===v);return q},order(){return q},range(s,e){start=s;end=e;return q},single(){single=true;return q},then(resolve){const rows=(tables[name]||[]).filter(r=>filters.every(f=>f(r)));return Promise.resolve({error:null,count:rows.length,data:single?rows[0]:rows.slice(start,end+1)}).then(resolve)}};return q}}
  const result=await readHealth(db)
  const matched=publicationAccount({id:'profile',name:'MODE.PARIS'},result.accounts)
  assert.equal(matched.id,account);assert.equal(matched.native.deban_at,'2026-11-05T18:00:00Z')
  assert.equal(healthView(matched,now).status,'temporary')
  assert.equal(publicationAccount({id:'profile',name:'Wrong'},result.accounts),null)
})
