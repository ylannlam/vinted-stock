import test from 'node:test'
import assert from 'node:assert/strict'
import {createRequire, Module} from 'node:module'
import {fileURLToPath} from 'node:url'
import {build} from 'esbuild'
import {parseHTML} from 'linkedom'

test('new accounts start in preparation, with Google and conditional Onoff email', async () => {
  const {window} = parseHTML('<html><body><div id="app"></div></body></html>')
  globalThis.window = window
  globalThis.document = window.document
  globalThis.IS_REACT_ACT_ENVIRONMENT = true
  const require = createRequire(import.meta.url)
  const React = require('react')
  const {act} = React
  const {Simulate} = require('react-dom/test-utils')
  const {createRoot} = require('react-dom/client')
  const entry = fileURLToPath(new URL('../src/components/AccountFormModal.jsx', import.meta.url))
  const bundle = await build({entryPoints: [entry], bundle: true, write: false, platform: 'node', format: 'cjs', jsx: 'automatic', packages: 'external'})
  const compiled = new Module(entry)
  compiled.paths = Module._nodeModulePaths(fileURLToPath(new URL('..', import.meta.url)))
  compiled._compile(bundle.outputFiles[0].text, entry)
  const root = createRoot(document.querySelector('#app'))
  let saved
  const render = account => act(async () => root.render(React.createElement(compiled.exports.default, {
    key: account?.id || 'new', account, onSave: fields => { saved = fields },
  })))
  const button = label => [...document.querySelectorAll('button')].find(b => b.textContent === label)
  const change = (selector, value) => act(async () => Simulate.change(document.querySelector(selector), {target: {value}}))
  const submit = () => act(async () => Simulate.submit(document.querySelector('form')))
  try {
    await render(null)
    assert.equal(button('Lyca').getAttribute('aria-pressed'), 'true')
    assert.deepEqual([...document.querySelectorAll('[aria-pressed]')].map(b => b.textContent), ['Lyca', 'Onoff'])
    assert.match(document.body.textContent, /Adresse e-mail Google/)
    assert.doesNotMatch(document.body.textContent, /Mot de passe|Statut|Banni|Suspendu|Apple/)
    assert.equal(document.querySelector('#onoff-email'), null)
    await change('[placeholder="@pseudo_vinted"]', 'exemple')
    await act(async () => button('Onoff').click())
    assert.ok(document.querySelector('input#onoff-email[type=email][required]'))
    await change('#onoff-email', 'exemple@example.test')
    await submit()
    assert.equal(saved.telephone_email, 'exemple@example.test')
    assert.equal(saved.telephone_type, 'onoff')
    await act(async () => button('Lyca').click())
    assert.equal(document.querySelector('#onoff-email'), null)
    await submit()
    assert.equal(saved.telephone_email, null)
    assert.equal(saved.telephone_type, 'lyca')
    assert.equal(saved.methode_connexion, 'google')
    assert.equal(saved.statut, 'en_preparation')
    assert.equal(saved.creation_stage, 'post1')
    assert.equal(saved.is_ready, false)
    assert.ok(!('password' in saved))

    await render({...saved, id: 'legacy', methode_connexion: 'apple', telephone_type: 'autre', statut: 'suspendu', creation_stage: 'blocked'})
    assert.ok(button('Actif'))
    assert.equal(button('Suspendu'), undefined)
    await submit()
    assert.equal(saved.methode_connexion, 'apple')
    assert.equal(saved.telephone_type, 'autre')
    assert.equal(saved.statut, 'suspendu')
  } finally {
    await act(async () => root.unmount())
    delete globalThis.window
    delete globalThis.document
    delete globalThis.IS_REACT_ACT_ENVIRONMENT
  }
})
