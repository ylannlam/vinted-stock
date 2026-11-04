import test from 'node:test'
import assert from 'node:assert/strict'
import {parseHTML} from 'linkedom'
import {build} from 'esbuild'
import {createRequire,Module} from 'node:module'
import {fileURLToPath} from 'node:url'

test('opening AdsPower reads the day once, then once more only after the account directory refresh',async()=>{
 const {window}=parseHTML('<html><body><div id="app"></div></body></html>')
 globalThis.window=window;globalThis.document=window.document;globalThis.IS_REACT_ACT_ENVIRONMENT=true
 const require=createRequire(import.meta.url),React=require('react'),{act}=React,{createRoot}=require('react-dom/client')
 const compiled=await build({stdin:{contents:"import {usePublicationTracking} from './src/lib/usePublicationTracking.js';export default function Probe({request}){usePublicationTracking([],request);return null}",resolveDir:fileURLToPath(new URL('..',import.meta.url)),loader:'jsx'},bundle:true,write:false,platform:'node',format:'cjs',jsx:'automatic',packages:'external',plugins:[{name:'no-network',setup(b){b.onResolve({filter:/^\.\/api$/},()=>({path:'api',namespace:'stub'}));b.onLoad({filter:/.*/,namespace:'stub'},()=>({contents:"export const authenticatedFetch=()=>{throw Error('network disabled in tests')}",loader:'js'}))}}]})
 const mod=new Module(fileURLToPath(import.meta.url));mod.paths=Module._nodeModulePaths(fileURLToPath(new URL('..',import.meta.url)));mod._compile(compiled.outputFiles[0].text,fileURLToPath(import.meta.url))
 const calls=[];let release
 const directory=new Promise(r=>release=r)
 const request=async action=>{calls.push(action);if(action==='publication-accounts'){await directory;return {refreshed:true}}return {date:'2026-11-04',accounts:[],links:[],directory_checked_at:new Date().toISOString()}}
 const root=createRoot(document.getElementById('app'))
 try{
  await act(async()=>root.render(React.createElement(mod.exports.default,{request})))
  assert.equal(calls.filter(c=>c==='publications').length,1,'no duplicate first read')
  await act(async()=>{release();await new Promise(r=>setTimeout(r,10))})
  assert.deepEqual(calls,['publication-accounts','publications','publications'])
 }finally{await act(async()=>root.unmount());delete globalThis.window;delete globalThis.document;delete globalThis.IS_REACT_ACT_ENVIRONMENT}
})
