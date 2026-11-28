import test from 'node:test'
import assert from 'node:assert/strict'
import {createRequire,Module} from 'node:module'
import {fileURLToPath} from 'node:url'
import {parseHTML} from 'linkedom'
import {build} from 'esbuild'

test('accueil, annuaire et cadence suivent les comptes actuels et isolent les anciens profils',async t=>{
  const {window}=parseHTML('<html><body><div id="root"></div></body></html>')
  const require=createRequire(import.meta.url),React=require('react')
  const {Simulate}=require('react-dom/test-utils')
  globalThis.window=window
  globalThis.document=window.document
  globalThis.IS_REACT_ACT_ENVIRONMENT=true
  window.location={hash:''}
  const root=require('react-dom/client').createRoot(document.getElementById('root'))
  t.after(async()=>{
    await React.act(async()=>root.unmount())
    delete globalThis.window
    delete globalThis.document
    delete globalThis.IS_REACT_ACT_ENVIRONMENT
  })
  const profiles=[
    {id:'a',login:'Active',linked:true},{id:'new',login:'Nouvelle',linked:true},
    {id:'restricted',login:'Limitée',linked:true,block:{kind:'restricted',label:'Compte restreint'}},
    {id:'ban',login:'Retirée',linked:true,block:{kind:'banned',label:'Compte banni'}},
    {id:'off',login:'Déliée',linked:false}
  ]
  const cached=[...profiles.filter(a=>a.id!=='new'),{id:'old',login:'Ancien profil',linked:true}]
  const stored=cached.map(a=>({remote_id:a.id,account:'',payload:a}))
  let offline=false
  const api={
    async query(view){
      if(view==='account-health'){if(offline)throw Error('Service indisponible');return {accounts:profiles,checkedAt:new Date().toISOString()}}
      if(view==='cadence')return cached.map(a=>({account:a.id,login:a.login,mode:'normal',day_limit:5,queued:0,posted:0,remaining:5}))
      if(view==='home')return {groups:{accounts:{total:78},orders:{total:4},items:{total:0},jobs:{total:1}}}
      if(view==='accounts')return {rows:stored,total:78,page:0,pageSize:36}
      if(view==='connection')return {webhook:true}
      throw Error(view)
    },
    async act(){},formatDate(){return ''}
  }
  const source=fileURLToPath(new URL('../src/components/ScalencyWorkspace.jsx',import.meta.url))
  const external=['../lib/scalency','./ScalencyDraft','./ScalencyBatchStudio','./ScalencyQuickAccount','./ScalencyRelations','./PublicationTracker','./DailyPublicationCount','./Wardrobe','./SalesDesk']
  const result=await build({entryPoints:[source],bundle:true,write:false,platform:'node',format:'cjs',jsx:'automatic',packages:'external',loader:{'.css':'empty'},external})
  const mod=new Module(source)
  mod.require=id=>id==='../lib/scalency'?api:external.includes(id)?()=>null:require(id)
  mod._compile(result.outputFiles[0].text,source)
  let revision=0
  async function show(kind,params={}){
    await React.act(async()=>root.render(React.createElement(mod.exports.default,{key:++revision,kind,admin:true,params})))
    await React.act(async()=>new Promise(resolve=>setTimeout(resolve,5)))
  }
  await show('home')
  const card=Array.from(document.querySelectorAll('.sc-stats button')).find(b=>b.textContent.includes('Comptes de l’atelier'))
  assert.equal(card.querySelector('strong').textContent,'3')
  await React.act(async()=>Simulate.click(card))
  assert.equal(window.location.hash,'comptes/scalency')
  await show('accounts')
  const names=()=>Array.from(document.querySelectorAll('.sc-panel .sc-row b'),e=>e.textContent)
  assert.deepEqual(names(),['Active','Limitée','Nouvelle'])
  assert.deepEqual(Array.from(document.querySelectorAll('tbody th'),c=>c.textContent),['Active','Nouvelle','Limitée'])
  assert.deepEqual(Array.from(document.querySelectorAll('tbody th a'),c=>c.textContent),['Active','Nouvelle'])
  assert.doesNotMatch(document.body.textContent,/Ancien profil|Retirée|Déliée/)
  await show('accounts',{filter:'history'})
  assert.ok(names().includes('Ancien profil'))
  assert.ok(names().includes('Retirée'))
  assert.equal(document.querySelector('.cadence-overview'),null)
  await React.act(async()=>Simulate.click(Array.from(document.querySelectorAll('.sc-row')).find(b=>b.textContent.includes('Retirée'))))
  assert.match(document.body.textContent,/Dernier état enregistré/)
  assert.equal(document.querySelector('a[href*="fonds?account="]'),null)
  offline=true
  await show('accounts')
  assert.equal(names().length,0)
  assert.match(document.body.textContent,/Annuaire Scalency indisponible/)
  await show('home')
  assert.match(document.querySelector('.sc-stats').textContent,/Comptes de l’atelierIndisponible/)
})
