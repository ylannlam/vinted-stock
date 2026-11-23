import {act} from './scalency'
import {uploadListingPhoto} from './api'

const eventName='stock-vinted-intake'
const running=new Set()
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

export async function queueIntake(owner,id,fields,files){
  if(!owner)throw Error('Attends le chargement de ton compte.')
  try{
    await put({owner,id,fields,created:Date.now(),stage:'upload',photos:files.map(file=>({file}))})
  }catch{throw Error('Les photos n’ont pas pu être enregistrées sur cet appareil. Elles restent dans le formulaire.')}
  changed(owner)
}
export async function retryIntake(owner,id){
  const entry=await transaction('readonly',store=>store.get(id))
  if(entry?.owner===owner&&entry.stage==='error'){
    await put({...entry,stage:'upload',error:''})
    changed(owner)
  }
}
async function processEntry(owner,id){
  const entry=await transaction('readonly',store=>store.get(id))
  if(!entry||entry.owner!==owner||entry.stage==='error')return
  try{
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
    await put(entry)
    const saved=await act('batch-create',{id,owner,fields:entry.fields,photos:entry.photos.map(p=>p.uploaded)})
    if(saved.state==='draft'&&!saved.batch){
      entry.stage='generating';await put(entry);changed(owner,true)
      try{await act('batch-generate',{id,version:saved.version})}
      catch(error){
        // A lost response may still have produced a durable draft. Its server status wins.
        const current=await act('batch-create',{id,owner,fields:entry.fields,photos:entry.photos.map(p=>p.uploaded)})
        if(!current.batch&&current.state==='draft')throw error
      }
    }
    await remove(id)
  }catch(error){
    await put({...entry,stage:'error',error:error.message||'Connexion interrompue.'})
  }finally{changed(owner,true)}
}
export function watchIntake(owner,onRows,onServer,onError){
  let live=true,revision=0
  async function refresh(){
    const stamp=++revision
    try{
      const entries=(await list(owner)).sort((a,b)=>a.created-b.created)
      if(!live||stamp!==revision)return
      onRows(entries.map(({id,fields,stage,error})=>({id,fields,stage,error})))
      for(const entry of entries){
        if(running.size>=2)break
        if(entry.stage==='error'||running.has(entry.id))continue
        running.add(entry.id)
        const run=()=>processEntry(owner,entry.id)
        const task=navigator.locks?navigator.locks.request('stock-vinted:'+entry.id,run):run()
        task.catch(error=>{if(live)onError(error.message)}).finally(()=>{
          running.delete(entry.id);changed(owner)
        })
      }
    }catch(error){if(live)onError(error.message||'Les envois locaux sont indisponibles.')}
  }
  function update(event){
    if(event.detail.owner===owner){if(event.detail.server)onServer();refresh()}
  }
  window.addEventListener(eventName,update)
  refresh()
  return ()=>{live=false;revision++;window.removeEventListener(eventName,update)}
}
