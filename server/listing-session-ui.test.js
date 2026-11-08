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
function server({dotb=false,ylavint=false,slow=0}={}){
 const rows=new Map(),calls=[],live={now:0,max:0},settings={global:null,account:null,effective:{...DEFAULT_LISTING_SETTINGS,dotb,spacing_minutes:30,custom:false}}
 const expose=row=>structuredClone({...row,photos:row.photos.map(p=>({...p,url:`https://example.test/${p.path}`}))})
 const request=async(method,body,query='')=>{
  const q=new URLSearchParams(query),action=body?.action||q.get('action');calls.push({action,body:structuredClone(body)})
  if(action==='session')return {account_id:q.get('account_id'),settings,dotb,ylavint,publisher:{ready:ylavint,online:true,limit:5,from_hour:9,to_hour:22},dotb_publish_enabled:dotb,drafts:[...rows.values()].reverse().map(expose)}
  if(action==='options')return options
  if(action==='accounts')return {accounts:[account]}
  if(action==='settings'&&method==='GET')return settings
  if(action==='settings'){const key=body.scope==='default'?'global':'account';settings[key]={settings:body.settings,version:(settings[key]?.version||0)+1};return structuredClone(settings)}
  if(action==='create'){const row={id:body.id,version:1,state:'draft',fields:{...emptyListing(),account_id:body.account_id},photos:[],created_at:new Date().toISOString()};rows.set(row.id,row);return {draft:expose(row)}}
  const row=rows.get(body?.id||q.get('id'));if(!row)throw Error('Brouillon introuvable.')
  if(body?.version!=null&&body.version!==row.version)throw Error('Cette fiche a changé dans un autre onglet.')
  if(action==='save'){row.fields={...body.fields,price:String(body.fields.price).replace(',','.')};row.photos=body.photos;row.version++}
  if(action==='generate'){live.now++;live.max=Math.max(live.max,live.now);if(slow)await wait(slow);live.now--;row.fields=applyListingPresets({...row.fields,title:`Body noir effet cuir décolleté V manches longues moulant soirée Y2K taille ${row.fields.size_text}`,description:'Body noir effet cuir.\n– Décolleté V',catalog_id:10,color_ids:[1]},options,settings.effective);row.ai_updated_at=new Date().toISOString();row.version++}
  if(action==='mark_published'){row.state='published';row.vinted_id='42';row.url='https://www.vinted.fr/items/42';row.published_at=new Date().toISOString();row.version++}
  if(action==='ylavint_publish'){row.state='scheduled';row.publish_provider='ylavint';row.can_cancel=true;row.publication_task_id='task';row.dotb_publish=body.mode!=='draft';row.message='Annonce confiée à YlaVint.';row.version++}
  if(action==='ylavint_cancel'){row.state='draft';row.publish_provider=null;row.publication_task_id=null;row.version++}
  if(action==='publish'){row.state='preparing';row.uploaded=0;row.dotb_publish=body.mode!=='draft';row.dotb_item_id='remote';row.version++}
  if(action==='step'){row.uploaded++;if(row.uploaded>=row.photos.length){row.state='scheduled';row.scheduled_at=new Date(Date.now()+3600000).toISOString();row.message='Annonce planifiée.'}row.version++}
  if(action==='discard'){rows.delete(row.id);return {removed:row.id}}
  return {draft:expose(row)}
 }
 let n=0
 const upload=async file=>({path:`owner/${String(++n).padStart(2,'0')}-${file.name}`})
 return {rows,calls,request,upload,settings,live}
}
const png=name=>new File([new Uint8Array(32)],name,{type:'image/png'})

const article=()=>document.querySelector('article')
const field=placeholder=>document.querySelector(`article input[placeholder="${placeholder}"]`)
const queue=()=>[...document.querySelectorAll('aside[aria-label="Articles du compte"] li button')]
const addFiles=async(ui,files)=>ui.act(async()=>ui.props(document.querySelector('input[aria-label="Ajouter les photos d’un ou plusieurs articles"]')).onChange({target:{files,value:''}}))
const autoWrite=async(ui,on)=>ui.act(async()=>ui.props([...document.querySelectorAll('input[type="checkbox"]')].find(i=>i.closest('label')?.textContent.includes('Rédaction automatique'))).onChange({target:{checked:on}}))
const fill=async(ui,{sku,size,price})=>{if(sku!=null)await ui.type(field('sz…'),sku);if(size!=null)await ui.type(field('M'),size);if(price!=null)await ui.type(field('24,90'),price)}
const rail=label=>[...document.querySelectorAll('nav[aria-label="Étapes des articles"] button')].find(b=>b.textContent.includes(label))?.textContent

test('photos dropped together become one or several articles, in file-name order',async()=>{
 const ui=await mount(),s=server()
 assert.deepEqual(ui.groupFiles([png('b-02.png'),png('a-01.png'),png('b-01.png'),png('a-02.png')],2).map(g=>g.map(f=>f.name)),[['a-01.png','a-02.png'],['b-01.png','b-02.png']])
 try{
  await ui.act(async()=>ui.root.render(ui.React.createElement(ui.Session,{request:s.request,upload:s.upload,account,meta,onBack(){},onOpenDraft(){}})))
  assert.ok(document.body.textContent.includes('Aucune annonce à traiter'))
  await addFiles(ui,[png('b-02.png'),png('a-01.png'),png('b-01.png'),png('a-02.png')])
  assert.ok(document.body.textContent.includes('4 photos sélectionnées'))
  assert.ok(ui.button('2 articles de 2 photos'),'pairs offered (front/back)')
  await ui.click('2 articles de 2 photos')
  await ui.act(()=>wait(50))
  assert.equal(s.rows.size,2)
  assert.deepEqual([...s.rows.values()].map(r=>r.photos.map(p=>p.path.split('-').slice(1).join('-'))),[['a-01.png','a-02.png'],['b-01.png','b-02.png']])
  assert.equal(queue().length,2,'both articles are in the queue');assert.equal(document.querySelectorAll('article').length,1,'one article is open at a time')
  assert.equal(s.calls.filter(c=>c.action==='generate').length,0,'nothing is written by the AI before the size is known')
 }finally{await ui.unmount()}
})

test('several articles are written at the same time, then published by hand line by line',async()=>{
 const ui=await mount(),s=server({slow:120})
 try{
  await ui.act(async()=>ui.root.render(ui.React.createElement(ui.Session,{request:s.request,upload:s.upload,account,meta,onBack(){},onOpenDraft(){}})))
  await autoWrite(ui,false)
  for(const name of ['01.png','02.png','03.png']){await addFiles(ui,[png(name)]);await ui.act(()=>wait(20))}
  assert.equal(queue().length,3)
  for(const [i,item] of queue().entries()){await ui.act(async()=>item.click());await fill(ui,{sku:`sku-${i}`,size:'M',price:'24,90'})}
  await ui.act(()=>wait(1100))
  assert.ok([...s.rows.values()].every(r=>r.fields.price==='24.90'&&r.fields.size_text==='M'))
  assert.equal(s.calls.filter(c=>c.action==='generate').length,0,'automatic writing switched off')
  await ui.click('Rédiger les 3 articles avec l’IA')
  await ui.act(()=>wait(500))
  assert.equal(s.calls.filter(c=>c.action==='generate').length,3)
  assert.equal(s.live.max,3,'the three articles are written in parallel')
  assert.ok(document.body.textContent.includes('3 articles rédigés.'))
  // Presets filled condition, parcel and Vinted size: all articles are ready.
  assert.match(rail('Prêtes'),/3$/)
  assert.match(article().querySelector('textarea.font-semibold').value,/taille M$/)
  await ui.click('Publier à la main')
  assert.ok(document.querySelector('section[aria-label="Publier sur Vinted"]'))
  const copyTitle=[...document.querySelectorAll('section[aria-label="Publier sur Vinted"] li')].find(li=>li.textContent.includes('Titre')).querySelector('button:last-child')
  await ui.act(async()=>copyTitle.click());await ui.act(()=>wait(10))
  assert.ok(document.body.textContent.includes('Copié ✓'))
  assert.ok(document.querySelector('button[aria-label="Titre : fait"]'),'copying ticks the line')
  const link=[...article().querySelectorAll('input')].find(i=>i.getAttribute('aria-label')?.startsWith('Lien Vinted'))
  const openId=[...s.rows.values()].find(r=>article().getAttribute('aria-label')===r.fields.title)?.id
  await ui.type(link,'https://www.vinted.fr/items/42-body')
  await ui.act(async()=>ui.props(article().querySelector('form')).onSubmit({preventDefault(){}}))
  await ui.act(()=>wait(30))
  const marked=s.calls.find(c=>c.action==='mark_published')
  assert.equal(marked.body.url,'https://www.vinted.fr/items/42-body');assert.equal(typeof marked.body.version,'number')
  assert.match(rail('En ligne'),/1$/);assert.match(rail('Prêtes'),/2$/)
  assert.match(document.body.textContent,/est notée publiée/)
  assert.notEqual(s.rows.get(openId)?.state==='published'&&article().getAttribute('aria-label'),undefined)
  assert.ok(article().querySelector('textarea.font-semibold'),'the next ready article opens')
  assert.equal(s.calls.some(c=>c.action==='publish'),false,'never sent to Dotb when the account publishes by hand')
  assert.equal(ui.button('Tout publier avec Dotb (2)'),undefined)
 }finally{await ui.unmount()}
})

test('automatic writing waits for SKU, size and price, then 2 seconds without typing',async()=>{
 const ui=await mount(),s=server()
 try{
  await ui.act(async()=>ui.root.render(ui.React.createElement(ui.Session,{request:s.request,upload:s.upload,account,meta,onBack(){},onOpenDraft(){}})))
  await addFiles(ui,[png('01.png')]);await ui.act(()=>wait(20))
  await fill(ui,{size:'M'})
  await ui.act(()=>wait(2400))
  assert.equal(s.calls.filter(c=>c.action==='generate').length,0,'size alone is not enough')
  await fill(ui,{sku:'sz123'})
  await ui.act(()=>wait(2400))
  assert.equal(s.calls.filter(c=>c.action==='generate').length,0,'price still missing')
  await fill(ui,{price:'24,90'})
  await ui.act(()=>wait(1200))
  assert.equal(s.calls.filter(c=>c.action==='generate').length,0,'still typing: no writing yet')
  await ui.act(()=>wait(1300))
  assert.equal(s.calls.filter(c=>c.action==='generate').length,1,'written without a click once everything is filled')
  assert.match(article().querySelector('textarea.font-semibold').value,/taille M$/)
  assert.match(rail('Prêtes'),/1$/)
  await ui.act(()=>wait(400))
  assert.equal(s.calls.filter(c=>c.action==='generate').length,1,'never rewritten automatically')
 }finally{await ui.unmount()}
})

for(const mode of ['draft','live'])test(`Dotb ${mode}: ready articles are sent one by one after checking the Bridge`,async()=>{
 const ui=await mount(),s=server({dotb:true})
 const ready={...emptyListing(),account_id:account.id,sku:'sku-a',size_text:'M',price:'19.90',title:'Body noir effet cuir décolleté V manches longues soirée taille M',description:'Body noir.',catalog_id:10,brand_id:1,brand_title:'Sans marque',size_id:4,status_id:2,package_size_id:1,color_ids:[1]}
 for(const id of ['aaaaaaaa-0000-4000-8000-000000000001','aaaaaaaa-0000-4000-8000-000000000002'])s.rows.set(id,{id,version:1,state:'draft',fields:{...ready},photos:[{path:`owner/${id}.png`}]})
 try{
  await ui.act(async()=>ui.root.render(ui.React.createElement(ui.Session,{request:s.request,upload:s.upload,account,meta:{...meta,dotb_publish_enabled:true},onBack(){},onOpenDraft(){}})))
  await ui.act(()=>wait(20))
  assert.ok(document.body.textContent.includes('un écart de 30 min'))
  await ui.act(async()=>ui.props(document.querySelector('input[value="dotb"]')).onChange())
  await ui.click(mode==='draft'?'Tout en brouillon Vinted (2)':'Tout publier avec Dotb (2)')
  await ui.act(()=>wait(1500))
  assert.equal(s.calls.filter(c=>c.action==='accounts').length,1,'Bridge checked once before the batch')
  assert.equal(s.calls.filter(c=>c.action==='publish').length,2)
  assert.ok(s.calls.filter(c=>c.action==='publish').every(c=>c.body.confirmation_account_id===account.id&&c.body.mode===mode))
  assert.ok([...s.rows.values()].every(r=>r.state==='scheduled'))
  assert.match(document.body.textContent,mode==='draft'?/2 annonces transmises à Dotb sur 2\. Dotb crée les brouillons/:/2 annonces transmises à Dotb sur 2\. Dotb les publie/)
  assert.match(document.body.textContent,mode==='draft'?/Brouillon prévu/:/Mise en ligne prévue/)
 }finally{await ui.unmount()}
})

test('a completed Vinted draft stays separate from published listings until its link is recorded',async()=>{
 const ui=await mount(),s=server({dotb:true}),id=crypto.randomUUID()
 s.rows.set(id,{id,version:3,state:'vinted_draft',dotb_publish:false,dotb_item_id:'remote',vinted_id:'42',fields:{...emptyListing(),account_id:account.id,sku:'test',title:'Robe test'},photos:[],message:'Brouillon créé sur Vinted.'})
 try{
  await ui.act(async()=>ui.root.render(ui.React.createElement(ui.Session,{request:s.request,upload:s.upload,account,meta:{...meta,dotb_publish_enabled:true},onBack(){},onOpenDraft(){}})))
  assert.match(document.body.textContent,/Brouillon créé sur Vinted/)
  assert.match(rail('En ligne'),/0$/)
  assert.equal(ui.button('En ligne via Dotb'),undefined)
  const link=document.querySelector('input[aria-label="Lien Vinted de Robe test"]')
  await ui.type(link,'https://www.vinted.fr/items/42-robe')
  await ui.act(async()=>ui.props(article().querySelector('form')).onSubmit({preventDefault(){}}))
  assert.match(rail('En ligne'),/1$/)
  assert.equal(s.calls.some(c=>c.action==='publish'),false)
 }finally{await ui.unmount()}
})

test('an article never sent can be removed after a confirmation',async()=>{
 const ui=await mount(),s=server()
 s.rows.set('aaaaaaaa-0000-4000-8000-000000000003',{id:'aaaaaaaa-0000-4000-8000-000000000003',version:1,state:'draft',fields:{...emptyListing(),account_id:account.id},photos:[]})
 try{
  await ui.act(async()=>ui.root.render(ui.React.createElement(ui.Session,{request:s.request,upload:s.upload,account,meta,onBack(){},onOpenDraft(){}})))
  await ui.act(()=>wait(20))
  await ui.click('Retirer de la session')
  assert.equal(s.calls.some(c=>c.action==='discard'),false,'asks first')
  await ui.click('Oui, retirer')
  await ui.act(()=>wait(20))
  assert.equal(s.rows.size,0);assert.equal(queue().length,0)
 }finally{await ui.unmount()}
})

test('a failed save keeps edits visible and blocks refresh or leaving until retry succeeds',async()=>{
 const ui=await mount(),s=server();let fail=false,left=0
 const request=async(method,body,query)=>{if(body?.action==='save'&&fail)throw Error('Sauvegarde interrompue');return s.request(method,body,query)}
 try{
  await ui.act(async()=>ui.root.render(ui.React.createElement(ui.Session,{request,upload:s.upload,account,meta,onBack(){left++},onOpenDraft(){left++}})))
  await addFiles(ui,[png('one.png')])
  await ui.act(()=>wait(20));fail=true
  await ui.type(field('sz…'),'SKU-À-CONSERVER')
  await ui.click('← Changer de compte')
  assert.equal(left,0);assert.match(document.body.textContent,/Sauvegarde interrompue/)
  await ui.click('Actualiser')
  assert.equal(field('sz…').value,'SKU-À-CONSERVER')
  assert.equal(s.calls.filter(c=>c.action==='session').length,1,'refresh cannot replace unsaved edits')
  await ui.click('Ouvrir la fiche complète');assert.equal(left,0)
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
  assert.ok(ui.button('Publier à la main'))
  await ui.type(field('M'),'L')
  assert.ok(ui.button('Publier à la main'),'changing the size keeps an available Vinted size')
  await ui.click('Publier à la main')
  document.execCommand=()=>false
  const copyTitle=[...document.querySelectorAll('section[aria-label="Publier sur Vinted"] li')].find(li=>li.textContent.includes('Titre')).querySelector('button:last-child')
  await ui.act(async()=>copyTitle.click())
  assert.match(document.body.textContent,/copie automatique est indisponible/)
  assert.equal(ui.button('Copié ✓'),undefined)
  assert.ok(document.querySelector('button[aria-label="Titre : à faire"]'),'a failed copy does not tick the checklist')
  await ui.click('Revenir à la fiche')
  await ui.click('← Changer de compte')
  assert.equal(s.rows.get(id).fields.size_id,5)
 }finally{await ui.unmount()}
})

test('step filters show only matching articles and an empty step has no publication action',async()=>{
 const ui=await mount(),s=server()
 for(const [id,state] of [['pending','draft'],['done','published']])s.rows.set(id,{id,version:1,state,fields:{...emptyListing(),account_id:account.id,title:state==='published'?'Article publié':''},photos:[]})
 try{
  await ui.act(async()=>ui.root.render(ui.React.createElement(ui.Session,{request:s.request,upload:s.upload,account,meta,onBack(){},onOpenDraft(){}})))
  const filter=label=>[...document.querySelectorAll('nav[aria-label="Étapes des articles"] button')].find(b=>b.textContent.includes(label))
  await ui.act(async()=>filter('En ligne').click())
  assert.equal(article().getAttribute('aria-label'),'Article publié')
  await ui.act(async()=>filter('Prêtes').click())
  assert.equal(article(),null)
  assert.equal(queue().length,0)
 }finally{await ui.unmount()}
})

test('automatic and batch writing share three slots and stop on quota errors',async()=>{
 const ui=await mount(),s=server(),releases=[];let running=0,max=0,attempts=0
 for(let n=0;n<7;n++){const id=`draft-${n}`;s.rows.set(id,{id,version:1,state:'draft',fields:{...emptyListing(),account_id:account.id,sku:`sz-${n}`,size_text:'M',price:'24.90'},photos:[{path:`${id}.png`}]})}
 const request=async(method,body,query)=>{
  if(body?.action==='generate'){
   attempts++;running++;max=Math.max(max,running)
   await new Promise(resolve=>releases.push(resolve));running--
   throw Error('Quota Gemini atteint')
  }
  return s.request(method,body,query)
 }
 try{
  await ui.act(async()=>ui.root.render(ui.React.createElement(ui.Session,{request,upload:s.upload,account,meta,onBack(){},onOpenDraft(){}})))
  await ui.act(()=>wait(20));assert.equal(attempts,3)
  await ui.click('Rédiger les 7 articles avec l’IA')
  await ui.act(()=>wait(20));assert.equal(attempts,3,'batch waits for the existing automatic writes')
  await ui.act(async()=>{releases.splice(0).forEach(resolve=>resolve());await wait(50)})
  await ui.act(()=>wait(50))
  assert.equal(max,3);assert.equal(attempts,3,'quota failure does not send waiting articles')
  assert.match(document.body.textContent,/Quota Gemini atteint|quota IA atteint/)
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

test('already published listings leave the default queue and remain available under En ligne',async()=>{
 const ui=await mount(),s=server()
 for(const id of ['done-a','done-b'])s.rows.set(id,{id,version:1,state:'published',fields:{...emptyListing(),account_id:account.id,title:id},photos:[]})
 try{
  await ui.act(async()=>ui.root.render(ui.React.createElement(ui.Session,{request:s.request,upload:s.upload,account,meta,onBack(){},onOpenDraft(){}})))
  assert.equal(queue().length,0);assert.equal(article(),null)
  assert.match(rail('À traiter'),/0$/);assert.match(rail('En ligne'),/2$/)
  const online=[...document.querySelectorAll('nav button')].find(b=>b.textContent.includes('En ligne'))
  await ui.act(async()=>online.click());assert.equal(queue().length,2)
  assert.equal(s.calls.some(c=>c.action==='publish'),false)
 }finally{await ui.unmount()}
})

test('opening and refreshing the session reconciles scheduled listings immediately without publishing again',async()=>{
 const ui=await mount(),s=server({dotb:true});let published=false
 for(const id of ['first','second'])s.rows.set(id,{id,version:1,state:'scheduled',dotb_item_id:`remote-${id}`,fields:{...emptyListing(),account_id:account.id,title:id},photos:[]})
 const request=async(method,body,query)=>{
  if(body?.action==='refresh'&&(body.id==='first'||published)){const row=s.rows.get(body.id);row.state='published';row.version++}
  return s.request(method,body,query)
 }
 try{
  await ui.act(async()=>ui.root.render(ui.React.createElement(ui.Session,{request,upload:s.upload,account,meta,onBack(){},onOpenDraft(){}})))
  assert.equal(s.calls.filter(c=>c.action==='refresh').length,2,'no one-minute wait')
  assert.equal(queue().length,1);assert.match(rail('En ligne'),/1$/)
  published=true;await ui.click('Actualiser')
  assert.equal(queue().length,0);assert.equal(article(),null);assert.match(rail('En ligne'),/2$/)
  assert.equal(s.calls.some(c=>['publish','step'].includes(c.action)),false)
 }finally{await ui.unmount()}
})

for(const mode of ['live','draft'])test(`YlaVint ${mode}: both providers stay visible and batch sends only to the selected provider`,async()=>{
 const ui=await mount(),s=server({ylavint:true,dotb:true})
 const ready={...emptyListing(),account_id:account.id,sku:'test',size_text:'M',price:'19.90',title:'Robe noire courte taille M',description:'Robe noire.',catalog_id:10,brand_id:1,brand_title:'Sans marque',size_id:4,status_id:2,package_size_id:1,color_ids:[1]}
 for(let i=0;i<2;i++){const id=crypto.randomUUID();s.rows.set(id,{id,version:1,state:'draft',fields:ready,photos:[{path:'owner/'+id+'.png'}]})}
 try{
  await ui.act(async()=>ui.root.render(ui.React.createElement(ui.Session,{request:s.request,upload:s.upload,account,meta:{...meta,dotb_publish_enabled:true},onBack(){},onOpenDraft(){}})))
  await ui.act(()=>wait(20))
  assert.ok(document.querySelector('input[value="dotb"]'));assert.ok(document.querySelector('input[value="ylavint"]').checked)
  await ui.click(mode==='draft'?'Tout en brouillon Vinted (2)':'Tout publier avec YlaVint (2)')
  assert.equal(s.calls.filter(c=>c.action==='ylavint_publish').length,2)
  assert.ok(s.calls.filter(c=>c.action==='ylavint_publish').every(c=>c.body.mode===mode&&c.body.confirmation_account_id===account.id))
  assert.equal(s.calls.filter(c=>['publish','step'].includes(c.action)).length,0,'no Dotb writes or steps')
  assert.match(document.body.textContent,/YlaVint · En attente de publication/)
  await ui.click('Annuler avant l’envoi');assert.equal([...s.rows.values()].filter(r=>r.state==='draft').length,1)
 }finally{await ui.unmount()}
})
