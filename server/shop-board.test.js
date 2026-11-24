import test from 'node:test'
import assert from 'node:assert/strict'
import {PDFDocument} from 'pdf-lib'
import {shopBoard} from './shop-board.js'
import {preserveShopCovers} from './shop-covers.js'
import {refreshShopPage} from './shop-refresh.js'
import {restrictOrderPage,salesStart} from '../src/lib/shopPeriod.js'
import {listingRows,performanceRows,printableLabel,saleBucket,sortListings,textMatch} from '../src/lib/shopView.js'
import {mergeLabels} from '../src/lib/batchLabels.js'

const before='2026-09-30T21:59:59.999Z'
const recent='2026-10-20T12:30:00Z'
const references={ads:[],lines:[],manual:[],drafts:[]}
const example=(id,options={})=>({id,account:'test-shop',title:'Robe',order_date:recent,normalized_status:'completed',state:'shipped',items:[],...options})
const item=(id,options={})=>({account:'a',seen_at:recent,payload:{id,account_id:'a',title:'Robe',status:'active',photo_url:'https://example.org/image.jpg',...options}})

test('la date de vente à Paris détermine les résultats et le dernier curseur',()=>{
  const orders=[example('first',{order_date:salesStart}),example('old',{order_date:before,deadline:recent}),example('undated',{order_date:null}),example('after')]
  const result=restrictOrderPage({data:orders,has_more:true,next_cursor:'later'})
  assert.deepEqual(result.data.map(r=>r.id),['first','after'])
  assert.equal(result.has_more,false);assert.equal(result.next_cursor,null)
  assert.equal(restrictOrderPage({data:[orders[0]],has_more:true,next_cursor:'next'}).next_cursor,'next')
})

test('le SKU suit les références exactes, les quantités d’un lot et le compte de chaque annonce',()=>{
  const completed=example('sale',{vinted_transaction_id:'tx',items:[
    {id:'line1',vinted_id:'new',quantity:2,title:'Robe'},
    {id:'line2',sku:'REF-B',title:'Veste'}]})
  const dataset=shopBoard({accounts:[{id:'a',login:'test-shop'},{id:'b',login:'other-shop'}],references,drafts:[{id:'draft',account:'a',sku:'BRO',title:'Brouillon'}],
    inventory:[item('old',{sku:'REF-A',replaced_by:'new'}),item('new',{status:'inactive',age_days:2,views:0,favourites:3}),item('different',{status:'inactive'}),item('hidden',{status:'inactive'}),
      item('worn',{sold:true,sale:{state:'terminee',sold_at:before}}),
      {account:'b',payload:{id:'new',account_id:'b',status:'active',title:'Robe',sku:'REF-B'}}],
    jobs:[{id:'pub',account_id:'a',type:'publish',status:'done',new_item_id:'new',done_at:recent},{type:'hide',account_id:'a',item_id:'hidden',status:'done',done_at:recent}],
    postedRefs:[{type:'job',id:'pub',account:'a',sku:'REF-A'},{type:'line',id:'line3',account:'a',sku:'REF-C'}],
    orders:[completed,{...completed,id:'duplicate'},example('pending',{state:'ready',normalized_status:'label_sent',has_label:true,items:[{id:'line3',title:'Autre'}]}),
      example('cancelled',{normalized_status:'cancelled',items:[{id:'cx',sku:'REF-A'}]}),example('previous',{order_date:before,deadline:recent,items:[{sku:'REF-A'}]})]})
  const cards=listingRows(dataset),newCard=cards.find(r=>r.account==='test-shop'&&r.id==='new')
  assert.deepEqual([newCard.sku,newCard.state,newCard.inventory,newCard.accountId,newCard.date,newCard.views],['REF-A','sold',true,'a',recent,0])
  assert.equal(cards.find(r=>r.id==='hidden').state,'hidden')
  assert.equal(cards.find(r=>r.id==='different').state,'offline')
  assert.equal(cards.find(r=>r.id==='draft').accountId,'a')
  assert.equal(cards.find(r=>r.account==='other-shop').state,'live')
  assert.equal(dataset.sales.length,3)
  const ranked=performanceRows(dataset.groups,'test-shop')
  assert.equal(ranked.find(r=>r.sku==='REF-A').completed,2)
  assert.equal(ranked.find(r=>r.sku==='REF-B').completed,1)
  assert.equal(ranked.find(r=>r.sku==='REF-C').pending,1)
  const pending=dataset.sales.find(r=>r.id==='pending')
  assert.equal(pending.lines[0].sku,'REF-C');assert.equal(printableLabel(pending),true)
  assert.equal(saleBucket(dataset.sales.find(r=>r.id==='cancelled')),'closed')
  assert.equal(printableLabel(dataset.sales.find(r=>r.id==='sale')),false)
  assert.ok(textMatch(pending,'ref-c test-shop'))
  assert.equal(sortListings(cards,'likes')[0].id,'new')
})

test('une lecture ancienne ne réimporte pas les commandes antérieures même si la page en contient',async()=>{
  const writes=[]
  const db={from:table=>({upsert(data){writes.push([table,data]);return {data:[],error:null}}})}
  const request=async(kind,{query})=>{assert.equal(kind,'orders');assert.equal(query.sort,'order_date')
    return {data:[example('current'),example('prior',{order_date:before})],has_more:true,next_cursor:'wont-be-read'}}
  assert.deepEqual(await refreshShopPage(db,'ventes','',true,request),{next:null})
  assert.deepEqual(writes[0][1].map(r=>r.remote_id),['current'])
  assert.equal(writes[1][0],'scalency_settings')
})

test('le PDF groupe les pages originales sans modifier les dimensions des bordereaux',async()=>{
  const a=await PDFDocument.create(),b=await PDFDocument.create()
  a.addPage([288,432]);a.addPage([288,432]);b.addPage([595,842])
  const merged=await PDFDocument.load(await mergeLabels([await a.save(),await b.save()],true))
  assert.deepEqual(merged.getPages().map(p=>[p.getWidth(),p.getHeight()]),[[288,432],[288,432],[595,842]])
})

test('une relecture sans photo conserve la couverture du bon compte et ne la transmet pas à un homonyme',()=>{
  const data=shopBoard({accounts:[{id:'a',login:'test-shop'},{id:'b',login:'other-shop'}],jobs:[],orders:[],drafts:[],references,
    inventory:[item('same',{photo_url:null}),{account:'b',payload:{account_id:'b',id:'same',title:'Robe',status:'active'}}],
    listingCovers:[{id:'same',account:'a',photo:'https://example.org/cover.jpg',sku:'REF-9'}]})
  const rows=listingRows(data)
  assert.equal(rows.find(r=>r.account==='test-shop').photo,'https://example.org/cover.jpg')
  assert.equal(rows.find(r=>r.account==='test-shop').sku,'REF-9')
  assert.equal(rows.find(r=>r.account==='other-shop').photo,null)
})

test('une fiche détaillée complète un index sans photos et une relecture réutilise cette image',async()=>{
  const saved=new Map(),calls=[]
  const db={from:()=>({select:()=>({in:(_column,keys)=>({data:keys.filter(k=>saved.has(k)).map(k=>({id:k,value:saved.get(k)}))})}),
    upsert:rows=>{for(const r of rows)saved.set(r.id,r.value);return {data:[]}}})}
  const request=async(path,options)=>{calls.push([path,options.query.account_id]);return {account_id:'a',id:'19',photos:['https://example.org/photo.jpg']}}
  const entry={account_id:'a',id:'19'}
  assert.equal((await preserveShopCovers(db,[{...entry}],request,recent))[0].photo_url,'https://example.org/photo.jpg')
  assert.equal((await preserveShopCovers(db,[{...entry}],request,recent))[0].photo_url,'https://example.org/photo.jpg')
  assert.deepEqual(calls,[['items/19','a']])
})

test('un retrait confirmé conserve l’annonce hors ligne après une lecture abrégée',()=>{
  const data=shopBoard({accounts:[{id:'a',login:'test-shop'}],jobs:[],orders:[],drafts:[],references,
    inventory:[item('retired'),item('restored',{updated_at:'2026-11-10T12:00:00Z'})],
    listingCovers:['retired','restored'].map(id=>({id,account:'a',deletedAt:recent}))})
  const rows=listingRows(data)
  assert.equal(rows.find(r=>r.id==='retired').state,'offline')
  assert.equal(rows.find(r=>r.id==='restored').state,'live')
})
