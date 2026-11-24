import {act,query} from './scalency'
import {uploadListingPhoto} from './api'

const eventName='stock-vinted-intake'
const running=new Set()
const buffered=new Map()
let opening

function database(){
  if(!opening){
    opening=new Promise((resolve,reject)=>{
      const request=indexedDB.open('stock-vinted-intake',1)
      request.onupgradeneeded=()=>request.result.createObjectStore('entries',{keyPath:'id'}).createIndex('owner','owner')
      request.onsuccess=()=>resolve(request.result)
      request.onerror=()=>reject(request.error)
    }).catch(error=>{opening=null;throw error})
  }
  return opening
}
async function transaction(mode,operation){
  const db=await database()
  return new Promise((resolve,reject)=>{
    const tx=db.transaction('entries',mode)
    const request=operation(tx.objectStore('entries'))
    tx.oncomplete=()=>resolve(request.result)
    tx.onabort=tx.onerror=()=>reject(tx.error||request.error||Error('Enregistrement local interrompu.'))
  })
}
const list=owner=>transaction('readonly',store=>store.index('owner').getAll(owner))
const put=entry=>transaction('readwrite',store=>store.put(entry))
const remove=id=>transaction('readwrite',store=>store.delete(id))
const changed=(owner,server=false)=>window.dispatchEvent(new CustomEvent(eventName,{detail:{owner,server}}))

// Only entries which have not yet reached durable storage need protection on tab close.
function protectUnsaved(event){
  event.preventDefault()
  event.returnValue=''
}
function releaseBuffered(id){
  buffered.delete(id)
  if(!buffered.size)window.removeEventListener('beforeunload',protectUnsaved)
}
async function persist(entry){
  try{
    await put({...entry,stage:'upload'})
    releaseBuffered(entry.id)
  }catch{
    // A full/private browser can still transfer the original files from this open tab.
    entry.stage='upload'
  }
  changed(entry.owner)
}
export function queueIntake(owner,id,fields,files){
  if(!owner)throw Error('Attends le chargement de ton compte.')
  const entry={owner,id,fields,created:Date.now(),stage:'saving',photos:files.map(file=>({file}))}
  if(!buffered.size)window.addEventListener('beforeunload',protectUnsaved)
  buffered.set(id,entry)
  // Yield to the form reset, focus and scroll before the browser clones large image files.
  setTimeout(()=>{changed(owner);void persist(entry)},0)
}
export async function retryIntake(owner,id){
  const local=buffered.get(id)
  if(local?.owner===owner&&local.stage==='error'){
    local.stage='upload';local.error='';changed(owner);return
  }
  const entry=await transaction('readonly',store=>store.get(id))
  if(entry?.owner===owner&&entry.stage==='error'){
    await put({...entry,stage:'upload',error:''})
    changed(owner)
  }
}
async function processEntry(owner,id){
  const memory=buffered.get(id)
  const entry=memory||await transaction('readonly',store=>store.get(id))
  if(!entry||entry.owner!==owner||entry.stage==='error')return
  try{
    await query('account-health',{account:entry.fields.account_id})
    // Three simultaneous transfers at most. Keep every successful path in its cover position.
    let next=0
    async function upload(){
      while(next<entry.photos.length){
        const index=next++,photo=entry.photos[index]
        if(photo.file)entry.photos[index]={uploaded:await uploadListingPhoto(photo.file)}
      }
    }
    const uploads=await Promise.allSettled(Array.from({length:Math.min(3,entry.photos.length)},upload))
    const failed=uploads.find(result=>result.status==='rejected')
    if(failed)throw failed.reason
    if(!memory)await put(entry)
    const saved=await act('batch-create',{id,owner,fields:entry.fields,photos:entry.photos.map(p=>p.uploaded)})
    if(saved.state==='draft'&&!saved.batch){
      entry.stage='generating'
      if(!memory)await put(entry)
      changed(owner,true)
      try{await act('batch-generate',{id,version:saved.version})}
      catch(error){
        // A lost response may still have produced a durable draft. Its server status wins.
        const current=await act('batch-create',{id,owner,fields:entry.fields,photos:entry.photos.map(p=>p.uploaded)})
        if(!current.batch&&current.state==='draft')throw error
      }
    }
    if(memory)releaseBuffered(id)
    else await remove(id)
  }catch(error){
    entry.stage='error';entry.error=error.message||'Connexion interrompue.'
    if(!memory)await put(entry)
  }finally{changed(owner,true)}
}
export function watchIntake(owner,onRows,onServer,onError){
  let live=true,revision=0
  async function refresh(){
    const stamp=++revision
    let saved=[]
    try{saved=await list(owner)}
    catch(error){
      if(!live||stamp!==revision)return
      if(![...buffered.values()].some(e=>e.owner===owner))onError(error.message||'Le stockage local est indisponible.')
    }
    if(!live||stamp!==revision)return
    const byId=new Map(saved.map(entry=>[entry.id,entry]))
    for(const entry of buffered.values())if(entry.owner===owner)byId.set(entry.id,entry)
    const entries=[...byId.values()].sort((a,b)=>a.created-b.created)
    onRows(entries.map(({id,fields,stage,error})=>({id,fields,stage,error})))
    for(const entry of entries){
      if(running.size>=2)break
      if(entry.stage==='saving'||entry.stage==='error'||running.has(entry.id))continue
      running.add(entry.id)
      const run=()=>processEntry(owner,entry.id)
      const task=navigator.locks?navigator.locks.request('stock-vinted:'+entry.id,run):run()
      task.catch(error=>{if(live)onError(error.message)}).finally(()=>{
        running.delete(entry.id);changed(owner)
      })
    }
  }
  function update(event){
    if(event.detail.owner===owner){if(event.detail.server)onServer();refresh()}
  }
  window.addEventListener(eventName,update)
  refresh()
  return ()=>{live=false;revision++;window.removeEventListener(eventName,update)}
}
