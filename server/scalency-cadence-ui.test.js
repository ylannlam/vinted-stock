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
    day_limit:10, remaining:10, posted:0, reserved:0
  }))
  const accounts = rows.map(({account,login}) => ({id:account,login,brand:'Marque'}))
  const writes = []
  let pendingSave
  const api = {
    async query(view) {
      if(view === 'cadence') return structuredClone(rows)
      if(view === 'quick-profiles') return {accounts}
      if(view === 'account-health') return {accounts,checkedAt:new Date().toISOString()}
      if(view === 'batch-drafts') return {rows:[],total:0}
      throw Error(view)
    },
    async act(action, fields) {
      if(action === 'sync') return
      assert.equal(action,'cadence-save')
      writes.push(fields)
      if(pendingSave) await pendingSave
      const limit = fields.mode === 'normal' ? fields.normal : fields.starter
      const row = rows.find(r => r.account === fields.account)
      Object.assign(row,{mode:fields.mode,starter_limit:fields.starter,normal_limit:fields.normal,day_limit:limit,remaining:limit})
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
  await React.act(async () => root.render(React.createElement(mod.exports.default,{params:{account:'alice'}})))
  const card = () => document.querySelector('.cadence-card')
  const change = (field,value) => React.act(async () => Simulate.change(field,{target:{value}}))
  const choose = value => change(document.querySelector('.bs-account select'),value)
  const edit = () => React.act(async () => Simulate.click(card().querySelector('button')))

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
  assert.equal(card().querySelector('select').value,'starter')
  await choose('')
  assert.equal(card(),null)
})
