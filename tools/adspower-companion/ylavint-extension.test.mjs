import test from 'node:test'
import assert from 'node:assert/strict'
import {validateExtensionForm,requestVisibleExtension,extensionForm} from './ylavint-extension.mjs'
import {parseHTML} from 'linkedom'
import {readExtensionState} from './ylavint-commerce.mjs'
const form=()=>({recognized:true,choices:[{name:'+3 jours ouvrés Colis à envoyer avant le 19 nov.',selected:true},{name:'+5 jours ouvrés Colis à envoyer avant le 23 nov.',selected:false}],buttons:[{name:'Envoyer la demande',enabled:true}],fields:[{name:'Message à l’attention de l’acheteur',value:''}]})
test('a native modal containing a form is one dialog; competing dialogs are refused',()=>{
 const {document}=parseHTML('<html><body><div role="dialog"><form><h2>Prolonger le délai d’envoi</h2><label><input type="radio" aria-label="+3 jours ouvrés" /></label><button>Envoyer la demande</button></form></div></body></html>')
 const saved={document:globalThis.document,getComputedStyle:globalThis.getComputedStyle}
 const visible=()=>{for(const e of document.querySelectorAll('*'))e.getClientRects=()=>[{}]}
 try{globalThis.document=document;globalThis.getComputedStyle=()=>({visibility:'visible'});visible()
  const f=extensionForm();assert.equal(f.recognized,true);assert.equal(f.container,'dialog');assert.equal(f.choices.length,1)
  document.body.append(document.querySelector('[role="dialog"]').cloneNode(true));visible();assert.equal(extensionForm().recognized,false)
 }finally{Object.assign(globalThis,saved)}
})
test('observed Manon form requires the exact choice, buyer message and final button',()=>{
 assert.ok(validateExtensionForm(form(),3,'',true))
 assert.throws(()=>validateExtensionForm(form(),5,'',true));assert.throws(()=>validateExtensionForm({...form(),recognized:false},3))
 assert.throws(()=>validateExtensionForm({...form(),fields:[{value:'Un texte déjà présent'}]},3,'',true))
 assert.throws(()=>validateExtensionForm({...form(),buttons:[{name:'Marquer comme envoyée',enabled:true}]},3))
 assert.throws(()=>validateExtensionForm({...form(),choices:[...form().choices,form().choices[0]]},3))
})
test('extension states use Vinted status rows, and the latest explicit state wins',()=>{
 assert.equal(readExtensionState({text:'Le client dit : prolongation acceptée',system:[]}),'unknown')
 assert.equal(readExtensionState({system:[{text:'En attente de réponse de l’acheteur quant à la demande de prolongation'}]}),'pending')
 assert.equal(readExtensionState({system:[{text:'En attente de réponse quant à la demande de prolongation'},{text:"tessa35 a accepté ta demande de prolongation du délai d’envoi."}]}),'accepted')
})
function fixture({state='unknown',confirm=true}={}){
 const id='123',p={desktop_order:true,conversation_id:id,item_id:'9',title:'Robe',days:5,reason:''},f=form(),steps={},events=[]
 let submitted=false,current='https://www.vinted.fr/inbox/123'
 const snapshot=()=>({url:current,conversation:true,system:[{text:submitted&&confirm?'En attente de réponse de l’acheteur quant à la demande de prolongation':state==='accepted'?'L’acheteur a accepté ta demande de prolongation':'2 jours restants pour envoyer le colis (avant le 16 nov. 15:22)',controls:[]}],controls:[{text:"Prolonger le délai d'envoi",enabled:true}],links:[]})
 const root={count:async()=>1,getByRole:(role,{name})=>({check:async()=>{f.choices.forEach(c=>c.selected=c.name===name)},click:async()=>{events.push('submit');submitted=true}})}
 const page={url:()=>current,evaluate:async fn=>fn.name==='extensionForm'?structuredClone(f):snapshot(),getByRole:()=>({or:()=>({click:async()=>events.push('open-form')})}),locator:()=>({filter:()=>root})}
 const reader={page,check:()=>{},sleep:async()=>{},update:()=>{},pace:{publication_review_seconds:3},snapshot:async()=>{},open:async()=>{},identity:async()=>{events.push('identity')},thread:async()=>({item:{id:'9'}}),settle:async()=>{}}
 const journal={read:async()=>({steps}),step:async(_id,key,value)=>{steps[key]=value;events.push(value)}}
 return {reader,journal,task:{id:'task'},authorize:async()=>events.push('guard'),p,events,steps}
}
test('native extension flow checks identity and permission, records intent before one click, and confirms pending state',async()=>{
 const f=fixture(),r=await requestVisibleExtension(f,f.p)
 assert.equal(r.requested,true);assert.equal(r.days,5);assert.equal(r.extension_state,'pending')
 assert.equal(f.events.filter(e=>e==='submit').length,1);assert.ok(f.events.indexOf('submitting')<f.events.indexOf('submit'));assert.equal(f.steps.extension,'confirmed')
 const accepted=fixture({state:'accepted'});assert.equal((await requestVisibleExtension(accepted,accepted.p)).extension_state,'accepted');assert.ok(!accepted.events.includes('submit'))
})
test('uncertain submission leaves the page for review and never retries the click',async()=>{
 const f=fixture({confirm:false});await assert.rejects(requestVisibleExtension(f,f.p),e=>e.keep_page===true&&/pas confirmé/.test(e.message))
 assert.equal(f.events.filter(e=>e==='submit').length,1);assert.equal(f.steps.extension,'submitting')
})
