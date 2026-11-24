import {useEffect,useRef,useState} from 'react'
import {copyText} from '../lib/copyText'

export default function CopySkuButton({sku}){
  const [feedback,setFeedback]=useState('')
  const reset=useRef(null)
  useEffect(()=>()=>clearTimeout(reset.current),[])
  if(sku==null||!String(sku).trim())return null

  async function copy(){
    clearTimeout(reset.current)
    try{
      await copyText(String(sku))
      setFeedback('Copié !')
    }catch{
      setFeedback('Sélectionne le SKU pour le copier.')
    }
    reset.current=setTimeout(()=>setFeedback(''),3500)
  }

  return <span className="shop-copy-control">
    <button type="button" className="shop-copy" onClick={copy} aria-label={'Copier le SKU '+sku}>
      {feedback==='Copié !'?feedback:'Copier'}
    </button>
    <span role="status" className={feedback==='Copié !'?'sr-only':undefined}>{feedback}</span>
  </span>
}
