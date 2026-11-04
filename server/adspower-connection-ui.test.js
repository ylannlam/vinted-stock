import test from 'node:test'
import assert from 'node:assert/strict'
import {parseHTML} from 'linkedom'
import {build} from 'esbuild'
import {createRequire,Module} from 'node:module'
import {fileURLToPath} from 'node:url'

test('mobile keeps cloud tracking without local calls; profile errors no longer report a closed connector',async()=>{
  const {window}=parseHTML('<html><body><div id="app"></div></body></html>')
  globalThis.window=window;globalThis.document=window.document
  Object.defineProperty(document,'visibilityState',{value:'visible'})
  globalThis.localStorage={getItem:()=>null,setItem(){}}
  globalThis.IS_REACT_ACT_ENVIRONMENT=true
  const require=createRequire(import.meta.url),React=require('react'),{act}=React,{createRoot}=require('react-dom/client')
  const compiled=await build({entryPoints:[fileURLToPath(new URL('../src/components/AdsPowerTab.jsx',import.meta.url))],bundle:true,write:false,platform:'node',format:'cjs',jsx:'automatic',packages:'external',plugins:[{name:'no-real-auth',setup(b){b.onLoad({filter:/src[\\/]lib[\\/]supabase\.js$/},()=>({contents:'export const supabase={auth:{getSession(){throw Error("Unexpected real auth")}}}'}))}}]})
  const mod=new Module(fileURLToPath(import.meta.url));mod.paths=Module._nodeModulePaths(fileURLToPath(new URL('..',import.meta.url)));mod._compile(compiled.outputFiles[0].text,fileURLToPath(import.meta.url))
  const AdsPowerTab=mod.exports.default
  let localCalls=0,cloudCalls=0,profileFailure=true
  const request=async path=>{localCalls++;if(path==='/state')return {configured:true,monitoring:true,jobs:[]};if(path==='/profiles'){if(profileFailure)throw Error('AdsPower demande une pause');return {profiles:[{id:'p1',name:'Compte test',number:'1',group:'Test'}]}}throw Error('Unexpected action')}
  const publications=async(action,query={})=>{cloudCalls++;return action==='profile-selection'?{selection:{version:1,profiles:[{id:'p1',name:'Compte test',number:'1',group:'Test'}]}}:{date:query.date,accounts:[],links:[],refreshed:true,directory_checked_at:new Date().toISOString()}}
  const healthRequest=async()=>({accounts:[],sync:{}})
  const props={request,publications,healthRequest}
  const button=text=>[...document.querySelectorAll('button')].find(b=>b.textContent===text)
  let root=createRoot(document.getElementById('app'))
  try{
    await act(async()=>root.render(React.createElement(AdsPowerTab,{...props,mobile:true})))
    assert.equal(localCalls,0);assert.ok(cloudCalls>0)
    assert.match(document.body.textContent,/Consultation sur mobile/)
    assert.match(document.body.textContent,/Tes publications, jour après jour/)
    assert.doesNotMatch(document.body.textContent,/Connecteur fermé|Connecter AdsPower à ton site/)
    assert.equal(document.querySelector('a[href*="127.0.0.1"]'),null)
    await act(async()=>button('Actualiser').click());assert.equal(localCalls,0)
    await act(async()=>root.unmount())
    root=createRoot(document.getElementById('app'))
    await act(async()=>root.render(React.createElement(AdsPowerTab,{...props,mobile:false})))
    assert.match(document.body.textContent,/Connecteur joignable/)
    assert.match(document.body.textContent,/profils AdsPower sont indisponibles/)
    assert.doesNotMatch(document.body.textContent,/Connecteur fermé|Connecter AdsPower à ton site/)
    profileFailure=false
    await act(async()=>window.dispatchEvent(new window.Event('online')))
    assert.match(document.body.textContent,/Compte test/)
    assert.doesNotMatch(document.body.textContent,/profils AdsPower sont indisponibles/)
  }finally{await act(async()=>root.unmount());delete globalThis.IS_REACT_ACT_ENVIRONMENT;delete globalThis.localStorage;delete globalThis.window;delete globalThis.document}
})
