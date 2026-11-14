import test from 'node:test'
import assert from 'node:assert/strict'
import {readFile} from 'node:fs/promises'
import {PGlite} from '@electric-sql/pglite'

test('PC publication: frozen request, executor/version, 30-minute lease, caps, uncertain write and atomic final state',async()=>{
 const db=new PGlite()
 try{
  await db.exec(`create role anon;create role authenticated;create role service_role;
   create table publication_accounts(id uuid primary key);create table vinted_watch_keys(id uuid primary key);
   create table vinted_agent_settings(account_id uuid primary key,enabled boolean,paused boolean default false,pause_reason text,messaging jsonb default '{}',limits jsonb default '{}',features jsonb default '{}',last_seen_at timestamptz,extension_version text);
   create table vinted_agent_tasks(id uuid primary key default gen_random_uuid(),account_id uuid,kind text,writes boolean,state text default 'queued',payload jsonb default '{}',result jsonb,created_by uuid,priority integer default 0,not_before timestamptz default now(),created_at timestamptz default now(),attempts integer default 0,error text,started_at timestamptz,finished_at timestamptz,lease uuid,lease_until timestamptz,dedupe_key text unique);
   create table listing_drafts(id uuid primary key default gen_random_uuid(),owner_id uuid,version integer default 1,state text default 'draft',fields jsonb,photos jsonb,dotb_item_id uuid,publication_task_id uuid,publish_provider text,payload jsonb,planned_at timestamptz,scheduled_at timestamptz,dotb_publish boolean,updated_at timestamptz,last_error text,message text,checked_at timestamptz,inflight text,vinted_id text,published_at timestamptz,uploaded integer);
  `)
  for(const file of ['20261114160000_ylavint_desktop.sql','20261114160001_ylavint_desktop_publication.sql'])await db.exec(await readFile(new URL('../supabase/migrations/'+file,import.meta.url),'utf8'))
  await db.exec('create trigger ylavint_listing_task_state after update of state on vinted_agent_tasks for each row execute function track_ylavint_listing()')
  const account=crypto.randomUUID(),owner=crypto.randomUUID(),id=crypto.randomUUID(),fields={account_id:account},snapshot={assisted:true,execution:'desktop',submit:true,fields,photos:[{path:'owned/photo'}]}
  await db.query(`insert into vinted_agent_settings(account_id,enabled,messaging,features,limits,extension_version) values ($1,true,'{"executor":"desktop"}','{"publish":true}','{"from_hour":0,"to_hour":0,"publish_item_per_day":1,"min_gap_minutes":0}','pc-1.4.0')`,[account])
  await db.query(`insert into listing_drafts(id,owner_id,fields,photos) values ($1,$2,$3,'[{}]')`,[id,owner,fields])
  const queue=payload=>db.query('select * from queue_ylavint_listing($1,$2,1,$3,0,null,true)',[id,owner,payload])
  await assert.rejects(queue(snapshot),/1.5 requis/)
  await db.query(`update vinted_agent_settings set extension_version='pc-1.5.0'`)
  await assert.rejects(queue({...snapshot,execution:'extension'}),/mode du compte/)
  const draft=(await queue(snapshot)).rows[0];assert.equal(draft.state,'scheduled')
  assert.equal((await queue(snapshot)).rows.length,0,'same request cannot queue twice')
  const claim=async driver=>(await db.query('select claim_vinted_agent_task($1,$2) as result',[account,driver])).rows[0].result
  assert.equal((await claim('extension')).state,'other_executor')
  const claimed=await claim('desktop');assert.equal(claimed.task.id,draft.publication_task_id)
  assert.ok(Date.parse(claimed.task.lease_until)-Date.parse(claimed.task.started_at)>=29*60000)
  assert.equal((await db.query('select state from listing_drafts')).rows[0].state,'preparing')
  await assert.rejects(db.query(`update vinted_agent_tasks set state='done',result='{"prepared":true,"missing":[]}' where id=$1`,[claimed.task.id]),/Invalid visible/)
  await db.query(`update vinted_agent_tasks set state='done',result='{"confirmed":true,"vinted_id":"123","message":"Publié"}' where id=$1`,[claimed.task.id])
  const saved=(await db.query('select * from listing_drafts')).rows[0];assert.equal(saved.state,'published');assert.equal(saved.vinted_id,'123')
  const next=crypto.randomUUID();await db.query(`insert into listing_drafts(id,owner_id,fields,photos) values ($1,$2,$3,'[{}]')`,[next,owner,fields])
  await db.query('select * from queue_ylavint_listing($1,$2,1,$3,0,null,true)',[next,owner,snapshot])
  assert.equal((await claim('desktop')).state,'idle','daily cap applies to visible publication')
  await db.query(`update vinted_agent_settings set limits='{"from_hour":0,"to_hour":0,"publish_item_per_day":2,"min_gap_minutes":0}'`)
  const uncertain=await claim('desktop');assert.ok(uncertain.task)
  await db.query(`update vinted_agent_tasks set lease_until=now()-interval '1 minute' where id=$1`,[uncertain.task.id])
  assert.equal((await claim('desktop')).state,'idle')
  assert.equal((await db.query('select state from listing_drafts where id=$1',[next])).rows[0].state,'attention')
  assert.equal((await db.query('select attempts from vinted_agent_tasks where id=$1',[uncertain.task.id])).rows[0].attempts,1)
  for(const fn of ['claim_vinted_agent_task(uuid,text)','queue_ylavint_listing(uuid,uuid,integer,jsonb,integer,timestamp with time zone,boolean)'])assert.equal((await db.query(`select has_function_privilege('authenticated',$1,'execute') as allowed`,[fn])).rows[0].allowed,false)
 }finally{await db.close()}
})
