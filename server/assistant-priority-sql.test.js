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
  await db.exec(await readFile(new URL('../supabase/migrations/20261115151455_assistant_task_priority.sql',import.meta.url),'utf8'))
  const account='00000000-0000-4000-8000-000000000001'
  await db.query(`insert into vinted_agent_settings(account_id,enabled,messaging,limits,features,extension_version) values ($1,true,'{"executor":"desktop","offers":{"enabled":true}}','{"from_hour":0,"to_hour":0}','{"wallet":true,"orders":true}','pc-1.8.10')`,[account])
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
 }finally{await db.close()}
})
