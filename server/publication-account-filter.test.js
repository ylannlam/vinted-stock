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
      build.onLoad({filter:/.*/,namespace:'fixture'},({path})=>({contents:path==='api'?'export const query=(...args)=>globalThis.readPublication(...args);export const act=(...args)=>globalThis.movePublication(...args)':'export default ()=>null'}))
    }}]})
  const {window}=parseHTML('<html><body><div id="root"></div></body></html>')
  globalThis.window=window;globalThis.document=window.document;globalThis.IS_REACT_ACT_ENVIRONMENT=true
  const redirects=[]
  window.location={replace:url=>redirects.push(url)}
  let directory=[{id:'c',login:'Chloé',linked:true,block:{kind:'restricted'}},{id:'b',login:'Béa',linked:false},{id:'a',login:'Alice',linked:true}]
  let publications=[]
  globalThis.readPublication=async (view,q)=>{
    if(view==='account-health'){
      if(!directory)throw Error('hors ligne')
      return {accounts:directory}
    }
    assert.equal(view,'publication-tracking')
    return {accounts:[{id:'old',login:'Archive'}],jobs:[],drafts:q.stage==='local'?publications:[]}
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
    const at=new Date(Date.now()+86400000).toISOString()
    publications=[{id:'first',version:2,title:'Robe du lot',kind:'draft',state:'preparing',account:'n',scheduled_for:at,actions:['move','stop-local']}]
    const writes=[]
    globalThis.movePublication=async (action,body)=>{writes.push({action,body});return {rows:[{id:'first',at}]}}
    window.HTMLElement.prototype.showModal=function(){this.setAttribute('open','')}
    await render({tab:'queue',stage:'local',account:'n'})
    assert.ok(document.querySelector('a[aria-current="page"][href*="stage=local"]'))
    assert.ok(document.querySelector('a[href*="stage=site"]'))
    await React.act(async()=>[...document.querySelectorAll('button')].find(b=>b.textContent==='Déplacer le créneau').click())
    assert.ok(document.querySelector('dialog[open]'))
    assert.equal(writes.length,0)
    await React.act(async()=>document.querySelector('dialog form').dispatchEvent(new window.Event('submit',{bubbles:true,cancelable:true})))
    assert.equal(writes[0].action,'move-publications')
    assert.equal(writes[0].body.entries[0].previous,at)
    assert.equal(writes[0].body.account,'n')
    assert.match(document.querySelector('.pub-receipt').textContent,/Stock Vinted · envoi prévu/)
  }finally{await React.act(async()=>root.unmount());delete globalThis.movePublication}
})
