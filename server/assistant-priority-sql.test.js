import test from 'node:test'
import assert from 'node:assert/strict'
import {readFile} from 'node:fs/promises'
import {PGlite} from '@electric-sql/pglite'

test('Postgres: replies, received offers, inbox and favourites; aged operational tasks still run',async()=>{
 const db=new PGlite()
 try{
  await db.exec(`create role anon; create role authenticated; create role service_role;
   create table public.vinted_agent_settings(account_id uuid primary key,enabled boolean,paused boolean default false,pause_reason text,
     messaging jsonb default '{}',limits jsonb default '{}',features jsonb default '{}',last_seen_at timestamptz,extension_version text);
   create table public.vinted_agent_tasks(id uuid primary key default gen_random_uuid(),account_id uuid,kind text,writes boolean,state text default 'queued',
     payload jsonb default '{}',created_by uuid,priority integer default 0,not_before timestamptz default now(),created_at timestamptz default now(),
     attempts integer default 0,error text,started_at timestamptz,finished_at timestamptz,lease uuid,lease_until timestamptz);
   create table public.listing_drafts(publication_task_id uuid,publish_provider text,state text,owner_id uuid,fields jsonb);`)
  await db.exec(await readFile(new URL('../supabase/migrations/20261115154530_priority_buyer_responses.sql',import.meta.url),'utf8'))
  await db.exec(await readFile(new URL('../supabase/migrations/20261115233449_desktop_publication_priority.sql',import.meta.url),'utf8'))
  const account='00000000-0000-4000-8000-000000000001'
  await db.query(`insert into vinted_agent_settings(account_id,enabled,messaging,limits,features,extension_version) values ($1,true,'{"executor":"desktop","desktop":{"response_priority":false},"offers":{"enabled":true}}','{"from_hour":0,"to_hour":0}','{"wallet":true,"orders":true}','pc-1.8.10')`,[account])
  await db.query(`insert into vinted_agent_tasks(account_id,kind,writes,priority,payload) values
   ($1,'like_message',true,9,'{}'),($1,'accept_offer',true,3,'{"desktop_offer":true,"offer":{"buyer_id":"77"}}'),
   ($1,'sync_inbox',false,4,'{}'),($1,'reply_message',true,5,'{}'),($1,'scan_likes',false,0,'{}')`,[account])
  const claim=async()=>(await db.query('select claim_vinted_agent_task($1,$2) as result',[account,'desktop'])).rows[0].result
  for(const expected of ['reply_message','accept_offer','sync_inbox','like_message','scan_likes']){
   const r=await claim();assert.equal(r.task.kind,expected)
   assert.equal((await claim()).state,'busy')
   await db.query(`update vinted_agent_tasks set state='done',started_at=now()-interval '1 hour',lease=null where id=$1`,[r.task.id])
  }
  await db.query(`insert into vinted_agent_tasks(account_id,kind,writes,priority,not_before) values ($1,'sync_orders',false,6,now()-interval '16 minutes'),($1,'like_message',true,3,now())`,[account])
  assert.equal((await claim()).task.kind,'sync_orders')
  assert.equal((await db.query(`select has_function_privilege('authenticated','public.claim_vinted_agent_task(uuid,text)','execute') as allowed`)).rows[0].allowed,false)
  await db.exec(`delete from vinted_agent_tasks; update vinted_agent_settings set messaging='{"executor":"desktop","offers":{"enabled":true}}'`)
  await db.query(`insert into vinted_agent_tasks(account_id,kind,writes,response_received_at,response_deadline_at) values
   ($1,'reply_message',true,now()-interval '1 minute',now()+interval '3 minutes'),
   ($1,'like_message',true,now()-interval '3 minutes',now()+interval '1 minute'),
   ($1,'sync_inbox',false,null,null)`,[account])
  assert.equal((await claim()).task.kind,'like_message','oldest favourite outranks a newer reply')
  await db.query(`update vinted_agent_tasks set state='done',started_at=now()-interval '1 minute' where state='running'`)
  assert.equal((await claim()).task.kind,'reply_message')
  await db.query(`update vinted_agent_tasks set state='done',started_at=now()-interval '1 minute' where state='running'`)
  await db.query(`insert into vinted_agent_tasks(account_id,kind,writes,response_deadline_at) values($1,'reply_message',true,now()-interval '1 minute')`,[account])
  assert.equal((await claim()).task.kind,'sync_inbox','two responses cannot starve detection of new events')
  await db.exec(`delete from vinted_agent_tasks; update vinted_agent_settings set paused=true`)
  await db.query(`insert into vinted_agent_tasks(account_id,kind,writes,response_deadline_at) values($1,'like_message',true,now()-interval '1 minute')`,[account])
  assert.equal((await claim()).state,'paused','priority never bypasses manual pause')
  await db.query(`update vinted_agent_settings set paused=false,limits='{"from_hour":0,"to_hour":0,"like_message_per_day":0}'`)
  assert.equal((await claim()).state,'idle','priority never bypasses daily limit')
  await db.exec(`update vinted_agent_settings set limits='{"from_hour":0,"to_hour":0}'; update vinted_agent_tasks set not_before=now()+interval '1 hour'`)
  assert.equal((await claim()).state,'idle','priority never overrides a backoff')
  for(const fast of [true,false]){
   await db.exec(`delete from vinted_agent_tasks;delete from listing_drafts;
    update vinted_agent_settings set messaging='{"executor":"desktop","desktop":{"response_priority":${fast}},"offers":{"enabled":true}}',
     features='{"publish":true,"orders":true,"wallet":true,"labels":true}',limits='{"from_hour":0,"to_hour":0}'`)
   const publication=crypto.randomUUID(),owner=crypto.randomUUID()
   await db.query(`insert into vinted_agent_tasks(id,account_id,kind,writes,priority,payload,created_by) values
    ($1,$2,'publish_item',true,2,$3,$4)`,[publication,account,JSON.stringify({listing:{assisted:true,execution:'desktop',submit:fast}}),owner])
   await db.query(`insert into listing_drafts values($1,'ylavint','scheduled',$2,$3)`,[publication,owner,JSON.stringify({account_id:account})])
   for(const kind of ['sync_inbox','scan_likes','sync_orders','scan_wallet','scan_wardrobe','fetch_label']){
    await db.query(`insert into vinted_agent_tasks(account_id,kind,writes,priority,not_before,payload) values($1,$2,false,999,now()-interval '1 hour','{"desktop_order":true}')`,[account,kind])
   }
   await db.query(`insert into vinted_agent_tasks(account_id,kind,writes,response_deadline_at) values
    ($1,'reply_message',true,now()+interval '1 minute'),($1,'like_message',true,now()+interval '3 minutes')`,[account])
   const urgent=await claim();assert.equal(urgent.task.kind,'reply_message','urgent buyer response still precedes publication')
   await db.query(`update vinted_agent_tasks set state='done',started_at=now()-interval '1 minute' where id=$1`,[urgent.task.id])
   const next=await claim();assert.equal(next.task.id,publication,'publication beats all routine reads, including overdue scans with higher numeric priority')
   assert.equal((await claim()).state,'busy','never interrupts an action already running')
   await db.query(`delete from vinted_agent_tasks where id<>$1`,[publication])
   await db.exec(`update vinted_agent_tasks set state='queued',started_at=null,attempts=0,lease=null`)
   await db.exec(`update vinted_agent_settings set paused=true`);assert.equal((await claim()).state,'paused')
   await db.exec(`update vinted_agent_settings set paused=false;update vinted_agent_tasks set not_before=now()+interval '1 hour'`);assert.equal((await claim()).state,'idle','future publication stays scheduled')
   await db.exec(`update vinted_agent_tasks set not_before=now();update vinted_agent_settings set limits='{"from_hour":0,"to_hour":0,"publish_item_per_day":0}'`);assert.equal((await claim()).state,'idle','publication daily cap still applies')
   await db.exec(`update vinted_agent_settings set limits='{"from_hour":0,"to_hour":0,"writes_per_day":0}'`);assert.equal((await claim()).state,'idle','overall daily cap still applies')
   await db.exec(`update vinted_agent_settings set limits=jsonb_build_object('from_hour',(extract(hour from now() at time zone 'Europe/Paris')::int+1)%24,'to_hour',(extract(hour from now() at time zone 'Europe/Paris')::int+2)%24)`);assert.equal((await claim()).state,'idle','activity hours still apply')
   await db.exec(`update vinted_agent_settings set limits='{"from_hour":0,"to_hour":0}',features='{"publish":false}'`);assert.equal((await claim()).state,'idle','disabled publication stays disabled')
   await db.exec(`update vinted_agent_settings set features='{"publish":true}',extension_version=null`);assert.equal((await claim()).state,'idle','missing desktop connector stays blocked')
   await db.exec(`update vinted_agent_settings set extension_version='pc-1.8.13'`)
   await db.query(`insert into vinted_agent_tasks(account_id,kind,writes,state,started_at) values($1,'publish_item',true,'done',now())`,[account]);assert.equal((await claim()).state,'idle','spacing between publications still applies')
  }
 }finally{await db.close()}
})
