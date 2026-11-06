import test from 'node:test'
import assert from 'node:assert/strict'
import {normalizeHealthAlert,healthReportInput,restrictionDate,syncHealth,handleAccountHealth,readHealth,healthNativeLink} from './account-health.js'
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
test('partial restrictions are recognized even as info notices, without being promoted to permanent bans',()=>{
  for(const title of ['Votre compte est temporairement restreint','Compte restreint','Votre compte Vinted a été limité','Nous avons temporairement restreint votre compte','Certaines fonctionnalités de votre compte sont temporairement suspendues','Vous ne pouvez plus envoyer des messages','Your account is temporarily restricted']){
    const h=normalizeHealthAlert(alert({title,severity:'info'}));assert.equal(h?.status,'restricted',title)
  }
  assert.equal(normalizeHealthAlert(alert({group:'dotb',title:'Votre compte est temporairement restreint',severity:'warning'})).status,'restricted')
  for(const title of ['Les restrictions ont été levées','Votre compte n’est plus restreint','Account restrictions have been lifted','Cette annonce est limitée','Le compte de votre acheteur est restreint','Votre compte pourrait être restreint','Si votre compte est restreint, contactez-nous'])assert.equal(normalizeHealthAlert(alert({title,severity:'info'})),null,title)
})
test('restrictions retain deadlines and visibility reports are shown without asserting a ban',()=>{
  const input={account_id:account,version:0,status:'restricted',reason:'Messages limités',until_at:'2026-11-05T18:00:00Z'}
  const report=healthReportInput(input,now)
  assert.equal(healthView({report},now).status,'restricted')
  assert.equal(healthView({report},now+86400000).expired,true)
  assert.equal(healthView({report},now+86400000).status,'review')
  assert.equal(boardSection({health:healthView({report},now),vinted:{statut:'actif',creation_stage:'ready'}},now),'blocked')
  assert.equal(healthView({native:{statut:'actif',is_shadowbanned:true}},now).status,'restricted')
  assert.equal(healthView({report:{status:'ok',checked_at:new Date(now).toISOString()},alerts:[normalizeHealthAlert(alert({title:'Compte restreint'}))]},now).status,'ok')
})
test('the profile 78 message keeps its date without fabricating an hour or a permanent ban',()=>{
  const title="Compte restreint jusqu'au 05/11/2026",body="Ton compte est restreint. Tu ne peux plus ajouter de nouveaux articles ni modifier tes annonces existantes jusqu'au 05/11/2026."
  const a=normalizeHealthAlert(alert({title,body,severity:'info'}))
  assert.equal(a.status,'restricted');assert.equal(a.until_date,'2026-11-05');assert.equal(a.until_at,undefined)
  assert.equal(normalizeHealthAlert(alert({title,body:null,severity:'info'})).status,'restricted')
  assert.match(remainingHealthTime(null,now,a.until_date),/05\/11\/2026 · heure non précisée/)
  assert.equal(healthView({alerts:[a]},now).status,'restricted')
  const nextDay=healthView({alerts:[a]},Date.parse('2026-11-04T23:30:00Z'))
  assert.equal(nextDay.status,'review');assert.equal(nextDay.attention,true);assert.match(nextDay.label,/Date annoncée/)
  assert.equal(restrictionDate("jusqu’au 31/02/2026"),null)
  assert.equal(restrictionDate("jusqu'au 05/11/2026 puis jusqu'au 06/11/2026"),null)
  assert.equal(restrictionDate('dans 24 heures'),null)
  const input={account_id:account,version:0,status:'restricted',reason:body,until_date:'2026-11-05'}
  assert.equal(healthReportInput(input,now).until_at,null)
  for(const patch of [{until_date:0},{until_date:'2026-02-31'},{until_date:'2026-11-03'},{status:'ok'},{until_at:'2026-11-05T18:00:00Z'}])assert.throws(()=>healthReportInput({...input,...patch},now))
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
    const q={select(){return q},or(){return q},eq(k,v){filters.push([k,v]);return q},in(k,v){filters.push([k,v]);return q},lte(){return q},update(v){patch=v;mode='update';return q},upsert(v){patch=v;mode='upsert';return q},insert(v){patch=v;mode='insert';return q},maybeSingle(){one=true;return q},single(){one=true;return q},then(resolve){
      if(patch)writes.push({table,patch,mode,filters})
      const data=table==='publication_accounts'?{id:account}:table==='account_health_sync'&&patch?.last_attempt_at?claim?{id:true}:null:table==='account_health_alerts'&&!patch?[normalizeHealthAlert(alert())]:null
      return Promise.resolve({data,error:table==='account_health_reports'&&conflict?{code:'23505'}:null}).then(resolve)
    }};return q
  }}
}
test('notification sync is read-only on Dotb, follows pages and persists resolved notices',async()=>{
  const db=dbMock(),calls=[]
  const fetcher=async(url,opts)=>{calls.push({url,opts});assert.equal(opts.method,undefined);const q=new URL(url).searchParams;return {ok:true,json:async()=>q.get('group')!=='vinted'?{data:[],has_more:false}:q.get('cursor')?{data:[alert({resolved:true,title:'Accès rétabli'})],has_more:false}:{data:[alert()],has_more:true,next_cursor:'next'}}}
  assert.deepEqual(await syncHealth(db,{fetcher,token:'test',now}),{refreshed:true})
  assert.equal(calls.length,4);assert.ok(calls.every(c=>!c.url.includes('live-')))
  assert.ok(!calls.some(c=>new URL(c.url).searchParams.get('group')==='smart_agent'),'buyer conversations are never read')
  assert.ok(calls.some(c=>new URL(c.url).searchParams.get('group')==='dotb'))
  assert.ok(db.writes.some(w=>w.table==='account_health_alerts'&&w.mode==='upsert'))
  assert.ok(db.writes.some(w=>Array.isArray(w.patch)&&w.patch.some(n=>n.id===id&&n.resolved===true)))
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
function healthDatabase(tables){
  return {from(name){let filters=[],start=0,end=999,single=false;const q={select(){return q},or(expr){filters.push(r=>expr.split(',').some(part=>{const [k,,v]=part.split('.');return String(r[k]??'')===v}));return q},eq(k,v){filters.push(r=>r[k]===v);return q},is(k,v){filters.push(r=>(r[k]??null)===v);return q},order(){return q},range(s,e){start=s;end=e;return q},single(){single=true;return q},then(resolve){const rows=(tables[name]||[]).filter(r=>filters.every(f=>f(r)));return Promise.resolve({error:null,count:rows.length,data:single?rows[0]:rows.slice(start,end+1)}).then(resolve)}};return q}}
}
test('read status links to an AdsPower profile by exact login and keeps the native deadline',async()=>{
  const tables={publication_accounts:[{id:account,login:'Mode.Paris',source_present:true}],account_health_reports:[],account_health_alerts:[],account_health_sync:[{id:true,error:null}],vinted_accounts:[{id,pseudo:'mode.paris',statut:'banni_temp',deban_at:'2026-11-05T18:00:00Z',deleted_at:null}]}
  const result=await readHealth(healthDatabase(tables))
  const matched=publicationAccount({id:'profile',name:'MODE.PARIS'},result.accounts)
  assert.equal(matched.id,account);assert.equal(matched.native.deban_at,'2026-11-05T18:00:00Z')
  assert.equal(healthView(matched,now).status,'temporary')
  assert.equal(publicationAccount({id:'profile',name:'Wrong'},result.accounts),null)
})

test('health uses the same explicit profile links and owner priority as Alicia when a pseudo changes',async()=>{
  const other='cccccccc-cccc-4ccc-8ccc-cccccccccccc'
  const tables={
    publication_accounts:[{id:account,login:'nouveau.pseudo',source_present:true}],
    publication_profile_links:[{owner_id:id,profile_id:'own',account_id:account},{owner_id:other,profile_id:'other',account_id:account}],
    adspower_preferences:[{owner_id:other,profiles:[{id:'other',number:'99'}]},{owner_id:id,profiles:[{id:'own',number:'75',name:'Nom différent / OUI'}]}],
    vinted_accounts:[{id:'native',pseudo:'ancien.pseudo',ads_power_num:75,statut:'banni_temp',deban_at:'2026-11-05T18:00:00Z'},{id:'another',pseudo:'nouveau.pseudo',ads_power_num:99,statut:'actif'}],
    account_health_reports:[{account_id:account,status:'review',reason:'À conserver',version:2}],account_health_sync:[{id:true,error:null}]
  }
  const result=await handleAccountHealth({method:'GET'},{db:healthDatabase(tables),user:{id}})
  const found=result.accounts[0]
  assert.equal(found.native.id,'native');assert.equal(found.health.status,'temporary')
  assert.equal(found.health.until_at,'2026-11-05T18:00:00Z')
  assert.deepEqual(found.native_link,{by:'profile_number',profile_number:'75',ambiguous:false})
  assert.equal(found.report.reason,'À conserver');assert.equal(found.report.version,2)
  tables.publication_profile_links=[];tables.adspower_preferences[1].profiles[0].name='NOUVEAU.PSEUDO'
  assert.equal((await readHealth(healthDatabase(tables),{ownerId:id})).accounts[0].native.id,'native','exact profile names remain a fallback when there is no explicit link')
})

test('native restrictions are never assigned from duplicated or archived account records',()=>{
  const a={login:'mode.paris'},profile={number:'75'}
  const active={id:'active',pseudo:'ancien',ads_power_num:75},archived={...active,id:'archive',deleted_at:'2026-01-01'}
  assert.equal(healthNativeLink(a,profile,[archived,active]).account.id,'active')
  const duplicate=healthNativeLink(a,profile,[active,{...active,id:'duplicate'},{id:'pseudo',pseudo:'mode.paris'}])
  assert.equal(duplicate.account,null);assert.equal(duplicate.ambiguous,true)
  assert.equal(healthNativeLink(a,null,[{pseudo:'MODE.PARIS'},{pseudo:'mode.paris'}]).account,null)
  assert.equal(healthNativeLink(a,profile,[archived]).account,null)
  assert.equal(healthNativeLink(a,{number:'123'},[{id:'pseudo',pseudo:'MODE.PARIS'}]).by,'pseudo')
})

test('the Dotb alert type is read first: restriction, ban, lifted restriction; listing alerts are ignored',async()=>{
  const {kindStatus}=await import('./account-health.js')
  assert.equal(kindStatus('vinted_account_restricted'),'restricted')
  assert.equal(kindStatus('account.banned'),'blocked')
  assert.equal(kindStatus('account_suspended','suspension définitive'),'permanent')
  assert.equal(kindStatus('account_restriction_lifted'),'recovered')
  for(const kind of ['item_blocked','listing_restricted','order_created','publish_failed','daily_limit_reached',''])assert.equal(kindStatus(kind),null)
  assert.equal(normalizeHealthAlert(alert({kind:'vinted_account_restricted',title:'Alerte',body:'',severity:'warning'})).status,'restricted')
  assert.equal(normalizeHealthAlert(alert({kind:'vinted_account_restricted',params:{restricted_until:'2026-11-09T10:00:00Z'},title:'Alerte'})).until_date,'2026-11-09')
  assert.equal(normalizeHealthAlert(alert({kind:'account_restriction_lifted',title:'Ton compte est restreint'})).kind,'recovered')
  assert.equal(normalizeHealthAlert(alert({kind:'item_blocked',title:'Annonce bloquée'})),null)
  assert.equal(normalizeHealthAlert(alert({kind:'captcha_required',group:'captchas',title:'Vérification'})).status,'verification')
})
test('wordings naming the account or titled as a restriction are detected, with their end date',()=>{
  const r=normalizeHealthAlert(alert({title:'Restriction de compte',body:'Le compte lilyaapm est restreint jusqu’au 05/11/2026.',severity:'warning'}))
  assert.equal(r.status,'restricted');assert.equal(r.until_date,'2026-11-05')
  assert.equal(normalizeHealthAlert(alert({title:'Compte restreint : fleurlicia',severity:'warning'})).status,'restricted')
  assert.equal(normalizeHealthAlert(alert({title:'Info',body:'Ton compte fait l’objet d’une restriction jusqu’au 9 novembre 2026',severity:'info'})).until_date,'2026-11-09')
  assert.equal(normalizeHealthAlert(alert({title:'Le compte lauriepmn a été désactivé',severity:'warning'})).status,'blocked')
  assert.equal(normalizeHealthAlert(alert({title:'Suspension définitive du compte',severity:'warning'})).status,'permanent')
  assert.equal(normalizeHealthAlert(alert({group:'smart_agent',title:'Votre compte est restreint',severity:'warning'})),null,'a buyer message is never an account alert')
})
test('every account notification is archived, and a live webhook alert updates the account at once',async()=>{
  const {archiveRow,receiveNotification}=await import('./account-health.js')
  const row=archiveRow(alert({kind:'vinted_account_restricted',params:{until:'2026-11-09'}}),'2026-11-04T18:00:00.000Z')
  assert.deepEqual([row.grp,row.kind,row.account_id,row.params.until],['vinted','vinted_account_restricted',account,'2026-11-09'])
  assert.equal(archiveRow(alert({group:'orders'})),null,'order notifications are not archived')
  const writes=[]
  const db={from:table=>({upsert:async rows=>{writes.push({table,rows});return {error:null}},select:()=>({in:async()=>({data:[],error:null})})})}
  const r=await receiveNotification(db,alert({title:'Votre compte est restreint'}),now)
  assert.equal(r.alert,'restricted')
  assert.deepEqual(writes.map(w=>w.table),['dotb_notifications','account_health_alerts'])
  const before={from:table=>({upsert:async rows=>table==='dotb_notifications'?{error:{code:'42P01'}}:(writes.push({table,rows}),{error:null}),select:()=>({in:async()=>({data:[],error:null})})})}
  assert.equal((await receiveNotification(before,alert(),now)).alert,'temporary','a database not yet updated still detects the account')
})

// Messages Vinted réels relayés par Dotb (pseudos remplacés).
const notice=(title,body,created_at='2026-11-04T22:01:26Z')=>alert({kind:'vinted_notice',severity:'info',title,body,created_at})
test('real Vinted notices: automation block, unblock, 5-day restriction, permanent ban, hidden listings',async()=>{
  const {openAlerts}=await import('./account-health.js')
  const blocked=normalizeHealthAlert(notice('Compte bloqué : automatisation détectée','compte1 Salut, on a remarqu&eacute; une activit&eacute; automatis&eacute;e sur ton compte, ce qui va &agrave; l\'encontre de nos Conditions g&eacute;n&eacute;rales .','2026-11-04T09:27:34Z'))
  assert.equal(blocked.status,'temporary');assert.match(blocked.body,/remarqué une activité automatisée/)
  const unblocked=normalizeHealthAlert(notice('Compte bloqué : automatisation détectée','Bonjour compte1, Ton compte a été débloqué. Tu peux à nouveau modifier tes annonces et mettre en ligne de nouveaux articles.','2026-11-05T14:09:51Z'))
  assert.equal(unblocked.kind,'recovered');assert.equal(unblocked.resolved,true)
  const restricted=normalizeHealthAlert(notice('Restriction de vente pendant 5 jours','compte2, Certaines activités sur ton compte semblent enfreindre nos Règles du catalogue relatives aux activités commerciales . Par conséquent, nous t\'imposons une restriction de 5 jours pendant laq'))
  assert.equal(restricted.status,'restricted');assert.equal(restricted.until_date,'2026-11-09','same date as the Vinted banner « jusqu’au 09/11/2026 »')
  assert.equal(normalizeHealthAlert(notice('Compte bloqué : Activité frauduleuse','Bonjour compte3, Nous avons définitivement bloqué votre compte Vinted en raison d\'une activité frauduleuse')).status,'permanent')
  for(const [title,body] of [['Important : annonce masquée','Bonjour compte4, Une annonce que tu as publiée sur Vinted semble contenir des photos de mauvaise qualité'],['Annonce(s) masquée(s) : problème lié aux photos','Bonjour compte4, Il semblerait que certaines photos'],['Important : article supprimé','Bonjour compte4, Un article que vous avez mis en ligne'],['Annonce supprimée : annonces en double','Bonjour compte4, Nous avons des raisons de croire']])
    assert.equal(normalizeHealthAlert(notice(title,body)),null,title)
  // Blocage puis déblocage puis nouveau blocage : seul le dernier blocage compte.
  const later={...blocked,id:'later',created_at:'2026-11-06T10:00:00.000Z'}
  assert.deepEqual(openAlerts([blocked,unblocked]),[])
  assert.deepEqual(openAlerts([blocked,unblocked,later]).map(a=>a.id),['later'])
  assert.equal(healthView({alerts:openAlerts([restricted])},Date.parse('2026-11-06T12:00:00Z')).status,'restricted')
  assert.equal(healthView({alerts:openAlerts([restricted])},Date.parse('2026-11-09T12:00:00Z')).status,'review','on the end date the account is shown as to check')
})
test('a Vinted page reading overrides older Dotb alerts and confirms access for a day',async()=>{
 const {openAlerts}=await import('./account-health.js')
 const dotb={id:'d',kind:'vinted_notice',status:'temporary',resolved:false,created_at:'2026-11-06T20:33:00Z'}
 const banner={id:'p',kind:'page_banner',status:'restricted',until_date:'2026-11-07',resolved:false,created_at:'2026-11-06T20:56:00Z',observed_at:'2026-11-06T21:40:00Z'}
 const now=Date.parse('2026-11-06T22:00:00Z')
 assert.deepEqual(openAlerts([dotb,banner],now).map(a=>a.id),['p'])
 const h=healthView({alerts:openAlerts([dotb,banner],now)},now);assert.equal(h.status,'restricted');assert.equal(h.source,'page')
 const ok={id:'o',kind:'page_ok',status:'review',resolved:true,created_at:'2026-11-06T21:00:00Z',observed_at:'2026-11-06T21:00:00Z'}
 assert.equal(healthView({alerts:openAlerts([dotb,ok],now)},now).label,'Accès confirmé')
 const later={...dotb,id:'l',created_at:'2026-11-06T21:30:00Z'}
 assert.equal(healthView({alerts:openAlerts([ok,later],now)},now).status,'temporary','a newer Dotb alert still wins')
 assert.equal(healthView({alerts:openAlerts([ok],Date.parse('2026-11-08T12:00:00Z'))}).status,'unknown','an old confirmation expires')
})
