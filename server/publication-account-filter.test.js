import test from 'node:test'
import assert from 'node:assert/strict'
import {createRequire,Module} from 'node:module'
import {fileURLToPath} from 'node:url'
import {build} from 'esbuild'
import {parseHTML} from 'linkedom'

test('le filtre Publications suit les liaisons Scalency, y compris après actualisation',async()=>{
  const cwd=fileURLToPath(new URL('..',import.meta.url))
  const bundle=await build({entryPoints:[cwd+'/src/components/PublicationTracker.jsx'],bundle:true,platform:'node',packages:'external',
    write:false,jsx:'automatic',loader:{'.css':'empty'},plugins:[{name:'publication-fixtures',setup(build){
      build.onResolve({filter:/^\.\.\/lib\/scalency$/},()=>({path:'api',namespace:'fixture'}))
      build.onResolve({filter:/^\.\/(DailyPublicationCount|PublicationLots)$/},()=>({path:'panel',namespace:'fixture'}))
      build.onLoad({filter:/.*/,namespace:'fixture'},({path})=>({contents:path==='api'?'export const query=(view)=>globalThis.readPublication(view);export const act=()=>{}':'export default ()=>null'}))
    }}]})
  const {window}=parseHTML('<html><body><div id="root"></div></body></html>')
  globalThis.window=window;globalThis.document=window.document;globalThis.IS_REACT_ACT_ENVIRONMENT=true
  const redirects=[]
  window.location={replace:url=>redirects.push(url)}
  let directory=[{id:'c',login:'Chloé',linked:true,block:{kind:'restricted'}},{id:'b',login:'Béa',linked:false},{id:'a',login:'Alice',linked:true}]
  globalThis.readPublication=async view=>{
    if(view==='account-health'){
      if(!directory)throw Error('hors ligne')
      return {accounts:directory}
    }
    assert.equal(view,'publication-tracking')
    return {accounts:[{id:'old',login:'Archive'}],jobs:[],drafts:[]}
  }
  const require=createRequire(import.meta.url),React=require('react'),{createRoot}=require('react-dom/client')
  const mod=new Module(fileURLToPath(import.meta.url));mod.paths=Module._nodeModulePaths(cwd);mod._compile(bundle.outputFiles[0].text,mod.id)
  const root=createRoot(document.getElementById('root'))
  const render=params=>React.act(async()=>root.render(React.createElement(mod.exports.default,{params})))
  const options=()=>[...document.querySelectorAll('select option')].map(o=>o.textContent)
  const refresh=()=>React.act(async()=>[...document.querySelectorAll('button')].find(b=>b.textContent==='Actualiser').click())
  try{
    await render({tab:'queue',account:'a'})
    assert.deepEqual(options(),['Tous les comptes','Alice','Chloé'])
    directory=null
    await refresh()
    assert.deepEqual(options(),['Comptes indisponibles'])
    assert.deepEqual(redirects,[])
    directory=[{id:'n',login:'Nouveau',linked:true}]
    await refresh()
    assert.deepEqual(options(),['Tous les comptes','Nouveau'])
    assert.deepEqual(redirects,['#publication?tab=queue'])
    await render({tab:'history',account:'old',job:'ancien'})
    assert.deepEqual(options(),[])
    assert.equal(redirects.length,1)
  }finally{await React.act(async()=>root.unmount())}
})
