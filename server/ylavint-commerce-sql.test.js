import test from 'node:test'
import assert from 'node:assert/strict'
import {readFile} from 'node:fs/promises'
import {PGlite} from '@electric-sql/pglite'

test('commerce storage is private and only a recent PC with enabled functions can claim its reads and PDFs',async()=>{
 const db=new PGlite()
 try{
  await db.exec(`create role anon;create role authenticated;create role service_role;
   create table publication_accounts(id uuid primary key);
   create table vinted_agent_settings(account_id uuid primary key,enabled boolean,paused boolean default false,pause_reason text,messaging jsonb default '{}',limits jsonb default '{}',features jsonb default '{}',last_seen_at timestamptz,extension_version text);
   create table vinted_agent_tasks(id uuid primary key default gen_random_uuid(),account_id uuid,kind text,writes boolean,state text default 'queued',payload jsonb default '{}',created_by uuid,priority integer default 0,not_before timestamptz default now(),created_at timestamptz default now(),attempts integer default 0,error text,started_at timestamptz,finished_at timestamptz,lease uuid,lease_until timestamptz);
   create table listing_drafts(publication_task_id uuid,publish_provider text,state text,owner_id uuid,fields jsonb);
  `)
  await db.exec(await readFile(new URL('../supabase/migrations/20261114160002_ylavint_desktop_commerce.sql',import.meta.url),'utf8'))
  await db.exec('create schema auth;create table auth.users(id uuid primary key);')
  await db.exec(await readFile(new URL('../supabase/migrations/20261114162953_ylavint_operations.sql',import.meta.url),'utf8'))
  await db.exec(await readFile(new URL('../supabase/migrations/20261115112948_ylavint_visible_offers.sql',import.meta.url),'utf8'))
  for(const table of ['ylavint_wallets','ylavint_desktop_orders','ylavint_order_preparation']){
   const access=(await db.query(`select relrowsecurity as rls,has_table_privilege('anon',$1,'select') as anon,has_table_privilege('authenticated',$1,'select') as authenticated,has_table_privilege('service_role',$1,'select,insert,update') as server from pg_class where oid=$1::regclass`,[table])).rows[0]
   assert.deepEqual(access,{rls:true,anon:false,authenticated:false,server:true})
  }
  assert.equal((await db.query(`select has_function_privilege('authenticated','claim_vinted_agent_task(uuid,text)','execute') as allowed`)).rows[0].allowed,false)
  const account=crypto.randomUUID();await db.query('insert into publication_accounts values($1)',[account])
  await db.query(`insert into vinted_agent_settings(account_id,enabled,messaging,features,limits,extension_version) values ($1,true,'{"executor":"desktop"}','{"wallet":true,"orders":true,"labels":true}','{"from_hour":0,"to_hour":0}','pc-1.5.0')`,[account])
  const claim=async driver=>(await db.query('select claim_vinted_agent_task($1,$2) as result',[account,driver])).rows[0].result
  await db.query(`insert into vinted_agent_tasks(account_id,kind,writes,payload) values($1,'scan_wallet',false,'{"manual":true}')`,[account])
  assert.equal((await claim('desktop')).state,'idle','old PC cannot receive unknown tasks')
  await db.exec(`update vinted_agent_settings set extension_version='pc-1.6.0'`)
  assert.equal((await claim('extension')).state,'other_executor')
  assert.equal((await claim('desktop')).task.kind,'scan_wallet')
  assert.equal((await claim('desktop')).state,'busy')
  await db.exec(`update vinted_agent_tasks set state='done'`)
  await db.query(`insert into vinted_agent_tasks(account_id,kind,writes,payload) values($1,'fetch_label',false,'{"transaction_id":"123"}'),($1,'fetch_label',false,'{"desktop_order":true,"conversation_id":"123"}')`,[account])
  assert.equal((await claim('desktop')).task.payload.desktop_order,true,'legacy labels stay with the extension')
  await db.exec(`update vinted_agent_tasks set state='done' where state='running';update vinted_agent_settings set features='{}'`)
  await db.query(`insert into vinted_agent_tasks(account_id,kind,writes) values($1,'scan_wallet',false)`,[account])
  assert.equal((await claim('desktop')).state,'idle','disabled wallet remains waiting')
  await db.exec(`update vinted_agent_settings set messaging='{"executor":"extension"}'`)
  assert.equal((await claim('extension')).task.payload.transaction_id,'123')
  await db.exec(`update vinted_agent_tasks set state='done' where state='running'`)
  assert.equal((await claim('extension')).state,'idle','the extension never gets wallet scans')
  await assert.rejects(db.query(`insert into ylavint_wallets(account_id,available,pending,withdrawal) values ($1,-1,0,'unknown')`,[account]))
  await db.exec(`update vinted_agent_tasks set state='done';update vinted_agent_settings set messaging='{"executor":"desktop"}',extension_version='pc-1.7.0'`)
  await db.query(`insert into vinted_agent_tasks(account_id,kind,writes,payload) values($1,'order_extension',true,'{"desktop_order":true,"conversation_id":"123","days":3}')`,[account])
  assert.equal((await claim('desktop')).state,'idle','old PC never receives shipping requests')
  await db.exec(`update vinted_agent_settings set extension_version='pc-1.8.0'`)
  assert.equal((await claim('desktop')).task.kind,'order_extension')
  await db.exec(`update vinted_agent_tasks set state='done' where state='running'`)
  await assert.rejects(db.query(`insert into vinted_agent_tasks(account_id,kind,writes,payload) values($1,'order_extension',true,'{"desktop_order":true,"conversation_id":"123"}')`,[account]),/unique/)
  const second=crypto.randomUUID();await db.query(`insert into vinted_agent_tasks(account_id,kind,writes,payload) values($1,'order_extension',true,'{"desktop_order":true,"conversation_id":"123"}')`,[second])
  assert.equal((await claim('desktop')).state,'idle','another account never supplies this account’s tasks')
  await db.exec(`update vinted_agent_settings set messaging='{"executor":"desktop","offers":{"enabled":true,"max_per_buyer":1,"period_days":1}}',extension_version='pc-1.8.6'`)
  await db.query(`insert into vinted_agent_tasks(account_id,kind,writes,payload) values($1,'accept_offer',true,'{"desktop_offer":true,"offer":{"buyer_id":"44"}}'),($1,'accept_offer',true,'{"offer":{"buyer_id":"45"}}')`,[account])
  assert.equal((await claim('desktop')).state,'idle','old connectors never receive accept-offer tasks')
  await db.exec(`update vinted_agent_settings set extension_version='pc-1.8.7'`)
  const acceptance=(await claim('desktop')).task;assert.equal(acceptance.kind,'accept_offer');assert.equal(acceptance.payload.desktop_offer,true)
  await db.exec(`update vinted_agent_tasks set state='done' where state='running'`)
  await db.query(`insert into vinted_agent_tasks(account_id,kind,writes,payload) values($1,'accept_offer',true,'{"desktop_offer":true,"offer":{"buyer_id":"44"}}')`,[account])
  assert.equal((await claim('desktop')).state,'idle','buyer cap and legacy offer isolation still apply')
 }finally{await db.close()}
})
