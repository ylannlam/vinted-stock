import {review} from './ylavint-ui.mjs'
import {PUBLICATION_PACE,typePublication} from './ylavint-typing.mjs'

const norm=s=>String(s??'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').replace(/\s+/g,' ').trim().toLowerCase()
const stop=message=>Object.assign(review(message),{keep_page:true})
const names={title:['title'],description:['description'],price:['price'],category:['catalog','catalog_id','category'],brand:['brand','brand_id'],size:['size','size_id'],condition:['condition','status','status_id'],color:['color','color_ids']}
const testIds={title:'title',description:'description',price:'price-input',category:'catalog-select-dropdown',brand:'brand-select-dropdown',color:'color-select-dropdown'}

export function listingChoices({fields:f,labels:l={}}){
 return [['category',f.catalog_id,l.category_path,'Catégorie'],['brand',f.brand_id,f.brand_title,'Marque'],['size',f.size_id,l.size,'Taille'],['condition',f.status_id,l.condition,'État'],['color',f.color_ids,l.colors,'Couleurs'],['package',f.package_size_id,l.package,'Colis'],...(l.attributes||[]).map(a=>[a.code,a.ids,a.titles,a.title])].filter(c=>c[1]!=null&&(!Array.isArray(c[1])||c[1].length))
}

// Orchestration is separate from the DOM adapter so interruptions can be tested
// without contacting Vinted or publishing a real article.
export async function preparePublication(task,ui){
 const listing=task.listing
 if(listing?.execution!=='desktop'||listing.assisted!==true||typeof listing.submit!=='boolean'||!listing.fields?.title||!Array.isArray(listing.photos)||!listing.photos.length||listing.photos.length>20)throw stop('Demande de publication incomplète.')
 await ui.open();await ui.guard();await ui.empty()
 await ui.step('Photos',()=>ui.photos(listing.photos))
 const approved=[]
 for(const [name,id,label,title] of listingChoices(listing)){
  await ui.guard();await ui.verify(approved)
  await ui.step(title,()=>ui.choice(name,id,label));approved.push({name,id,label})
  await ui.pause()
 }
 for(const [name,value,title] of [['title',listing.fields.title,'Titre'],['description',listing.fields.description,'Description'],['price',String(listing.fields.price),'Prix']]){
  await ui.guard();await ui.verify(approved)
  await ui.step(title,()=>ui.text(name,String(value),()=>ui.verify(approved)))
  approved.push({name,value:String(value)});await ui.pause()
 }
 await ui.step('Relecture',async()=>{await ui.guard();await ui.reread();await ui.verify(approved)})
 if(!listing.submit)return {prepared:true,missing:[]}
 await ui.guard();await ui.authorize();await ui.verify(approved)
 await ui.step('Publication',()=>ui.submit(()=>ui.verify(approved)))
 const result=await ui.confirm(listing.fields)
 if(!result?.confirmed||!/^\d{1,18}$/.test(result.vinted_id))throw stop('Publication non confirmée. Vérifie Vinted avant toute nouvelle tentative.')
 return result
}

export class PublicationForm{
 constructor({page,reader,task,journal,check,authorize,update,progress=async()=>{},sleep,pace={},fetcher=fetch}){
  Object.assign(this,{page,reader,task,journal,check,authorize,update,progress,sleep,fetcher});this.pace={...PUBLICATION_PACE,...pace};this.steps=[];this.seq=0;this.imageSources=null;this.lastControl=0;this.clicked=false
 }
 async open(){await this.reader.open('/items/new');await this.reader.identity(true)}
 async guard(){
  this.check()
  if(new URL(this.page.url()).pathname!=='/items/new')throw stop('Le formulaire de cette annonce n’est plus ouvert.')
  await this.reader.identity()
  if(await this.page.locator('iframe[src*="captcha"],iframe[src*="challenge"],[data-testid="item-upload-critical-error-dialog"],[data-testid="item-upload-error-dialog"]').count())throw stop('Vinted demande une vérification ou signale une erreur. Reprends la main.')
  if(!await this.page.evaluate(()=>document.hasFocus()))throw stop('La fenêtre a perdu le focus. Tu gardes la main.')
  if(Date.now()-this.lastControl>5000){await this.authorize();this.lastControl=Date.now()}
 }
 async field(name){
  if(!/^[a-zA-Z0-9_-]+$/.test(name))throw stop('Champ de formulaire inconnu.')
  const selectors=(names[name]||[name]).flatMap(n=>[`input[name="${n}"]:not([type="hidden"])`,`textarea[name="${n}"]`,`select[name="${n}"]`,`[id="${n}"]`])
  if(testIds[name])selectors.push(`[data-testid="${testIds[name]}"]`)
  for(const s of selectors){
   const root=this.page.locator(s+':visible')
   if(await root.count()!==1)continue
   if(await root.evaluate(e=>e.matches('input,textarea,select,[role="combobox"],button[type="button"]')))return root
   const inner=root.locator('input:not([type="hidden"]),textarea,select,[role="combobox"],button[type="button"]').filter({visible:true})
   if(await inner.count()===1)return inner
  }
  throw stop('Champ « '+name+' » introuvable ou ambigu. Vérifie le formulaire.')
 }
 async empty(){
  for(const name of ['title','description','price'])if((await (await this.field(name)).inputValue()).trim())throw stop('Un brouillon est déjà présent. Il est conservé dans cet onglet.')
  if(await this.page.locator('[data-testid="media-upload-grid"] img').count())throw stop('Des photos sont déjà présentes. Aucun nouvel ajout.')
 }
 async step(name,fn){
  this.update({state:'preparing',message:'Annonce · '+name})
  const step={name,status:'running'};this.steps.push(step)
  await this.report();await fn();step.status='done';await this.report()
 }
 async report(){try{await this.progress({seq:++this.seq,steps:this.steps.map(s=>({...s}))})}catch{throw stop('Le suivi du site est inaccessible. Vérifie le formulaire avant de reprendre.')}}
 async pause(){await this.sleep(this.pace.publication_field_seconds*1000);await this.guard()}
 async images(){return this.page.locator('[data-testid="media-upload-grid"] img').evaluateAll(images=>images.map(e=>({src:e.currentSrc||e.src,ready:e.complete&&e.naturalWidth>0})))}
 async photos(photos){
  const files=[]
  for(const [i,p] of photos.entries()){
   await this.guard()
   const url=new URL(p.url),ext={'image/jpeg':'jpg','image/png':'png','image/webp':'webp'}[p.type]
   if(!ext||url.origin!=='https://xnclywhkqpdulogykvoy.supabase.co'||!url.pathname.startsWith('/storage/v1/object/sign/creative-assets/')||!url.searchParams.get('token'))throw stop('Source de photo non autorisée.')
   const response=await this.fetcher(url,{credentials:'omit',redirect:'error',signal:AbortSignal.timeout(30000)})
   if(!response.ok||Number(response.headers.get('content-length'))>8000000)throw stop('Photo inaccessible ou trop volumineuse.')
   // Bound the stream as well: a missing Content-Length must not allow an unbounded download.
   let length=0;const chunks=[]
   for await(const bytes of response.body){length+=bytes.length;if(length>8000000)throw stop('Photo trop volumineuse.');chunks.push(bytes)}
   if(!length)throw stop('Photo vide.')
   files.push({name:`photo-${String(i+1).padStart(2,'0')}.${ext}`,mimeType:p.type,buffer:Buffer.concat(chunks)})
  }
  const input=this.page.locator('input[type="file"][name="photos"]')
  if(await input.count()!==1||await input.evaluate(e=>e.disabled||e.files.length>0))throw stop('Zone de photos indisponible ou déjà remplie.')
  await this.guard();await input.setInputFiles(files,{timeout:60000})
  for(let i=0;i<90;i++){
   await this.guard();const images=await this.images()
   if(images.length===photos.length&&images.every(p=>p.ready)&&!await this.page.locator('[data-testid="media-upload-grid"] [role="progressbar"],[data-testid="media-upload-grid"] [aria-busy="true"]').count()){this.imageSources=images.map(p=>p.src);return}
   await this.sleep(1000)
  }
  throw stop('Les photos ne sont pas toutes chargées. Aucun nouvel ajout automatique.')
 }
 async text(name,value,inspect){
  const field=await this.field(name)
  if(await field.evaluate(e=>e.disabled||e.readOnly))throw stop('Ce champ ne peut pas être saisi.')
  await typePublication(field,value,{pace:this.pace,check:this.check,sleep:this.sleep,corrections:['title','description'].includes(name),inspect:async()=>{await this.guard();await inspect()},onProgress:(n,total)=>this.update({state:'typing',message:`Annonce · ${name==='title'?'Titre':name==='description'?'Description':'Prix'} · ${n}/${total}`})})
 }
 async option(id,label){
  if(!label)throw stop('Libellé de choix manquant.')
  const options=this.page.locator('[role="radio"],[role="checkbox"],[role="option"],input[type="radio"],input[type="checkbox"]').filter({visible:true})
  for(let attempt=0;attempt<20;attempt++){
   await this.guard()
   const candidates=await options.evaluateAll(es=>es.map(e=>({value:e.getAttribute('value'),disabled:e.disabled||e.getAttribute('aria-disabled')==='true',text:(e.getAttribute('aria-labelledby')||'').split(/\s+/).filter(Boolean).map(id=>document.getElementById(id)?.textContent||'').join(' ').trim()||e.getAttribute('aria-label')||[...(e.labels||[])].map(l=>l.textContent).join(' ')||e.textContent,leaves:e.hasAttribute('aria-label')||e.hasAttribute('aria-labelledby')?[]:[...e.querySelectorAll('*')].filter(n=>!n.children.length).map(n=>n.textContent)})))
   const hits=candidates.map((v,i)=>({...v,i})).filter(v=>!v.disabled&&(v.value===null||v.value===String(id))&&(norm(v.text)===norm(label)||v.leaves.some(t=>norm(t)===norm(label))))
   if(hits.length>1)throw stop('Plusieurs choix correspondent à « '+label+' ».')
   if(hits.length===1){const option=options.nth(hits[0].i);await option.scrollIntoViewIfNeeded();if(!await option.evaluate(e=>e.checked||e.getAttribute('aria-checked')==='true'||e.getAttribute('aria-selected')==='true'))await option.click();return}
   await this.sleep(300)
  }
  throw stop('Choix « '+label+' » introuvable.')
 }
 async choice(name,id,label){
  if(name==='package'){
   if(!Number.isSafeInteger(id))throw stop('Format de colis inconnu.')
   const cell=this.page.locator(`[data-testid="${id}-package-size--cell"]`)
   if(await cell.count()!==1)throw stop('Format de colis introuvable.')
   await cell.scrollIntoViewIfNeeded();await cell.click();return
  }
  const field=await this.field(name),ids=Array.isArray(id)?id:[id],labels=name==='category'?[label?.at(-1)?.title]:Array.isArray(label)?label:[label]
  if(labels.some(l=>typeof l!=='string'||!l.trim()))throw stop('Choix incomplet pour « '+name+' ».')
  await field.scrollIntoViewIfNeeded()
  if(await field.evaluate(e=>e.tagName==='SELECT')){
   await field.selectOption(ids.map((v,i)=>({value:String(v),label:labels[i]})));return
  }
  await field.click()
  if(name==='brand'){
   const search=this.page.locator('input[name="brand-search-input"]:visible')
   await search.waitFor({state:'visible',timeout:10000})
   await typePublication(search,String(label),{pace:this.pace,check:this.check,sleep:this.sleep,inspect:()=>this.guard()})
  }
  if(name==='category')for(const entry of label){await this.option(entry.id,entry.title);await this.sleep(500)}
  else for(let i=0;i<ids.length;i++){await this.option(ids[i],labels[i]);await this.sleep(300)}
  if(name==='color')await (await this.field(name)).click()
  await this.sleep(500)
 }
 async verify(approved){
  this.check()
  if(this.imageSources){const images=await this.images();if(images.some(p=>!p.ready)||JSON.stringify(images.map(p=>p.src))!==JSON.stringify(this.imageSources))throw stop('Les photos ou leur ordre ont changé. Vérifie le formulaire.')}
  for(const entry of approved){
   const {name,value,id,label}=entry
   if(name==='package'){
    const radio=this.page.locator(`[data-testid="package_type_selector_${id}"]`)
    if(await radio.count()!==1||!await radio.evaluate(e=>e.checked||e.getAttribute('aria-checked')==='true'))throw stop('Le format du colis ne correspond plus à la fiche.')
    continue
   }
   const field=await this.field(name)
   if(value!==undefined){const actual=await field.inputValue();if(name==='price'?Number(actual.replace(',','.'))!==Number(value):actual!==value)throw stop('Le champ « '+name+' » a changé. Aucune publication.');continue}
   const expected=name==='category'?[label.at(-1).title]:Array.isArray(label)?label:[label]
   const actual=await field.evaluate(e=>e.tagName==='SELECT'?[...e.selectedOptions].map(o=>o.textContent):String(e.value||e.textContent).split(','))
   if(actual.length!==expected.length||expected.some(l=>!actual.map(norm).includes(norm(l))))throw stop('Le choix « '+name+' » ne correspond pas à la fiche.')
  }
 }
 async reread(){
  await (await this.field('title')).scrollIntoViewIfNeeded();await this.sleep(this.pace.publication_review_seconds*500)
  await (await this.field('price')).scrollIntoViewIfNeeded();await this.sleep(this.pace.publication_review_seconds*500)
 }
 async submit(verify=async()=>{}){
  if(this.clicked)throw stop('Une publication a déjà été demandée. Aucun deuxième clic.')
  const button=this.page.locator('[data-testid="upload-form-save-button"]:visible')
  if(await button.count()!==1||!await button.isEnabled())throw stop('Le bouton de publication n’est pas disponible.')
  await button.scrollIntoViewIfNeeded();await this.guard();await this.authorize()
  await this.journal.step(this.task.id,'publication','submitting');await verify();await this.guard();this.clicked=true
  await button.click({timeout:15000})
 }
 async confirm(fields){
  // A click or success toast is insufficient: require the actual item page and
  // its owner edit link, with the approved title visible on that page.
  for(let i=0;i<30;i++){
   this.check();const url=new URL(this.page.url()),id=url.origin==='https://www.vinted.fr'&&url.pathname.match(/^\/items\/([1-9]\d{0,17})(?:-|$)/)?.[1]
   if(id){
    await this.reader.identity()
    const heading=this.page.getByRole('heading',{name:fields.title,exact:true})
    const edit=this.page.locator(`a[href="/items/${id}/edit"],a[href="https://www.vinted.fr/items/${id}/edit"]`).filter({visible:true})
    if(await heading.count()===1&&await edit.count()===1){await this.journal.step(this.task.id,'publication','confirmed');return {confirmed:true,vinted_id:id}}
   }
   await this.sleep(1000)
  }
  throw stop('Le résultat de la publication est incertain. Vérifie le dressing ; cet envoi ne sera pas rejoué.')
 }
}
