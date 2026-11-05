import test from 'node:test'
import assert from 'node:assert/strict'
import {parseHTML} from 'linkedom'
import {build} from 'esbuild'
import {createRequire,Module} from 'node:module'
import {fileURLToPath} from 'node:url'

test('the account gallery shows each background with the login below, keeps accounts to avoid apart and opens a session in one click',async()=>{
 const {window}=parseHTML('<html><body><div id="app"></div></body></html>')
 globalThis.window=window;globalThis.document=window.document;globalThis.IS_REACT_ACT_ENVIRONMENT=true
 const require=createRequire(import.meta.url),React=require('react'),{act}=React,{createRoot}=require('react-dom/client')
 const compiled=await build({entryPoints:[fileURLToPath(new URL('../src/components/ListingAccountGallery.jsx',import.meta.url))],bundle:true,write:false,platform:'node',format:'cjs',jsx:'automatic',packages:'external'})
 const mod=new Module(fileURLToPath(import.meta.url));mod.paths=Module._nodeModulePaths(fileURLToPath(new URL('..',import.meta.url)));mod._compile(compiled.outputFiles[0].text,fileURLToPath(import.meta.url))
 const Gallery=mod.exports.default,root=createRoot(document.getElementById('app'))
 const accounts=[{id:'a',login:'lilyaapm',profile_number:'78',country:'FR'},{id:'b',login:'fleurlicia',profile_number:'45',country:'FR',dotb:true},{id:'c',login:'lilou_lio',profile_number:'68',country:'FR'}]
 const picker={accounts:{a:{background:{title:'Chambre',url:'https://example.test/a.webp'},today:2,in_progress:1,last_at:new Date().toISOString(),health:null},b:{background:null,today:0,in_progress:0,health:null},c:{background:{url:'https://example.test/c.webp'},health:{status:'restricted',label:'Compte restreint',attention:true}}}}
 const started=[];let styles=0
 try{
  await act(async()=>root.render(React.createElement(Gallery,{accounts,picker,configured:true,onStart:id=>started.push(id),onStyles:()=>styles++})))
  const lists=[...document.querySelectorAll('ul')]
  assert.deepEqual([...lists[0].querySelectorAll('button')].map(b=>b.getAttribute('aria-label')),['Publier sur lilyaapm','Publier sur fleurlicia'],'highest AdsPower number first')
  assert.equal(lists[0].querySelector('img').getAttribute('src'),'https://example.test/a.webp')
  assert.match(lists[0].textContent,/2 aujourd’hui, 1 en cours/)
  assert.match(lists[0].textContent,/Pas encore de fond/);assert.match(lists[0].textContent,/Dotb/)
  assert.match(lists[1].textContent,/lilou_lio/);assert.match(document.body.textContent,/À éviter pour l’instant · 1/);assert.match(lists[1].textContent,/Compte restreint/)
  await act(async()=>lists[0].querySelector('button').click())
  assert.deepEqual(started,['a'])
  await act(async()=>[...document.querySelectorAll('button')].find(b=>b.textContent==='Choisir les fonds').click())
  assert.equal(styles,1)
  picker.accounts.a.background.original_url='https://example.test/a.png'
  const props=node=>node[Object.keys(node).find(key=>key.startsWith('__reactProps$'))]
  await act(async()=>props(lists[0].querySelector('img')).onError())
  assert.equal(lists[0].querySelector('img').getAttribute('src'),'https://example.test/a.png','a missing thumbnail falls back to the original background')
  await act(async()=>props(lists[0].querySelector('img')).onError())
  assert.equal(lists[0].querySelector('img'),null,'broken images do not cause a retry loop')
  assert.match(lists[0].textContent,/Fond indisponible/)
 }finally{await act(async()=>root.unmount());delete globalThis.window;delete globalThis.document;delete globalThis.IS_REACT_ACT_ENVIRONMENT}
})
