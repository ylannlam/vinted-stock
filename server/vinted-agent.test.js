import test from 'node:test'
import assert from 'node:assert/strict'
import {normalizeSettings,effectiveSettings,unmaskPlan,repricePlan,dueScans,parseWardrobe,parseOrders,parseLikes,parseLabel,sanitizeRecipe,parisDayStart,
  agentPoll,agentResult,agentLearn,pauseOnAlert,handleAgent,KINDS,DEFAULTS} from './vinted-agent.js'

// --- Base en mémoire, juste assez proche de supabase-js pour ces parcours ---
function fakeDb(state={}){
  const table=name=>state[name]||(state[name]=[])
  const db={state,uploads:[],from(name){
    const rows=table(name);let filters=[],op='select',patch=null,limit=Infinity,order=null,returning=false
    const matches=r=>filters.every(f=>f(r))
    const run=()=>{
      if(op==='insert'){
        for(const row of [].concat(patch)){
          if(name==='vinted_agent_tasks'&&row.dedupe_key&&rows.some(r=>r.dedupe_key===row.dedupe_key&&['queued','running'].includes(r.state)))return {data:null,error:{code:'23505'}}
          const defaults=name==='vinted_agent_settings'?{paused:false}:name==='vinted_agent_tasks'?{id:crypto.randomUUID(),state:'queued',created_at:new Date().toISOString(),attempts:0}:{}
          rows.push({...defaults,...row})
        }
        return {data:null,error:null}
      }
      if(op==='update'){const hit=rows.filter(matches);hit.forEach(r=>Object.assign(r,patch));return {data:returning?hit.map(r=>({...r})):null,error:null}}
      if(op==='delete'){for(const r of rows.filter(matches))rows.splice(rows.indexOf(r),1);return {data:null,error:null}}
      let out=rows.filter(matches)
      if(order)out=[...out].sort((a,b)=>String(a[order.k]).localeCompare(String(b[order.k]))*(order.asc?1:-1))
      return {data:out.slice(0,limit).map(r=>({...r})),error:null}
    }
    const q={select(){if(op!=='select')returning=true;return q},eq(k,v){filters.push(r=>String(r[k])===String(v));return q},neq(k,v){filters.push(r=>String(r[k])!==String(v));return q},
      in(k,v){filters.push(r=>v.map(String).includes(String(r[k])));return q},gte(k,v){filters.push(r=>r[k]&&r[k]>=v);return q},
      order(k,o={}){order={k,asc:o.ascending!==false};return q},limit(n){limit=n;return q},
      insert(v){op='insert';patch=v;return q},update(v){op='update';patch=v;return q},delete(){op='delete';return q},
      upsert(v,{onConflict}={}){const keys=(onConflict||'id').split(',');for(const row of [].concat(v)){const i=rows.findIndex(r=>keys.every(k=>String(r[k])===String(row[k])));if(i>=0)Object.assign(rows[i],row);else rows.push({...row})}op='noop';return q},
      async maybeSingle(){const r=run();return {data:r.data?.[0]||null,error:r.error}},
      then(ok,ko){return Promise.resolve(op==='noop'?{data:null,error:null}:run()).then(ok,ko)}}
    return q
  },
  async rpc(fn,args){
    const tasks=table('vinted_agent_tasks')
    if(fn==='claim_vinted_agent_task'){
      const s=table('vinted_agent_settings').find(r=>r.account_id===args.p_account)
      if(!s?.enabled)return {data:{state:'disabled'},error:null}
      if(s.paused)return {data:{state:'paused',reason:s.pause_reason},error:null}
      const t=tasks.filter(t=>t.account_id===args.p_account&&t.state==='queued'&&(!t.not_before||Date.parse(t.not_before)<=Date.now())).sort((a,b)=>a.writes-b.writes)[0]
      if(!t)return {data:{state:'idle'},error:null}
      Object.assign(t,{state:'running',lease:crypto.randomUUID(),started_at:new Date().toISOString()})
      return {data:{state:'task',task:{...t}},error:null}
    }
    if(fn==='finish_vinted_agent_task'){
      const t=tasks.find(t=>t.id===args.p_task&&t.lease===args.p_lease&&t.state==='running')
      if(!t)return {data:null,error:new Error('agent_lease_expired')}
      Object.assign(t,{state:args.p_state,result:args.p_result,error:args.p_error,lease:null});return {data:t,error:null}
    }
  },
  storage:{from:()=>({upload:async(path,bytes)=>{db.uploads.push({path,size:bytes.length});return {data:{path},error:null}},createSignedUrls:async paths=>({data:paths.map(p=>({signedUrl:`https://x.supabase.co/sign/${p}`})),error:null})})}}
  return db
}
const ACC='11111111-1111-4111-8111-111111111111'
const base=()=>({publication_accounts:[{id:ACC,login:'compte_demo',vinted_id:'3206068112'}],vinted_agent_settings:[],vinted_agent_tasks:[],vinted_agent_log:[],vinted_agent_recipes:[],vinted_agent_listings:[],vinted_agent_orders:[],vinted_agent_contacts:[],listing_drafts:[]})
const recipe=(kind,extra={})=>({kind,recipe:{method:'POST',path:'/api/v2/x',body:'none',...extra}})

test('settings are bounded and keep careful defaults',()=>{
  const s=normalizeSettings({features:{unmask:true},limits:{writes_per_day:30},unmask:{price_drop:1.234}})
  assert.equal(s.features.unmask,true);assert.equal(s.features.likes,false);assert.equal(s.limits.writes_per_day,30);assert.equal(s.limits.min_gap_minutes,12);assert.equal(s.unmask.price_drop,1.23)
  assert.throws(()=>normalizeSettings({limits:{writes_per_day:900}}),/entre 0 et 200/)
  assert.throws(()=>normalizeSettings({features:{unmask:'oui'}}),/invalide/)
  assert.throws(()=>normalizeSettings({likes:{message:'x'}}),/2 caractères minimum/)
  assert.deepEqual(effectiveSettings(null),normalizeSettings({}))
})
test('unmask: same price drop as Baz Hub (1 €, 2 € max, never under 2 €), spaced repairs',()=>{
  const cfg=DEFAULTS.unmask,now=Date.parse('2026-11-07T12:00:00Z')
  assert.deepEqual(unmaskPlan({state:'hidden',price:10,total_drop:0,repairs:0},cfg,now),{new_price:9,drop:1})
  assert.deepEqual(unmaskPlan({state:'hidden',price:9,total_drop:1.5,repairs:1},cfg,now),{new_price:8.5,drop:0.5})
  assert.deepEqual(unmaskPlan({state:'hidden',price:2.5,total_drop:0,repairs:0},cfg,now),{new_price:2,drop:0.5})
  assert.deepEqual(unmaskPlan({state:'hidden',price:2,total_drop:0,repairs:0},cfg,now),{new_price:2,drop:0},'repaired without lowering under the floor')
  assert.equal(unmaskPlan({state:'visible',price:10},cfg,now),null)
  assert.equal(unmaskPlan({state:'hidden',price:10,repairs:3},cfg,now),null,'max repairs')
  assert.equal(unmaskPlan({state:'hidden',price:10,repairs:1,last_repair_at:'2026-11-07T00:00:00Z'},cfg,now),null,'24 h between repairs')
})
test('price lifecycle: one step after the delay, never under the floor',()=>{
  const cfg=DEFAULTS.pricing,now=Date.parse('2026-11-20T12:00:00Z')
  assert.deepEqual(repricePlan({state:'visible',price:12,listed_at:'2026-11-01T00:00:00Z',total_drop:0},cfg,now),{new_price:11,drop:1})
  assert.equal(repricePlan({state:'visible',price:12,listed_at:'2026-11-18T00:00:00Z'},cfg,now),null,'too recent')
  assert.equal(repricePlan({state:'visible',price:12,listed_at:'2026-11-01T00:00:00Z',last_price_drop_at:'2026-11-19T00:00:00Z'},cfg,now),null)
  assert.equal(repricePlan({state:'visible',price:3.5,listed_at:'2026-11-01T00:00:00Z'},cfg,now),null,'floor')
  assert.equal(repricePlan({state:'visible',price:20,listed_at:'2026-11-01T00:00:00Z',total_drop:5},cfg,now),null,'max drop')
})
test('periodic reads follow the enabled features',()=>{
  const s=normalizeSettings({features:{unmask:true,orders:true}}),now=Date.parse('2026-11-07T12:00:00Z')
  assert.deepEqual(dueScans(s,{},now),['scan_wardrobe','sync_orders'])
  assert.deepEqual(dueScans(s,{scan_wardrobe:'2026-11-07T11:00:00Z',sync_orders:'2026-11-07T11:00:00Z'},now),['sync_orders'])
  assert.deepEqual(dueScans(normalizeSettings({}),{},now),[])
})
test('extension results are revalidated',()=>{
  const w=parseWardrobe({complete:true,items:[{id:5,title:' Robe  noire ',price:'12.5',is_hidden:true,photo_url:'https://images1.vinted.net/a.jpg'},{id:5},{id:'abc'},{id:6,is_closed:true,photo_url:'https://evil.example/a.jpg'}]})
  assert.equal(w.items.length,2);assert.equal(w.items[0].state,'hidden');assert.equal(w.items[0].title,'Robe noire');assert.equal(w.items[0].price,12.5)
  assert.equal(w.items[1].state,'sold');assert.equal(w.items[1].photo_url,null)
  assert.throws(()=>parseWardrobe({}),/illisible/)
  const o=parseOrders({orders:[{transaction_id:'9876',status:'À expédier',price:{amount:'15.00'},item_ids:[1,'x'],label_ready:true,shipment_id:44}]})
  assert.deepEqual(o[0].item_ids,['1']);assert.equal(o[0].price,15);assert.equal(o[0].shipment_id,'44')
  assert.deepEqual(parseLikes({likes:[{item_id:1,user_id:2},{item_id:1,user_id:2},{item_id:'z',user_id:3}]}),[{item_id:'1',user_id:'2',login:null}])
  assert.throws(()=>parseLabel({pdf_base64:Buffer.from('<html>').toString('base64')}),/PDF/)
  assert.equal(parseLabel({pdf_base64:Buffer.from('%PDF-1.7'+'x'.repeat(200)).toString('base64')}).subarray(0,5).toString(),'%PDF-')
})
test('recipes never keep cookies, CSRF or session identifiers',()=>{
  const r=sanitizeRecipe('item_edit',{method:'put',path:'/api/v2/item_upload/items/{id}',headers:{'X-CSRF-Token':'secret','cookie':'a=b','x-anon-id':'z','x-money-object':'true'},body:'json',template:{item:{id:1}}})
  assert.deepEqual(r.headers,{'x-money-object':'true'});assert.equal(r.method,'PUT')
  assert.throws(()=>sanitizeRecipe('item_edit',{method:'DELETE',path:'/api/v2/items/1'}),/Méthode/)
  assert.throws(()=>sanitizeRecipe('item_edit',{method:'GET',path:'https://evil.example/api'}),/Chemin/)
  assert.throws(()=>sanitizeRecipe('nope',{}),/inconnue/)
})
test('Paris day starts at local midnight (winter and summer time)',()=>{
  assert.equal(parisDayStart(Date.parse('2026-11-07T15:00:00Z')),'2026-11-06T23:00:00.000Z')
  assert.equal(parisDayStart(Date.parse('2026-07-07T23:30:00Z')),'2026-07-07T22:00:00.000Z')
})

test('an account must be switched on from the site before the agent does anything',async()=>{
  const db=fakeDb(base())
  assert.equal((await agentPoll(db,{},{member_id:'3206068112'})).state,'disabled')
  assert.equal((await agentPoll(db,{},{member_id:'999',login:'autre'})).state,'unknown')
  assert.equal(db.state.vinted_agent_log.at(-1).event,'unknown_profile')
  assert.equal(db.state.vinted_agent_tasks.length,0)
})
test('wardrobe scan → hidden listings get a repair task; nothing is sent to Vinted without the learned recipes',async()=>{
  const state=base();state.vinted_agent_settings.push({account_id:ACC,enabled:true,paused:false,features:{unmask:true},limits:{},unmask:{},pricing:{},likes:{}})
  const db=fakeDb(state)
  let r=await agentPoll(db,{},{member_id:'3206068112'})
  assert.equal(r.state,'task');assert.equal(r.task.kind,'scan_wardrobe')
  await agentResult(db,{},{task_id:r.task.id,lease:r.task.lease,member_id:'3206068112',ok:true,result:{complete:true,items:[{id:11,title:'Robe',price:10,is_hidden:true},{id:12,title:'Jupe',price:8}]}},{rand:()=>0})
  assert.equal(state.vinted_agent_listings.length,2)
  assert.equal(state.vinted_agent_tasks.filter(t=>t.kind==='unmask_item').length,0,'no repair before the edit is learned')
  for(const k of KINDS.unmask_item.needs)state.vinted_agent_recipes.push(recipe(k))
  state.vinted_agent_tasks.forEach(t=>t.created_at='2026-01-01T00:00:00Z')
  r=await agentPoll(db,{},{member_id:'3206068112'})
  await agentResult(db,{},{task_id:r.task.id,lease:r.task.lease,member_id:'3206068112',ok:true,result:{complete:true,items:[{id:11,title:'Robe',price:10,is_hidden:true},{id:12,title:'Jupe',price:8}]}},{rand:()=>0})
  const repair=state.vinted_agent_tasks.find(t=>t.kind==='unmask_item')
  assert.deepEqual(repair.payload,{item_id:'11',price:10,new_price:9,drop:1});assert.equal(repair.writes,true)
  repair.not_before=new Date(Date.now()-1000).toISOString()
  r=await agentPoll(db,{},{member_id:'3206068112'})
  assert.equal(r.task.kind,'unmask_item');assert.ok(r.task.recipes.item_edit)
  await agentResult(db,{},{task_id:r.task.id,lease:r.task.lease,member_id:'3206068112',ok:true,result:{item_id:'11',price:9}})
  const row=state.vinted_agent_listings.find(l=>l.item_id==='11')
  assert.deepEqual([row.state,row.repairs,row.price,row.total_drop],['repairing',1,9,1])
})
test('a captcha or a Vinted alert pauses the account; the interrupted write is not replayed',async()=>{
  const state=base();state.vinted_agent_settings.push({account_id:ACC,enabled:true,paused:false,features:{},limits:{},unmask:{},pricing:{},likes:{}})
  state.vinted_agent_recipes.push(...KINDS.reprice_item.needs.map(k=>recipe(k)))
  state.vinted_agent_tasks.push({id:crypto.randomUUID(),account_id:ACC,kind:'reprice_item',writes:true,state:'queued',payload:{item_id:'5',price:10,new_price:9}})
  const db=fakeDb(state)
  const r=await agentPoll(db,{},{member_id:'3206068112'})
  assert.equal(r.task.kind,'reprice_item')
  assert.deepEqual(await agentResult(db,{},{task_id:r.task.id,lease:r.task.lease,member_id:'3206068112',ok:false,code:'captcha'}),{saved:true,paused:true})
  assert.equal(state.vinted_agent_tasks[0].state,'failed')
  assert.equal(state.vinted_agent_settings[0].paused,true);assert.match(state.vinted_agent_settings[0].pause_reason,/captcha/)
  assert.equal((await agentPoll(db,{},{member_id:'3206068112'})).state,'paused')
  // Bandeau Vinted relevé par la veille → pause aussi (déjà en pause : pas de doublon au journal).
  const logs=state.vinted_agent_log.length
  assert.equal(await pauseOnAlert(db,{status:'restricted',member_id:'3206068112',message:'Compte restreint'}),false)
  assert.equal(state.vinted_agent_log.length,logs)
  state.vinted_agent_settings[0].paused=false
  assert.equal(await pauseOnAlert(db,{status:'restricted',member_id:'3206068112',message:'Compte restreint'}),true)
  assert.equal(await pauseOnAlert(db,{status:'ok',member_id:'3206068112'}),false)
})
test('a result for another account or an expired task is refused',async()=>{
  const state=base();state.publication_accounts.push({id:'22222222-2222-4222-8222-222222222222',login:'b',vinted_id:'42'})
  state.vinted_agent_settings.push({account_id:ACC,enabled:true,paused:false,features:{orders:true},limits:{},unmask:{},pricing:{},likes:{}})
  state.vinted_agent_recipes.push(recipe('orders_list'))
  const db=fakeDb(state)
  const r=await agentPoll(db,{},{member_id:'3206068112'})
  assert.equal(r.task.kind,'sync_orders')
  await assert.rejects(agentResult(db,{},{task_id:r.task.id,lease:r.task.lease,member_id:'42',ok:true,result:{orders:[]}}),/autre compte/)
  await assert.rejects(agentResult(db,{},{task_id:r.task.id,lease:crypto.randomUUID(),member_id:'3206068112',ok:true,result:{orders:[]}}),/expiré/)
  await agentResult(db,{},{task_id:r.task.id,lease:r.task.lease,member_id:'3206068112',ok:true,result:{orders:[{transaction_id:'777',status:'Payée',title:'Robe',price:'12.00'}]}})
  assert.equal(state.vinted_agent_orders[0].transaction_id,'777');assert.equal(state.vinted_agent_orders[0].account_id,ACC)
})
test('learning stores a cleaned recipe; publishing waits for the learned creation',async()=>{
  const state=base(),db=fakeDb(state),user={id:'u1'}
  await agentLearn(db,{},{kind:'photo_upload',member_id:'3206068112',login:'compte_demo',recipe:{method:'POST',path:'/api/v2/photos',body:'form',fields:['photo[file]','photo[type]'],headers:{'x-csrf-token':'s'}}})
  assert.equal(state.vinted_agent_recipes[0].recipe.path,'/api/v2/photos');assert.deepEqual(state.vinted_agent_recipes[0].recipe.headers,{})
  const draft={id:'33333333-3333-4333-8333-333333333333',owner_id:'u1',version:1,state:'draft',photos:[{path:'a.jpg'}],fields:{account_id:ACC,title:'Robe',description:'Belle robe',price:'12',catalog_id:10}}
  state.listing_drafts.push(draft)
  await assert.rejects(handleAgent({method:'POST',body:{action:'publish_drafts',ids:[draft.id]}},{db,user}),/création d’une annonce/)
  state.vinted_agent_recipes.push(recipe('item_create'))
  let out=await handleAgent({method:'POST',body:{action:'publish_drafts',ids:[draft.id]}},{db,user})
  assert.equal(out.queued,0);assert.match(out.refused[0].reason,/non activée/)
  state.vinted_agent_settings.push({account_id:ACC,enabled:true,paused:false,features:{publish:true},limits:{},unmask:{},pricing:{},likes:{}})
  out=await handleAgent({method:'POST',body:{action:'publish_drafts',ids:[draft.id]}},{db,user})
  assert.equal(out.queued,1);assert.equal(draft.state,'scheduled');assert.match(draft.message,/agent/)
  const task=state.vinted_agent_tasks.find(t=>t.kind==='publish_item');task.not_before=new Date(Date.now()-1000).toISOString()
  const r=await agentPoll(db,{},{member_id:'3206068112'})
  assert.equal(r.task.kind,'publish_item');assert.deepEqual(r.task.listing.photos,['https://x.supabase.co/sign/a.jpg'])
  await agentResult(db,{},{task_id:r.task.id,lease:r.task.lease,member_id:'3206068112',ok:true,result:{vinted_id:'555'}})
  assert.equal(draft.state,'published');assert.equal(draft.vinted_id,'555');assert.equal(draft.version,3)
})
test('settings are saved with a version check, and pause / resume are journaled',async()=>{
  const state=base(),db=fakeDb(state),user={id:'u1'}
  const saved=await handleAgent({method:'POST',body:{action:'save_settings',account_id:ACC,enabled:true,settings:{features:{orders:true}}}},{db,user})
  assert.equal(saved.version,1);assert.equal(state.vinted_agent_settings[0].features.orders,true)
  await assert.rejects(handleAgent({method:'POST',body:{action:'save_settings',account_id:ACC,enabled:true,version:0,settings:{}}},{db,user}),/modifiés/)
  await handleAgent({method:'POST',body:{action:'pause',account_id:ACC}},{db,user})
  assert.equal(state.vinted_agent_settings[0].paused,true)
  await handleAgent({method:'POST',body:{action:'resume',account_id:ACC}},{db,user})
  assert.equal(state.vinted_agent_settings[0].paused,false)
  assert.deepEqual(state.vinted_agent_log.map(l=>l.event),['settings','manual_pause','resumed'])
})
