import test from 'node:test'
import assert from 'node:assert/strict'
import vm from 'node:vm'
import {readFileSync} from 'node:fs'
import {parseHTML} from 'linkedom'
import {openListingForm} from '../extensions/ylavint/form-worker.js'
const source=readFileSync(new URL('../extensions/ylavint/form.js',import.meta.url),'utf8')
const makeTask=()=>({id:crypto.randomUUID(),kind:'publish_item',member_id:'7',listing:{assisted:true,deadline:new Date(Date.now()+600000).toISOString(),fields:{title:'Robe test',description:'Annonce fictive',price:'12.50',catalog_id:10,brand_id:1,brand_title:'Sans marque',size_id:4,status_id:2,package_size_id:1,color_ids:[1],item_attributes:[]},labels:{category_path:[{id:1,title:'Femmes'},{id:10,title:'Robes'}],size:'M',condition:'Très bon état',package:'Petit',colors:['Noir']},photos:[{url:'https://local.test/one',type:'image/png'},{url:'https://local.test/two',type:'image/webp'}]}})
function setup(){
 const scope={Date,Set,Error,Array,String,Number,fetch(){throw Error('Aucun accès réseau autorisé dans ces simulations')}};vm.runInNewContext(source,scope)
 const writes=[],ui={identity:async()=>({member_id:'7',status:'ok'}),blocked:async()=>false,empty:async()=>true,notice:()=>{},photo:async(p,i)=>({size:5,type:p.type,name:i+1}),photos:async files=>writes.push(['photos',files.map(f=>f.name)]),text:async(k,v)=>{writes.push([k,v]);return true},choice:async(k,id,label)=>{writes.push([k,id,label]);return true}}
 return {prepare:scope.ylvPrepareForm,ui,writes}
}
test('form preparation adds the photos in order and fills fields, without a publish capability',async()=>{
 const {prepare,ui,writes}=setup(),r=await prepare(makeTask(),ui)
 assert.equal(r.prepared,true);assert.deepEqual(Array.from(r.missing),[])
 assert.deepEqual(structuredClone(writes[0]),['photos',[1,2]])
 assert.deepEqual(writes.find(w=>w[0]==='price'),['price','12.50'])
 assert.deepEqual(writes.filter(w=>['category','size','condition','color','package'].includes(w[0])).map(w=>w[0]),['category','size','condition','color','package'])
 assert.equal(r.vinted_id,undefined)
 assert.ok(!/fetch\(|\/api\/v2|\.submit\(|requestSubmit\(/.test(source),'the form script has no network / publication submission')
})
test('wrong account, restriction, verification, populated form and expired request stop before any photo',async()=>{
 for(const kind of ['wrong-account','restricted','challenge','populated','expired']){
  const {prepare,ui,writes}=setup(),task=makeTask()
  if(kind==='wrong-account')ui.identity=async()=>({member_id:'8',status:'ok'})
  if(kind==='restricted')ui.identity=async()=>({member_id:'7',status:'restricted'})
  if(kind==='challenge')ui.blocked=async()=>true
  if(kind==='populated')ui.empty=async()=>false
  if(kind==='expired')task.listing.deadline=new Date(0).toISOString()
  await assert.rejects(prepare(task,ui),undefined,kind);assert.equal(writes.length,0,kind)
 }
})
test('a restriction appearing during preparation stops remaining fields; an unavailable field is reported',async()=>{
 const a=setup();a.ui.photos=async()=>{a.writes.push(['photos']);a.ui.blocked=async()=>true}
 await assert.rejects(a.prepare(makeTask(),a.ui));assert.deepEqual(a.writes,[['photos']])
 const b=setup();b.ui.choice=async name=>name!=='size'
 const result=await b.prepare(makeTask(),b.ui);assert.deepEqual(Array.from(result.missing),['Taille','État','Couleurs','Colis']);assert.equal(result.prepared,true)
})
test('a second delivery never imports the same request twice, including a lost result',async()=>{
 const {prepare,ui,writes}=setup(),task=makeTask();await prepare(task,ui)
 await assert.rejects(prepare(task,ui),/déjà/);assert.equal(writes.filter(w=>w[0]==='photos').length,1)
})
test('a failed or invalid photo prevents any import and cannot be retried silently',async()=>{
 for(const mode of ['failed','oversized','unsupported']){
  const {prepare,ui,writes}=setup(),task=makeTask()
  if(mode==='failed')ui.photo=async()=>{throw Error('Photo refusée')}
  if(mode==='oversized')ui.photo=async()=>({size:8000001})
  if(mode==='unsupported')task.listing.photos[0].type='text/html'
  await assert.rejects(prepare(task,ui));await assert.rejects(prepare(task,ui),/déjà/);assert.equal(writes.length,0)
 }
})
test('an account switch while downloading stops before photos are imported',async()=>{
 const {prepare,ui,writes}=setup()
 ui.photo=async()=>{ui.identity=async()=>({member_id:'8',status:'ok'});return {size:5}}
 await assert.rejects(prepare(makeTask(),ui),/compte choisi/);assert.equal(writes.length,0)
})
function browser(){
 const values={},calls=[]
 const b={storage:{local:{get:async k=>({[k]:values[k]}),set:async v=>Object.assign(values,v)}},tabs:{create:async v=>{calls.push(['create',v]);return {id:81}},get:async()=>({status:'complete',url:'https://www.vinted.fr/items/new'}),sendMessage:async(id,msg)=>{calls.push(['message',id,msg.type]);return {ok:true,result:{prepared:true,missing:[]}}}}}
 return {b,calls}
}
test('the worker opens one visible tab in its own browser and never submits the listing',async()=>{
 const {b,calls}=browser(),task=makeTask();const result=await openListingForm(task,b)
 assert.equal(result.result.prepared,true);assert.deepEqual(calls,[['create',{url:'https://www.vinted.fr/items/new',active:true}],['message',81,'prepare_listing']])
 await assert.rejects(openListingForm(task,b),/déjà/);assert.equal(calls.length,2)
})
test('redirects, old direct jobs and missing acknowledgement cannot cause another fill',async()=>{
 for(const mode of ['redirect','old','lost','expired','invalid-deadline']){
  const {b,calls}=browser(),task=makeTask()
  if(mode==='redirect')b.tabs.get=async()=>({status:'complete',url:'https://www.vinted.fr/captcha'})
  if(mode==='old')delete task.listing.assisted
  if(mode==='expired')task.listing.deadline=new Date(0).toISOString()
  if(mode==='invalid-deadline')task.listing.deadline='invalid'
  if(mode==='lost')b.tabs.sendMessage=async()=>{calls.push(['message']);throw Error('Réponse perdue')}
  await assert.rejects(openListingForm(task,b));await assert.rejects(openListingForm(task,b))
  assert.equal(calls.filter(c=>c[0]==='create').length,['old','expired','invalid-deadline'].includes(mode)?0:1)
  assert.equal(calls.filter(c=>c[0]==='message').length,mode==='lost'?1:0)
 }
})

test('the actual DOM adapter fills a local form and leaves both final buttons untouched',async()=>{
 const {window,document}=parseHTML(`<html><body><form><input name="title"><textarea name="description"></textarea><input name="price"><input type="file" name="photos" multiple>
 <select name="catalog"><option value="">Choisir</option><option value="10">Robes</option></select><select name="brand"><option value="">Choisir</option><option value="1">Sans marque</option></select>
 <select name="size"><option value="">Choisir</option><option value="4">M</option></select><select name="condition"><option value="">Choisir</option><option value="2">Très bon état</option></select>
 <select name="color"><option value="">Choisir</option><option value="1">Noir</option></select><select name="package_size"><option value="">Choisir</option><option value="1">Petit</option></select>
 <button type="submit">Publier</button><button type="button">Enregistrer le brouillon</button></form></body></html>`)
 window.HTMLElement.prototype.getClientRects=()=>[{}]
 let submits=0,changes=0;for(const b of document.querySelectorAll('button'))b.addEventListener('click',()=>submits++)
 document.querySelector('form').addEventListener('submit',()=>submits++)
 document.querySelector('input[type=file]').addEventListener('change',()=>{changes++;const grid=document.createElement('div');grid.setAttribute('data-testid','media-upload-grid');grid.innerHTML='<img alt="Simulation 1"><img alt="Simulation 2">';document.body.append(grid)})
 class Transfer{constructor(){this.files=[];this.items={add:f=>this.files.push(f)}}}
 const scope={__YLAVINT_FORM_TEST__:true,window,document,Date,Set,Error,Array,String,Number,File,DataTransfer:Transfer,Event:window.Event,HTMLInputElement:window.HTMLInputElement,HTMLSelectElement:window.HTMLSelectElement,HTMLTextAreaElement:window.HTMLTextAreaElement,MutationObserver:window.MutationObserver,CSS:{escape:s=>s},setTimeout,clearTimeout,atob,location:{origin:'https://www.vinted.fr',pathname:'/items/new'},readVintedAccount:()=>({member_id:'7',status:'ok'}),chrome:{runtime:{onMessage:{addListener(){}},sendMessage:async()=>({base64:Buffer.from('local simulation').toString('base64')})}}}
 vm.runInNewContext(source,scope)
 scope.ylvFormTest.ui.wait=async ms=>assert.equal(ms,10000)
 const r=await scope.ylvPrepareForm(makeTask(),scope.ylvFormTest.ui)
 assert.equal(submits,0);assert.equal(changes,1)
 assert.equal(document.querySelector('[name=title]').value,'Robe test');assert.equal(document.querySelector('[name=price]').value,'12.50')
 assert.deepEqual([...document.querySelector('input[type=file]').files].map(f=>[f.name,f.type]),[['photo-01.png','image/png'],['photo-02.webp','image/webp']])
 assert.deepEqual(Array.from(r.missing),[])
 assert.equal(document.querySelector('[name=catalog]').value,'10');assert.equal(document.querySelector('[name=size]').value,'4')
 assert.match(document.getElementById('ylv-form-notice').textContent,/clique toi-même/)
})

test('custom category and brand controls use exact labelled options and leave final actions untouched',async()=>{
 const {window,document}=parseHTML(`<html><body><button type="button" id="catalog" role="combobox">Choisir la catégorie</button><input name="brand" readonly><div id="options"></div><button type="submit">Publier</button><button type="button" id="save">Enregistrer le brouillon</button></body></html>`)
 window.HTMLElement.prototype.getClientRects=()=>[{}]
 let finalClicks=0
 document.querySelector('button[type=submit]').addEventListener('click',()=>finalClicks++)
 document.getElementById('save').addEventListener('click',()=>finalClicks++)
 const root=document.getElementById('options'),category=document.getElementById('catalog'),brand=document.querySelector('[name=brand]')
 const option=(id,title,fn)=>{root.innerHTML=`<span id="label-${id}">${title}</span><input type="radio" value="${id}" aria-labelledby="label-${id}">`;root.querySelector('input').addEventListener('click',fn)}
 category.addEventListener('click',()=>option(1,'Femmes',()=>option(10,'Robes',()=>{category.textContent='Robes';root.innerHTML=''})))
 brand.addEventListener('click',()=>{root.innerHTML='<input name="brand-search-input"><div id="brand-results"></div>';root.querySelector('input').addEventListener('input',e=>{assert.equal(e.target.value,'Shein');const list=document.getElementById('brand-results');list.innerHTML='<input type="radio" value="99" aria-label="Shein"><input type="radio" value="100" aria-label="Shein Kids">';list.querySelector('input').addEventListener('click',()=>{brand.value='Shein';root.innerHTML=''})})})
 const scope={__YLAVINT_FORM_TEST__:true,window,document,Date,Set,Error,Array,String,Number,Event:window.Event,HTMLInputElement:window.HTMLInputElement,HTMLSelectElement:window.HTMLSelectElement,HTMLTextAreaElement:window.HTMLTextAreaElement,MutationObserver:window.MutationObserver,CSS:{escape:s=>s},setTimeout,clearTimeout,chrome:{runtime:{onMessage:{addListener(){}}}}}
 vm.runInNewContext(source,scope)
 assert.equal(await scope.ylvFormTest.choice('category',10,[{id:1,title:'Femmes'},{id:10,title:'Robes'}]),true)
 assert.equal(await scope.ylvFormTest.choice('brand',99,'Shein'),true)
 assert.equal(category.textContent,'Robes');assert.equal(brand.value,'Shein');assert.equal(finalClicks,0)
 const color=document.createElement('input');color.name='color';document.body.append(color)
 color.addEventListener('click',()=>{root.innerHTML='<div role="checkbox" aria-label="Noir" aria-checked="false"><input type="checkbox" aria-hidden="true"></div>';root.firstChild.addEventListener('click',()=>{const replacement=document.createElement('input');replacement.name='color';replacement.value='Noir';color.replaceWith(replacement);root.innerHTML=''})})
 assert.equal(await scope.ylvFormTest.choice('color',[1],['Noir']),true,'custom choices must read the replacement field after React renders')
 assert.equal(finalClicks,0)
 // Même une fausse option portant le bon texte ne peut soumettre le formulaire.
 const size=document.createElement('input');size.name='size';document.body.append(size)
 size.addEventListener('click',()=>{root.innerHTML='<button role="option" type="submit" value="4">M</button>';root.firstChild.addEventListener('click',()=>finalClicks++)})
 assert.equal(await scope.ylvFormTest.choice('size',4,'M'),false);assert.equal(finalClicks,0)
})

test('screenshot controls: condition with description, color grid committed on close, package cell and React replacement',async()=>{
 const {window,document}=parseHTML(`<html><body><input name="condition" readonly><input name="color" readonly><div id="options"></div>
 <div data-testid="1-package-size--cell"><span id="package-size-1">Petit</span><p>Convient pour un article qui tient dans une grande enveloppe.</p><input type="radio" data-testid="package_type_selector_1" aria-labelledby="package-size-1"></div>
 <div data-testid="2-package-size--cell"><span>Moyen</span><input type="radio" data-testid="package_type_selector_2" checked></div>
 <button type="submit" data-testid="upload-form-save-button">Ajouter</button><button type="button" data-testid="upload-form-save-draft-button">Sauvegarder le brouillon</button></body></html>`)
 window.HTMLElement.prototype.getClientRects=()=>[{}]
 let finalClicks=0;for(const b of document.querySelectorAll('button'))b.addEventListener('click',()=>finalClicks++)
 const root=document.getElementById('options'),condition=document.querySelector('[name=condition]'),color=document.querySelector('[name=color]')
 condition.addEventListener('click',()=>{
  root.innerHTML='<div role="radio" id="condition-2" aria-checked="false"><div><span>Très bon état</span><p>Article très peu porté/utilisé qui peut présenter de légères imperfections, mais qui reste en très bon état.</p></div><input type="radio" aria-hidden="true"></div><div role="radio"><span>Bon état</span><p>Article porté/utilisé quelques fois.</p></div>'
  root.firstChild.addEventListener('click',()=>{const replacement=document.createElement('input');replacement.name='condition';replacement.value='Très bon état';condition.replaceWith(replacement);root.innerHTML=''})
 })
 let open=false;const selected=new Set()
 color.addEventListener('click',()=>{
  if(open){open=false;color.value=[...selected].join(', ');root.innerHTML='';return}
  open=true;root.innerHTML='<div role="checkbox" aria-label="Kaki" aria-checked="false" data-testid="color-grid-option-16"><span>Kaki</span></div><div role="checkbox" aria-label="Noir" aria-checked="false" data-testid="color-grid-option-1"><span>Noir</span></div>'
  for(const o of root.children)o.addEventListener('click',()=>{selected.add(o.getAttribute('aria-label'));o.setAttribute('aria-checked','true')})
 })
 document.querySelector('[data-testid="1-package-size--cell"]').addEventListener('click',()=>{
  const radio=document.querySelector('[data-testid="package_type_selector_1"]'),replacement=document.createElement('input');replacement.type='radio';replacement.setAttribute('data-testid','package_type_selector_1');replacement.checked=true;radio.replaceWith(replacement)
  document.querySelector('[data-testid="package_type_selector_2"]').checked=false
 })
 const scope={__YLAVINT_FORM_TEST__:true,window,document,Date,Set,Error,Array,String,Number,Event:window.Event,HTMLInputElement:window.HTMLInputElement,HTMLSelectElement:window.HTMLSelectElement,HTMLTextAreaElement:window.HTMLTextAreaElement,MutationObserver:window.MutationObserver,CSS:{escape:s=>s},setTimeout,clearTimeout,chrome:{runtime:{onMessage:{addListener(){}}}}}
 vm.runInNewContext(source,scope)
 assert.equal(await scope.ylvFormTest.choice('condition',2,'Très bon état'),true)
 assert.equal(await scope.ylvFormTest.choice('color',[16,1],['Kaki','Noir']),true)
 assert.equal(open,false);assert.equal(color.value,'Kaki, Noir')
 assert.equal(await scope.ylvFormTest.choice('package',1,'Petit'),true)
 assert.equal(document.querySelector('[data-testid="package_type_selector_2"]').checked,false)
 assert.equal(finalClicks,0)
})

test('progress reports confirmed fields in order; a reporting outage does not refill or submit',async()=>{
 const {prepare,ui,writes}=setup(),reports=[]
 ui.progress=async(task,p)=>{reports.push(structuredClone(p));if(p.seq===3)throw Error('Site momentanément indisponible')}
 const result=await prepare(makeTask(),ui)
 assert.deepEqual(Array.from(result.missing),[])
 assert.deepEqual(reports.map(p=>p.seq),Array.from({length:reports.length},(_,i)=>i+1))
 assert.equal(reports.at(-1).steps.every(s=>s.status==='done'),true)
 assert.equal(writes.filter(w=>w[0]==='photos').length,1)
})
