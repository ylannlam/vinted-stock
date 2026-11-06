import test from 'node:test'
import assert from 'node:assert/strict'
import {planPublications,planConflicts,parisToUtc,parisDate,validatePlanSettings,SKU_GAP_MINUTES} from '../src/lib/publicationPlan.js'
import {planListings,draftIssues} from './publication-planner.js'
import {summarizeAiUsage} from '../src/lib/aiUsage.js'
import {bestSellers} from '../src/lib/library.js'
import {recordAiUsage} from './listing-studio.js'
import {AppError} from './dotb.js'

const MIN=60000
const now=Date.parse('2026-11-06T08:00:00Z') // 9 h à Paris
const drafts=(account,n,sku=i=>`SKU-${account}-${i}`)=>Array.from({length:n},(_,i)=>({id:`${account}-${i}`,version:1,account_id:account,sku:sku(i),title:`Article ${i}`,created_at:`2026-11-0${1+i%5}T10:00:00Z`}))

test('Paris time conversion handles both daylight saving changes', () => {
  assert.equal(new Date(parisToUtc('2026-03-29',600)).toISOString(),'2026-03-29T08:00:00.000Z')
  assert.equal(new Date(parisToUtc('2026-10-25',600)).toISOString(),'2026-10-25T09:00:00.000Z')
  assert.equal(new Date(parisToUtc('2026-11-06',0)).toISOString(),'2026-11-05T23:00:00.000Z')
  assert.equal(parisDate(Date.parse('2026-11-05T23:30:00Z')),'2026-11-06')
})

test('the plan respects the daily quota, the hour window, the account spacing and the SKU rule', () => {
  const list=[...drafts('a',12,i=>i<4?'SAME':`A${i}`),...drafts('b',12,i=>i<4?'same ':`B${i}`),...drafts('c',3)]
  const settings={perDay:4,from:'10:00',to:'20:00',days:4,start:'today',spacing:40}
  const plan=planPublications({drafts:list,settings,now})
  assert.equal(plan.items.length,27)
  assert.deepEqual(plan.conflicts,[])
  for(const item of plan.items){
    const date=item.date
    assert.ok(item.at>=parisToUtc(date,600)&&item.at<=parisToUtc(date,1200),'inside the window')
    assert.ok(item.at>=now+10*MIN,'never in the past')
  }
  const perDay=new Map()
  for(const item of plan.items){const key=`${item.account_id}${item.date}`;perDay.set(key,(perDay.get(key)||0)+1)}
  assert.ok([...perDay.values()].every(n=>n<=4))
  const same=plan.items.filter(i=>i.sku.trim().toLowerCase()==='same').sort((x,y)=>x.at-y.at)
  assert.equal(same.length,8)
  for(let i=1;i<same.length;i++)assert.ok(same[i].at-same[i-1].at>=SKU_GAP_MINUTES*MIN,'same SKU at least 30 minutes apart')
  for(const account of ['a','b','c']){
    const times=plan.items.filter(i=>i.account_id===account).map(i=>i.at).sort((x,y)=>x-y)
    for(let i=1;i<times.length;i++)assert.ok(times[i]-times[i-1]>=40*MIN,'account spacing kept')
  }
  // Les plus anciennes fiches partent en premier.
  assert.equal(plan.items.find(i=>i.account_id==='c').id,'c-0')
})

test('existing listings count in the day and keep their distance', () => {
  const tomorrow=parisToUtc('2026-11-07',12*60)
  const occupied=[{account_id:'a',sku:'S1',at:tomorrow},{account_id:'a',sku:'S2',at:tomorrow+60*MIN},{account_id:'z',sku:'SKU-a-0',at:parisToUtc('2026-11-07',10*60)}]
  const plan=planPublications({drafts:drafts('a',6),occupied,settings:{perDay:3,from:'10:00',to:'22:00',days:1,start:'tomorrow',spacing:30},now})
  assert.equal(plan.items.length,1,'two already planned, one more allowed')
  assert.deepEqual(plan.conflicts,[])
  assert.equal(plan.unplanned.length,5)
  assert.ok(Math.abs(plan.items[0].at-parisToUtc('2026-11-07',600))>=30*MIN||plan.items[0].sku!=='SKU-a-0')
})

test('a stricter spacing saved on the account wins', () => {
  const plan=planPublications({drafts:drafts('a',3),settings:{perDay:3,from:'10:00',to:'12:00',days:1,start:'tomorrow',spacing:20},spacingByAccount:{a:90},now})
  assert.equal(plan.items.length,2)
  assert.ok(plan.items[1].at-plan.items[0].at>=90*MIN)
})

test('planConflicts reports a slot too close to the same account or SKU', () => {
  const items=[{id:'x',account_id:'a',sku:'S',at:1000*MIN},{id:'y',account_id:'b',sku:'s',at:1010*MIN}]
  assert.deepEqual(planConflicts(items,[{account_id:'a',at:1020*MIN}],{spacing:30}).map(c=>c.kind).sort(),['account','sku','sku'])
})

test('plan settings are validated', () => {
  assert.throws(()=>validatePlanSettings({perDay:0}),/1 et 60/)
  assert.throws(()=>validatePlanSettings({from:'20:00',to:'20:10'}),/30 minutes/)
  assert.throws(()=>validatePlanSettings({mode:'other'}),/brouillon/)
  assert.equal(validatePlanSettings({perDay:'5'}).perDay,5)
})

test('draft readiness ignores the category check when a catalog is chosen', () => {
  const fields={account_id:'a',sku:'S',price:'12',title:'Robe longue noire',description:'Belle robe',catalog_id:10,brand_id:1}
  assert.deepEqual(draftIssues({fields,photos:[{path:'p'}]}),[])
  assert.deepEqual(draftIssues({fields:{...fields,price:''},photos:[]}),['au moins une photo','le prix'])
})

test('planListings validates the batch and reports each listing separately', async () => {
  const id='11111111-1111-4111-8111-111111111111',id2='22222222-2222-4222-8222-222222222222'
  const rows=[{id,version:3,state:'draft',fields:{account_id:'a'}},{id:id2,version:1,state:'scheduled',fields:{account_id:'a'}}]
  const db={from:()=>({select(){return this},eq(){return this},in(){return Promise.resolve({data:rows,error:null})}})}
  const read=async()=>({data:[{id:'33333333-3333-4333-8333-333333333333',login:'x'}]})
  const at=new Date(Date.now()+3600000).toISOString(),queued=[]
  const queue=async(row,options)=>{queued.push([row.id,options.notBefore,options.mode]);return {state:'preparing',version:row.version+1,planned_at:options.notBefore,message:'ok'}}
  const out=await planListings(db,{id:'u'},{mode:'live',items:[{id,version:3,at},{id:id2,version:1,at}]},{read,queue})
  assert.deepEqual(out.results.map(r=>r.ok),[true,false])
  assert.match(out.results[1].error,/changé/)
  assert.deepEqual(queued,[[id,at,'live']])
  await assert.rejects(planListings(db,{id:'u'},{mode:'live',items:[{id,version:3,at:'2020-01-01T00:00:00Z'}]},{read,queue}),/passée/)
  await assert.rejects(planListings(db,{id:'u'},{mode:'x',items:[{id,version:3,at}]},{read,queue}),/brouillon/)
  await assert.rejects(planListings(db,{id:'u'},{mode:'live',items:[{id,version:3,at},{id,version:3,at}]},{read,queue}),AppError)
})

test('AI usage is summarized with the saved prices', () => {
  const rows=[{created_at:new Date(now-3600000).toISOString(),model:'lite',input_tokens:1e6,output_tokens:2e5,account_id:'a'},{created_at:new Date(now-86400000).toISOString(),model:'other',input_tokens:10,output_tokens:10,account_id:null}]
  const out=summarizeAiUsage(rows,[{model:'lite',input_per_million:0.3,output_per_million:2.5}],{days:7,now,logins:new Map([['a','lea']])})
  assert.equal(out.total.generations,2)
  assert.equal(out.total.unpriced,1)
  assert.ok(Math.abs(out.total.cost-0.8)<1e-9)
  assert.equal(out.series.length,7)
  assert.deepEqual(out.unknown_models,['other'])
  assert.equal(out.accounts[0].label,'lea')
})

test('recording AI usage never breaks the listing', async () => {
  const inserted=[]
  await recordAiUsage({from:()=>({insert:async row=>{inserted.push(row);return {error:null}}})},{model:'lite',input_tokens:12.4,output_tokens:-3},{listing:'11111111-1111-4111-8111-111111111111',account:'bad',user:null})
  assert.deepEqual(inserted,[{feature:'listing_text',model:'lite',input_tokens:12,output_tokens:0,listing_id:'11111111-1111-4111-8111-111111111111',account_id:null,user_id:null}])
  await recordAiUsage({from:()=>{throw Error('missing table')}},{model:'lite'})
  await recordAiUsage(null,null)
})

test('best sellers group sales by SKU over the chosen period', () => {
  const day=86400000
  const items=[{sku:'A',sold_at:new Date(now-day).toISOString(),price:'20',photo_url:'https://x/a.jpg',title:'Robe'},{sku:'a ',sold_at:new Date(now-2*day).toISOString(),price:null},{sku:'B',sold_at:new Date(now-40*day).toISOString(),price:'10'},{sku:'',sold_at:new Date(now).toISOString()}]
  const products=[{id:'p1',supplier_sku:'A',title:'Robe Shein',photo_url:'https://x/p.jpg',price:9}]
  const recent=bestSellers({items,products,links:[]},{days:30,now})
  assert.deepEqual(recent.map(r=>[r.sku,r.count,r.revenue,r.priced]),[['A',2,20,1]])
  assert.equal(recent[0].product.id,'p1')
  assert.equal(recent[0].title,'Robe Shein')
  assert.deepEqual(bestSellers({items,products},{days:null,now}).map(r=>r.sku),['A','B'])
})
