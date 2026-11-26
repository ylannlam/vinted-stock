import test from 'node:test'
import assert from 'node:assert/strict'
import {createRequire,Module} from 'node:module'
import {fileURLToPath} from 'node:url'
import {build} from 'esbuild'
import {parseHTML} from 'linkedom'

test('chaque ouverture propose les deux espaces et reprend le lien du bon espace',async()=>{
  const rootDir=fileURLToPath(new URL('..',import.meta.url))
  const bundle=await build({stdin:{contents:`
    import {useNavigation} from './src/lib/navigation'
    import SpaceChooser from './src/components/SpaceChooser'
    import {TAB_SPACES} from './src/constants'
    export default function Entry({capture}){
      const [tab,,filters,choose]=useNavigation(capture)
      return tab===TAB_SPACES?<SpaceChooser onChoose={choose}/>:<output>{JSON.stringify([tab,filters])}</output>
    }`,resolveDir:rootDir,loader:'jsx'},bundle:true,platform:'node',packages:'external',write:false,jsx:'automatic'})
  const {window}=parseHTML('<html><body><div id="root"></div></body></html>')
  globalThis.window=window;globalThis.document=window.document;globalThis.IS_REACT_ACT_ENVIRONMENT=true
  const require=createRequire(import.meta.url),React=require('react'),{createRoot}=require('react-dom/client')
  const mod=new Module(fileURLToPath(import.meta.url));mod.paths=Module._nodeModulePaths(rootDir)
  mod._compile(bundle.outputFiles[0].text,fileURLToPath(import.meta.url))
  const {TAB_HOME,TAB_ALICIA,TAB_LISTINGS,TAB_CATALOG}=await import('../src/constants.js')
  async function open(hash,desktop,choice,expected,filters={},imported=false){
    window.location={hash}
    window.matchMedia=()=>({matches:desktop})
    const root=createRoot(document.getElementById('root'))
    try{
      await React.act(async()=>root.render(React.createElement(mod.exports.default,{capture:()=>imported})))
      const buttons=[...document.querySelectorAll('button')]
      assert.deepEqual(buttons.map(b=>b.querySelector('strong').textContent),['YLANN','ALICIA'])
      await React.act(async()=>buttons[choice==='alicia'?1:0].click())
      assert.deepEqual(JSON.parse(document.querySelector('output').textContent),[expected,filters])
      if(Object.keys(filters).length)assert.equal(window.location.hash,hash)
      await React.act(async()=>{window.location.hash='#espaces';window.dispatchEvent(new window.Event('hashchange'))})
      assert.equal(document.querySelectorAll('button').length,2)
    }finally{await React.act(async()=>root.unmount())}
  }
  await open('',false,'ylann',TAB_HOME)
  await open('',true,'alicia',TAB_ALICIA)
  await open('#annonces?account=exemple',true,'ylann',TAB_LISTINGS,{account:'exemple'})
  await open('#alicia/suivi?lot=exemple',false,'alicia',TAB_ALICIA,{lot:'exemple',section:'suivi'})
  await open('#annonces?account=exemple',false,'alicia',TAB_ALICIA)
  await open('#alicia/fonds',true,'ylann',TAB_HOME)
  await open('',false,'ylann',TAB_CATALOG,{},true)
})
