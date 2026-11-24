import test from 'node:test'
import assert from 'node:assert/strict'
import {createRequire,Module} from 'node:module'
import {fileURLToPath} from 'node:url'
import {parseHTML} from 'linkedom'
import {build} from 'esbuild'

test('a confirmed publication refreshes the visible counter and retries after a missed event',async()=>{
  const rootDir=fileURLToPath(new URL('..',import.meta.url))
  const result=await build({entryPoints:[rootDir+'/src/components/DailyPublicationCount.jsx'],bundle:true,platform:'node',packages:'external',write:false,jsx:'automatic',loader:{'.css':'empty'},plugins:[{
    name:'test-counter',setup(b){
      b.onResolve({filter:/^\.\.\/lib\/(scalency|supabase)$/},args=>({path:args.path.split('/').pop(),namespace:'mock'}))
      b.onLoad({filter:/.*/,namespace:'mock'},({path})=>({contents:path==='scalency'?'export const query=(...args)=>globalThis.counterApi.read(...args)':'export const supabase=globalThis.counterApi.client'}))
    }}]})
  const {window}=parseHTML('<html><body><div id="root"></div></body></html>')
  globalThis.window=window;globalThis.document=window.document;globalThis.IS_REACT_ACT_ENVIRONMENT=true
  const require=createRequire(import.meta.url),React=require('react'),{act}=React,{createRoot}=require('react-dom/client')
  const root=createRoot(document.getElementById('root'))
  let total=1,changed,release,blocked=false,removed=false
  const channel={on(type,opts,fn){assert.equal(type,'broadcast');assert.equal(opts.event,'changed');changed=fn;return this},subscribe(){return this}}
  globalThis.counterApi={
    async read(view,{day}){
      assert.equal(view,'daily-publications')
      const previous=total
      if(blocked){blocked=false;await new Promise(r=>{release=r})}
      return {day,total:previous,accounts:[{account:'a',login:'Test',total:previous}],reposts:0,estimated:0}
    },
    client:{channel(name,options){assert.equal(name,'stock-vinted:publications');assert.equal(options.config.private,true);return channel},removeChannel(){removed=true}}
  }
  const mod=new Module(fileURLToPath(import.meta.url));mod.paths=Module._nodeModulePaths(rootDir);mod._compile(result.outputFiles[0].text,fileURLToPath(import.meta.url))
  const displayed=()=>document.querySelector('.daily-publications-total strong')?.textContent
  const turn=()=>new Promise(r=>setTimeout(r,210))
  try{
    await act(async()=>root.render(React.createElement(mod.exports.default)))
    assert.equal(displayed(),'1')
    total=2;blocked=true
    await act(async()=>{changed();await turn()})
    total=3
    await act(async()=>{changed();await turn();release();await turn()})
    assert.equal(displayed(),'3')
    total=4
    await act(async()=>{document.dispatchEvent(new window.Event('visibilitychange'));await turn()})
    assert.equal(displayed(),'4')
  }finally{
    await act(async()=>root.unmount())
    delete globalThis.window;delete globalThis.document;delete globalThis.IS_REACT_ACT_ENVIRONMENT;delete globalThis.counterApi
  }
  assert.equal(removed,true)
})
