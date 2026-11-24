import test from 'node:test'
import assert from 'node:assert/strict'
import {readFile} from 'node:fs/promises'
import {PGlite} from '@electric-sql/pglite'

test('counts each confirmed listing on its Paris day, including reposts, and signals new postings',async()=>{
  const db=new PGlite()
  try{
    await db.exec(`
      create role anon; create role authenticated; create role service_role;
      create schema realtime; create schema auth;
      create table public.profiles(id uuid,role text);
      create table public.scalency_records(kind text,account text,remote_id text,payload jsonb);
      create table public.listing_drafts(fields jsonb,vinted_id text,published_at timestamptz);
      create table realtime.messages(extension text);
      create table notices(msg jsonb,event text,topic text,private boolean);
      create function auth.uid() returns uuid language sql as $$select null::uuid$$;
      create function realtime.topic() returns text language sql as $$select null::text$$;
      create function realtime.send(jsonb,text,text,boolean) returns void language sql as $$insert into public.notices values ($1,$2,$3,$4)$$;
    `)
    await db.exec(await readFile(new URL('../supabase/migrations/20261124204500_scalency_publication_counter.sql',import.meta.url),'utf8'))
    const insert=(kind,account,id,payload)=>db.query('insert into scalency_records values($1,$2,$3,$4)',[kind,account,id,payload])
    const count=async day=>(await db.query('select scalency_publications_on_day($1) as report',[day])).rows[0].report
    await insert('accounts','','one',{login:'Test A'})
    await insert('accounts','','two',{login:'Test B'})
    const post={type:'publish',status:'done',new_item_id:'item1',done_at:'2026-10-24T22:15:00Z'}
    await insert('jobs','one','first',post)
    await insert('jobs','one','retry',{...post,done_at:'2026-10-25T23:05:00Z'})
    await insert('jobs','one','queued',{...post,status:'queued',new_item_id:'unconfirmed'})
    await insert('jobs','one','failed',{...post,status:'failed',new_item_id:'failed'})
    await insert('jobs','one','no-id',{...post,new_item_id:null})
    await insert('jobs','two','repost',{type:'relist',status:'done',new_item_id:'item2',updated_at:'2026-10-25T22:59:00Z'})
    await db.query('insert into listing_drafts values($1,$2,$3),($1,$4,$3)',[{account_id:'one'},'item1',post.done_at,'local'])
    const report=await count('2026-10-25')
    assert.equal(report.total,3);assert.equal(report.reposts,1);assert.equal(report.estimated,1)
    assert.deepEqual(report.accounts.map(a=>[a.login,a.total]),[['Test A',2],['Test B',1]])
    assert.equal((await count('2026-10-24')).total,0)
    assert.equal((await count('2026-10-26')).total,0)
    const notifications=async()=>(await db.query('select * from notices')).rows
    const before=await notifications()
    assert.equal(before.length,5);assert.ok(before.every(x=>x.private&&x.topic==='stock-vinted:publications'&&Object.keys(x.msg).length===0))
    await db.exec("update scalency_records set payload=payload where remote_id='first'")
    assert.equal((await notifications()).length,before.length)
    await db.query("update scalency_records set payload=$1 where remote_id='queued'",[{...post,new_item_id:'item3',done_at:'2026-10-25T23:00:00Z'}])
    assert.equal((await count('2026-10-26')).total,1)
    assert.equal((await notifications()).length,before.length+1)
  }finally{await db.close()}
})
