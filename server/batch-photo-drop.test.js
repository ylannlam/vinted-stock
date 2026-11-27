import assert from 'node:assert/strict'
import {createRequire,Module} from 'node:module'
import test from 'node:test'
import {fileURLToPath} from 'node:url'
import {build} from 'esbuild'
import {parseHTML} from 'linkedom'

test('le dépôt couvre la fenêtre de saisie et ajoute chaque photo une seule fois',async()=>{
  const rootDir=fileURLToPath(new URL('..',import.meta.url))
  const bundle=await build({entryPoints:[rootDir+'/src/components/BatchEntry.jsx'],platform:'node',packages:'external',bundle:true,
    write:false,jsx:'automatic',plugins:[{name:'offline',setup(b){
      b.onResolve({filter:/batchIntake$/},()=>({path:'intake',namespace:'mock'}))
      b.onLoad({filter:/.*/,namespace:'mock'},()=>({contents:'export function queueIntake(){throw Error("unexpected submission")}'}))
    }}]})
  const {window}=parseHTML('<html><body><div id="root"></div></body></html>')
  globalThis.window=window;globalThis.document=window.document;globalThis.IS_REACT_ACT_ENVIRONMENT=true
  globalThis.cancelAnimationFrame=()=>{}
  const require=createRequire(import.meta.url),React=require('react'),{act}=React
  const mod=new Module(fileURLToPath(import.meta.url));mod.paths=Module._nodeModulePaths(rootDir)
  mod._compile(bundle.outputFiles[0].text,fileURLToPath(import.meta.url))
  const root=require('react-dom/client').createRoot(document.getElementById('root'))
  const render=props=>act(async()=>root.render(React.createElement(mod.exports.default,{account:{id:'a',login:'Test'},...props})))
  const dispatch=async(type,fields={})=>{
    const event=new window.Event(type,{bubbles:true,cancelable:true})
    Object.assign(event,fields)
    await act(async()=>window.dispatchEvent(event))
    return event.defaultPrevented
  }
  const names=()=>Array.from(document.querySelectorAll('.bs-photo img'),img=>img.alt)
  const overlay=()=>document.querySelector('.bs-drop-overlay')
  const transfer={types:['Files'],files:[]}
  try{
    await render({})
    await dispatch('dragenter',{dataTransfer:{types:['text/plain']}})
    assert.equal(overlay(),null)
    await dispatch('dragenter',{dataTransfer:transfer})
    await dispatch('dragenter',{dataTransfer:transfer})
    await dispatch('dragleave')
    assert.match(overlay().textContent,/Test/)
    await dispatch('dragleave')
    assert.equal(overlay(),null)
    await dispatch('dragover',{dataTransfer:transfer})
    assert.equal(transfer.dropEffect,'copy')
    transfer.files=['face.jpg','dos.jpg'].map(name=>new File(['image'],name,{type:'image/jpeg'}))
    await dispatch('drop',{dataTransfer:transfer})
    assert.deepEqual(names(),['face.jpg','dos.jpg']);assert.equal(overlay(),null)
    const web={types:['text/uri-list','text/html'],getData:type=>type==='text/uri-list'?'data:image/png;base64,AQ==':''}
    await dispatch('dragenter',{dataTransfer:web})
    assert.ok(overlay())
    assert.equal(await dispatch('drop',{dataTransfer:web}),true)
    assert.deepEqual(names(),['face.jpg','dos.jpg','photo.png'])
    const blob={types:['text/plain'],getData:type=>type==='text/plain'?'blob:https://chatgpt.com/test-image':''}
    assert.equal(await dispatch('drop',{dataTransfer:blob}),true)
    assert.match(document.querySelector('[role="alert"]').textContent,/Ctrl\+V/)
    assert.equal(await dispatch('paste',{clipboardData:{files:[new File(['image'],'collée.png',{type:'image/png'})]}}),true)
    assert.equal(await dispatch('paste',{clipboardData:{files:[]}}),false)
    assert.equal(await dispatch('drop',{dataTransfer:{types:['text/plain'],getData:()=>''}}),false)
    await dispatch('dragenter',{dataTransfer:transfer})
    await dispatch('keydown',{key:'Escape'})
    assert.equal(overlay(),null)
    const dialog=document.createElement('div')
    dialog.setAttribute('aria-modal','true');document.body.append(dialog)
    await dispatch('drop',{dataTransfer:transfer});dialog.remove()
    for(const props of [{active:false},{blocked:true}]){
      await render(props)
      await dispatch('dragenter',{dataTransfer:transfer})
      await dispatch('drop',{dataTransfer:transfer})
      assert.equal(overlay(),null)
    }
    assert.deepEqual(names(),['face.jpg','dos.jpg','photo.png','collée.png'])
    await render({})
    const realFetch=globalThis.fetch
    let signal
    try{
      globalThis.fetch=(_url,options)=>new Promise((_,reject)=>{
        signal=options.signal;signal.addEventListener('abort',()=>reject(Error('aborted')),{once:true})
      })
      const hanging={types:['text/uri-list'],getData:t=>t==='text/uri-list'?'https://img.example/hanging':''}
      await dispatch('drop',{dataTransfer:hanging})
      await dispatch('drop',{dataTransfer:{types:['Files'],files:[new File(['a'],'queued.png',{type:'image/png'})]}})
      const cancel=[...document.querySelectorAll('button')].find(b=>b.textContent==='Annuler l’import en cours')
      assert.ok(cancel)
      await act(async()=>cancel.click())
      assert.ok(signal.aborted)
      assert.equal(names().length,4)
    }finally{globalThis.fetch=realFetch}
    const burst=Array.from({length:24},(_,i)=>new File(['image'],'robe-'+i+'.png',{type:'image/png'}))
    await dispatch('drop',{dataTransfer:{types:['Files'],files:burst}})
    assert.deepEqual(names().slice(4),burst.slice(0,16).map(f=>f.name))
    assert.match(document.querySelector('[role="alert"]').textContent,/20 photos/)
    await act(async()=>document.querySelector('.bs-photo-remove').click())
    await dispatch('paste',{clipboardData:{files:[burst[17]]}})
    assert.equal(names().length,20)
    assert.equal(names().at(-1),'robe-17.png')
    await act(async()=>root.render(null))
    const drawCalls=[],decoded=[],closed=[]
    let inProgress=0,maxConcurrent=0
    globalThis.createImageBitmap=async(file,{resizeWidth})=>{
      decoded.push(file);maxConcurrent=Math.max(maxConcurrent,++inProgress)
      await new Promise(r=>setTimeout(r,1))
      return {width:resizeWidth,height:resizeWidth*2,close(){closed.push(file);inProgress--}}
    }
    const canvasPrototype=Object.getPrototypeOf(document.createElement('canvas'))
    const getContext=canvasPrototype.getContext
    canvasPrototype.getContext=()=>({drawImage:(image,x,y,width,height)=>drawCalls.push([width,height])})
    try{
      await render({})
      await dispatch('drop',{dataTransfer:{types:['Files'],files:burst}})
      for(let i=0;i<100&&closed.length<20;i++)await new Promise(r=>setTimeout(r,5))
      assert.equal(maxConcurrent,1)
      assert.deepEqual(decoded,burst.slice(0,20))
      assert.deepEqual(closed,decoded)
      assert.deepEqual(drawCalls,Array.from({length:20},()=>[128,256]))
      assert.equal(document.querySelectorAll('.bs-photo canvas').length,20)
    }finally{delete globalThis.createImageBitmap;canvasPrototype.getContext=getContext}
  }finally{
    await act(async()=>root.unmount())
    delete globalThis.window;delete globalThis.document;delete globalThis.IS_REACT_ACT_ENVIRONMENT;delete globalThis.cancelAnimationFrame
  }
})
