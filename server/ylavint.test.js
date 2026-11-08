import test from 'node:test'
import assert from 'node:assert/strict'
import {parseInbox,applyInbox,queueReply,applyReply,replyFailed,draftAi,generateReply,orderStatus,pushSales,withoutYlavintOwned,salesOrderId,ylavintUuid,
  syncPublicationItems,handleYlavint,normalizeAi,humanKeyword,likeText,pollExtras,unseen,ylavintView,queueStudioPublish} from './ylavint.js'
import {agentPoll,agentResult,effectiveSettings,DEFAULTS} from './vinted-agent.js'

// --- Base en mémoire, assez proche de supabase-js pour ces parcours ---
function fakeDb(state={}){
  const table=name=>state[name]||(state[name]=[])
  let serial=1
  const db={state,calls:[],from(name){
    const rows=table(name);let filters=[],op='select',patch=null,limit=Infinity,order=null,returning=false,head=false,count=false,conflict=null,ignore=false
    const matches=r=>filters.every(f=>f(r))
    const run=()=>{
      if(op==='insert'||op==='upsert'){
        const out=[]
        for(const row of [].concat(patch)){
          if(name==='vinted_agent_tasks'&&row.dedupe_key&&rows.some(r=>r.dedupe_key===row.dedupe_key&&['queued','running'].includes(r.state)))return {data:null,error:{code:'23505'}}
          const keys=op==='upsert'?conflict:name==='ylavint_messages'?['account_id','conversation_id','message_id']:null
          const i=keys?rows.findIndex(r=>keys.every(k=>String(r[k])===String(row[k]))):-1
          if(i>=0){if(op==='insert')return {data:null,error:{code:'23505'}};if(!ignore)Object.assign(rows[i],row);out.push(rows[i]);continue}
          const defaults={vinted_agent_settings:{paused:false,enabled:false},vinted_agent_tasks:{id:crypto.randomUUID(),state:'queued',created_at:new Date().toISOString(),attempts:0,priority:0},
            ylavint_conversations:{ai_state:'none',ai_replies:0,needs_human:false,unread:false,last_from_me:false,allow_reply:true},ylavint_messages:{id:serial++,state:'vinted',source:'vinted',from_me:false}}[name]||{}
          const r={...defaults,...row};rows.push(r);out.push(r)
        }
        return {data:returning?out.map(r=>({...r})):null,error:null}
      }
      if(op==='update'){
        const hit=rows.filter(matches)
        if(name==='ylavint_messages'&&patch.message_id&&hit.some(h=>rows.some(r=>r!==h&&r.account_id===h.account_id&&r.conversation_id===h.conversation_id&&r.message_id===patch.message_id)))return {data:null,error:{code:'23505'}}
        hit.forEach(r=>Object.assign(r,patch));return {data:returning?hit.map(r=>({...r})):null,error:null}
      }
      if(op==='delete'){for(const r of rows.filter(matches))rows.splice(rows.indexOf(r),1);return {data:null,error:null}}
      let out=rows.filter(matches)
      if(order)out=[...out].sort((a,b)=>String(a[order.k]??'').localeCompare(String(b[order.k]??''))*(order.asc?1:-1))
      if(head)return {data:null,count:out.length,error:null}
      return {data:out.slice(0,limit).map(r=>({...r})),count:count?out.length:undefined,error:null}
    }
    const orFilter=expr=>{ // ai_state.eq.pending,and(ai_state.eq.drafting,updated_at.lt.X) | col.ilike.%x%
      const parts=expr.match(/and\([^)]*\)|[^,]+/g)
      const one=p=>{if(p.startsWith('and('))return p.slice(4,-1).split(',').every(one);const [k,o,...v]=p.split('.');const val=v.join('.')
        return r=>o==='eq'?String(r[k])===val:o==='lt'?String(r[k]??'')<val:o==='is'?r[k]==null:o==='ilike'?String(r[k]||'').toLowerCase().includes(val.replace(/%/g,'').toLowerCase()):false}
      const fns=parts.map(p=>p.startsWith('and(')?(r=>p.slice(4,-1).split(',').every(x=>one(x)(r))):one(p))
      filters.push(r=>fns.some(f=>f(r)))
    }
    const q={select(_c,o={}){if(op!=='select')returning=true;head=!!o.head;count=!!o.count;return q},eq(k,v){filters.push(r=>String(r[k])===String(v));return q},neq(k,v){filters.push(r=>String(r[k])!==String(v));return q},
      in(k,v){filters.push(r=>v.map(String).includes(String(r[k])));return q},gte(k,v){filters.push(r=>r[k]&&r[k]>=v);return q},lt(k,v){filters.push(r=>r[k]<v);return q},
      not(k,o,v){filters.push(r=>!(o==='is'&&v===null?r[k]==null:false));return q},is(k,v){filters.push(r=>v===null?r[k]==null:r[k]===v);return q},or(expr){orFilter(expr);return q},
      order(k,o={}){order={k,asc:o.ascending!==false};return q},limit(n){limit=n;return q},
      insert(v){op='insert';patch=v;return q},update(v){op='update';patch=v;return q},delete(){op='delete';return q},
      upsert(v,o={}){op='upsert';patch=v;conflict=(o.onConflict||'id').split(',');ignore=!!o.ignoreDuplicates;return q},
      async maybeSingle(){const r=run();return {data:r.data?.[0]||null,error:r.error}},async single(){const r=run();return {data:r.data?.[0]||null,error:r.error||(r.data?.[0]?null:{code:'PGRST116'})}},
      then(ok,ko){return Promise.resolve(run()).then(ok,ko)}}
    return q
  },
  async rpc(fn,args){
    db.calls.push({fn,args})
    const tasks=table('vinted_agent_tasks')
    if(fn==='upsert_sales_snapshot'){for(const o of args.p_orders){const i=table('sales_orders').findIndex(r=>r.id===o.id);if(i>=0)Object.assign(table('sales_orders')[i],o);else table('sales_orders').push({...o})};for(const l of args.p_lines){const i=table('sales_lines').findIndex(r=>r.id===l.id);if(i>=0)Object.assign(table('sales_lines')[i],l);else table('sales_lines').push({...l,stage:'to_order'})};return {data:null,error:null}}
    if(fn==='queue_sales_sources')return {data:0,error:null}
    if(fn==='claim_vinted_agent_task'){
      const s=table('vinted_agent_settings').find(r=>r.account_id===args.p_account)
      if(!s?.enabled)return {data:{state:'disabled'},error:null}
      if(s.paused)return {data:{state:'paused',reason:s.pause_reason},error:null}
      const t=tasks.filter(t=>t.account_id===args.p_account&&t.state==='queued'&&(!t.not_before||Date.parse(t.not_before)<=Date.now())).sort((a,b)=>(b.priority||0)-(a.priority||0)||a.writes-b.writes)[0]
      if(!t)return {data:{state:'idle'},error:null}
      Object.assign(t,{state:'running',lease:crypto.randomUUID(),started_at:new Date().toISOString()})
      return {data:{state:'task',task:{...t}},error:null}
    }
    if(fn==='finish_vinted_agent_task'){
      const t=tasks.find(t=>t.id===args.p_task&&t.lease===args.p_lease&&t.state==='running')
      if(!t)return {data:null,error:new Error('agent_lease_expired')}
      Object.assign(t,{state:args.p_state,result:args.p_result,error:args.p_error,lease:null});return {data:t,error:null}
    }
    return {data:null,error:null}
  },
  storage:{from:()=>({upload:async()=>({data:{},error:null}),createSignedUrls:async paths=>({data:paths.map(p=>({signedUrl:`https://x.supabase.co/sign/${p}`})),error:null}),createSignedUrl:async p=>({data:{signedUrl:`https://x.supabase.co/sign/${p}`},error:null})})}}
  return db
}
const ACC='11111111-1111-4111-8111-111111111111',USER='22222222-2222-4222-8222-222222222222'
const base=(extra={})=>({publication_accounts:[{id:ACC,login:'compte_demo',vinted_id:'3206068112'}],vinted_agent_settings:[{account_id:ACC,enabled:true,paused:false,features:{inbox:true,ai:true,orders:true,sales:true},limits:{},unmask:{},pricing:{},likes:{},messaging:{},version:1}],
  vinted_agent_tasks:[],vinted_agent_log:[],vinted_agent_recipes:[],vinted_agent_listings:[],vinted_agent_orders:[],vinted_agent_contacts:[],listing_drafts:[],ylavint_conversations:[],ylavint_messages:[],ylavint_config:[],sales_orders:[],sales_lines:[],publication_items:[],ai_usage:[],...extra})
const settings=db=>effectiveSettings(db.state.vinted_agent_settings[0])
const recent=(min=5)=>new Date(Date.now()-min*60000).toISOString()
const convo=(extra={})=>({id:'9001',other:{id:'77',login:'acheteuse',photo:'https://images1.vinted.net/a.jpg'},unread:true,updated_at:'2026-11-07T15:00:00+01:00',
  item:{id:'5551',title:'Robe satin noire',price:{amount:'25.0'},photo:'https://evil.example/x.jpg'},transaction:null,allow_reply:true,
  messages:[{id:'m1',from_me:false,body:'Bonjour, elle taille comment ?',sent_at:recent(10)},{id:'m0',from_me:true,body:'Bonjour !',sent_at:recent(30)}],...extra})
const enableAi=(db,extra={})=>db.state.ylavint_config.push({key:'ai',value:{enabled:true,mode:'suggest',...extra},version:1})
const fakeAi=(reply='Elle taille normalement, prends ta taille habituelle.',extra={})=>async()=>({reply,needs_human:false,reason:'',usage:{model:'gemini-test',input_tokens:10,output_tokens:5},...extra})

test('inbox results are revalidated: ids, bodies, photos, order',()=>{
  const [c]=parseInbox({conversations:[convo(),{id:'abc'},convo()]})
  assert.equal(c.id,'9001');assert.equal(c.item_photo,null,'non-Vinted photo dropped');assert.equal(c.other_photo,'https://images1.vinted.net/a.jpg');assert.equal(c.item_price,25)
  assert.deepEqual(c.messages.map(m=>m.id),['m0','m1'],'sorted oldest first')
  assert.throws(()=>parseInbox({conversations:'x'}),/illisible/)
  assert.equal(parseInbox({conversations:[convo({messages:[{id:'bad id!',body:'x'},{id:'ok',body:''}]})]})[0].messages.length,0)
})

test('inbox sync stores conversations and messages, and asks the AI only for a recent buyer message',async()=>{
  const db=fakeDb(base());enableAi(db)
  const task={account_id:ACC}
  const r=await applyInbox(db,task,{conversations:[convo(),convo({id:'9002',messages:[{id:'x1',from_me:false,body:'Vieux message',sent_at:'2026-01-01T10:00:00Z'}]}),convo({id:'9003',messages:null,preview:'Merci'})]},{settings:settings(db)})
  assert.equal(r.conversations,3);assert.equal(r.ai_pending,1)
  const c=db.state.ylavint_conversations
  assert.equal(c.find(x=>x.conversation_id==='9001').ai_state,'pending')
  assert.equal(c.find(x=>x.conversation_id==='9002').ai_state,'none','old messages are not answered')
  assert.equal(c.find(x=>x.conversation_id==='9003').last_message,'Merci');assert.equal(c.find(x=>x.conversation_id==='9003').synced_at,null,'list only: detail still to read')
  assert.equal(c.find(x=>x.conversation_id==='9001').last_from_me,false)
  assert.equal(db.state.ylavint_messages.length,3)
  // Relecture : aucun doublon.
  await applyInbox(db,task,{conversations:[convo()]},{settings:settings(db)})
  assert.equal(db.state.ylavint_messages.length,3)
})

test('a reply written on the site waits in the queue, then takes its Vinted id; failures are visible',async()=>{
  const db=fakeDb(base())
  await applyInbox(db,{account_id:ACC},{conversations:[convo()]},{settings:{features:{}}})
  const q=await queueReply(db,{account_id:ACC,conversation_id:'9001',body:'  Oui elle taille bien ! ',user:USER})
  const task=db.state.vinted_agent_tasks[0]
  assert.equal(task.kind,'reply_message');assert.equal(task.priority,10);assert.equal(task.payload.manual,true);assert.equal(task.payload.body,'Oui elle taille bien !')
  const local=db.state.ylavint_messages.find(m=>m.message_id===q.local_id)
  assert.equal(local.state,'queued');assert.equal(local.task_id,task.id)
  assert.equal(db.state.ylavint_conversations[0].last_from_me,true)
  await applyReply(db,{...task,account_id:ACC},{message_id:'m2'})
  assert.equal(local.state,'sent');assert.equal(local.message_id,'m2')
  // La lecture suivante retrouve le message sans le dupliquer.
  await applyInbox(db,{account_id:ACC},{conversations:[convo({messages:[...convo().messages,{id:'m2',from_me:true,body:'Oui elle taille bien !',sent_at:recent(1)}]})]},{settings:{features:{}}})
  assert.equal(db.state.ylavint_messages.filter(m=>m.body==='Oui elle taille bien !').length,1)
  // Échec : visible sur le site.
  const q2=await queueReply(db,{account_id:ACC,conversation_id:'9001',body:'Deuxième',user:USER})
  await replyFailed(db,db.state.vinted_agent_tasks[1],'Vinted a refusé le message.')
  assert.equal(db.state.ylavint_messages.find(m=>m.message_id===q2.local_id).state,'failed')
  // Compte coupé : refus clair.
  db.state.vinted_agent_settings[0].enabled=false
  await assert.rejects(queueReply(db,{account_id:ACC,conversation_id:'9001',body:'x'}),/pas activé/)
  await assert.rejects(queueReply(db,{account_id:ACC,conversation_id:'9001',body:'   '}),/Écris/)
})

test('a reply sent without a Vinted id is matched by its text at the next read',async()=>{
  const db=fakeDb(base())
  await applyInbox(db,{account_id:ACC},{conversations:[convo()]},{settings:{features:{}}})
  const q=await queueReply(db,{account_id:ACC,conversation_id:'9001',body:'Je vérifie et je te dis',user:USER})
  await applyReply(db,db.state.vinted_agent_tasks[0],{})
  await applyInbox(db,{account_id:ACC},{conversations:[convo({messages:[...convo().messages,{id:'m9',from_me:true,body:'Je vérifie et je te dis',sent_at:recent(0)}]})]},{settings:{features:{}}})
  const mine=db.state.ylavint_messages.filter(m=>m.body==='Je vérifie et je te dis')
  assert.equal(mine.length,1);assert.equal(mine[0].message_id,'m9');assert.notEqual(mine[0].message_id,q.local_id)
})

test('AI agent: suggestion, automatic reply with delay, sensitive words go to a human',async()=>{
  const db=fakeDb(base());enableAi(db)
  await applyInbox(db,{account_id:ACC},{conversations:[convo()]},{settings:settings(db)})
  const conv=()=>db.state.ylavint_conversations[0]
  let r=await draftAi(db,conv(),normalizeAi({enabled:true,mode:'suggest'}),{generate:fakeAi()})
  assert.equal(r.state,'drafted');assert.match(conv().ai_draft,/taille normalement/);assert.equal(conv().ai_handled_message_id,'m1')
  assert.equal(db.state.ai_usage[0].feature,'ylavint_reply')
  // Mode « répondre seul » : réponse programmée après un délai, jamais immédiate.
  conv().ai_state='pending'
  const before=Date.now()
  r=await draftAi(db,conv(),normalizeAi({enabled:true,mode:'auto',delay_min_seconds:60,delay_max_seconds:60}),{generate:fakeAi(),rand:()=>0})
  assert.equal(r.state,'queued');assert.equal(conv().ai_replies,1)
  const t=db.state.vinted_agent_tasks.find(t=>t.kind==='reply_message')
  assert.equal(t.payload.source,'ai');assert.equal(t.payload.manual,false);assert.equal(t.priority,5);assert.ok(Date.parse(t.not_before)>=before+59000)
  // Mot sensible : jamais envoyé seul.
  t.state='done';db.state.ylavint_messages.find(m=>m.source==='ai').state='sent'
  db.state.ylavint_messages.push({account_id:ACC,conversation_id:'9001',message_id:'m3',from_me:false,body:'Je veux un remboursement, le colis est abîmé',sent_at:new Date(Date.now()+120000).toISOString(),state:'vinted'})
  r=await draftAi(db,conv(),normalizeAi({enabled:true,mode:'auto'}),{generate:fakeAi('Je suis désolée, je regarde.')})
  assert.equal(r.state,'human');assert.equal(conv().needs_human,true);assert.match(conv().ai_reason,/rembours/)
  assert.equal(db.state.vinted_agent_tasks.filter(t=>t.kind==='reply_message').length,1,'no automatic send')
  assert.equal(humanKeyword(normalizeAi({}),'Il est ABÎMÉ'),'abime')
})

test('AI replies never carry links or phone numbers; the prompt keeps everything on Vinted',async()=>{
  const fetcher=async(_u,o)=>{const body=JSON.parse(o.body);assert.match(body.messages[0].content,/hors de Vinted/);assert.match(body.messages[0].content,/Ma consigne/)
    return new Response(JSON.stringify({choices:[{message:{content:JSON.stringify({reply:'Écris-moi au 06 12 34 56 78',needs_human:false,reason:''})}}],usage:{prompt_tokens:3,completion_tokens:2}}),{status:200})}
  const r=await generateReply(normalizeAi({instructions:'Ma consigne'}),{boutique:'x',conversation:[]},{fetcher,token:'k'})
  assert.equal(r.needs_human,true)
  await assert.rejects(generateReply(normalizeAi({}),{},{token:''}),/Gemini/)
  assert.throws(()=>normalizeAi({mode:'fou'}),/proposer/)
  assert.equal(likeText('Merci pour ton like sur {article} à {prix} {inconnu}!',{title:'Robe',price:20}),'Merci pour ton like sur Robe à 20 € !')
})

test('poll: the extension drafts at most one AI reply and reports unread conversations',async()=>{
  const db=fakeDb(base());enableAi(db)
  await applyInbox(db,{account_id:ACC},{conversations:[convo(),convo({id:'9004'})]},{settings:settings(db)})
  const out=await pollExtras(db,{id:ACC},settings(db),{generate:fakeAi()})
  assert.equal(out.unread,2);assert.equal(out.ai,'drafted');assert.ok(out.features.includes('inbox'))
  assert.equal(db.state.ylavint_conversations.filter(c=>c.ai_state==='drafted').length,1)
  const paused=await pollExtras(db,{id:ACC},settings(db),{paused:true,generate:fakeAi()})
  assert.equal(paused.ai,undefined)
})

test('Vinted order statuses map to the Sales tab',()=>{
  const cases={'Commande annulée':'cancelled','Remboursement en cours':'returning','Commande terminée':'completed','Colis livré':'delivered','Bordereau envoyé, à envoyer':'label_sent',
    'Colis expédié':'shipped','Disponible au point relais':'ready_for_pickup','Paiement effectué':'payment_received'}
  for(const [t,s] of Object.entries(cases))assert.equal(orderStatus(t),s,t)
  assert.equal(salesOrderId('123'),salesOrderId('123'));assert.notEqual(salesOrderId('123'),salesOrderId('124'))
  assert.match(ylavintUuid('x'),/^[0-9a-f]{8}-[0-9a-f]{4}-5[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/)
})

test('sales read by YlaVint reach the Sales tab once, with the SKU of the published listing; Dotb sales stay with Dotb',async()=>{
  const db=fakeDb(base({listing_drafts:[{id:'d1',vinted_id:'5551',fields:{sku:'sz123',size_text:'M'}}],sales_orders:[{id:'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',transaction_id:'802'}],
    vinted_agent_orders:[{transaction_id:'801',account_id:ACC,label_path:`agent-labels/${ACC}/801.pdf`}]}))
  const n=await pushSales(db,ACC,[{transaction_id:'801',status:'Bordereau envoyé',title:'Robe satin noire taille M',price:25,currency:'EUR',item_ids:['5551'],order_date:'2026-11-07T10:00:00.000Z'},
    {transaction_id:'802',status:'Payé',title:'Déjà chez Dotb',price:10,item_ids:[]}])
  assert.equal(n,1)
  const order=db.state.sales_orders.find(o=>o.transaction_id==='801')
  assert.equal(order.id,salesOrderId('801'));assert.equal(order.status,'label_sent');assert.equal(order.account_login,'compte_demo');assert.equal(order.label_url,`ylavint:agent-labels/${ACC}/801.pdf`)
  const line=db.state.sales_lines[0]
  assert.equal(line.order_id,order.id);assert.equal(line.source.sku,'sz123');assert.equal(line.source.size,'M');assert.equal(line.source.vinted_id,'5551');assert.equal(line.source.selling_price,'25.00')
  assert.equal(db.state.vinted_agent_orders[0].sales_order_id,order.id)
  // Deuxième lecture : même identifiant, pas de doublon.
  await pushSales(db,ACC,[{transaction_id:'801',status:'Colis expédié',title:'Robe satin noire taille M',price:25,item_ids:['5551']}])
  assert.equal(db.state.sales_orders.filter(o=>o.transaction_id==='801').length,1);assert.equal(db.state.sales_orders.find(o=>o.transaction_id==='801').status,'shipped')
  // Dotb : la vente rangée par YlaVint n'est pas réimportée.
  const kept=await withoutYlavintOwned(db,{orders:[{id:'dotb-1',transaction_id:'801'},{id:'dotb-2',transaction_id:'999'}],lines:[{order_id:'dotb-1'},{order_id:'dotb-2'}]})
  assert.deepEqual(kept.orders.map(o=>o.id),['dotb-2']);assert.deepEqual(kept.lines,[{order_id:'dotb-2'}])
})

test('wardrobe feeds the publication tracking without losing earlier dates',async()=>{
  const db=fakeDb(base({publication_items:[{account_id:ACC,item_id:'1',published:true,estimated_at:'2026-10-01T00:00:00Z'}]}))
  await syncPublicationItems(db,ACC,[{item_id:'1',title:'A',price:10,state:'hidden',listed_at:'2026-11-01T00:00:00Z'},{item_id:'2',title:'B',price:12,state:'draft',listed_at:null},{item_id:'3',title:'C',price:9,state:'visible',listed_at:'2026-11-05T00:00:00Z'}])
  const items=Object.fromEntries(db.state.publication_items.map(i=>[i.item_id,i]))
  assert.equal(items['1'].estimated_at,'2026-10-01T00:00:00Z');assert.equal(items['1'].status,'hidden');assert.equal(items['1'].published,true)
  assert.equal(items['2'].published,false);assert.equal(items['3'].status,'active');assert.equal(items['3'].url,'https://www.vinted.fr/items/3')
})

test('site: inbox view, thread read marks it seen, AI settings with version check, manual price change',async()=>{
  const db=fakeDb(base());enableAi(db)
  await applyInbox(db,{account_id:ACC},{conversations:[convo()]},{settings:settings(db)})
  let v=await ylavintView({query:{view:'inbox',filter:'unread'}},{db})
  assert.equal(v.conversations.length,1);assert.equal(v.conversations[0].login,'compte_demo');assert.equal(v.conversations[0].unseen,true)
  const t=await ylavintView({query:{view:'thread',account_id:ACC,conversation_id:'9001'}},{db})
  assert.equal(t.messages.length,2);assert.ok(db.state.ylavint_conversations[0].site_read_at)
  assert.equal(unseen(db.state.ylavint_conversations[0]),false)
  const req=b=>({method:'POST',body:b})
  await assert.rejects(handleYlavint(req({action:'save_ai',version:0,config:{mode:'auto'}}),{db,user:{id:USER}}),/Actualise/)
  const saved=await handleYlavint(req({action:'save_ai',version:1,config:{mode:'auto',instructions:'Toujours tutoyer.'}}),{db,user:{id:USER}})
  assert.equal(saved.config.mode,'auto');assert.equal(saved.config.enabled,true,'keeps what was not sent');assert.equal(saved.version,2)
  const sug=await handleYlavint(req({action:'ai_suggest',account_id:ACC,conversation_id:'9001'}),{db,user:{id:USER}},{generate:fakeAi()})
  assert.equal(sug.state,'drafted','a suggestion is never sent automatically, even in auto mode')
  await handleYlavint(req({action:'ai_send',account_id:ACC,conversation_id:'9001'}),{db,user:{id:USER}})
  assert.equal(db.state.vinted_agent_tasks.at(-1).payload.body,'Elle taille normalement, prends ta taille habituelle.')
  db.state.vinted_agent_listings.push({account_id:ACC,item_id:'5551',price:20,state:'visible'})
  await assert.rejects(handleYlavint(req({action:'item_reprice',account_id:ACC,item_id:'5551',new_price:18}),{db,user:{id:USER}}),/Apprends/)
  db.state.vinted_agent_recipes.push({kind:'item_form',recipe:{}},{kind:'item_edit',recipe:{}})
  const rp=await handleYlavint(req({action:'item_reprice',account_id:ACC,item_id:'5551',new_price:18}),{db,user:{id:USER}})
  assert.equal(rp.queued,1);assert.equal(db.state.vinted_agent_tasks.at(-1).payload.new_price,18)
})

test('end to end: poll enqueues the inbox read, the extension result is stored, the reply goes out first',async()=>{
  const db=fakeDb(base());enableAi(db);db.state.vinted_agent_settings[0].features={inbox:true}
  let p=await agentPoll(db,'k',{member_id:'3206068112',login:'compte_demo',version:'3.0.0'})
  assert.equal(p.state,'task');assert.equal(p.task.kind,'sync_inbox')
  assert.equal(p.task.recipes.inbox_list.path,'/api/v2/inbox','default read recipe');assert.deepEqual(p.task.payload.known,{})
  assert.equal(p.wait_seconds,undefined)
  await agentResult(db,'k',{task_id:p.task.id,lease:p.task.lease,member_id:'3206068112',ok:true,result:{conversations:[convo()]}})
  assert.equal(db.state.ylavint_conversations.length,1)
  await queueReply(db,{account_id:ACC,conversation_id:'9001',body:'Bonjour, oui !',user:USER})
  db.state.vinted_agent_recipes.push({kind:'message_send',recipe:{method:'POST',path:'/api/v2/conversations/{id}/replies',body:'json',template:{reply:{body:''}}}})
  p=await agentPoll(db,'k',{member_id:'3206068112',login:'compte_demo'},Date.now())
  assert.equal(p.task.kind,'reply_message');assert.equal(p.task.recipes.message_send.path,'/api/v2/conversations/{id}/replies')
  await agentResult(db,'k',{task_id:p.task.id,lease:p.task.lease,member_id:'3206068112',ok:true,result:{conversation_id:'9001',message_id:'m5'}})
  assert.equal(db.state.ylavint_messages.find(m=>m.body==='Bonjour, oui !').state,'sent')
  // Sans recette relevée : l'envoi prêt à l'emploi est utilisé (plus de mode apprentissage à faire à la main).
  db.state.vinted_agent_recipes=db.state.vinted_agent_recipes.filter(r=>r.kind!=='message_send')
  await queueReply(db,{account_id:ACC,conversation_id:'9001',body:'Autre',user:USER})
  p=await agentPoll(db,'k',{member_id:'3206068112',login:'compte_demo'},Date.now()+3600000)
  assert.equal(p.task.kind,'reply_message');assert.deepEqual(p.task.recipes.message_send.template,{reply:{body:'',photo_temp_uuids:null,is_personal_data_sharing_check_skipped:false}})
})

test('a disabled account still reports its Bridge presence every 10 minutes',async()=>{
  const db=fakeDb(base({vinted_agent_settings:[]}))
  const p=await agentPoll(db,'k',{member_id:'3206068112',login:'compte_demo',version:'3.0.0'})
  assert.equal(p.state,'disabled');assert.equal(p.wait_seconds,600)
  assert.ok(db.state.vinted_agent_settings[0].last_seen_at);assert.equal(db.state.vinted_agent_settings[0].extension_version,'3.0.0');assert.equal(db.state.vinted_agent_settings[0].enabled,false)
})

test('publishing from the listing studio goes through YlaVint only when the account is ready',async()=>{
  const db=fakeDb(base())
  const row={id:'33333333-3333-4333-8333-333333333333',version:1,state:'draft',fields:{account_id:ACC,title:'Robe',description:'Belle robe',price:'20',catalog_id:10},photos:[{path:'a.jpg'}]}
  db.state.listing_drafts.push({...row})
  await assert.rejects(queueStudioPublish(db,{id:USER},row),/pas prête/)
  db.state.vinted_agent_settings[0].features.publish=true
  db.state.vinted_agent_recipes.push({kind:'photo_upload',recipe:{}},{kind:'item_create',recipe:{}})
  const out=await queueStudioPublish(db,{id:USER},row,{mode:'draft'})
  assert.equal(out.state,'scheduled');assert.match(out.message,/YlaVint/)
  const t=db.state.vinted_agent_tasks[0];assert.equal(t.kind,'publish_item');assert.equal(t.payload.live,false)
  await assert.rejects(queueStudioPublish(db,{id:USER},row),/déjà/)
  assert.equal(DEFAULTS.features.inbox,false,'everything stays off until switched on')
})

test('the in-page panel only reads and changes the account logged in that profile',async()=>{
  const {agentSelf}=await import('./ylavint.js')
  const OTHER='44444444-4444-4444-8444-444444444444'
  const db=fakeDb(base({publication_accounts:[{id:ACC,login:'compte_demo',vinted_id:'3206068112'},{id:OTHER,login:'autre',vinted_id:'999'}],
    vinted_agent_log:[{id:1,account_id:ACC,level:'info',event:'x',message:'mien',created_at:new Date().toISOString()},{id:2,account_id:OTHER,level:'info',event:'x',message:'autre',created_at:new Date().toISOString()}]}))
  const o=await agentSelf(db,'k',{op:'overview',member_id:'3206068112'})
  assert.equal(o.account.id,ACC);assert.deepEqual(o.log.map(l=>l.message),['mien'])
  await agentSelf(db,'k',{op:'save_settings',member_id:'3206068112',payload:{account_id:OTHER,enabled:true,version:1,settings:{features:{likes:true}}}})
  assert.equal(db.state.vinted_agent_settings.find(s=>s.account_id===ACC).features.likes,true,'forced to the logged-in account')
  assert.equal(db.state.vinted_agent_settings.some(s=>s.account_id===OTHER),false)
  await assert.rejects(agentSelf(db,'k',{op:'pause_all',member_id:'3206068112'}),/refusée/)
  await assert.rejects(agentSelf(db,'k',{op:'overview',member_id:'1'}),/pas encore connu/)
  await assert.rejects(agentSelf(db,'k',{op:'enqueue',member_id:'3206068112',payload:{kind:'publish_item'}}),/inconnue/)
})

// ---------- Likes et flux de commande façon Dotb ----------
import {planLikes,likePayload,likeDone,orderStage,planFlow,flowDone} from './ylavint-flows.js'
import {normalizeSettings,offerPrice,fillTemplate} from './vinted-agent-config.js'
const ACF='11111111-1111-4111-8111-111111111111'
const can=new Set(['conversation_create','message_send','shipping_extension','order_cancel','feedback_send','item_delete'])
test('likes: rotation of up to 3 messages, cooldown, ignored members and per-item cap',async()=>{
  const settings=normalizeSettings({features:{likes:true},likes:{wait_minutes:0,cooldown_days:1,ignored:'@Spam_user',per_item:{enabled:true,max:2},
    messages:[{message:'Coucou @username'},{message:'Encore toi !',discount:{mode:'simple',amount:10,unit:'pct',rounding:'half'}}]}})
  const db=fakeDb({vinted_agent_contacts:[{account_id:ACF,item_id:'9',user_id:'7',state:'sent',sent_at:new Date(Date.now()-3*86400000).toISOString()}]})
  const r=await planLikes(db,{account_id:ACF},[{item_id:'1',user_id:'7',login:'bob'},{item_id:'2',user_id:'7',login:'bob'},{item_id:'1',user_id:'8',login:'spam_user'},{item_id:'1',user_id:'5',login:'ann'},{item_id:'1',user_id:'6',login:'cid'}],settings,{rand:()=>0,can})
  const tasks=db.state.vinted_agent_tasks
  assert.equal(r.queued,2) // bob (message 2), ann ; bob une 2e fois = délai, spam = ignoré, cid = limite par article (2)
  assert.deepEqual(tasks.map(t=>[t.payload.user_id,t.payload.step]),[['7',1],['5',0]])
  assert.equal(db.state.vinted_agent_contacts.filter(c=>c.state==='skipped').length,3)
  db.state.vinted_agent_listings=[{account_id:ACF,item_id:'1',title:'Robe',price:20,state:'visible'}]
  const p=await likePayload(db,{account_id:ACF,payload:tasks[0].payload},settings)
  assert.equal(p.message,'Encore toi !');assert.equal(p.offer_price,18);assert.equal(p.skip,null)
})
test('likes: follow-up is planned after the first message, and skipped once the buyer answered',async()=>{
  const settings=normalizeSettings({features:{likes:true},likes:{messages:[{message:'Salut',followup:{enabled:true,delay_hours:24,message:'Toujours intéressé(e) ?'}}]}})
  const db=fakeDb({vinted_agent_contacts:[{account_id:ACF,item_id:'1',user_id:'5',state:'queued',step:0}]})
  const task={id:'t',account_id:ACF,payload:{item_id:'1',user_id:'5',step:0}}
  await likeDone(db,task,{conversation_id:'444'},settings,{rand:()=>0})
  const fu=db.state.vinted_agent_tasks[0];assert.equal(fu.payload.followup,true);assert.equal(fu.payload.conversation_id,'444')
  assert.equal(db.state.vinted_agent_contacts[0].followup_state,'queued');assert.equal(db.state.vinted_agent_contacts[0].state,'sent')
  const r=await likeDone(db,{...task,payload:fu.payload},{skipped:'Le membre a répondu.'},settings)
  assert.match(r.message,/non envoyée/);assert.equal(db.state.vinted_agent_contacts[0].followup_state,'skipped')
})
test('offer price and templates',()=>{
  assert.equal(offerPrice(34.9,{mode:'simple',amount:3,unit:'eur',rounding:'none'}),31.9)
  assert.equal(offerPrice(34.9,{mode:'simple',amount:3,unit:'eur',rounding:'euro'}),31)
  assert.equal(offerPrice(3,{mode:'simple',amount:5,unit:'eur',rounding:'none'}),null)
  assert.equal(offerPrice(20,{mode:'none'}),null)
  assert.equal(fillTemplate('Merci @username !',{login:'léa'}),'Merci @léa !')
})
test('order stage from Vinted status',()=>{
  assert.equal(orderStage('Le paiement a été validé'),'paid');assert.equal(orderStage('Expédie le colis avant le 12/11'),'paid')
  assert.equal(orderStage('Colis expédié'),'shipped');assert.equal(orderStage('Le colis est disponible au point relais'),'pickup')
  assert.equal(orderStage('Commande terminée'),'completed');assert.equal(orderStage('Vente annulée'),'cancelled')
})
test('order flow: confirmation, extension then cancel on a live sale; pickup, review, end message and delete on transitions',async()=>{
  const now=Date.parse('2026-11-08T12:00:00Z'),day=86400000
  const settings=normalizeSettings({order_flow:{confirm:{enabled:true,message:'Merci @username'},extension:{enabled:true,after_days:3,relance1:'Relance'},cancel:{enabled:true,minutes_before:30},
    pickup:{enabled:true,first_days:1,first:'Arrivé !',second_days:3,second:'Toujours dispo'},review:{enabled:true,after_days:1,text:'Parfait',end_message:'Merci à toi'},delete_sold:true}})
  const order={transaction_id:'100',account_id:ACF,stage:null,order_date:new Date(now-3600000).toISOString(),ship_deadline:new Date(now+5*day).toISOString(),conversation_id:'555',item_ids:['77'],flow:{}}
  const db=fakeDb({vinted_agent_orders:[order]})
  await planFlow(db,ACF,[{transaction_id:'100',status:'Le paiement a été validé',buyer_login:'lea',title:'Robe'}],settings,{now,rand:()=>0,can})
  const keys=()=>db.state.vinted_agent_tasks.filter(t=>t.state==='queued').map(t=>t.dedupe_key).sort()
  assert.deepEqual(keys(),['flow:cancel:100','flow:confirm:100','flow:ext:100'])
  assert.equal(db.state.vinted_agent_tasks.find(t=>t.dedupe_key==='flow:confirm:100').payload.body,'Merci @lea')
  assert.equal(order.stage,'paid')
  // Expédiée : demande de délai et annulation retirées.
  await planFlow(db,ACF,[{transaction_id:'100',status:'Colis expédié'}],settings,{now:now+day,rand:()=>0,can})
  assert.deepEqual(keys(),['flow:confirm:100'])
  await planFlow(db,ACF,[{transaction_id:'100',status:'Le colis est disponible au point relais'}],settings,{now:now+2*day,rand:()=>0,can})
  assert.ok(keys().includes('flow:pickup1:100')&&keys().includes('flow:pickup2:100'))
  await planFlow(db,ACF,[{transaction_id:'100',status:'Commande terminée'}],settings,{now:now+3*day,rand:()=>0,can})
  assert.deepEqual(keys(),['flow:confirm:100','flow:del_77:100','flow:end:100','flow:review:100'])
  const review=db.state.vinted_agent_tasks.find(t=>t.dedupe_key==='flow:review:100')
  await flowDone(db,review,{ok:true,result:{}},{now:now+4*day})
  assert.equal(order.flow.review.state,'done')
})
test('order flow: an old sale seen for the first time triggers nothing',async()=>{
  const now=Date.parse('2026-11-08T12:00:00Z')
  const settings=normalizeSettings({order_flow:{confirm:{enabled:true},review:{enabled:true},delete_sold:true}})
  const db=fakeDb({vinted_agent_orders:[{transaction_id:'200',account_id:ACF,stage:null,order_date:'2026-09-01T10:00:00Z',conversation_id:'1',item_ids:['3'],flow:{}}]})
  await planFlow(db,ACF,[{transaction_id:'200',status:'Commande terminée'}],settings,{now,rand:()=>0,can})
  assert.equal((db.state.vinted_agent_tasks||[]).length,0);assert.equal(db.state.vinted_agent_orders[0].stage,'completed')
})
