import test from 'node:test'
import assert from 'node:assert/strict'
import {parseHTML} from 'linkedom'
import {build} from 'esbuild'
import {createRequire,Module} from 'node:module'
import {fileURLToPath} from 'node:url'
import {vintedItemId,vintedItemUrl,readTeamBoard,markPublished,readBoardRows} from './team-board.js'
import {handleListingStudio} from './listing-studio.js'
import {boardSection,groupBoard,sinceLabel,stateLabel} from '../src/lib/teamBoard.js'

const me='11111111-1111-4111-8111-111111111111',ylann='22222222-2222-4222-8222-222222222222'
const A='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',B='bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',C='cccccccc-cccc-4ccc-8ccc-cccccccccccc'
const draftId='dddddddd-dddd-4ddd-8ddd-dddddddddddd'

// Minimal Supabase stand-in: filters eq / neq / is / in, range, limit, update with version, rpc.
function database(tables,rpc={}) {
  const calls=[]
  return {tables,calls,rpc:async(name,args)=>{calls.push(['rpc',name,args]);return {data:rpc[name]?.(args)??null,error:null}},from(table){
    let filters=[],patch=null,single=false,limit=Infinity,offset=0
    const rows=()=>(tables[table]||[]).filter(r=>filters.every(f=>f(r)))
    const run=()=>{let data=rows();if(patch){data.forEach(r=>Object.assign(r,patch));calls.push(['update',table,patch])}data=structuredClone(data.slice(offset,offset+limit));return {count:rows().length,data:single?data[0]||null:data,error:null}}
    const q={select(){return q},order(){return q},range(start,end){offset=start;limit=end-start+1;return q},eq(k,v){filters.push(r=>r[k]===v);return q},neq(k,v){filters.push(r=>r[k]!==v);return q},is(k,v){filters.push(r=>(r[k]??null)===v);return q},in(k,v){filters.push(r=>v.includes(r[k]));return q},limit(n){limit=n;return q},update(p){patch=p;return q},maybeSingle(){single=true;return Promise.resolve(run())},single(){return q.maybeSingle()},then(resolve){return Promise.resolve(run()).then(resolve)}}
    return q
  }}
}
const tables=()=>({
  publication_accounts:[{id:A,login:'body.paris',source_present:true},{id:B,login:'mode.lyon',source_present:true},{id:C,login:'old.account',source_present:true}],
  publication_profile_links:[{owner_id:ylann,profile_id:'p-a-ylann',account_id:A},{owner_id:me,profile_id:'p-a-me',account_id:A},{owner_id:ylann,profile_id:'p-b',account_id:B}],
  adspower_preferences:[{owner_id:me,profiles:[{id:'p-a-me',number:'12',name:'Body Paris'}]},{owner_id:ylann,profiles:[{id:'p-a-ylann',number:'99'},{id:'p-b',number:'7',name:'Lyon'}]}],
  creative_accounts:[{id:A,enabled:true,background_id:'bg',prompt_front:'Face',prompt_back:''},{id:B,enabled:false,background_id:null,prompt_front:'',prompt_back:''}],
  creative_resources:[{id:'bg',kind:'background',archived_at:null,content:'Fond avant',content_back:'Fond arrière'}],
  vinted_accounts:[{pseudo:'autre',ads_power_num:'12',statut:'actif',creation_stage:'ready',is_ready:true,deleted_at:null},{pseudo:'OLD.ACCOUNT',ads_power_num:null,statut:'banni_temp',deleted_at:null}],
  profiles:[{id:me,pseudo:'Alicia'},{id:ylann,pseudo:'Ylann'}],
  listing_drafts:[{id:draftId,owner_id:me,state:'draft',dotb_item_id:null,version:3,fields:{account_id:A,title:'Body noir'},updated_at:'2026-11-04T10:00:00Z'},
    {id:'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee',owner_id:ylann,state:'draft',dotb_item_id:null,version:1,fields:{account_id:A,title:'Pas à moi'},updated_at:'2026-11-04T09:00:00Z'}]
})
const counts=()=>({stats:[{account_id:A,today:2,week:5,last_at:'2026-11-04T09:30:00Z'}],drafts:[{account_id:A,drafts:2}],recent:[{account_id:A,items:[{id:'r1',title:'Robe',vinted_id:'123456',published_at:'2026-11-04T09:30:00Z',owner_id:ylann}]}]})

test('a Vinted link or number gives the item number; anything else is refused',()=>{
  for(const [input,id] of [['https://www.vinted.fr/items/7432189-robe-noire','7432189'],['https://www.vinted.fr/items/7432189','7432189'],['https://vinted.be/items/55?referrer=x','55'],['  7432189 ','7432189'],['https://vinted.fr/items/00042-robe','42']])assert.equal(vintedItemId(input),id,input)
  for(const input of ['','http://www.vinted.fr/items/1','https://www.vinted.fr.evil.com/items/1','https://www.vinted.fr/member/12','https://user:pw@www.vinted.fr/items/1','https://www.vinted.fr/items/abc','javascript:alert(1)','https://vinted.fr.com/items/1','https://vinted.co.evil/items/1','https://vinted.fr/items/1/edit','0',42,{},['42']])assert.equal(vintedItemId(input),null,input)
  assert.equal(vintedItemUrl('123'),'https://www.vinted.fr/items/123');assert.equal(vintedItemUrl('x'),null)
})
test('the board joins each account to its AdsPower profile, status, style, counters and drafts, without calling Dotb',async()=>{
  const db=database(tables(),{team_board_counts:counts})
  const board=await readTeamBoard(db,{id:me},{now:new Date('2026-11-04T15:00:00Z')})
  assert.equal(board.day,'2026-11-04');assert.equal(board.me,'Alicia')
  assert.deepEqual(db.calls.filter(c=>c[0]==='rpc'),[['rpc','team_board_counts',{p_day:'2026-11-04'}]])
  const [a,b,c]=['body.paris','mode.lyon','old.account'].map(l=>board.accounts.find(r=>r.login===l))
  assert.deepEqual(a.profile,{id:'p-a-me',number:'12',name:'Body Paris'},'the signed-in member’s own profile comes first')
  assert.equal(a.vinted.creation_stage,'ready','status matched by AdsPower number');assert.equal('ads_power_num' in a.vinted,false)
  assert.deepEqual(a.style,{ready:false,background:true,front:true,back:false})
  assert.equal(a.can_create,true);assert.equal(b.can_create,false);assert.equal(c.can_create,false);assert.equal(a.today,2);assert.equal(a.week,5);assert.equal(a.drafts,2)
  assert.deepEqual(a.mine.map(d=>d.id),[draftId],'only my own drafts can be marked as published')
  assert.deepEqual(a.recent,[{id:'r1',title:'Robe',url:'https://www.vinted.fr/items/123456',published_at:'2026-11-04T09:30:00Z',author:'Ylann',mine:false}])
  assert.equal(b.profile.number,'7','another member’s profile when I have none');assert.equal(b.style.ready,false);assert.equal(b.vinted,null);assert.equal(b.today,0);assert.equal(b.last_at,null)
  assert.equal(c.vinted.statut,'banni_temp','status matched by pseudo, ignoring case');assert.equal(c.profile,null);assert.equal(c.style,null)
})
test('marking a draft as published needs a Vinted link, the current version, and a link not used elsewhere',async()=>{
  const t=tables();t.listing_drafts.push({id:'ffffffff-ffff-4fff-8fff-ffffffffffff',owner_id:ylann,state:'published',vinted_id:'999',dotb_item_id:null,version:2,fields:{},photos:[]})
  t.listing_drafts.forEach(d=>d.photos||=[])
  const db=database(t),call=body=>handleListingStudio({method:'POST',body,query:{}},{db,user:{id:me}},{read:async()=>{throw Error('Dotb must not be called')},allowDotb:false})
  await assert.rejects(call({action:'mark_published',id:draftId,version:3,url:'https://example.com/items/1'}),/lien de l’annonce Vinted/)
  await assert.rejects(call({action:'mark_published',id:draftId,version:2,url:'https://www.vinted.fr/items/42'}),/changé/,'stale version')
  await assert.rejects(call({action:'mark_published',id:draftId,version:3,url:'https://www.vinted.fr/items/999'}),/déjà enregistré/)
  const {draft}=await call({action:'mark_published',id:draftId,version:3,url:'https://www.vinted.fr/items/42-body'})
  assert.equal(draft.state,'published');assert.equal(draft.url,'https://www.vinted.fr/items/42');assert.equal(draft.message,'Publiée à la main sur Vinted.')
  const again=await call({action:'mark_published',id:draftId,version:3,url:'https://www.vinted.fr/items/00042-body'});assert.equal(again.draft.version,4,'retry after a lost reply never writes again')
  const saved=db.tables.listing_drafts.find(d=>d.id===draftId);assert.equal(saved.vinted_id,'42');assert.ok(saved.published_at);assert.equal(saved.version,4)
  await assert.rejects(call({action:'mark_published',id:draftId,version:4,url:'https://www.vinted.fr/items/43'}),/déjà été transmise/)
  await assert.rejects(handleListingStudio({method:'POST',body:{action:'mark_published',id:draftId,version:4,url:'https://www.vinted.fr/items/1'},query:{}},{db,user:{id:ylann}},{allowDotb:false}),/introuvable/,'someone else’s draft')
})
test('a listing already sent to Dotb is never marked by hand',async()=>{
  await assert.rejects(markPublished(database({listing_drafts:[]}),{id:draftId,state:'draft',dotb_item_id:'x'},'https://www.vinted.fr/items/1',async()=>{}),/déjà été transmise/)
})
test('accounts are grouped: due creation posts first, then the least recently fed, paused, and blocked last',()=>{
  const now=Date.parse('2026-11-04T15:00:00Z')
  const row=(login,patch={})=>({login,today:0,last_at:null,profile:null,vinted:null,...patch})
  const rows=[row('ready-recent',{vinted:{creation_stage:'ready'},last_at:'2026-11-04T08:00:00Z',today:1}),row('ready-old',{vinted:{creation_stage:'ready'},last_at:'2026-10-30T08:00:00Z'}),row('never'),
    row('day1-due',{vinted:{creation_stage:'post1',creation_next_at:'2026-11-04T08:00:00Z'}}),row('day2-later',{vinted:{creation_stage:'post2',creation_next_at:'2026-11-05T08:00:00Z'}}),
    row('wait',{vinted:{creation_stage:'wait',creation_next_at:'2026-11-03T08:00:00Z'}}),row('banned',{vinted:{statut:'banni_def'}}),row('shadow',{vinted:{is_shadowbanned:true,creation_stage:'ready'}})]
  const groups=Object.fromEntries(groupBoard(rows,{now}).map(s=>[s.key,s.rows.map(r=>r.login)]))
  assert.deepEqual(groups,{now:['day1-due'],feed:['never','ready-old','ready-recent'],rest:['wait','day2-later'],blocked:['banned','shadow']})
  assert.deepEqual(groupBoard(rows,{now,search:'READY-o'}).flatMap(s=>s.rows.map(r=>r.login)),['ready-old'])
  assert.equal(boardSection(row('x',{vinted:{creation_stage:'post1'}}),now),'now','no date = due')
  assert.equal(stateLabel(row('x')),'À relier dans « Comptes »');assert.equal(stateLabel(rows[0]),'Prêt à publier');assert.equal(stateLabel(rows[6]),'Bannissement définitif');assert.equal(stateLabel(rows[3]),'Jour 1 · première annonce')
  assert.equal(sinceLabel(null,now),'Jamais');assert.equal(sinceLabel('2026-11-04T01:00:00Z',now),'Aujourd’hui');assert.equal(sinceLabel('2026-11-03T12:00:00Z',now),'Hier');assert.equal(sinceLabel('2026-10-30T12:00:00Z',now),'Il y a 5 jours')
})

test('the Alicia tab lists accounts by priority, opens listing creation for an account, and records a published link',async()=>{
  const {window}=parseHTML('<html><body><div id="app"></div></body></html>')
  globalThis.window=window;globalThis.document=window.document;globalThis.IS_REACT_ACT_ENVIRONMENT=true
  const require=createRequire(import.meta.url),React=require('react'),{act}=React,{createRoot}=require('react-dom/client')
  const compiled=await build({entryPoints:[fileURLToPath(new URL('../src/components/TeamBoardTab.jsx',import.meta.url))],bundle:true,write:false,platform:'node',format:'cjs',jsx:'automatic',packages:'external',external:['../lib/api']})
  const mod=new Module(fileURLToPath(import.meta.url));mod.paths=Module._nodeModulePaths(fileURLToPath(new URL('..',import.meta.url)));mod._compile(compiled.outputFiles[0].text,fileURLToPath(import.meta.url))
  const base=(login,patch)=>({account_id:login,login,profile:null,can_create:true,vinted:null,style:null,today:0,week:0,last_at:null,drafts:0,recent:[],mine:[],...patch})
  let board={day:'2026-11-04',me:'Alicia',accounts:[base('fed.today',{vinted:{creation_stage:'ready'},today:2,week:4,last_at:new Date().toISOString(),profile:{id:'p1',number:'3'},style:{ready:true}}),
    base('starving',{vinted:{creation_stage:'ready'},profile:{id:'p2',number:'8'},mine:[{id:'d1',version:5,title:'Body noir'}]}),base('banned',{vinted:{statut:'banni_def'}}),base('unselected',{can_create:false})]}
  const calls=[],created=[]
  const request=async(method,body,query)=>{calls.push(body?.action||query);if(body?.action==='mark_published'){board=structuredClone(board);board.accounts[1].mine=[];board.accounts[1].today=1};return structuredClone(board)}
  const root=createRoot(document.getElementById('app')),props=n=>n[Object.keys(n).find(k=>k.startsWith('__reactProps$'))]
  try{
    await act(async()=>root.render(React.createElement(mod.exports.default,{request,onCreateListing:p=>created.push(p),onStyles(){},onAccounts(){}})))
    await act(async()=>{await new Promise(r=>setTimeout(r,10))})
    const titles=[...document.querySelectorAll('article h3')].map(h=>h.textContent)
    assert.equal(titles.includes('unselected'),false,'my selected accounts are the default view')
    await act(async()=>[...document.querySelectorAll('button')].find(b=>b.textContent==='Tous les comptes · 4').click())
    assert.ok(document.body.textContent.includes('unselected'))
    await act(async()=>[...document.querySelectorAll('button')].find(b=>b.textContent==='Mes comptes choisis · 3').click())
    assert.equal(document.body.textContent.includes('unselected'),false)
    assert.deepEqual(titles.slice(0,2),['starving','fed.today'],'the account fed least recently comes first')
    assert.ok(document.body.textContent.includes('2 annonces publiées aujourd’hui sur 1 compte'))
    assert.ok(document.body.textContent.includes('Profil AdsPower n°8'))
    const card=[...document.querySelectorAll('article')].find(a=>a.querySelector('h3').textContent==='starving')
    await act(async()=>[...card.querySelectorAll('button')].find(b=>b.textContent==='Créer une annonce').click())
    assert.deepEqual(created,['p2'])
    const input=card.querySelector('input');await act(async()=>props(input).onChange({target:{value:'https://www.vinted.fr/items/42'}}))
    // The simulated DOM does not submit a form on button click (browsers do): submit it as the browser would.
    assert.equal(card.querySelector('form button').textContent,'Publiée')
    await act(async()=>props(card.querySelector('form')).onSubmit({preventDefault(){}}))
    await act(async()=>{await new Promise(r=>setTimeout(r,10))})
    assert.deepEqual(calls,['action=board','mark_published','action=board'])
    assert.ok(document.body.textContent.includes('« Body noir » est notée comme publiée.'))
    assert.ok(document.body.textContent.includes('3 annonces publiées aujourd’hui sur 2 comptes'))
    assert.equal([...document.querySelectorAll('article')].filter(a=>a.textContent.includes('Créer une annonce')).length,2,'no create button on blocked accounts')
    const blocked=[...document.querySelectorAll('details summary')].find(s=>s.textContent.includes('Bloqués'));assert.ok(blocked,'blocked accounts are folded away')
  }finally{await act(async()=>root.unmount());delete globalThis.window;delete globalThis.document;delete globalThis.IS_REACT_ACT_ENVIRONMENT}
})


test('profiles linked by their name are usable only for their selected owner; removed links cannot select another account',async()=>{
 const t=tables();t.publication_profile_links=[];t.adspower_preferences[0].profiles=[{id:'auto',number:'12',name:'BODY.PARIS'}]
 const board=await readTeamBoard(database(t),{id:me})
 assert.equal(board.accounts[0].profile.id,'auto');assert.equal(board.accounts[0].can_create,true)
 t.publication_profile_links=[{owner_id:me,profile_id:'auto',account_id:B}]
 const linked=await readTeamBoard(database(t),{id:me})
 assert.equal(linked.accounts.find(r=>r.account_id===A).can_create,false)
 assert.equal(linked.accounts.find(r=>r.account_id===B).profile.id,'auto')
})
test('all pages are read even if the API imposes a smaller row limit',async()=>{
 const rows=Array.from({length:1201},(_,id)=>({id})),offsets=[]
 const actual=await readBoardRows(()=>({range:async(start)=>{offsets.push(start);return {data:rows.slice(start,start+200),count:rows.length,error:null}}}))
 assert.deepEqual(actual,rows);assert.deepEqual(offsets,[0,200,400,600,800,1000,1200])
})
test('archived accounts and a completed daily creation post are not suggested again',()=>{
 const archived={vinted:{deleted_at:'2026-11-01',creation_stage:'ready'}}
 assert.equal(boardSection(archived),'blocked');assert.equal(stateLabel(archived),'Archivé · ne plus utiliser')
 const done={vinted:{creation_stage:'post1'},today:1}
 assert.equal(boardSection(done),'rest');assert.equal(stateLabel(done),'Annonce du jour notée')
})
test('publication rejects missing accounts, links on another account, and a simultaneous duplicate',async()=>{
 const t=tables(),db=database(t),row=t.listing_drafts[0]
 await assert.rejects(markPublished(db,{...row,fields:{}},'42',async()=>{}),/Choisis le compte/)
 t.publication_items=[{item_id:'42',account_id:B}]
 await assert.rejects(markPublished(db,row,'42',async()=>{}),/autre compte/)
 t.publication_items=[]
 await assert.rejects(markPublished(db,row,'42',async()=>{throw {code:'23505'}}),/déjà enregistré/)
})

test('style readiness follows inherited prompts and rejects archived backgrounds or missing backs',async()=>{
 const t=tables();t.creative_accounts[0].prompt_front=null;t.creative_accounts[0].prompt_back=null
 let board=await readTeamBoard(database(t),{id:me});assert.equal(board.accounts[0].style.ready,true)
 t.creative_resources[0].archived_at='2026-11-04';board=await readTeamBoard(database(t),{id:me});assert.equal(board.accounts[0].style.ready,false)
 t.creative_resources[0].archived_at=null;t.creative_accounts[0].prompt_back='';board=await readTeamBoard(database(t),{id:me});assert.equal(board.accounts[0].style.ready,false)
})
