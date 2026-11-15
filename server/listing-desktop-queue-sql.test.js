import test from 'node:test'
import assert from 'node:assert/strict'
import {readFile} from 'node:fs/promises'
import {PGlite} from '@electric-sql/pglite'

test('Postgres: PC listings queue offline, deduplicate and execute serially only after resume with a compatible connector',async()=>{
 const db=new PGlite(),account=crypto.randomUUID(),owner=crypto.randomUUID()
 try{
  await db.exec(`create role anon;create role authenticated;create role service_role;
   create table vinted_agent_settings(account_id uuid primary key,enabled boolean,paused boolean,pause_reason text,messaging jsonb,features jsonb,limits jsonb,last_seen_at timestamptz,extension_version text);
   create table vinted_agent_tasks(id uuid primary key default gen_random_uuid(),account_id uuid,kind text,writes boolean,state text default 'queued',payload jsonb,created_by uuid,priority integer,not_before timestamptz,created_at timestamptz default now(),attempts integer default 0,error text,started_at timestamptz,finished_at timestamptz,lease uuid,lease_until timestamptz,dedupe_key text);
   create table listing_drafts(id uuid primary key,owner_id uuid,version integer,state text,fields jsonb,dotb_item_id text,publication_task_id uuid,payload jsonb,publish_provider text,planned_at timestamptz,scheduled_at timestamptz,dotb_publish boolean,updated_at timestamptz,last_error text,message text);`)
  await db.exec(await readFile(new URL('../supabase/migrations/20261115154530_priority_buyer_responses.sql',import.meta.url),'utf8'))
  await db.exec(await readFile(new URL('../supabase/migrations/20261115223422_desktop_publication_queue.sql',import.meta.url),'utf8'))
  await db.query(`insert into vinted_agent_settings values($1,true,true,'Pause demandée','{"executor":"desktop"}','{"publish":true}','{"from_hour":0,"to_hour":0,"min_gap_minutes":0}',null,null)`,[account])
  const draft=async()=>{const id=crypto.randomUUID();await db.query(`insert into listing_drafts(id,owner_id,version,state,fields) values($1,$2,1,'draft',$3)`,[id,owner,JSON.stringify({account_id:account})]);return id}
  const payload={assisted:true,execution:'desktop',submit:true,fields:{account_id:account},photos:[{path:'owned.png'}]}
  const queue=async(id,change={},who=owner)=>db.query(`select * from queue_ylavint_listing($1,$2,1,$3,0,null,true)`,[id,who,JSON.stringify({...payload,...change})])
  const first=await draft(),second=await draft();assert.equal((await queue(first)).rows.length,1);assert.equal((await queue(second)).rows.length,1)
  assert.equal((await queue(first)).rows.length,0,'same draft is never sent twice')
  assert.equal((await queue(await draft(),{},crypto.randomUUID())).rows.length,0,'other owner cannot enqueue')
  assert.equal((await db.query('select paused from vinted_agent_settings')).rows[0].paused,true)
  const claim=async()=>(await db.query(`select claim_vinted_agent_task($1,'desktop') as value`,[account])).rows[0].value
  assert.equal((await claim()).state,'paused')
  await db.exec(`update vinted_agent_settings set paused=false`);assert.equal((await claim()).state,'idle','old/missing connector cannot execute')
  await db.exec(`update vinted_agent_settings set extension_version='pc-1.8.12'`)
  assert.equal((await claim()).task.kind,'publish_item');assert.equal((await claim()).state,'busy','one publication at a time')
  await db.exec(`update vinted_agent_tasks set state='done',lease=null where state='running'`);assert.equal((await claim()).task.kind,'publish_item')
  await assert.rejects(queue(await draft(),{submit:'true'}),/publier ou préparer/)
  await db.exec(`update vinted_agent_settings set features='{"publish":false}'`);await assert.rejects(queue(await draft()),/non activée/)
  assert.equal((await db.query(`select has_function_privilege('authenticated','public.queue_ylavint_listing(uuid,uuid,integer,jsonb,integer,timestamptz,boolean)','execute') as allowed`)).rows[0].allowed,false)
 }finally{await db.close()}
})
