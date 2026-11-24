import {useEffect,useRef,useState} from 'react'
import {flushSync} from 'react-dom'
import {queueIntake} from '../lib/batchIntake'
import {clothingSizeSuggestions,emptyListing,validateListingPhoto} from '../lib/listingStudio'

import BatchPhotoOrder from './BatchPhotoOrder'

export default function BatchEntry({account,owner,blocked,onQueued,onDetailed}){
  const [sku,setSku]=useState(''),[price,setPrice]=useState('')
  const [sizeOverride,setSizeOverride]=useState(null)
  const size=sizeOverride&&sizeOverride.account===account?.id?sizeOverride.value:account?.default_size||'M'
  useEffect(()=>setSizeOverride(null),[account?.id])
  const [photos,setPhotos]=useState([]),[error,setError]=useState('')
  const urls=useRef(new Set()),skuInput=useRef(null)
  useEffect(()=>()=>{for(const url of urls.current)URL.revokeObjectURL(url)},[])
  function add(files){
    if(blocked)return
    try{
      if(photos.length+files.length>20)throw Error('Tu peux ajouter jusqu’à 20 photos par annonce.')
      files.forEach(validateListingPhoto)
      const next=files.map(file=>{const url=URL.createObjectURL(file);urls.current.add(url);return {file,url}})
      setPhotos(prev=>[...prev,...next]);setError('')
    }catch(e){setError(e.message)}
  }
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
    if(blocked||!account?.brand||!photos.length)return
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
      <label className="bs-drop" onDragOver={e=>e.preventDefault()} onDrop={e=>{e.preventDefault();add([...e.dataTransfer.files])}}>
        <strong>Ajouter les photos</strong><span>Glisse-les ici ou choisis tes fichiers</span>
        <input type="file" aria-label="Ajouter les photos" multiple accept="image/jpeg,image/png,image/webp" onChange={e=>{add([...e.target.files]);e.target.value=''}}/>
      </label>
      {photos.length>0&&<BatchPhotoOrder photos={photos} onMove={movePhoto} onRemove={removePhoto}/>}
      <p className="bs-meta">{photos.length>1?'Glisse les photos pour changer leur ordre.':'La première photo sera la couverture.'} Colis petit.</p>
      {error&&<p className="sc-error" role="alert">{error}</p>}
      <button className="sc-primary bs-submit" disabled={!account?.brand||!(Number(price)>0)||!size.trim()||!photos.length}>Remplir l’annonce</button>
    </fieldset></form>
  </section>
}
