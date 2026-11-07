import test from 'node:test'
import assert from 'node:assert/strict'
import {createRequire} from 'node:module'
import Module from 'node:module'
import {fileURLToPath} from 'node:url'
import {build} from 'esbuild'
import {parseHTML} from 'linkedom'

test('Publication reconciles pending statuses on opening without sending or scheduling anything',async()=>{
 const {window}=parseHTML('<html><body><div id="app"></div></body></html>')
 globalThis.window=window;globalThis.document=window.document;globalThis.IS_REACT_ACT_ENVIRONMENT=true
 const require=createRequire(import.meta.url),React=require('react'),{act}=React,{createRoot}=require('react-dom/client')
 const compiled=await build({entryPoints:[fileURLToPath(new URL('../src/components/PublicationTab.jsx',import.meta.url))],bundle:true,write:false,platform:'node',format:'cjs',jsx:'automatic',packages:'external',external:['../lib/api']})
 const mod=new Module(fileURLToPath(import.meta.url));mod.paths=Module._nodeModulePaths(fileURLToPath(new URL('..',import.meta.url)));mod._compile(compiled.outputFiles[0].text,fileURLToPath(import.meta.url))
 const root=createRoot(document.getElementById('app')),calls=[];let done=false
 const request=async(method,body,query)=>{
  const action=body?.action||new URLSearchParams(query).get('action');calls.push(action)
  if(action==='refresh'){done=true;return {draft:{id:'posted',state:'published'}}}
  assert.equal(action,'planner')
  return {accounts:[],drafts:[],queue:[],occupied:[],scheduled:done?[]:[{id:'posted',state:'scheduled',dotb_item_id:'remote',title:'Robe déjà en ligne',scheduled_at:new Date().toISOString(),live:true}]}
 }
 try{
  await act(async()=>root.render(React.createElement(mod.exports.default,{request})))
  assert.deepEqual(calls,['planner','refresh','planner'])
  assert.ok(document.body.textContent.includes('Aucune annonce programmée'))
  assert.ok(!document.body.textContent.includes('Robe déjà en ligne'))
 }finally{await act(async()=>root.unmount());delete globalThis.window;delete globalThis.document;delete globalThis.IS_REACT_ACT_ENVIRONMENT}
})
