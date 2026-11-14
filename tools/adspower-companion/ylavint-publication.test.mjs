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
test('publication confirmation rejects a toast or an item page without the seller edit control',async()=>{
 let path='/items/new',owner=false,confirmed=0
 const form=new PublicationForm({page:{url:()=>`https://www.vinted.fr${path}`,getByRole:()=>({count:async()=>1}),locator:()=>({filter:()=>({count:async()=>owner?1:0})})},reader:{identity:async()=>({member_id:'7'})},task:{id:'t'},journal:{step:async()=>confirmed++},check:()=>{},sleep:async()=>{}})
 await assert.rejects(form.confirm({title:'Robe noire'}),/incertain/)
 path='/items/123-robe-noire';await assert.rejects(form.confirm({title:'Robe noire'}),/incertain/)
 owner=true;assert.equal((await form.confirm({title:'Robe noire'})).vinted_id,'123');assert.equal(confirmed,1)
})
