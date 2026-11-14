import test from 'node:test'
import assert from 'node:assert/strict'
import {readFile} from 'node:fs/promises'
import {PGlite} from '@electric-sql/pglite'

test('Postgres: exclusive executor, unsupported tasks preserved, leases and daily caps',async()=>{
 const db=new PGlite()
 try{
  await db.exec(`
   create role anon; create role authenticated; create role service_role;
   create table public.publication_accounts(id uuid primary key);
   create table public.vinted_watch_keys(id uuid primary key);
   create table public.vinted_agent_settings(account_id uuid primary key,enabled boolean,paused boolean default false,pause_reason text,
     messaging jsonb default '{}',limits jsonb default '{}',features jsonb default '{}',last_seen_at timestamptz,extension_version text);
   create table public.vinted_agent_tasks(id uuid primary key default gen_random_uuid(),account_id uuid,kind text,writes boolean,state text default 'queued',
     payload jsonb default '{}',created_by uuid,priority integer default 0,not_before timestamptz default now(),created_at timestamptz default now(),
     attempts integer default 0,error text,started_at timestamptz,finished_at timestamptz,lease uuid,lease_until timestamptz);
   create table public.listing_drafts(publication_task_id uuid,publish_provider text,state text,owner_id uuid,fields jsonb);
  `)
  await db.exec(await readFile(new URL('../supabase/migrations/20261114160000_ylavint_desktop.sql',import.meta.url),'utf8'))
  const account='00000000-0000-4000-8000-000000000001'
  await db.query('insert into publication_accounts values ($1)',[account])
  await db.query(`insert into vinted_agent_settings(account_id,enabled,messaging,limits,features) values ($1,true,'{"executor":"desktop"}','{"from_hour":0,"to_hour":0,"like_message_per_day":1}','{"likes":true}')`,[account])
  await db.query(`insert into vinted_agent_tasks(account_id,kind,writes,priority) values ($1,'reprice_item',true,100),($1,'like_message',true,0)`,[account])
  const claim=async driver=>(await db.query(driver?`select claim_vinted_agent_task($1,$2) as result`:`select claim_vinted_agent_task($1) as result`,driver?[account,driver]:[account])).rows[0].result
  assert.equal((await claim()).state,'other_executor','an old extension cannot claim a desktop account')
  const first=await claim('desktop');assert.equal(first.task.kind,'like_message');assert.ok(first.task.lease)
  assert.equal((await claim('desktop')).state,'busy','second worker does not obtain the same task')
  await db.query(`update vinted_agent_tasks set state='done',lease=null where id=$1`,[first.task.id])
  await db.query(`insert into vinted_agent_tasks(account_id,kind,writes) values ($1,'like_message',true),($1,'scan_likes',false)`,[account])
  assert.equal((await claim('desktop')).task.kind,'scan_likes','daily cap does not block reads')
  const rows=(await db.query(`select kind,state,attempts from vinted_agent_tasks where state='queued' order by kind`)).rows
  assert.deepEqual(rows,[{kind:'like_message',state:'queued',attempts:0},{kind:'reprice_item',state:'queued',attempts:0}])
  await db.query(`update vinted_agent_settings set messaging='{}' where account_id=$1`,[account])
  assert.equal((await claim('desktop')).state,'other_executor','switch back stops native claims')
  assert.equal((await db.query(`select has_function_privilege('authenticated','public.claim_vinted_agent_task(uuid,text)','execute') as allowed`)).rows[0].allowed,false)
  await assert.rejects(db.query('insert into vinted_watch_keys(id,desktop_account_id) values (gen_random_uuid(),$1)',[account]),/desktop_pair_complete/)
 }finally{await db.close()}
})
