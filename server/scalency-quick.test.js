import test from 'node:test'
import assert from 'node:assert/strict'
import {quickIssues} from '../src/lib/scalencyQuick.js'
import {prepareQuickDraft,quickProfiles,saveQuickBrand,saveQuickSize,verifyQuickFields} from './scalency-quick.js'
import {CatalogTemporarilyUnavailable,readCategoryOptions} from './scalency-catalogs.js'
import {reviewMetadata} from './scalency-batch.js'
import {draftPayload} from './scalency-api.js'
const options={catalog:{id:10},conditions:[{id:2}],size_groups:[{sizes:[{id:3,title:'S'}]}],package_sizes:[{id:1,title:'Petit'}]}
const fields={account_id:'account1',sku:'piece',price:'25',title:'Robe rouge',description:'Robe rouge cintrée.',status_id:2,catalog_id:10,size_id:3,color_ids:[7],package_size_id:1,brand_id:null,brand_title:'Marque du compte'}

test('un référentiel en chargement utilise uniquement le secours de la même catégorie',async()=>{
  const warming=Object.assign(Error('Le référentiel Vinted se charge'),{status:409})
  const primary=async()=>{throw warming}
  const secondary=async path=>{assert.equal(path,'catalogs/10/options?country=FR&locale=fr');return options}
  assert.equal(await readCategoryOptions(10,primary,secondary),options)
  let reads=0
  const retry=async()=>{if(++reads===1)throw warming;return options}
  assert.equal(await readCategoryOptions(10,retry,async()=>({...options,catalog:{id:99}}),async()=>{}),options)
  await assert.rejects(readCategoryOptions(10,primary,async()=>null,async()=>{}),CatalogTemporarilyUnavailable)
  const retired=Object.assign(Error('Catégorie retirée'),{status:404})
  await assert.rejects(readCategoryOptions(10,async()=>{throw retired},secondary),e=>e===retired)
})

test('le texte et les photos du brouillon sont conservés puis la catégorie seule est reprise',async t=>{
  const previous={...process.env}
  Object.assign(process.env,{ONEPROVIDER_API_KEY:'test',SCALENCY_API_KEY:'test',DOTB_API_TOKEN:'test'})
  t.after(()=>{for(const k of ['ONEPROVIDER_API_KEY','SCALENCY_API_KEY','DOTB_API_TOKEN']){
    if(previous[k]===undefined)delete process.env[k];else process.env[k]=previous[k]
  }})
  const row={id:'brouillon',version:2,fields:{account_id:'vt-3',price:'39.90',sku:'article',size_text:'M'},photos:[{path:'photo'}],payload:{batch:{status:'running'}}}
  const db={from(name){
    let key,patch
    const q={select:()=>q,eq(k,v){if(k==='id')key=v;return q},in:async()=>({data:[]}),update(value){patch=value;return q},
      async maybeSingle(){
        if(name==='listing_drafts'){Object.assign(row,patch);return {data:{id:row.id,version:row.version,fields:row.fields}}}
        if(name==='scalency_records')return {data:{payload:{linked:true}}}
        if(key==='listing-brand:vt-3')return {data:{value:{name:'Marque du compte'}}}
        return {data:null}
      }}
    return q
  }}
  let aiCalls=0,down=true
  t.mock.method(globalThis,'fetch',async url=>{
    const path=new URL(url).pathname
    if(path.endsWith('/messages')){
      aiCalls++
      return Response.json({model:'test',content:[{type:'tool_use',name:'vinted_listing',input:{title:'Body noir',
        sentences:['Body noir avec bretelles fines.','Le dos présente un détail brodé.'],
        hashtags:['body','noir','brodé','lingerie','bretelles','dentelle','mode','élégant','femme','soirée','tenue','dos','chic','ajusté','haut'],
        catalog_id:1835,color_ids:[1],is_dress:false,is_ball_gown:false}}]})
    }
    if(path.endsWith('/catalogs/1835/options'))return Response.json({}, {status:503})
    assert.ok(path.endsWith('/catalogs/1835'))
    if(down)return Response.json({error:{message:'Le référentiel Vinted se charge'}},{status:429})
    return Response.json({...options,catalog:{id:1835,title:'Bodies'},conditions:[{id:2,title:'Très bon état'}],
      size_groups:[{sizes:[{id:3,title:'M'}]}]})
  })
  const run=()=>prepareQuickDraft(db,{id:'vendeur'},{headers:{}},row,async()=>['data:image/png;base64,dGVzdA=='],reviewMetadata)
  await run()
  assert.equal(row.payload.batch.status,'review')
  assert.equal(row.payload.batch.catalog_pending,true)
  const {description,title}=row.fields
  assert.match(title,/Body noir taille M/)
  down=false
  await run()
  assert.equal(aiCalls,1)
  assert.equal(row.payload.batch.status,'ready')
  assert.equal(row.fields.title,title)
  assert.equal(row.fields.description,description)
  assert.deepEqual(row.photos,[{path:'photo'}])
  assert.equal(row.fields.sku,'article')
  assert.equal(row.fields.price,'39.90')
})
test('un conflit cite les deux marques et la validation accepte la correction seule',async()=>{
  const db={from(table){
    return {select(){return this},eq(){return this},maybeSingle(){return {data:table==='scalency_records'?{payload:{linked:true}}:{value:{name:'Maison A'}}}}}
  }}
  await assert.rejects(verifyQuickFields(db,{...fields,brand_title:'Maison B'},options),/« Maison B ».*« Maison A »/)
  await verifyQuickFields(db,{...fields,brand_title:'Maison A'},options)
})
test('Une annonce complète transmet la marque du vendeur, les couleurs, le SKU et le petit colis',()=>{
  assert.deepEqual(quickIssues(fields,options),[])
  const payload=draftPayload({fields},['https://example.org/image.jpg'],fields.account_id)
  assert.equal(payload.brand,'Marque du compte')
  assert.equal(payload.package_size_id,1)
  assert.equal(payload.sku,'piece')
  assert.deepEqual(payload.color_ids,[7])
})
test('Une taille incertaine, une palette invalide et un colis indisponible interrompent le parcours automatique',()=>{
  assert.deepEqual(quickIssues({...fields,size_id:null,color_ids:[999],package_size_id:2},options),['Taille sur l’étiquette','Couleur','Petit colis indisponible pour cette catégorie'])
})
test('La taille facultative ne bloque pas une catégorie sans tailles',()=>{
  assert.deepEqual(quickIssues({...fields,size_id:null},{...options,size_groups:[]}),[])
})
test('Une catégorie hors ligne ou une caractéristique obligatoire manquante doit être corrigée',()=>{
  assert.ok(quickIssues(fields,{...options,offline:true}).includes('Catégorie Vinted'))
  const attr={code:'type',title:'Type',required:true,options:[{id:8}]}
  assert.ok(quickIssues(fields,{...options,attributes:[attr]}).includes('Type'))
})

test('la taille par compte se relit et se retire indépendamment de la marque',async()=>{
  const profiles=[{remote_id:'compte-a',payload:{linked:true,login:'A'}},{remote_id:'compte-b',payload:{linked:true,login:'B'}}]
  const settings=new Map([['listing-brand:compte-a',{name:'Maison A'}]])
  const db={from(table){
    let selected
    const q={
      select(){return q},
      eq(key,value){if(key==='remote_id')selected=value;return q},
      order:async()=>({data:profiles}),
      maybeSingle:async()=>({data:profiles.find(p=>p.remote_id===selected)}),
      like:async(key,pattern)=>({data:[...settings].filter(([id])=>id.startsWith(pattern.slice(0,-1))).map(([id,value])=>({id,value}))}),
      upsert:async({id,value})=>{settings.set(id,value);return {data:null}},
      delete:()=>({eq:async(key,id)=>{settings.delete(id);return {data:null}}})
    }
    assert.ok(['scalency_records','scalency_settings'].includes(table))
    return q
  }}
  const read=async()=>(await quickProfiles(db,{id:'vendeur'})).accounts
  await saveQuickSize(db,'compte-a',' xl ')
  await saveQuickSize(db,'compte-b','38')
  await saveQuickBrand(db,'compte-a','Atelier A')
  assert.deepEqual(await read(),[
    {id:'compte-a',login:'A',brand:'Atelier A',default_size:'XL'},
    {id:'compte-b',login:'B',brand:'',default_size:'38'}
  ])
  await assert.rejects(saveQuickSize(db,'compte-inconnu','L'),/relié/)
  await assert.rejects(saveQuickSize(db,'compte-a','X'.repeat(81)),/taille/)
  await saveQuickSize(db,'compte-a','')
  assert.deepEqual((await read()).map(a=>[a.brand,a.default_size]),[['Atelier A',''],['','38']])
})
