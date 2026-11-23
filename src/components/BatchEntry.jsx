import {useEffect,useRef,useState} from 'react'
import {act} from '../lib/scalency'
import {uploadListingPhoto} from '../lib/api'
import {emptyListing,validateListingPhoto} from '../lib/listingStudio'

export default function BatchEntry({account,onSaved,onDetailed,onBusy}){
  const [sku,setSku]=useState(''),[price,setPrice]=useState(''),[size,setSize]=useState('M')
  const [photos,setPhotos]=useState([]),[busy,setBusy]=useState(false),[error,setError]=useState('')
  const urls=useRef(new Set()),gate=useRef(false),id=useRef(crypto.randomUUID()),skuInput=useRef(null)
  useEffect(()=>()=>{for(const url of urls.current)URL.revokeObjectURL(url)},[])
  function add(files){
    if(gate.current)return
    try{
      if(photos.length+files.length>20)throw Error('Tu peux ajouter jusqu’à 20 photos par annonce.')
      files.forEach(validateListingPhoto)
      const next=files.map(file=>{const url=URL.createObjectURL(file);urls.current.add(url);return {file,url}})
      setPhotos(prev=>[...prev,...next]);setError('')
    }catch(e){setError(e.message)}
  }
  function release(url){URL.revokeObjectURL(url);urls.current.delete(url)}
  async function start(event){
    event.preventDefault()
    if(gate.current||!account?.brand||!photos.length)return
    gate.current=true;setBusy(true);onBusy(true);setError('')
    try{
      const paths=[]
      for(const photo of photos){
        if(!photo.uploaded)photo.uploaded=await uploadListingPhoto(photo.file)
        paths.push(photo.uploaded)
      }
      const fields={...emptyListing(),sku:sku.trim(),price,size_text:size.trim(),account_id:account.id}
      const saved=await act('save',{id:id.current,version:null,fields,photos:paths})
      onSaved(saved)
      photos.forEach(p=>release(p.url));setPhotos([]);setSku('');setPrice('');setSize('M');id.current=crypto.randomUUID()
      requestAnimationFrame(()=>skuInput.current?.focus())
    }catch(e){setError(e.message)}
    finally{gate.current=false;setBusy(false);onBusy(false)}
  }
  return <section className="bs-panel bs-entry"><div className="bs-panel-head"><h2>Nouvelle annonce</h2><button type="button" className="bs-link" disabled={busy} onClick={onDetailed}>Formulaire détaillé</button></div>
    <form onSubmit={start}><fieldset disabled={busy}>
      <label className="sc-field"><span>SKU</span><input ref={skuInput} required maxLength={200} value={sku} onChange={e=>setSku(e.target.value)} placeholder="Référence de la pièce"/></label>
      <div className="bs-pair"><label className="sc-field"><span>Prix (€)</span><input type="number" required min=".01" max="99999.99" step=".01" inputMode="decimal" value={price} onChange={e=>setPrice(e.target.value)} placeholder="0,00"/></label>
      <label className="sc-field"><span>Taille sur l’étiquette</span><input list="bs-sizes" required maxLength={80} value={size} onChange={e=>setSize(e.target.value)}/><datalist id="bs-sizes">{['XXS','XS','S','M','L','XL','XXL','3XL','Taille unique'].map(s=><option key={s} value={s}/>)}</datalist></label></div>
      <label className="bs-drop" onDragOver={e=>e.preventDefault()} onDrop={e=>{e.preventDefault();add([...e.dataTransfer.files])}}>
        <strong>Ajouter les photos</strong><span>Glisse-les ici ou choisis tes fichiers</span>
        <input type="file" aria-label="Ajouter les photos" multiple accept="image/jpeg,image/png,image/webp" onChange={e=>{add([...e.target.files]);e.target.value=''}}/>
      </label>
      {photos.length>0&&<div className="bs-photos">{photos.map((p,i)=><div key={p.url}><img src={p.url} alt={'Photo '+(i+1)}/><button type="button" aria-label={'Retirer la photo '+(i+1)} onClick={()=>{release(p.url);setPhotos(old=>old.filter(x=>x!==p))}}>×</button></div>)}</div>}
      <p className="bs-meta">La première photo sera la couverture. Colis petit.</p>
      {error&&<p className="sc-error" role="alert">{error}</p>}
      <button className="sc-primary bs-submit" disabled={!account?.brand||!sku.trim()||!(Number(price)>0)||!size.trim()||!photos.length}>{busy?'Enregistrement des photos…':'Remplir l’annonce'}</button>
    </fieldset></form>
  </section>
}
