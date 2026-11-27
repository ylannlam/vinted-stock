import test from 'node:test'
import assert from 'node:assert/strict'
import {randomUUID} from 'node:crypto'
import {readFile} from 'node:fs/promises'
import {PGlite} from '@electric-sql/pglite'
import {addDays,parisDate} from '../src/lib/publicationPlan.js'
import {lotDays} from '../src/lib/lotSchedule.js'

const migration=name=>readFile(new URL('../supabase/migrations/'+name+'.sql',import.meta.url),'utf8')

test('un lot de dix réparti sur deux jours est atomique, idempotent et suivi à deux dates distinctes',async t=>{
  const db=new PGlite(),owner=randomUUID()
  t.after(()=>db.close())
  await db.exec(`create role anon; create role authenticated; create role service_role;
    create schema auth; create table auth.users(id uuid primary key);
    create table profiles(id uuid,role text);
    create table scalency_records(kind text,account text,remote_id text,payload jsonb);
    create table scalency_commands(request_id text);
    create table listing_drafts(id uuid primary key,owner_id uuid,version int default 1,state text default 'draft',
      fields jsonb,photos jsonb default '[]',payload jsonb default '{"batch":{"status":"ready"}}',
      published_at timestamptz,scheduled_at timestamptz,vinted_id text,publication_task_id text,inflight text,
      dotb_item_id text,updated_at timestamptz,message text);`)
  for(const name of ['20261123203246_scalency_publication_lots','20261124130000_scalency_daily_capacity','20261125195613_scalency_lot_windows']){
    await db.exec(await migration(name))
  }
  const counter=await migration('20261124204500_scalency_publication_counter')
  await db.exec(counter.slice(0,counter.indexOf('create policy')))
  await db.exec(await migration('20261127150120_scalency_publication_planning'))
  await db.query('insert into auth.users values($1)',[owner])
  await db.query("insert into profiles values($1,'admin')",[owner])
  await db.exec(`insert into scalency_records values('accounts','','one','{"linked":true,"login":"Compte A"}'),
    ('accounts','','two','{"linked":false,"login":"Ancien"}');
    insert into scalency_account_cadence values('one','normal',3,7);`)
  const today=parisDate(Date.now()),day=addDays(today,1),next=addDays(day,1)
  const groups=lotDays({day,from:'08:00',to:'20:00',firstCount:7},10)
  const entries=groups.flatMap(g=>g.times.map(at=>({id:randomUUID(),version:1,at,until:g.end})))
  for(const [i,e] of entries.entries())await db.query('insert into listing_drafts(id,owner_id,fields) values($1,$2,$3)',
    [e.id,owner,{account_id:'one',sku:'sku-'+i,title:'Article '+i}])
  const report=async(date,filter,user=owner)=>(await db.query("select scalency_publication_planning($1,$2,$3,null,0) as r",[user,date,filter])).rows[0].r
  const save=()=>db.query("select scalency_accept_limited_lot('test',$1,'one',$2)",[owner,JSON.stringify(entries)])
  assert.equal((await report(today,'planned')).accounts[0].ready,10)
  for(let i=0;i<5;i++)await db.query("insert into scalency_records values('jobs','one',$1,$2)",
    ['external-'+i,{type:'publish',status:'queued',not_before:groups[1].times[0],created_at:new Date().toISOString()}])
  await assert.rejects(save(),/daily_capacity/)
  assert.equal((await db.query('select count(*)::int as n from scalency_lot_entries')).rows[0].n,0)
  await db.exec("delete from scalency_records where remote_id='external-4'")
  await save();await save()
  assert.equal((await report(day,'planned')).total,7)
  assert.equal((await report(next,'planned')).total,7)
  assert.equal((await report(today,'added')).total,14)
  assert.equal((await report(day,'added')).total,0)
  const cards=(await report(day,'planned')).accounts
  assert.equal(cards.length,1);assert.equal(cards[0].ready,0);assert.equal(cards[0].capacity.remaining,0)
  await db.query("update scalency_lot_entries set job_id='123',status='queued' where draft_id=$1",[entries[0].id])
  await db.query("insert into scalency_records values('jobs','one','123',$1)",[{type:'publish',status:'done',new_item_id:'912',done_at:new Date().toISOString(),created_at:entries[0].at}])
  const planned=await report(day,'planned')
  assert.equal(planned.total,7);assert.equal(planned.rows.find(r=>r.job_id==='123').job_status,'done')
  assert.equal((await report(today,'added')).accounts[0].posted,1)
  assert.equal((await report(day,'planned',randomUUID())).rows.some(r=>r.lot==='test'),false)
})
