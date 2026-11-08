import test from 'node:test'
import assert from 'node:assert/strict'
import {parseHTML} from 'linkedom'
import {build} from 'esbuild'
import {createRequire,Module} from 'node:module'
import {fileURLToPath} from 'node:url'
import {emptyListing,listingIssues,generationIssues} from '../src/lib/listingStudio.js'

const account={id:'account-a',login:'compte-test',profile_number:'78',country:'FR',connected:true}
const options={catalog:{id:10},conditions:[{id:2,title:'Très bon état'}],size_groups:[{sizes:[{id:4,title:'M'}]}],package_sizes:[{id:1,title:'Petit'}],attributes:[]}
const fields={...emptyListing(),account_id:account.id,sku:'SKU-TEST',size_text:'M',price:'15',title:'Combinaison noire M',description:'Combinaison noire à manches longues.',catalog_id:10,brand_id:1,size_id:4,status_id:2,package_size_id:1}
const base=()=>({id:'draft-a',version:1,state:'draft',fields:{...fields},photos:[{path:'test/photo.png',url:'https://example.test/photo.png'}],uploaded:0,created_at:new Date().toISOString(),updated_at:new Date().toISOString()})

test('incomplete and stale choices point to a visible field; Gemini has a separate input checklist',()=>{
 const missing=listingIssues({...fields,status_id:null},base().photos,options)
 assert.deepEqual(missing,[{key:'condition',label:'l’état réel de l’article',step:'review'}])
 assert.equal(listingIssues({...fields,size_id:99},base().photos,options)[0].key,'size')
 assert.deepEqual(generationIssues(fields,base().photos),[])
 assert.deepEqual(generationIssues({...fields,price:'oops',size_text:''},[]).map(i=>i.key),['photos','price','size-text'])
})

test('listing editor guides missing fields, confirms saves, refreshes offline accounts and preserves edits during saves',async()=>{
 const {window}=parseHTML('<html><body><div id="app"></div></body></html>')
 globalThis.window=window;globalThis.document=window.document
 globalThis.IS_REACT_ACT_ENVIRONMENT=true
 const require=createRequire(import.meta.url),React=require('react'),{act}=React
 const {createRoot}=require('react-dom/client')
 // Compile the real component with the same React instance as the test renderer.
 const compiled=await build({entryPoints:[fileURLToPath(new URL('../src/components/ListingStudio.jsx',import.meta.url))],bundle:true,write:false,platform:'node',format:'cjs',jsx:'automatic',packages:'external',external:['../lib/api']})
 const mod=new Module(fileURLToPath(import.meta.url));mod.paths=Module._nodeModulePaths(fileURLToPath(new URL('..',import.meta.url)));mod._compile(compiled.outputFiles[0].text,fileURLToPath(import.meta.url))
 const ListingStudio=mod.exports.default
 const root=createRoot(document.getElementById('app'))
 let row=base(),connected=false,releaseSave,holdSave=false,failOptions=true,failSave=false
 const calls=[]
 const request=async(method,body,query='')=>{
  const action=body?.action||new URLSearchParams(query).get('action');calls.push({action,body:structuredClone(body)})
  if(action==='metadata'||action==='accounts')return {accounts:[{...account,connected}],catalogs:[{id:10,title:'Combinaisons'}],colors:[],ai_ready:true}
  if(action==='options'){if(failOptions)throw Error('Options temporairement indisponibles');return options}
  if(action==='list')return {drafts:[structuredClone(row)],count:1}
  if(action==='save'){
   if(failSave)throw Error('Connexion interrompue pendant la sauvegarde')
   if(holdSave){holdSave=false;await new Promise(resolve=>{releaseSave=resolve})}
   row={...row,fields:body.fields,version:row.version+1}
  }
  if(action==='publish')row={...row,state:'preparing',version:row.version+1}
  return {draft:structuredClone(row)}
 }
 const button=text=>[...document.querySelectorAll('button')].find(b=>b.textContent===text)
 const click=async text=>{const b=button(text);assert.ok(b,`Button not found: ${text}`);assert.equal(b.disabled,false);await act(async()=>b.click())}
 const props=node=>node[Object.keys(node).find(key=>key.startsWith('__reactProps$'))]
 const edit=async(selector,value)=>{const input=document.querySelector(selector);await act(async()=>props(input).onChange({target:{value}}))}
 try{
  row.fields.status_id=null
  await act(async()=>root.render(React.createElement(ListingStudio,{request})))
  await act(async()=>[...document.querySelectorAll('button')].find(b=>b.textContent.includes('Combinaison noire M')).click())
  assert.ok(document.body.textContent.includes('Options temporairement indisponibles'))
  failOptions=false
  await click('Réessayer le chargement des options')
  await click('3. Publication')
  await click('Compléter la fiche →')
  assert.equal(document.querySelector('[aria-current="step"]').textContent,'2. Fiche de l’article')
  assert.ok(document.getElementById('listing-condition'))
  await click('Très bon état')
  await click('Enregistrer le brouillon')
  assert.ok(document.body.textContent.includes('Brouillon enregistré sur Stock Vinted.'))
  const count=calls.filter(c=>c.action==='save').length
  await click('Enregistrer le brouillon')
  assert.equal(calls.filter(c=>c.action==='save').length,count,'already saved does not send another write')
  assert.equal(calls.some(c=>c.action==='publish'),false)

  // An edit made during a save must be flushed before the success message.
  await edit('#listing-title input','Premier titre corrigé')
  holdSave=true
  await click('Enregistrer le brouillon')
  assert.ok(releaseSave)
  await edit('#listing-title input','Dernier titre à conserver')
  await act(async()=>releaseSave())
  assert.equal(row.fields.title,'Dernier titre à conserver')
  assert.equal(document.querySelector('#listing-title input').value,'Dernier titre à conserver')

  failSave=true
  await edit('#listing-title input','Titre après une coupure réseau')
  await click('3. Publication')
  await act(async()=>props(document.querySelector('input[value="dotb"]')).onChange())
  await click('Publier avec Dotb sur compte-test')
  assert.ok(document.body.textContent.includes('Connexion interrompue pendant la sauvegarde'))
  assert.equal(calls.some(c=>c.action==='publish'),false)
  failSave=false
  await click('Publier avec Dotb sur compte-test')
  assert.ok(document.body.textContent.includes('Le Bridge est déconnecté'))
  assert.equal(calls.some(c=>c.action==='publish'),false)
  connected=true
  await click('Publier avec Dotb sur compte-test')
  assert.equal(calls.filter(c=>c.action==='publish').length,1)
  assert.equal(calls.find(c=>c.action==='publish').body.confirmation_account_id,account.id)
  assert.ok(document.body.textContent.includes('Fiche créée dans Dotb'))
 }finally{
  await act(async()=>root.unmount())
  delete globalThis.window;delete globalThis.document;delete globalThis.IS_REACT_ACT_ENVIRONMENT
 }
})

test('with Dotb off, the last step downloads the listing folder and never asks Dotb to publish',async()=>{
 const {window}=parseHTML('<html><body><div id="app"></div></body></html>')
 globalThis.window=window;globalThis.document=window.document
 globalThis.IS_REACT_ACT_ENVIRONMENT=true
 const require=createRequire(import.meta.url),React=require('react'),{act}=React
 const {createRoot}=require('react-dom/client')
 const compiled=await build({entryPoints:[fileURLToPath(new URL('../src/components/ListingStudio.jsx',import.meta.url))],bundle:true,write:false,platform:'node',format:'cjs',jsx:'automatic',packages:'external',external:['../lib/api']})
 const mod=new Module(fileURLToPath(import.meta.url));mod.paths=Module._nodeModulePaths(fileURLToPath(new URL('..',import.meta.url)));mod._compile(compiled.outputFiles[0].text,fileURLToPath(import.meta.url))
 const ListingStudio=mod.exports.default
 const root=createRoot(document.getElementById('app'))
 let row=base();const calls=[],fetched=[],downloads=[]
 const request=async(method,body,query='')=>{
  const action=body?.action||new URLSearchParams(query).get('action');calls.push(action)
  if(action==='metadata'||action==='accounts')return {accounts:[account],catalogs:[{id:10,title:'Combinaisons'}],colors:[],ai_ready:true,dotb_publish_enabled:false}
  if(action==='options')return options
  if(action==='list')return {drafts:[structuredClone(row)],count:1}
  if(action==='step')row={...row,state:'draft',last_error:null,manual_recoverable:false}
  if(action==='mark_published'){published.push(body);row={...row,state:'published',vinted_id:'42',url:'https://www.vinted.fr/items/42',message:'Publiée à la main sur Vinted.'}}
  return {draft:structuredClone({...row,photos:[{path:'test/photo.png',url:'https://example.test/fresh-photo.png'}]})}
 }
 const published=[]
 const oldFetch=globalThis.fetch,oldCreate=URL.createObjectURL
 globalThis.fetch=async url=>{fetched.push(url);return {ok:true,blob:async()=>new Blob([new Uint8Array(64)],{type:'image/png'})}}
 URL.createObjectURL=blob=>{downloads.push(blob);return 'blob:test'}
 const button=text=>[...document.querySelectorAll('button')].find(b=>b.textContent===text)
 try{
  await act(async()=>root.render(React.createElement(ListingStudio,{request})))
  await act(async()=>[...document.querySelectorAll('button')].find(b=>b.textContent.includes('Combinaison noire M')).click())
  await act(async()=>button('3. Publication').click())
  await act(async()=>{const node=document.querySelector('input[value="dotb"]');node[Object.keys(node).find(k=>k.startsWith('__reactProps$'))].onChange()})
  assert.ok(document.body.textContent.includes('L’envoi automatique par Dotb est coupé'))
  assert.equal([...document.querySelectorAll('button')].some(b=>b.textContent.startsWith('Publier sur')),false)
  assert.equal(document.body.textContent.includes('Bridge Dotb'),false)
  await act(async()=>button('Télécharger le dossier d’annonce').click())
  assert.deepEqual(fetched,['https://example.test/fresh-photo.png'],'the photo link is reloaded before download')
  assert.equal(downloads.length,1);assert.equal(downloads[0].type,'application/zip')
  assert.ok(document.body.textContent.includes('Dossier téléchargé. Rien n’a été publié'))
  assert.equal(calls.includes('publish'),false);assert.equal(calls.includes('step'),false)
  // An old failed transfer that never reached Dotb recovers on open, even with last_error.
  row={...row,state:'preparing',last_error:'Ancienne erreur',manual_recoverable:true}
  await act(async()=>button('Mes brouillons et publications').click())
  await act(async()=>[...document.querySelectorAll('button')].find(b=>b.textContent.includes('Combinaison noire M')).click())
  await act(async()=>new Promise(resolve=>setTimeout(resolve,650)))
  assert.equal(calls.filter(a=>a==='step').length,1)
  assert.ok(button('Télécharger le dossier d’annonce'))
  assert.equal(calls.includes('publish'),false)
  // After publishing by hand on Vinted, the link is noted from the same panel.
  const form=[...document.querySelectorAll('form')].find(f=>f.textContent.includes('Déjà publiée sur Vinted'))
  assert.ok(form,'link field shown in manual mode')
  const props=node=>node[Object.keys(node).find(key=>key.startsWith('__reactProps$'))]
  await act(async()=>props(form.querySelector('input')).onChange({target:{value:'https://www.vinted.fr/items/42-combinaison'}}))
  await act(async()=>props(form).onSubmit({preventDefault(){}}))
  assert.equal(published.length,1);assert.equal(published[0].url,'https://www.vinted.fr/items/42-combinaison');assert.equal(typeof published[0].version,'number')
  assert.ok(document.body.textContent.includes('Publiée à la main'));assert.ok(document.body.textContent.includes('Voir l’annonce sur Vinted'))
  assert.equal(document.body.textContent.includes('Fiche créée dans Dotb'),false,'no Dotb steps for a listing published by hand')
 }finally{
  await act(async()=>root.unmount())
  globalThis.fetch=oldFetch;URL.createObjectURL=oldCreate
  delete globalThis.window;delete globalThis.document;delete globalThis.IS_REACT_ACT_ENVIRONMENT
 }
})
