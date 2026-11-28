import test from 'node:test'
import assert from 'node:assert/strict'
import {createRequire, Module} from 'node:module'
import {fileURLToPath} from 'node:url'
import {parseHTML} from 'linkedom'
import {build} from 'esbuild'

test('le plafond reste unique et les modifications suivent le compte et le rythme sélectionnés', async t => {
  const {window} = parseHTML('<html><body><div id="app"></div></body></html>')
  globalThis.window = window
  globalThis.document = window.document
  globalThis.IS_REACT_ACT_ENVIRONMENT = true
  const require = createRequire(import.meta.url)
  const React = require('react')
  const {Simulate} = require('react-dom/test-utils')
  const root = require('react-dom/client').createRoot(document.getElementById('app'))
  t.after(async () => {
    await React.act(async () => root.unmount())
    delete globalThis.IS_REACT_ACT_ENVIRONMENT
    delete globalThis.document
    delete globalThis.window
  })

  const rows = ['alice','brune','clara'].map(account => ({
    account, login:account, mode:'normal', normal_limit:10, starter_limit:4,
    day_limit:10, remaining:10, posted:0, reserved:0, queued:0
  }))
  Object.assign(rows[0],{posted:2,reserved:3,queued:1,remaining:5})
  Object.assign(rows[1],{reserved:10,remaining:0})
  Object.assign(rows[2],{posted:10,remaining:0})
  const accounts = rows.map(({account,login}) => ({id:account,login,brand:'Marque'})).reverse()
  accounts.push({id:'banni',login:'profil-banni'},{id:'restreint',login:'profil-restreint'},{id:'inconnu',login:'sans-suivi'})
  accounts.push({id:'ancien',login:'ancien-cache'},{id:'retiré',login:'compte-délié'})
  const bans = new Set(['banni'])
  const writes = []
  const drafts = []
  const requests = new Map()
  let pendingSave,cadenceDown=false
  const api = {
    formatMoney: price=>price+' €',
    async query(view) {
      if(view === 'cadence'){
        if(cadenceDown)throw Error('indisponible')
        return structuredClone(rows)
      }
      if(view === 'quick-profiles') return {accounts}
      if(view === 'account-health') return {accounts:accounts.filter(a=>a.id!=='ancien').map(a=>({...a,linked:a.id!=='retiré',block:
        bans.has(a.id)?{kind:'banned',label:'Compte banni'}:a.id==='restreint'?{kind:'restricted',label:'Compte restreint'}:null})),checkedAt:new Date().toISOString()}
      if(view === 'batch-drafts') return {rows:structuredClone(drafts),total:drafts.length,draftCounts:{alice:47,restreint:1}}
      throw Error(view)
    },
    async act(action, fields) {
      if(action === 'sync') return
      if(action === 'batch-generate')return new Promise((resolve,reject)=>requests.set(fields.id,{resolve,reject}))
      assert.equal(action,'cadence-save')
      writes.push(fields)
      if(pendingSave) await pendingSave
      const limit = fields.mode === 'normal' ? fields.normal : fields.starter
      const row = rows.find(r => r.account === fields.account)
      Object.assign(row,{mode:fields.mode,starter_limit:fields.starter,normal_limit:fields.normal,day_limit:limit,remaining:Math.max(0,limit-row.posted-row.reserved)})
      return structuredClone(row)
    }
  }
  const source = fileURLToPath(new URL('../src/components/ScalencyBatchStudio.jsx',import.meta.url))
  const external = ['../lib/scalency','../lib/batchIntake','./AccountPhotos','./ScalencyDraft','./BatchEntry']
  const compiled = await build({entryPoints:[source],bundle:true,write:false,platform:'node',format:'cjs',jsx:'automatic',packages:'external',loader:{'.css':'empty'},external})
  const mod = new Module(source)
  mod.require = id => {
    if(id === '../lib/scalency') return api
    if(id === './AccountPhotos') return {PhotoAccountPanel:() => React.createElement('aside')}
    if(external.includes(id)) return () => null
    return require(id)
  }
  mod._compile(compiled.outputFiles[0].text,source)
  await React.act(async () => root.render(React.createElement(mod.exports.default,{params:{account:'banni'}})))
  const card = () => document.querySelector('.cadence-card')
  const change = (field,value) => React.act(async () => Simulate.change(field,{target:{value}}))
  const accountButton = id => document.querySelector('.bs-account-choice[value="'+id+'"]')
  const choose = value => React.act(async () => Simulate.click(accountButton(value)))
  const edit = () => React.act(async () => Simulate.click(card().querySelector('button')))
  const options = () => Array.from(document.querySelectorAll('.bs-account-choice'),o=>o.getAttribute('value'))
  const refresh = () => React.act(async () => Simulate.click(Array.from(document.querySelectorAll('button')).find(b=>b.textContent==='Actualiser')))

  assert.equal(card(),null)
  assert.ok(!options().includes('banni'))
  assert.ok(!document.body.textContent.includes('profil-banni'))
  assert.ok(options().includes('restreint'))
  assert.deepEqual(options(),['alice','brune','clara','restreint','inconnu'])
  assert.equal(accountButton('alice').querySelector('.bs-account-drafts').textContent,'47 brouillons')
  assert.equal(accountButton('brune').querySelector('.bs-account-drafts').textContent,'0 brouillon')
  assert.equal(accountButton('restreint').querySelector('.bs-account-drafts').textContent,'1 brouillon')
  assert.match(accountButton('alice').textContent,/5 places libres aujourd’hui.*2 publiées · 1 en file/)
  assert.match(accountButton('brune').textContent,/Places du jour réservées.*0 publiée · 0 en file/)
  assert.match(accountButton('clara').textContent,/Plafond atteint.*10 publiées · 0 en file/)
  assert.match(accountButton('restreint').textContent,/Compte restreint/)
  assert.match(accountButton('inconnu').textContent,/Suivi indisponible/)
  await choose('restreint')
  assert.equal(document.querySelector('.sc-account-warning'),null)
  assert.match(accountButton('restreint').textContent,/Compte restreint/)
  await choose('alice')
  assert.equal(document.querySelector('.sc-account-warning'),null)
  assert.equal(accountButton('alice').getAttribute('aria-pressed'),'true')
  await edit()
  for(const login of ['brune','clara','alice']) {
    await choose(login)
    assert.equal(document.querySelectorAll('.cadence-card').length,1)
    assert.ok(card().textContent.includes(login))
    assert.equal(card().querySelector('form'),null)
  }
  await edit()
  assert.equal(card().querySelectorAll('input').length,1)
  await change(card().querySelector('input'),'27')
  await React.act(async () => Simulate.submit(card().querySelector('form')))
  assert.deepEqual(writes.at(-1),{account:'alice',mode:'normal',starter:4,normal:27})
  assert.match(card().textContent,/27/)
  await choose('brune')
  await edit()
  await change(card().querySelector('select'),'starter')
  assert.equal(card().querySelector('input').value,'4')
  await change(card().querySelector('input'),'0')
  let finishSave
  pendingSave = new Promise(resolve => { finishSave = resolve })
  await React.act(async () => Simulate.submit(card().querySelector('form')))
  assert.deepEqual(writes.at(-1),{account:'brune',mode:'starter',starter:0,normal:10})
  await choose('alice')
  await edit()
  await React.act(async () => finishSave())
  assert.equal(card().querySelector('input').value,'27')
  await choose('brune')
  await edit()
  assert.equal(card().querySelector('input').value,'0')
  assert.match(accountButton('brune').textContent,/Plafond à zéro/)
  assert.equal(card().querySelector('select').value,'starter')
  bans.add('brune')
  await refresh()
  assert.ok(!options().includes('brune'))
  assert.equal(card(),null)
  bans.delete('brune')
  await refresh()
  assert.ok(options().includes('brune'))
  assert.equal(card(),null)
  cadenceDown=true
  await refresh()
  assert.match(accountButton('alice').textContent,/Suivi indisponible/)
  assert.equal(accountButton('alice').querySelector('.bs-account-counts'),null)
  cadenceDown=false
  await refresh()
  assert.match(accountButton('alice').textContent,/22 places libres aujourd’hui/)

  await t.test('chaque résultat reste sur son SKU quand deux remplissages se terminent dans le désordre',async()=>{
    for(const sku of ['A','B']){
      const pendingIssue=sku==='A'?'La taille L attend la confirmation du référentiel Vinted.':undefined
      drafts.push({id:sku,version:2,count:1,fields:{account_id:'alice',sku,price:'22'},
        batch:{status:'review',catalog_pending:true,catalog_issue:pendingIssue,missing:[pendingIssue||'Texte enregistré. Options de la catégorie Vinted en attente.','Couleur']}})
    }
    await choose('alice')
    await refresh()
    const draft=sku=>Array.from(document.querySelectorAll('.bs-draft-row')).find(el=>el.querySelector('h3')?.textContent===sku)
    const notice=()=>document.querySelector('.bs-preparation-note')
    const retry=sku=>React.act(async()=>Simulate.click(Array.from(draft(sku).querySelectorAll('button')).find(b=>b.textContent==='Actualiser la catégorie')))
    assert.equal(draft('A').querySelector('.bs-badge').textContent,'Catégorie Vinted en attente')
    assert.match(draft('A').textContent,/La taille L attend la confirmation/)
    assert.match(draft('A').textContent,/Champs à vérifier · Couleur/)
    await retry('A')
    await retry('B')
    assert.match(notice().textContent,/B · Vérification de la catégorie/)
    await React.act(async()=>requests.get('A').reject(Error('Connexion interrompue')))
    assert.match(draft('A').textContent,/Connexion interrompue/)
    assert.match(notice().textContent,/B · Vérification de la catégorie/)
    drafts[1].version++
    drafts[1].batch={status:'ready',missing:[]}
    await React.act(async()=>requests.get('B').resolve())
    assert.equal(notice().textContent.trim(),'B · Prête à relire')
    assert.equal(notice().getAttribute('role'),'status')
    await retry('A')
    await React.act(async()=>requests.get('A').reject(Error('Réseau indisponible')))
    assert.match(notice().textContent,/A · Réseau indisponible/)
    assert.equal(notice().getAttribute('role'),'alert')
    await choose('brune')
    assert.equal(notice(),null)
  })
})
