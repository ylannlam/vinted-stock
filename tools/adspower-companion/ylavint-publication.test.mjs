import test from 'node:test'
import assert from 'node:assert/strict'
import {typePublication} from './ylavint-typing.mjs'
import {preparePublication,PublicationForm} from './ylavint-publication.mjs'
import {parseHTML} from 'linkedom'

function field(){
 const state={value:'',focused:true,events:[]}
 const control={inputValue:async()=>state.value,scrollIntoViewIfNeeded:async()=>{},click:async()=>{},evaluate:async()=>state.focused,
  pressSequentially:async(char,options)=>{state.events.push({char,delay:options.delay});state.value+=char},press:async key=>{state.events.push({key});state.value=key==='Backspace'?state.value.slice(0,-1):state.value+'\n'}}
 return {state,control}
}
test('publication types slowly, corrects transient typos and preserves exact approved text',async()=>{
 const {state,control}=field(),pauses=[],value='Jolie robe avec manches.\nTrès bon état.'
 await typePublication(control,value,{pace:{publication_corrections:true},corrections:true,sleep:async ms=>pauses.push(ms)})
 assert.equal(state.value,value);assert.equal(state.events.filter(e=>e.key==='Backspace').length,1)
 assert.ok(state.events.filter(e=>e.char).every(e=>e.delay===250));assert.ok(pauses.includes(1200))
})
test('price and brand input never introduce typos; prefilled input is left intact',async()=>{
 for(const value of ['29.50','Avec','38']){const {state,control}=field();await typePublication(control,value,{pace:{publication_corrections:true},sleep:async()=>{}});assert.equal(state.value,value);assert.ok(!state.events.some(e=>e.key==='Backspace'))}
 const {state,control}=field();state.value='texte personnel';await assert.rejects(typePublication(control,'nouveau'),/déjà présent/);assert.equal(state.value,'texte personnel')
})
test('manual change and lost focus halt typing and preserve the user input',async()=>{
 for(const takeover of [s=>s.value='mon texte',s=>s.focused=false]){
  const {state,control}=field(),send=control.pressSequentially
  control.pressSequentially=async(...args)=>{await send(...args);takeover(state)}
  await assert.rejects(typePublication(control,'robe',{sleep:async()=>{}}),e=>e.keep_page===true)
  assert.equal(state.events.length,1)
 }
})

const task=submit=>({listing:{assisted:true,execution:'desktop',submit,fields:{title:'Robe noire',description:'Avec manches longues',price:'20.00',catalog_id:10,brand_id:1,brand_title:'Sans marque',status_id:2,package_size_id:1,color_ids:[],item_attributes:[]},labels:{category_path:[{id:10,title:'Robes'}],condition:'Très bon état',package:'Petit'},photos:[{url:'photo'}]}})
function ui(){
 const calls=[],target={calls}
 for(const name of ['open','guard','empty','photos','verify','pause','choice','text','reread','authorize','submit'])target[name]=async(...args)=>calls.push({name,args})
 target.step=async(name,fn)=>{calls.push({name:'step',args:[name]});await fn()}
 target.confirm=async()=>({confirmed:true,vinted_id:'123'})
 return target
}
test('prepare-only hands back the complete form and never clicks publish',async()=>{
 const target=ui();const result=await preparePublication(task(false),target)
 assert.deepEqual(result,{prepared:true,missing:[]});assert.equal(target.calls.filter(c=>c.name==='submit').length,0)
 assert.equal(target.calls.filter(c=>c.name==='text').length,3)
 assert.equal(target.calls.filter(c=>c.name==='choice').length,4)
})
test('publication requires explicit intent, final authorization, exact fields and confirmed item page',async()=>{
 for(const mode of [undefined,'true'])await assert.rejects(preparePublication(task(mode),ui()),/incomplète/)
 const target=ui();assert.equal((await preparePublication(task(true),target)).vinted_id,'123')
 assert.equal(target.calls.filter(c=>c.name==='submit').length,1)
 assert.ok(target.calls.findIndex(c=>c.name==='authorize')<target.calls.findIndex(c=>c.name==='submit'))
 for(const reason of ['changed','stopped','uncertain']){
  const failure=ui();if(reason==='changed')failure.verify=async()=>{throw Error('changed')};if(reason==='stopped')failure.authorize=async()=>{throw Error('stopped')};if(reason==='uncertain')failure.confirm=async()=>({confirmed:false})
  await assert.rejects(preparePublication(task(true),failure));assert.equal(failure.calls.filter(c=>c.name==='submit').length,reason==='uncertain'?1:0)
 }
})
test('photos may only come from the private signed Stock Vinted store',async()=>{
 const form=new PublicationForm({check:()=>{},reader:{},page:{},sleep:async()=>{},fetcher:async()=>{throw Error('network must not be used')}})
 form.guard=async()=>{}
 for(const url of ['http://127.0.0.1/file','https://www.vinted.fr/api/private','https://files.test/image','https://xnclywhkqpdulogykvoy.supabase.co/storage/v1/object/public/creative-assets/a'])await assert.rejects(form.photos([{url,type:'image/jpeg'}]),/non autorisée/)
})
test('the desktop form loads signed photos from the migrated stock store and its original store',async()=>{
 const host='stock-vinted-bd46f562da6a.stock-vinted-bd46f562da6a-pc.workers.dev'
 const path='/storage/v1/object/sign/creative-assets/owner/article.png'
 const urls=['https://'+host,'https://xnclywhkqpdulogykvoy.supabase.co'].map(origin=>origin+path+'?token=signed')
 const fetched=[],uploads=[]
 const input={count:async()=>1,evaluate:async()=>false,setInputFiles:async files=>uploads.push(files)}
 const progress={count:async()=>0}
 const form=new PublicationForm({page:{locator:s=>s.startsWith('input')?input:progress},fetcher:async(url,options)=>{
  fetched.push(url.href);assert.equal(options.redirect,'error')
  return new Response(new Uint8Array([1,2,3]))
 }})
 form.guard=async()=>{}
 form.images=async()=>[{src:'preview',ready:true},{src:'preview2',ready:true}]
 await form.photos(urls.map(url=>({url,type:'image/png'})))
 assert.deepEqual(fetched,urls)
 assert.deepEqual(uploads[0].map(f=>f.name),['photo-01.png','photo-02.png'])
 for(const url of ['http://'+host+path+'?token=signed','https://other.workers.dev'+path+'?token=signed',
  'https://'+host+path,'https://'+host+path.replace('/sign/','/public/')+'?token=signed']){
  await assert.rejects(form.photos([{url,type:'image/png'}]),/non autorisée/)
 }
 assert.deepEqual(fetched,urls)
})
test('a duplicate publish click is refused even if the first click failed',async()=>{
 let clicked=0,recorded=0
 const form=new PublicationForm({page:{locator:()=>({count:async()=>1,isEnabled:async()=>true,scrollIntoViewIfNeeded:async()=>{},click:async()=>{clicked++;throw Error('connection lost')}})},task:{id:'one'},journal:{step:async()=>{recorded++}},authorize:async()=>{}})
 form.guard=async()=>{}
 await assert.rejects(form.submit(),/connection lost/);await assert.rejects(form.submit(),/déjà été demandée/)
 assert.equal(clicked,1);assert.equal(recorded,1)
})

function domForm(html){
 const {document}=parseHTML('<html><body>'+html+'</body></html>')
 const evaluate=(fn,arg)=>{const before=globalThis.document;globalThis.document=document;try{return fn(arg)}finally{globalThis.document=before}}
 const locator=read=>({count:async()=>read().length,evaluate:async fn=>{assert.equal(read().length,1);return evaluate(fn,read()[0])},evaluateAll:async fn=>evaluate(fn,read()),filter:()=>locator(read),nth:i=>locator(()=>read().slice(i,i+1)),inputValue:async()=>read()[0].value,scrollIntoViewIfNeeded:async()=>{},click:async()=>read()[0].click(),locator:s=>locator(()=>read().flatMap(e=>[...e.querySelectorAll(s.replaceAll(':visible',''))]))})
 const page={locator:s=>locator(()=>[...document.querySelectorAll(s.replaceAll(':visible',''))])}
 const form=new PublicationForm({page,check:()=>{},sleep:async()=>{}});form.guard=async()=>{}
 return {form,document}
}
test('visible field controls verify text, selections, exact price, package and photo order',async()=>{
 const {form,document}=domForm('<input name="title" value="Robe noire"><textarea name="description">Avec manches</textarea><input name="price" value="20,00"><input name="brand" readonly value="Sans marque"><input name="condition" readonly value="Très bon état"><input name="color" readonly value="Noir, Beige"><button type="button" id="catalog" role="combobox">Robes</button><input data-testid="package_type_selector_1" type="radio" aria-checked="true">')
 const approved=[{name:'title',value:'Robe noire'},{name:'description',value:'Avec manches'},{name:'price',value:'20.00'},{name:'brand',id:1,label:'Sans marque'},{name:'category',id:10,label:[{id:10,title:'Robes'}]},{name:'condition',id:2,label:'Très bon état'},{name:'color',id:[1,2],label:['Noir','Beige']},{name:'package',id:1,label:'Petit'}]
 await form.verify(approved)
 for(const name of ['title','description','price','brand','condition','color']){
  const el=document.querySelector(`[name="${name}"]`),before=el.value;el.value='modification manuelle'
  await assert.rejects(form.verify(approved),e=>e.keep_page===true);el.value=before
 }
 form.imageSources=['a','b'];form.images=async()=>[{src:'b',ready:true},{src:'a',ready:true}]
 await assert.rejects(form.verify(approved),/ordre ont changé/)
 form.images=async()=>[{src:'a',ready:true},{src:'b',ready:false}]
 await assert.rejects(form.verify(approved),/photos/)
})
test('visible option matching requires a unique exact title and matching value',async()=>{
 const {form,document}=domForm('<div role="radio" value="2"><span>Très bon état</span><p>Quelques marques légères.</p></div><div role="radio" value="3" aria-label="Bon état"></div>')
 let clicks=0;document.querySelector('[value="2"]').addEventListener('click',()=>clicks++)
 await form.option(2,'Très bon état');assert.equal(clicks,1)
 await assert.rejects(form.option(3,'Très bon état'),/introuvable/)
 document.body.insertAdjacentHTML('beforeend','<div role="radio" value="2" aria-label="Très bon état"></div>')
 await assert.rejects(form.option(2,'Très bon état'),/Plusieurs choix/);assert.equal(clicks,1)
})

test('category picker walks button branches and the exact radio leaf despite a different photo suggestion',async()=>{
 const path=[{id:1904,title:'Femmes'},{id:4,title:'Vêtements'},{id:10,title:'Robes'},{id:1774,title:'Pour occasions'},{id:1777,title:"Robes de bal de fin d'année"}]
 const {form,document}=domForm('<nav><button>Femmes</button></nav><input name="catalog" readonly value="Robes de mariée"><ul data-testid="category-list"></ul>')
 const list=document.querySelector('ul'),field=document.querySelector('[name="catalog"]'),visited=[]
 let navigationClicks=0;document.querySelector('nav button').addEventListener('click',()=>navigationClicks++)
 const level=index=>{
  const entry=path[index],leaf=index===path.length-1
  list.innerHTML=`<li><div id="catalog-${entry.id}" role="${leaf?'radio':'button'}" aria-checked="false"><div><span>${entry.title}</span></div></div></li>`
  if(index===0)list.insertAdjacentHTML('afterbegin','<li><div id="catalog-1776" role="radio" aria-checked="true"><span>Robes de mariée</span><p>Femmes &gt; Vêtements &gt; Robes &gt; Pour occasions</p></div></li>')
  list.querySelector(`[id="catalog-${entry.id}"]`).addEventListener('click',()=>{visited.push(entry.id);if(leaf){field.value=entry.title;list.innerHTML=''}else level(index+1)})
 }
 field.addEventListener('click',()=>level(0))
 await form.choice('category',1777,path)
 assert.deepEqual(visited,path.map(p=>p.id));assert.equal(navigationClicks,0);assert.equal(list.children.length,0)
 await form.verify([{name:'category',id:1777,label:path}])
})

test('category choices cannot use the header, another catalog ID, duplicate rows or an incorrect title',async()=>{
 for(const html of [
  '<nav><div id="catalog-1904" role="button">Femmes</div></nav>',
  '<ul data-testid="category-list"><li><div id="catalog-4" role="button">Femmes</div></li></ul>',
  '<ul data-testid="category-list"><li><div id="catalog-1904" role="button">Hommes</div></li></ul>',
  '<ul data-testid="category-list"><li><div id="catalog-1904" role="button">Femmes</div></li><li><div id="catalog-1904" role="button">Femmes</div></li></ul>'
 ]){
  const {form,document}=domForm(html);let clicks=0;document.body.addEventListener('click',()=>clicks++)
  await assert.rejects(form.option(1904,'Femmes',{category:true}),e=>e.keep_page===true);assert.equal(clicks,0)
 }
 const {form}=domForm('');await assert.rejects(form.option('1904','Femmes',{category:true}),/invalide/)
})

test('an already selected category leaf is clicked to close the picker',async()=>{
 const {form,document}=domForm('<ul data-testid="category-list"><li><div id="catalog-1777" role="radio" aria-checked="true">Robes de bal de fin d’année</div></li></ul>')
 let clicks=0;document.querySelector('[role="radio"]').addEventListener('click',()=>clicks++)
 await form.option(1777,'Robes de bal de fin d’année',{category:true});assert.equal(clicks,1)
})

test('colors use the exact catalog tile, not the duplicate photo suggestion',async()=>{
 const {form,document}=domForm('<div role="checkbox" data-testid="filter-grid-option-20" aria-label="Crème"><div data-testid="suggested-color-20">Crème</div></div><div role="checkbox" data-testid="filter-grid-option-20" aria-label="Crème"><div data-testid="color-20">Crème</div></div><div role="checkbox" data-testid="filter-grid-option-4" aria-label="Beige"><div data-testid="color-4">Beige</div></div>')
 const clicks=[];for(const e of document.querySelectorAll('[role="checkbox"]'))e.addEventListener('click',()=>{clicks.push(e.firstElementChild.getAttribute('data-testid'));e.setAttribute('aria-checked','true')})
 await form.option(20,'Crème',{color:true});await form.option(4,'Beige',{color:true});await form.option(20,'Crème',{color:true})
 assert.deepEqual(clicks,['color-20','color-4'])
 await assert.rejects(form.option(20,'Beige',{color:true}),/introuvable/)
 document.querySelector('[data-testid="color-20"]').parentElement.remove()
 await assert.rejects(form.option(20,'Crème',{color:true}),/introuvable/)
 assert.deepEqual(clicks,['color-20','color-4'])
})

test('real browser: category branches and duplicated color suggestions select only the approved choices',{skip:process.env.YLAVINT_BROWSER_TEST!=='1'},async t=>{
 const {chromium}=await import('playwright-core'),browser=await chromium.launch({channel:'msedge',headless:true})
 t.after(()=>browser.close());const page=await browser.newPage()
 await page.setContent(`<nav><button id="navigation">Femmes</button></nav><input name="catalog" readonly value="Robes de mariée"><input name="color" readonly><ul data-testid="category-list"></ul><div id="colors" hidden></div>`)
 await page.evaluate(()=>{
  const field=document.querySelector('[name="catalog"]'),list=document.querySelector('ul'),colors=document.querySelector('#colors'),color=document.querySelector('[name="color"]')
  const branch=()=>{list.innerHTML='<li><div id="catalog-1904" role="button"><span>Femmes</span></div></li>';list.querySelector('[role="button"]').onclick=()=>{list.innerHTML='<li><div id="catalog-1777" role="radio"><span>Robes de bal de fin d’année</span></div></li>';list.querySelector('[role="radio"]').onclick=()=>{field.value='Robes de bal de fin d’année';list.innerHTML=''}}}
  field.onclick=branch;document.querySelector('#navigation').onclick=()=>{throw Error('Wrong header target')}
  colors.innerHTML='<div role="checkbox" aria-label="Crème" data-testid="filter-grid-option-20"><div data-testid="suggested-color-20">Crème</div></div><div role="checkbox" aria-label="Crème" data-testid="filter-grid-option-20"><div data-testid="color-20">Crème</div></div><div role="checkbox" aria-label="Beige" data-testid="filter-grid-option-4"><div data-testid="color-4">Beige</div></div>'
  color.onclick=()=>{colors.hidden=!colors.hidden};for(const tile of colors.children)tile.onclick=()=>{if(tile.firstElementChild.dataset.testid.startsWith('suggested'))throw Error('Suggestion targeted');tile.setAttribute('aria-checked','true');color.value=[...colors.querySelectorAll('[aria-checked="true"]')].map(e=>e.getAttribute('aria-label')).join(', ')}
 })
 const form=new PublicationForm({page,check:()=>{},sleep:async()=>{}});form.guard=async()=>{}
 const path=[{id:1904,title:'Femmes'},{id:1777,title:'Robes de bal de fin d’année'}]
 await form.choice('category',1777,path);await form.choice('color',[20,4],['Crème','Beige'])
 await form.verify([{name:'category',id:1777,label:path},{name:'color',id:[20,4],label:['Crème','Beige']}])
 assert.equal(await page.locator('#colors').isVisible(),false)
 assert.equal(await page.locator('[data-testid="suggested-color-20"]').evaluate(e=>e.parentElement.getAttribute('aria-checked')),null)
})
test('publication confirmation rejects a toast or an item page without the seller edit control',async()=>{
 let path='/items/new',owner=false,confirmed=0
 const form=new PublicationForm({page:{url:()=>`https://www.vinted.fr${path}`,getByRole:()=>({count:async()=>1}),locator:()=>({filter:()=>({count:async()=>owner?1:0})})},reader:{identity:async()=>({member_id:'7'})},task:{id:'t'},journal:{step:async()=>confirmed++},check:()=>{},sleep:async()=>{}})
 await assert.rejects(form.confirm({title:'Robe noire'}),/incertain/)
 path='/items/123-robe-noire';await assert.rejects(form.confirm({title:'Robe noire'}),/incertain/)
 owner=true;assert.equal((await form.confirm({title:'Robe noire'})).vinted_id,'123');assert.equal(confirmed,1)
})
