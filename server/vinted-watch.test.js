import test from 'node:test'
import assert from 'node:assert/strict'
import {execFileSync} from 'node:child_process'
import {mkdtempSync,writeFileSync,readFileSync} from 'node:fs'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {parseHTML} from 'linkedom'
import {watchReport,bannerAlertId,recordWatch,watchArchive,readWatchToken,newWatchToken,WATCH_FILES} from './vinted-watch.js'
import '../extensions/vinted-watch/read.js'

const page=(html,href)=>{const {document}=parseHTML(`<!doctype html><html><body>${html}</body></html>`);return globalThis.readVintedAccount(document,href)}
// Données Next.js telles que Vinted les met dans chaque page (structure réelle, valeurs fictives).
const flight=user=>`<script>self.__next_f.push([1,${JSON.stringify('5:{"translations":{"listing_restriction.info_banner.title":"Compte restreint jusqu\'au {date}"}}\n')}])</script>`+
  `<script>self.__next_f.push([1,${JSON.stringify(`92:["$","$L110",null,{"initialUserState":{"user":${JSON.stringify(user)},"other":1}}]\n`)}])</script>`
const user=(extra={})=>({id:3206068112,login:'compte_demo',about:'Coucou { les filles }',account_ban_date:null,action_restriction:null,is_account_banned:false,...extra})
const banner=`<div class="web_ui__InfoBanner__inner_content"><h4 class="web_ui__InfoBanner__title">Compte restreint jusqu'au 07/11/2027</h4><div class="web_ui__InfoBanner__body">Ton compte est restreint. Tu ne peux plus ajouter de nouveaux articles ni modifier tes annonces existantes jusqu'au 07/11/2027. <a href="/listing-restriction">En savoir plus.</a></div></div>`

test('the connected account and its restriction are read from the page data, on any Vinted page',()=>{
  const r=page(flight(user({action_restriction:{action:5,expiration_date:'2027-11-07'}})),'https://www.vinted.fr/')
  assert.deepEqual([r.status,r.until_date,r.member_id,r.login,r.source],['restricted','2027-11-07','3206068112','compte_demo','page_data'])
  assert.equal(page(flight(user()),'https://www.vinted.fr/catalog').status,'ok','no restriction: the account is fine')
  assert.equal(page(flight(user({is_account_banned:true})),'https://www.vinted.fr/').status,'blocked')
  assert.equal(page(flight(user({action_restriction:{action:5,expiration_date:'2020-01-01'}})),'https://www.vinted.fr/').status,'ok','an expired restriction is over')
})
test('the profile banner confirms the restriction; translations, listings and other pages never count',()=>{
  const r=page(flight(user())+banner,'https://www.vinted.fr/member/3206068112')
  assert.equal(r.status,'restricted');assert.equal(r.until_date,'2027-11-07');assert.match(r.message,/Tu ne peux plus ajouter/)
  assert.equal(page('<h1>Robe</h1><p>compte restreint jusqu\'au 01/01/2027 lol</p>','https://www.vinted.fr/items/5').status,'ok')
  assert.equal(page(flight(user()),'https://www.vinted.fr/').member_id,'3206068112')
  assert.equal(page('<p>Connecte-toi</p>','https://www.vinted.fr/').member_id,null,'logged out: nothing to report')
  assert.equal(page(banner,'https://evil.example/'),null)
  assert.equal(page('<div class="web_ui__InfoBanner__inner_content"><h4 class="web_ui__InfoBanner__title">Compte bloqué</h4><div>Nous avons définitivement bloqué ton compte.</div></div>','https://www.vinted.fr/').status,'permanent')
})
test('reports are validated: account number, state, freshness',()=>{
  const now=Date.parse('2026-11-06T21:00:00Z'),ok={member_id:'3206068112',status:'restricted',until_date:'2026-11-07',observed_at:'2026-11-06T20:59:00Z',login:' x ',message:'Compte restreint'}
  assert.deepEqual(watchReport({report:ok},now),{member_id:'3206068112',login:'x',status:'restricted',until_date:'2026-11-07',message:'Compte restreint',observed_at:'2026-11-06T20:59:00.000Z'})
  assert.throws(()=>watchReport({report:{...ok,member_id:'abc'}},now),/profil/)
  assert.throws(()=>watchReport({report:{...ok,status:'hacked'}},now))
  assert.throws(()=>watchReport({report:{...ok,observed_at:'2026-11-01T00:00:00Z'}},now),/ancien/)
  assert.equal(watchReport({report:{...ok,status:'blocked'}},now).until_date,null)
  const t=newWatchToken();assert.equal(readWatchToken(`Bearer ${t.token}`).id,t.id);assert.equal(readWatchToken('Bearer svpc_x'),null)
})
function fakeDb(state){
  return {from(table){
    const rows=state[table]||(state[table]=[]);let filters=[]
    const q={select(){return q},eq(k,v){filters.push(r=>String(r[k])===String(v));return q},ilike(k,v){filters.push(r=>String(r[k]).toLowerCase()===String(v).toLowerCase());return q},
      async maybeSingle(){return {data:rows.find(r=>filters.every(f=>f(r)))||null,error:null}},
      update(v){return {eq:async(k,val)=>{rows.filter(r=>r[k]===val).forEach(r=>Object.assign(r,v));return {error:null}}}},
      async upsert(row){const i=rows.findIndex(r=>r.id===row.id);if(i>=0)rows[i]=row;else rows.push(row);return {error:null}}}
    return q
  }}
}
test('a banner becomes the account state; the same banner keeps its first date; no banner lifts the earlier blocks',async()=>{
  const state={publication_accounts:[{id:'acc-1',login:'liloumln2',vinted_id:'3206068112'}],vinted_watch_keys:[{id:'k1'}],account_health_alerts:[]}
  const db=fakeDb(state),base={member_id:'3206068112',login:'liloumln2',status:'restricted',until_date:'2026-11-07',message:'Compte restreint jusqu\'au 07/11/2026 Ton compte est restreint.'}
  assert.deepEqual(await recordWatch(db,{id:'k1'},{...base,observed_at:'2026-11-06T20:00:00.000Z'}),{saved:true,account:'liloumln2',status:'restricted'})
  await recordWatch(db,{id:'k1'},{...base,observed_at:'2026-11-06T20:45:00.000Z'})
  const [row]=state.account_health_alerts
  assert.equal(row.id,bannerAlertId('acc-1'));assert.equal(row.kind,'page_banner');assert.equal(row.until_date,'2026-11-07');assert.equal(row.created_at,'2026-11-06T20:00:00.000Z')
  assert.equal(row.title,'Compte restreint jusqu\'au 07/11/2026')
  await recordWatch(db,{id:'k1'},{...base,status:'ok',until_date:null,message:'',observed_at:'2026-11-08T09:00:00.000Z'})
  assert.equal(state.account_health_alerts.length,1);assert.equal(state.account_health_alerts[0].kind,'page_ok');assert.equal(state.account_health_alerts[0].created_at,'2026-11-08T09:00:00.000Z')
  assert.equal(state.vinted_watch_keys[0].last_login,'liloumln2')
  assert.equal((await recordWatch(db,{id:'k1'},{...base,member_id:'999',login:'inconnu',observed_at:'2026-11-08T09:00:00.000Z'})).saved,false)
})
test('the downloaded archive is a valid extension carrying its own key',()=>{
  const dir=mkdtempSync(join(tmpdir(),'watch-')),zip=join(dir,'x.zip')
  writeFileSync(zip,watchArchive('svwk_test-token',name=>readFileSync(new URL(`../extensions/vinted-watch/${name}`,import.meta.url),'utf8')))
  const list=execFileSync('unzip',['-l',zip]).toString()
  for(const name of WATCH_FILES)assert.match(list,new RegExp(name.replace('.','\\.')))
  assert.match(execFileSync('unzip',['-p',zip,'config.js']).toString(),/svwk_test-token/)
  execFileSync('unzip',['-tq',zip])
  JSON.parse(execFileSync('unzip',['-p',zip,'manifest.json']).toString())
})
