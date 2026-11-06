import test from 'node:test'
import assert from 'node:assert/strict'
import {guessCategory,validatePricing,gridPrice,salePriceOf,groupPosted,sheinFacts} from '../src/lib/library.js'
import {syncDotbLibrary,handleLibraryAction,validateMeta} from './library.js'

test('categories are guessed from the first keyword of the title',()=>{
  assert.equal(guessCategory('SHEIN Robe longue fleurie'),'robe')
  assert.equal(guessCategory('Robe chemise à rayures'),'robe')
  assert.equal(guessCategory('Ensemble top et jupe plissée'),'ensemble')
  assert.equal(guessCategory('Top Navettage Manches taille XXS'),'top')
  assert.equal(guessCategory('LUMIGAL · Pantalon Long Vintage'),'pantalon')
  assert.equal(guessCategory('Glimmora · Jupe Longue Vintage'),'jupe')
  assert.equal(guessCategory('Modelyn · Combinaison Patchwork Dentelle'),'combinaison')
  assert.equal(guessCategory('Débardeur côtelé'),'top')
  assert.equal(guessCategory('Jean large taille haute'),'jean')
  assert.equal(guessCategory('Cardigan en maille'),'pull')
  assert.equal(guessCategory('Accessoire'),'autre')
  assert.equal(guessCategory(null),'autre')
})

test('the pricing grid gives a whole sale price, a manual price wins, and invalid grids are refused',()=>{
  const pricing=validatePricing({tiers:[{max:'10',price:'39'},{max:'6',price:'31'},{max:'14,5',price:49}],above:'4.4'})
  assert.deepEqual(pricing.tiers.map(t=>t.max),[6,10,14.5],'tiers are sorted')
  assert.equal(gridPrice(5.87,pricing),31);assert.equal(gridPrice(6,pricing),31);assert.equal(gridPrice(9.68,pricing),39);assert.equal(gridPrice(13.25,pricing),49)
  assert.equal(gridPrice(20.62,pricing),91,'above the last tier: coefficient, rounded')
  assert.equal(gridPrice(20,{tiers:[{max:10,price:39}],above:null}),null,'no coefficient: no invented price')
  assert.equal(gridPrice(null,pricing),null);assert.equal(gridPrice(10,null),null)
  assert.deepEqual(salePriceOf({price:9,sale_price:'45'},pricing),{price:45,manual:true})
  assert.deepEqual(salePriceOf({price:9,sale_price:null},pricing),{price:39,manual:false})
  assert.throws(()=>validatePricing({tiers:[{max:5,price:20},{max:5,price:25}]}),/même prix/)
  assert.throws(()=>validatePricing({tiers:[{max:-1,price:20}]}),/invalide/)
  assert.throws(()=>validatePricing({tiers:Array.from({length:21},(_,i)=>({max:i+1,price:10}))}),/20 paliers/)
  assert.deepEqual(validatePricing({tiers:[],above:''}),{tiers:[],above:null})
})

test('posted Dotb items are grouped by SKU, without sold SKUs, with their linked Shein product',()=>{
  const posted=[
    {id:'1',sku:'SZA',title:'Robe A',account_login:'lea',price:'39',status:'published',synced_at:'2026-11-06T10:00:00Z',photo_url:'https://img/a1.jpg'},
    {id:'2',sku:'sza',title:'Robe A bis',account_login:'mia',price:'45',status:'pending',synced_at:'2026-11-06T11:00:00Z',photo_url:'https://img/a2.jpg'},
    {id:'3',sku:'SZSOLD',title:'Jupe vendue',account_login:'lea',price:'30',status:'published',synced_at:'2026-11-06T10:00:00Z'},
  ]
  const groups=groupPosted(posted,{products:[{id:'p1',title:'Robe longue Shein',supplier_sku:null,price:12}],links:[{sku:'SZA',product_id:'p1'}],sales:[{sku:'szsold',quantity:1}]})
  assert.equal(groups.length,1,'sold SKU is only in « Vendus »')
  assert.equal(groups[0].items.length,2);assert.deepEqual(groups[0].accounts,['lea','mia']);assert.deepEqual(groups[0].prices,[39,45])
  assert.equal(groups[0].product.id,'p1');assert.equal(groups[0].title,'Robe longue Shein');assert.equal(groups[0].photo_url,'https://img/a2.jpg','latest listing photo')
})

test('Shein measurements are separated from other details',()=>{
  const facts=sheinFacts({details:[{name:'Longueur',value:'120 cm'},{name:'Composition',value:'100% Polyester'},{name:'Tour de poitrine',value:'88'},{name:'Détails',value:'Fente, 45 cm'},{name:'',value:'x'}]})
  assert.deepEqual(facts.measures.map(d=>d.name),['Longueur','Tour de poitrine','Détails'])
  assert.deepEqual(facts.details.map(d=>d.name),['Composition'])
  assert.deepEqual(sheinFacts(null),{measures:[],details:[]})
})

function fakeDb(extra={}){
  const calls=[]
  const query=table=>{const q={};for(const m of ['select','eq','order','range','update','upsert','delete','maybeSingle'])q[m]=(...a)=>{calls.push([table,m,...a]);return q};q.then=(ok,ko)=>Promise.resolve({data:null,error:null}).then(ok,ko);return q}
  return {calls,from:query,rpc:async(name,args)=>{calls.push(['rpc',name,args]);return (extra[name]?.(args))||{data:name==='library_claim_dotb_sync'?{cursor:null}:7,error:null}}}
}
const item=(id,sku)=>({id,sku,title:'Article',vinted_account_id:null,status:'published',price:'39',currency:'EUR',photos:[]})
const uuid=n=>`00000000-0000-4000-8000-${String(n).padStart(12,'0')}`

test('the Dotb sync imports every page with one lease, saves the cursor and resumes when time runs out',async()=>{
  const db=fakeDb(),pages={undefined:{data:[item(uuid(1),'A')],has_more:true,next_cursor:'c2'},c2:{data:[item(uuid(2),'B')],has_more:false,next_cursor:null}}
  const read=async cursor=>pages[cursor]
  assert.deepEqual(await syncDotbLibrary(db,{read}),{done:true,pages:2,items:2})
  const imports=db.calls.filter(c=>c[1]==='library_import_dotb_page')
  assert.deepEqual(imports.map(c=>c[2].p_cursor),['c2',null]);assert.equal(new Set(imports.map(c=>c[2].p_lease)).size,1)
  assert.equal(db.calls.some(c=>c[1]==='library_release_dotb_sync'),false,'a finished sync releases its lease in the database')
  const slow=fakeDb()
  assert.deepEqual(await syncDotbLibrary(slow,{read,deadline:0}),{done:false,pages:1,items:1})
  assert.ok(slow.calls.some(c=>c[1]==='library_release_dotb_sync'),'an unfinished sync frees the lease and keeps the cursor')
  const busy=fakeDb({library_claim_dotb_sync:()=>({data:null,error:{message:'sync_running'}})})
  await assert.rejects(syncDotbLibrary(busy,{read}),/déjà en cours/)
  const broken=fakeDb()
  await assert.rejects(syncDotbLibrary(broken,{read:async()=>{throw Error('Dotb down')}}),/Dotb down/)
  assert.ok(broken.calls.some(c=>c[1]==='library_release_dotb_sync'),'an error frees the lease')
})

test('library actions validate SKU lists, categories, prices and the grid',async()=>{
  const db=fakeDb(),user={id:uuid(9)}
  assert.deepEqual(await handleLibraryAction(db,user,{action:'library-add',references:'sz123\nhttps://fr.shein.com/Robe-p-12345678.html'}),{queued:7,references:2})
  const add=db.calls.find(c=>c[1]==='library_add_references')[2]
  assert.equal(add.p_source,'manual');assert.deepEqual(add.p_refs.map(r=>r.reference_key),['sku:sz123','product:12345678'])
  await handleLibraryAction(db,user,{action:'library-add',references:'sz9',source:'listing'})
  assert.equal(db.calls.filter(c=>c[1]==='library_add_references').at(-1)[2].p_source,'listing')
  await assert.rejects(handleLibraryAction(db,user,{action:'library-add',references:'pas un sku !'}),/SKU ou un lien/)
  assert.deepEqual(validateMeta({product_id:uuid(1),category:'robe',sale_price:'39,5'}),{product_id:uuid(1),category:'robe',sale_price:39.5})
  assert.throws(()=>validateMeta({product_id:uuid(1),category:'chaussure'}),/Catégorie/)
  assert.throws(()=>validateMeta({product_id:'x',category:'robe'}),/Produit/)
  assert.throws(()=>validateMeta({product_id:uuid(1),sale_price:'-3'}),/Prix/)
  await handleLibraryAction(db,user,{action:'product-meta',product_id:uuid(1),category:null,sale_price:''})
  assert.ok(db.calls.some(c=>c[0]==='catalog_product_meta'&&c[1]==='delete'),'clearing both values removes the override')
  await handleLibraryAction(db,user,{action:'product-meta',product_id:uuid(1),category:'jupe',sale_price:null})
  assert.equal(db.calls.find(c=>c[1]==='upsert')[2].category,'jupe')
  assert.deepEqual((await handleLibraryAction(db,user,{action:'pricing',pricing:{tiers:[{max:10,price:39}],above:null}})).pricing,{tiers:[{max:10,price:39}],above:null})
  await assert.rejects(handleLibraryAction(db,user,{action:'pricing',pricing:{tiers:'x'}}),/Grille/)
  assert.equal(await handleLibraryAction(db,user,{action:'observe'}),undefined,'other catalogue actions are left to the catalogue')
})
