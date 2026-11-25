import test from 'node:test'
import assert from 'node:assert/strict'
import {createRequire,Module} from 'node:module'
import {fileURLToPath} from 'node:url'
import {build} from 'esbuild'
import {parseHTML} from 'linkedom'
import {addDays,parisDate} from '../src/lib/publicationPlan.js'

test('le récapitulatif utilise les places du jour choisi et confirme la sélection entière',async t=>{
  const {window}=parseHTML('<html><body><div id="app"></div></body></html>')
  globalThis.window=window;globalThis.document=window.document;globalThis.IS_REACT_ACT_ENVIRONMENT=true
  const require=createRequire(import.meta.url),React=require('react'),{Simulate}=require('react-dom/test-utils')
  const root=require('react-dom/client').createRoot(document.getElementById('app'))
  t.after(async()=>{
    await React.act(async()=>root.unmount())
    delete globalThis.window;delete globalThis.document;delete globalThis.IS_REACT_ACT_ENVIRONMENT
  })
  const source=fileURLToPath(new URL('../src/components/LotWindowPlanner.jsx',import.meta.url))
  const bundle=await build({entryPoints:[source],bundle:true,write:false,platform:'node',jsx:'automatic',packages:'external',external:['../lib/scalency']})
  const tomorrow=addDays(parisDate(Date.now()),1),later=addDays(tomorrow,1),requests=[]
  const mod=new Module(source)
  mod.require=id=>id==='../lib/scalency'?{async query(view,params){
    requests.push([view,params]);return {remaining:params.day===tomorrow?10:3}
  }}:require(id)
  mod._compile(bundle.outputFiles[0].text,source)
  const chosen=Array.from({length:10},(_,i)=>({id:String(i),fields:{sku:'robe-'+i}})),sent=[]
  await React.act(async()=>root.render(React.createElement(mod.exports.default,{account:'test',chosen,onSubmit:(...args)=>sent.push(args)})))
  const submit=document.querySelector('.sc-primary'),date=document.querySelector('input[type=date]')
  assert.deepEqual(requests.at(-1),['lot-capacity',{account:'test',day:tomorrow}])
  assert.equal(document.querySelectorAll('li time').length,10)
  assert.equal(submit.disabled,false)
  await React.act(async()=>Simulate.click(submit))
  assert.deepEqual(sent,[[chosen,{day:tomorrow,from:'08:00',to:'20:00'}]])
  await React.act(async()=>Simulate.change(date,{target:{value:later}}))
  assert.equal(submit.disabled,true)
  assert.match(document.querySelector('[role=status]').textContent,/3 places disponibles/)
  assert.equal(sent.length,1)
})
