import {useCallback,useEffect,useRef,useState} from 'react'
import {createPortal,flushSync} from 'react-dom'
import {queueIntake} from '../lib/batchIntake'
import {clothingSizeSuggestions,emptyListing,validateListingPhoto} from '../lib/listingStudio'
import {filesFromClipboard,hasTransferImage,readTransfer,resolveTransfer} from '../lib/dropFiles'

import BatchPhotoOrder from './BatchPhotoOrder'

export default function BatchEntry({account,owner,blocked,active=true,onQueued,onDetailed}){
  const [sku,setSku]=useState(''),[price,setPrice]=useState('')
  const [sizeOverride,setSizeOverride]=useState(null)
  const size=sizeOverride&&sizeOverride.account===account?.id?sizeOverride.value:account?.default_size||'M'
  useEffect(()=>setSizeOverride(null),[account?.id])
  const [photos,setPhotos]=useState([]),[error,setError]=useState('')
  const [draggingFiles,setDraggingFiles]=useState(false)
  const [importing,setImporting]=useState(false)
  const urls=useRef(new Set()),skuInput=useRef(null)
  useEffect(()=>()=>{for(const url of urls.current)URL.revokeObjectURL(url)},[])
  const add=useCallback(files=>{
    if(blocked)return
    try{
      if(urls.current.size+files.length>20)throw Error('Tu peux ajouter jusqu’à 20 photos par annonce.')
      files.forEach(validateListingPhoto)
      const next=files.map(file=>{const url=URL.createObjectURL(file);urls.current.add(url);return {file,url}})
      setPhotos(prev=>[...prev,...next]);setError('')
    }catch(e){setError(e.message)}
  },[blocked])
  useEffect(()=>{
    if(!active||blocked)return
    let depth=0,live=true,pending=0,queue=Promise.resolve()
    function reset(){depth=0;setDraggingFiles(false)}
    function modalOpen(){return !!document.querySelector('[aria-modal="true"],dialog[open]')}
    function dropTarget(event){
      const transfer=event.dataTransfer
      return (hasTransferImage(transfer)||transfer?.files?.length>0)&&!modalOpen()
    }
    function enter(event){
      if(!dropTarget(event))return
      event.preventDefault();depth++;setDraggingFiles(true)
    }
    function over(event){
      if(!dropTarget(event))return
      event.preventDefault()
      event.dataTransfer.dropEffect='copy'
      setDraggingFiles(true)
    }
    function leave(){
      depth=Math.max(0,depth-1)
      if(!depth)setDraggingFiles(false)
    }
    function drop(event){
      reset()
      if(modalOpen()||!event.dataTransfer)return
      const read=readTransfer(event.dataTransfer)
      if(!dropTarget(event)&&!read.files.length&&!read.urls.length)return
      event.preventDefault()
      if(!pending&&read.files.length){add(read.files);return}
      pending++;setImporting(true)
      queue=queue.then(async()=>{
        if(!live)return
        try{
          const files=await resolveTransfer(read)
          if(live)add(files)
        }catch(error){if(live)setError(error.message)}
        finally{if(--pending===0&&live)setImporting(false)}
      })
    }
    function paste(event){
      if(modalOpen())return
      const files=filesFromClipboard(event.clipboardData)
      if(files.length){event.preventDefault();add(files)}
    }
    function escape(event){if(event.key==='Escape')reset()}
    const listeners={dragenter:enter,dragover:over,dragleave:leave,drop,paste,dragend:reset,blur:reset,keydown:escape}
    for(const [type,handler] of Object.entries(listeners))window.addEventListener(type,handler,true)
    return ()=>{
      for(const [type,handler] of Object.entries(listeners))window.removeEventListener(type,handler,true)
      live=false;reset();setImporting(false)
    }
  },[active,blocked,add,account?.id])
  function release(url){URL.revokeObjectURL(url);urls.current.delete(url)}
  function movePhoto(source,target){
    setPhotos(current=>{
      const from=current.findIndex(p=>p.url===source),to=current.findIndex(p=>p.url===target)
      if(from<0||to<0||from===to)return current
      const next=[...current]
      const [photo]=next.splice(from,1)
      next.splice(to,0,photo)
      return next
    })
  }
  function removePhoto(photo){
    release(photo.url)
    setPhotos(current=>current.filter(p=>p.url!==photo.url))
  }
  function start(event){
    event.preventDefault()
    if(blocked||importing||!account?.brand||!photos.length)return
    const fields={...emptyListing(),sku:sku.trim(),price,size_text:size.trim(),account_id:account.id}
    try{
      queueIntake(owner,crypto.randomUUID(),fields,photos.map(photo=>photo.file))
    }catch(error){setError(error.message);return}
    flushSync(()=>{
      setPhotos([]);setSku('');setPrice('');setSizeOverride(null);setError('')
      onQueued(fields.sku)
    })
    skuInput.current?.focus({preventScroll:true})
    skuInput.current?.scrollIntoView({block:'center',behavior:'instant'})
    photos.forEach(photo=>release(photo.url))
  }
  return <section className="bs-panel bs-entry"><div className="bs-panel-head"><h2>Nouvelle annonce</h2><button type="button" className="bs-link" disabled={!!account&&blocked} onClick={onDetailed}>Formulaire détaillé</button></div>
    <form onSubmit={start}><fieldset disabled={blocked}>
      <label className="sc-field"><span>SKU (facultatif)</span><input ref={skuInput} maxLength={200} value={sku} onChange={e=>setSku(e.target.value)} placeholder="Référence de la pièce"/></label>
      <div className="bs-pair"><label className="sc-field"><span>Prix (€)</span><input type="number" required min=".01" max="99999.99" step=".01" inputMode="decimal" value={price} onChange={e=>setPrice(e.target.value)} placeholder="0,00"/></label>
      <label className="sc-field"><span>Taille sur l’étiquette</span><input list="bs-sizes" required maxLength={80} value={size} onChange={e=>setSizeOverride({account:account?.id,value:e.target.value})}/><datalist id="bs-sizes">{clothingSizeSuggestions.map(s=><option key={s} value={s}/>)}</datalist></label></div>
      <label className="bs-drop">
        <strong>Ajouter les photos</strong><span>Glisse-les dans la fenêtre ou choisis tes fichiers</span>
        <input type="file" aria-label="Ajouter les photos" multiple accept="image/jpeg,image/png,image/webp" onChange={e=>{add([...e.target.files]);e.target.value=''}}/>
      </label>
      {draggingFiles&&active&&!blocked&&createPortal(<div className="bs-drop-overlay" role="status">
        <div><strong>Dépose les photos ici</strong><span>Nouvelle annonce{account?.login?' · '+account.login:''}</span></div>
      </div>,document.body)}
      {photos.length>0&&<BatchPhotoOrder photos={photos} onMove={movePhoto} onRemove={removePhoto}/>}
      <p className="bs-meta">{photos.length>1?'Glisse les photos pour changer leur ordre.':'La première photo sera la couverture.'} Colis petit.</p>
      {error&&<p className="sc-error" role="alert">{error}</p>}
      <button className="sc-primary bs-submit" disabled={importing||!account?.brand||!(Number(price)>0)||!size.trim()||!photos.length}>{importing?'Ajout des photos…':'Remplir l’annonce'}</button>
    </fieldset></form>
  </section>
}
