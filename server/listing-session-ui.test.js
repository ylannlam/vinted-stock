import test from 'node:test'
import assert from 'node:assert/strict'
import {parseHTML} from 'linkedom'
import {build} from 'esbuild'
import {createRequire,Module} from 'node:module'
import {fileURLToPath} from 'node:url'
import {emptyListing} from '../src/lib/listingStudio.js'
import {DEFAULT_LISTING_SETTINGS,applyListingPresets} from '../src/lib/listingSettings.js'

const account={id:'33333333-3333-4333-8333-333333333333',login:'compte-test',profile_id:'profile-a',profile_number:'78',country:'FR',connected:true,dotb:false}
const options={catalog:{id:10},conditions:[{id:2,title:'Très bon état'}],size_groups:[{sizes:[{id:4,title:'M'},{id:5,title:'L'}]}],package_sizes:[{id:1,title:'Petit'}],attributes:[]}
const meta={accounts:[account],catalogs:[{id:1,title:'Femmes'},{id:10,parent_id:1,title:'Bodies'}],colors:[{id:1,title:'Noir'}],ai_ready:true,dotb_publish_enabled:false}
const wait=ms=>new Promise(resolve=>setTimeout(resolve,ms))

async function mount(){
 const {window}=parseHTML('<html><body><div id="app"></div></body></html>')
 globalThis.window=window;globalThis.document=window.document;document.execCommand=()=>true;globalThis.IS_REACT_ACT_ENVIRONMENT=true
 const require=createRequire(import.meta.url),React=require('react'),{act}=React,{createRoot}=require('react-dom/client')
 const compiled=await build({entryPoints:[fileURLToPath(new URL('../src/components/ListingSession.jsx',import.meta.url))],bundle:true,write:false,platform:'node',format:'cjs',jsx:'automatic',packages:'external',external:['../lib/api','../lib/listingExport']})
 const mod=new Module(fileURLToPath(import.meta.url));mod.paths=Module._nodeModulePaths(fileURLToPath(new URL('..',import.meta.url)));mod._compile(compiled.outputFiles[0].text,fileURLToPath(import.meta.url))
 const root=createRoot(document.getElementById('app'))
 const props=node=>node[Object.keys(node).find(key=>key.startsWith('__reactProps$'))]
 const buttons=()=>[...document.querySelectorAll('button')]
 const button=text=>buttons().find(b=>b.textContent===text)
 const click=async text=>{const b=button(text);assert.ok(b,`Button not found: ${text}`);assert.equal(b.disabled,false,`Button disabled: ${text}`);await act(async()=>b.click())}
 const type=async(node,value)=>act(async()=>props(node).onChange({target:{value}}))
 const unmount=async()=>{await act(async()=>root.unmount());delete globalThis.window;delete globalThis.document;delete globalThis.IS_REACT_ACT_ENVIRONMENT}
 return {React,act,root,Session:mod.exports.default,cardStage:mod.exports.cardStage,groupFiles:mod.exports.groupFiles,props,button,buttons,click,type,unmount}
}

// Fake server: the same actions as /api/resources?scope=listings, nothing remote.
function server({dotb=false}={}){
 const rows=new Map(),calls=[],settings={global:null,account:null,effective:{...DEFAULT_LISTING_SETTINGS,dotb,spacing_minutes:30,custom:false}}
 const expose=row=>structuredClone({...row,photos:row.photos.map(p=>({...p,url:`https://example.test/${p.path}`}))})
 const request=async(method,body,query='')=>{
  const q=new URLSearchParams(query),action=body?.action||q.get('action');calls.push({action,body:structuredClone(body)})
  if(action==='session')return {account_id:q.get('account_id'),settings,dotb,dotb_publish_enabled:dotb,drafts:[...rows.values()].reverse().map(expose)}
  if(action==='options')return options
  if(action==='accounts')return {accounts:[account]}
  if(action==='settings'&&method==='GET')return settings
  if(action==='settings'){const key=body.scope==='default'?'global':'account';settings[key]={settings:body.settings,version:(settings[key]?.version||0)+1};return structuredClone(settings)}
  if(action==='create'){const row={id:body.id,version:1,state:'draft',fields:{...emptyListing(),account_id:body.account_id},photos:[],created_at:new Date().toISOString()};rows.set(row.id,row);return {draft:expose(row)}}
  const row=rows.get(body?.id||q.get('id'));if(!row)throw Error('Brouillon introuvable.')
  if(body?.version!=null&&body.version!==row.version)throw Error('Cette fiche a changé dans un autre onglet.')
  if(action==='save'){row.fields={...body.fields,price:String(body.fields.price).replace(',','.')};row.photos=body.photos;row.version++}
  if(action==='generate'){row.fields=applyListingPresets({...row.fields,title:`Body noir effet cuir décolleté V manches longues moulant soirée Y2K taille ${row.fields.size_text}`,description:'Body noir effet cuir.\n– Décolleté V',catalog_id:10,color_ids:[1]},options,settings.effective);row.ai_updated_at=new Date().toISOString();row.version++}
  if(action==='mark_published'){row.state='published';row.vinted_id='42';row.url='https://www.vinted.fr/items/42';row.published_at=new Date().toISOString();row.version++}
  if(action==='publish'){row.state='preparing';row.uploaded=0;row.version++}
  if(action==='step'){row.uploaded++;if(row.uploaded>=row.photos.length){row.state='scheduled';row.scheduled_at=new Date(Date.now()+3600000).toISOString();row.message='Annonce planifiée.'}row.version++}
  if(action==='discard'){rows.delete(row.id);return {removed:row.id}}
  return {draft:expose(row)}
 }
 let n=0
 const upload=async file=>({path:`owner/${String(++n).padStart(2,'0')}-${file.name}`})
 return {rows,calls,request,upload,settings}
}
const png=name=>new File([new Uint8Array(32)],name,{type:'image/png'})

test('photos dropped together become one or several articles, in file-name order',async()=>{
 const ui=await mount(),s=server()
 assert.deepEqual(ui.groupFiles([png('b-02.png'),png('a-01.png'),png('b-01.png'),png('a-02.png')],2).map(g=>g.map(f=>f.name)),[['a-01.png','a-02.png'],['b-01.png','b-02.png']])
 try{
  await ui.act(async()=>ui.root.render(ui.React.createElement(ui.Session,{request:s.request,upload:s.upload,account,meta,onBack(){},onOpenDraft(){}})))
  assert.ok(document.body.textContent.includes('Aucun article en cours'))
  const input=document.querySelector('input[aria-label="Ajouter les photos d’un ou plusieurs articles"]')
  await ui.act(async()=>ui.props(input).onChange({target:{files:[png('b-02.png'),png('a-01.png'),png('b-01.png'),png('a-02.png')],value:''}}))
  assert.ok(document.body.textContent.includes('4 photos sélectionnées'))
  assert.ok(ui.button('2 articles de 2 photos'),'pairs offered (front/back)')
  await ui.click('2 articles de 2 photos')
  await ui.act(()=>wait(50))
  assert.equal(s.rows.size,2)
  assert.deepEqual([...s.rows.values()].map(r=>r.photos.map(p=>p.path.split('-').slice(1).join('-'))),[['a-01.png','a-02.png'],['b-01.png','b-02.png']])
  assert.equal(document.querySelectorAll('article').length,2)
  assert.equal(s.calls.filter(c=>c.action==='generate').length,0,'nothing is written by the AI before asked')
 }finally{await ui.unmount()}
})

test('a session prepares several articles, then each is copied and noted as published by hand',async()=>{
 const ui=await mount(),s=server()
 try{
  await ui.act(async()=>ui.root.render(ui.React.createElement(ui.Session,{request:s.request,upload:s.upload,account,meta,onBack(){},onOpenDraft(){}})))
  for(const name of ['01.png','02.png']){
   const input=document.querySelector('input[aria-label="Ajouter les photos d’un ou plusieurs articles"]')
   await ui.act(async()=>ui.props(input).onChange({target:{files:[png(name)],value:''}}))
   await ui.act(()=>wait(20))
  }
  assert.equal(document.querySelectorAll('article').length,2)
  assert.equal(ui.button('Tout préparer avec l’IA').disabled,true,'SKU, size and price first')
  // Fill SKU, size and price of both cards; edits are saved after a short pause.
  const cards=[...document.querySelectorAll('article')]
  for(const [i,card] of cards.entries()){
   const [sku,size,price]=card.querySelectorAll('fieldset input')
   await ui.type(sku,`sku-${i}`);await ui.type(size,'M');await ui.type(price,'24,90')
  }
  await ui.act(()=>wait(1100))
  assert.ok([...s.rows.values()].every(r=>r.fields.price==='24.90'&&r.fields.size_text==='M'))
  await ui.click('Tout préparer avec l’IA (2)')
  await ui.act(()=>wait(50))
  assert.equal(s.calls.filter(c=>c.action==='generate').length,2)
  assert.ok(document.body.textContent.includes('2 articles préparés.'))
  // Presets filled condition, parcel and Vinted size: both articles are ready.
  assert.equal(document.body.textContent.match(/Prête à publier/g)?.length,2)
  assert.ok(document.body.textContent.includes('Très bon état'))
  const first=document.querySelector('article')
  const title=first.querySelector('textarea.font-semibold')
  assert.match(title.value,/taille M$/)
  await ui.act(async()=>[...first.querySelectorAll('button')].find(b=>b.textContent==='Copier le titre').click())
  await ui.act(()=>wait(10))
  assert.ok(first.textContent.includes('Titre copié ✓'))
  const linkInput=[...first.querySelectorAll('input')].find(i=>i.getAttribute('aria-label')?.startsWith('Lien Vinted'))
  await ui.type(linkInput,'https://www.vinted.fr/items/42-body')
  await ui.act(async()=>ui.props(first.querySelector('form')).onSubmit({preventDefault(){}}))
  await ui.act(()=>wait(20))
  const marked=s.calls.find(c=>c.action==='mark_published')
  assert.equal(marked.body.url,'https://www.vinted.fr/items/42-body');assert.equal(typeof marked.body.version,'number')
  assert.ok(document.body.textContent.includes('Publiées depuis hier · 1'))
  assert.equal(s.calls.some(c=>c.action==='publish'),false,'never sent to Dotb when the account publishes by hand')
  assert.equal(ui.button('Tout publier en ligne via Dotb (1)'),undefined)
 }finally{await ui.unmount()}
})

for(const mode of ['draft','live'])test(`Dotb ${mode}: ready articles are sent one by one after checking the Bridge`,async()=>{
 const ui=await mount(),s=server({dotb:true})
 const ready={...emptyListing(),account_id:account.id,sku:'sku-a',size_text:'M',price:'19.90',title:'Body noir effet cuir décolleté V manches longues soirée taille M',description:'Body noir.',catalog_id:10,brand_id:1,brand_title:'Sans marque',size_id:4,status_id:2,package_size_id:1,color_ids:[1]}
 for(const id of ['aaaaaaaa-0000-4000-8000-000000000001','aaaaaaaa-0000-4000-8000-000000000002'])s.rows.set(id,{id,version:1,state:'draft',fields:{...ready},photos:[{path:`owner/${id}.png`}]})
 try{
  await ui.act(async()=>ui.root.render(ui.React.createElement(ui.Session,{request:s.request,upload:s.upload,account,meta:{...meta,dotb_publish_enabled:true},onBack(){},onOpenDraft(){}})))
  await ui.act(()=>wait(20))
  assert.ok(document.body.textContent.includes('une annonce toutes les 30 min'))
  await ui.click(mode==='draft'?'Tout en brouillon Vinted (2)':'Tout publier en ligne via Dotb (2)')
  await ui.act(()=>wait(1500))
  assert.equal(s.calls.filter(c=>c.action==='accounts').length,1,'Bridge checked once before the batch')
  assert.equal(s.calls.filter(c=>c.action==='publish').length,2)
  assert.ok(s.calls.filter(c=>c.action==='publish').every(c=>c.body.confirmation_account_id===account.id&&c.body.mode===mode))
  assert.ok([...s.rows.values()].every(r=>r.state==='scheduled'))
  assert.match(document.body.textContent,mode==='draft'?/2 annonces transmises à Dotb sur 2\. Dotb crée les brouillons/:/2 annonces transmises à Dotb sur 2\. Dotb les publie/)
  assert.match(document.body.textContent,/Prévue/)
 }finally{await ui.unmount()}
})

test('a completed Vinted draft stays separate from published listings until its link is recorded',async()=>{
 const ui=await mount(),s=server({dotb:true}),id=crypto.randomUUID()
 s.rows.set(id,{id,version:3,state:'vinted_draft',dotb_publish:false,dotb_item_id:'remote',vinted_id:'42',fields:{...emptyListing(),account_id:account.id,sku:'test',title:'Robe test'},photos:[],message:'Brouillon créé sur Vinted.'})
 try{
  await ui.act(async()=>ui.root.render(ui.React.createElement(ui.Session,{request:s.request,upload:s.upload,account,meta:{...meta,dotb_publish_enabled:true},onBack(){},onOpenDraft(){}})))
  assert.match(document.body.textContent,/Brouillon créé sur Vinted/)
  assert.doesNotMatch(document.body.textContent,/Publiées depuis hier/)
  assert.equal(ui.button('Dotb : en ligne'),undefined)
  const link=document.querySelector('input[aria-label="Lien Vinted de Robe test"]')
  await ui.type(link,'https://www.vinted.fr/items/42-robe')
  await ui.act(async()=>ui.props(document.querySelector('article form')).onSubmit({preventDefault(){}}))
  assert.match(document.body.textContent,/Publiées depuis hier · 1/)
  assert.equal(s.calls.some(c=>c.action==='publish'),false)
 }finally{await ui.unmount()}
})

test('an article never sent can be removed after a confirmation',async()=>{
 const ui=await mount(),s=server()
 s.rows.set('aaaaaaaa-0000-4000-8000-000000000003',{id:'aaaaaaaa-0000-4000-8000-000000000003',version:1,state:'draft',fields:{...emptyListing(),account_id:account.id},photos:[]})
 try{
  await ui.act(async()=>ui.root.render(ui.React.createElement(ui.Session,{request:s.request,upload:s.upload,account,meta,onBack(){},onOpenDraft(){}})))
  await ui.act(()=>wait(20))
  await ui.click('Modifier les détails')
  await ui.click('Retirer de la session')
  assert.equal(s.calls.some(c=>c.action==='discard'),false,'asks first')
  await ui.click('Oui, retirer')
  await ui.act(()=>wait(20))
  assert.equal(s.rows.size,0);assert.equal(document.querySelectorAll('article').length,0)
 }finally{await ui.unmount()}
})


test('a failed save keeps edits visible and blocks refresh or leaving until retry succeeds',async()=>{
 const ui=await mount(),s=server();let fail=false,left=0
 const request=async(method,body,query)=>{if(body?.action==='save'&&fail)throw Error('Sauvegarde interrompue');return s.request(method,body,query)}
 try{
  await ui.act(async()=>ui.root.render(ui.React.createElement(ui.Session,{request,upload:s.upload,account,meta,onBack(){left++},onOpenDraft(){left++}})))
  await ui.act(async()=>ui.props(document.querySelector('input[type="file"]')).onChange({target:{files:[png('one.png')],value:''}}))
  await ui.act(()=>wait(20));fail=true
  await ui.type(document.querySelector('article input'),'SKU-À-CONSERVER')
  await ui.click('← Changer de compte')
  assert.equal(left,0);assert.match(document.body.textContent,/Sauvegarde interrompue/)
  await ui.click('Actualiser')
  assert.equal(document.querySelector('article input').value,'SKU-À-CONSERVER')
  assert.equal(s.calls.filter(c=>c.action==='session').length,1,'refresh cannot replace unsaved edits')
  await ui.click('Modifier les détails');await ui.click('Ouvrir la fiche complète');assert.equal(left,0)
  fail=false;await ui.click('Réessayer l’enregistrement')
  assert.equal([...s.rows.values()][0].fields.sku,'SKU-À-CONSERVER')
  await ui.click('← Changer de compte');assert.equal(left,1)
 }finally{await ui.unmount()}
})

test('refresh retries category options, changed sizes match again, and failed copying is not reported as success',async()=>{
 const ui=await mount(),s=server();let optionsFail=true
 const id=crypto.randomUUID()
 await s.request('POST',{action:'create',id,account_id:account.id})
 await s.request('POST',{action:'save',id,version:1,fields:{...emptyListing(),account_id:account.id,sku:'test',size_text:'M',price:'20'},photos:[{path:'one.png'}]})
 await s.request('POST',{action:'generate',id,version:2})
 const request=async(method,body,query)=>{if(query?.startsWith('action=options')&&optionsFail)throw Error('Options indisponibles');return s.request(method,body,query)}
 try{
  await ui.act(async()=>ui.root.render(ui.React.createElement(ui.Session,{request,upload:s.upload,account,meta,onBack(){},onOpenDraft(){}})))
  optionsFail=false;await ui.click('Actualiser')
  assert.ok(ui.button('Copier le titre'))
  await ui.type(document.querySelectorAll('article fieldset input')[1],'L')
  assert.ok(ui.button('Copier le titre'),'changing the size keeps an available Vinted size')
  document.execCommand=()=>false
  await ui.click('Copier le titre')
  assert.match(document.body.textContent,/copie automatique est indisponible/)
  assert.equal(ui.button('Titre copié ✓'),undefined)
  await ui.click('← Changer de compte')
  assert.equal(s.rows.get(id).fields.size_id,5)
 }finally{await ui.unmount()}
})

test('retrying settings after a partial save preserves the new shared version',async()=>{
 const ui=await mount(),s=server();let failed=false
 const attempts=[]
 const request=async(method,body,query)=>{
  if(body?.action==='settings'){attempts.push(structuredClone(body));if(body.scope===account.id&&!failed){failed=true;throw Error('Connexion interrompue')}}
  return s.request(method,body,query)
 }
 try{
  await ui.act(async()=>ui.root.render(ui.React.createElement(ui.Session,{request,upload:s.upload,account,meta,onBack(){},onOpenDraft(){}})))
  await ui.click('Réglages');await ui.click('Enregistrer les réglages')
  assert.match(document.body.textContent,/Connexion interrompue/)
  await ui.click('Enregistrer les réglages')
  assert.equal(attempts.filter(b=>b.scope==='default').length,1)
  assert.equal(attempts.filter(b=>b.scope===account.id).length,2)
  assert.ok(attempts.every(b=>b.version===0))
  assert.match(document.body.textContent,/Réglages enregistrés/)
 }finally{await ui.unmount()}
})
