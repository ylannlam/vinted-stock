import {useEffect,useRef,useState} from 'react'
import {createPortal,flushSync} from 'react-dom'
import {queueIntake} from '../lib/batchIntake'
import {clothingSizeSuggestions,emptyListing,MAX_LISTING_PHOTOS,validateListingPhoto} from '../lib/listingStudio'
import {fetchImage,filesFromClipboard,hasTransferImage,readTransfer} from '../lib/dropFiles'

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
  const intake=useRef(null)
  useEffect(()=>()=>{for(const url of urls.current)URL.revokeObjectURL(url)},[])
  useEffect(()=>{
    if(!active||blocked)return
    let depth=0,hideTimer,session
    function reset(){clearTimeout(hideTimer);depth=0;setDraggingFiles(false)}
    function show(){
      setDraggingFiles(true)
      clearTimeout(hideTimer)
      // External drags can end in the source tab without delivering dragend here.
      hideTimer=setTimeout(reset,1500)
    }
    function cancel(){
      session?.controller.abort()
      session={controller:new AbortController(),reserved:0,queue:Promise.resolve()}
      setImporting(false)
    }
    cancel()
    function append(file){
      const url=URL.createObjectURL(file)
      urls.current.add(url)
      setPhotos(prev=>[...prev,{file,url}])
    }
    function receive({files,urls:addresses}){
      const current=session,signal=current.controller.signal
      let warning=''
      const valid=files.filter(file=>{
        try{validateListingPhoto(file);return true}
        catch(e){warning=e.message;return false}
      })
      const entries=[...valid,...addresses]
      const available=MAX_LISTING_PHOTOS-urls.current.size-current.reserved
      if(entries.length>available)warning='Maximum '+MAX_LISTING_PHOTOS+' photos par annonce. Les photos en trop ont été écartées.'
      if(!entries.length&&!warning)warning='Aucune photo reconnue. Glisse une image ou colle-la avec Ctrl+V.'
      setError(warning)
      for(const item of entries.slice(0,Math.max(0,available))){
        if(typeof item!=='string'&&!current.reserved){append(item);continue}
        current.reserved++
        setImporting(true)
        current.queue=current.queue.then(async()=>{
          try{
            if(signal.aborted)return
            const file=typeof item==='string'?await fetchImage(item,fetch,signal):item
            if(!signal.aborted){validateListingPhoto(file);append(file)}
          }catch(e){if(!signal.aborted)setError(e.message)}
          finally{if(--current.reserved===0&&!signal.aborted)setImporting(false)}
        })
      }
    }
    intake.current={receive,cancel}
    function modalOpen(){return !!document.querySelector('[aria-modal="true"],dialog[open]')}
    function dropTarget(event){
      const transfer=event.dataTransfer
      return (hasTransferImage(transfer)||transfer?.files?.length>0)&&!modalOpen()
    }
    function enter(event){
      if(!dropTarget(event))return
      event.preventDefault();depth++;show()
    }
    function over(event){
      if(!dropTarget(event)){
        // Chrome only makes HTML/plain image data readable in drop, after dragover is accepted.
        const types=Array.from(event.dataTransfer?.types||[])
        if(!modalOpen()&&types.some(t=>t==='text/html'||t==='text/plain'||t==='DownloadURL'))event.preventDefault()
        return
      }
      event.preventDefault()
      event.dataTransfer.dropEffect='copy'
      show()
    }
    function leave(){
      depth=Math.max(0,depth-1)
      if(!depth)reset()
    }
    function drop(event){
      reset()
      if(modalOpen()||!event.dataTransfer)return
      const read=readTransfer(event.dataTransfer)
      if(!dropTarget(event)&&!read.files.length&&!read.urls.length)return
      event.preventDefault()
      receive(read)
    }
    function paste(event){
      if(modalOpen())return
      const files=filesFromClipboard(event.clipboardData)
      if(files.length){event.preventDefault();receive({files,urls:[]})}
    }
    function escape(event){if(event.key==='Escape')reset()}
    const listeners={dragenter:enter,dragover:over,dragleave:leave,drop,paste,dragend:reset,blur:reset,keydown:escape}
    for(const [type,handler] of Object.entries(listeners))window.addEventListener(type,handler,true)
    return ()=>{
      for(const [type,handler] of Object.entries(listeners))window.removeEventListener(type,handler,true)
      intake.current=null;session.controller.abort();reset();setImporting(false)
    }
  },[active,blocked,account?.id])
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
    let draftId
    try{
      draftId=crypto.randomUUID()
      queueIntake(owner,draftId,fields,photos.map(photo=>photo.file))
    }catch(error){setError(error.message);return}
    flushSync(()=>{
      setPhotos([]);setSku('');setPrice('');setSizeOverride(null);setError('')
      onQueued(fields.sku,draftId)
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
        <input type="file" aria-label="Ajouter les photos" multiple accept="image/jpeg,image/png,image/webp" onChange={e=>{if(e.target.files.length)intake.current?.receive({files:[...e.target.files],urls:[]});e.target.value=''}}/>
      </label>
      {draggingFiles&&active&&!blocked&&createPortal(<div className="bs-drop-overlay" role="status">
        <div><strong>Dépose les photos ici</strong><span>Nouvelle annonce{account?.login?' · '+account.login:''}</span></div>
      </div>,document.body)}
      {photos.length>0&&<BatchPhotoOrder photos={photos} onMove={movePhoto} onRemove={removePhoto}/>}
      {importing&&<button type="button" className="bs-link" onClick={()=>intake.current?.cancel()}>Annuler l’import en cours</button>}
      <p className="bs-meta">{photos.length>1?'Glisse les photos pour changer leur ordre.':'La première photo sera la couverture.'} Colis petit.</p>
      {error&&<p className="sc-error" role="alert">{error}</p>}
      <button className="sc-primary bs-submit" disabled={importing||!account?.brand||!(Number(price)>0)||!size.trim()||!photos.length}>{importing?'Ajout des photos…':'Remplir l’annonce'}</button>
    </fieldset></form>
  </section>
}
