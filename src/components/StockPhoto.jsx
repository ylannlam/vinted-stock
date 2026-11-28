import {useState} from 'react'

export default function StockPhoto({item,supplierPhoto,faded,onEdit}) {
  const [failed,setFailed]=useState([])
  const [zoom,setZoom]=useState(null)
  const src=[item.photo_url,supplierPhoto].find(url=>url&&!failed.includes(url))
  const supplier=src&&src!==item.photo_url
  const title=[supplier?'Photo fournisseur':'Photo de l’article',item.size,item.emplacement].filter(Boolean).join(' · ')
  function unavailable(){
    setFailed(previous=>previous.includes(src)?previous:[...previous,src])
    setZoom(null)
  }
  if(!src)return <div className="flex h-full w-full flex-col items-center justify-center gap-2 bg-stone-50 px-6 text-center text-sm text-slate-600">
    <svg className="h-8 w-8 text-slate-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" aria-hidden="true">
      <rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="9" cy="9" r="1.5"/><path d="m3 17 5-5 4 4 4-5 5 6"/>
    </svg>
    <span>{failed.length?'Photo indisponible':'Aucune photo'}</span>
    {onEdit&&<button type="button" className="rounded text-xs font-semibold text-teal-800 underline underline-offset-2" onClick={()=>onEdit(item)}>Ajouter une photo</button>}
  </div>
  return <>
    <button type="button" aria-label={'Agrandir · '+title} className="relative block h-full w-full cursor-zoom-in" onClick={()=>setZoom(src)}>
      <img key={src} src={src} alt={title} loading="lazy" referrerPolicy="no-referrer" onError={unavailable}
        className={'h-full w-full object-contain'+(faded?' opacity-70':'')}/>
      {supplier&&<span className="absolute bottom-2 left-1/2 -translate-x-1/2 whitespace-nowrap rounded bg-white/95 px-2 py-1 text-[10px] font-medium text-teal-900 shadow-sm">Photo fournisseur</span>}
    </button>
    {zoom===src&&<dialog aria-label={title} ref={node=>{if(node&&!node.open)node.showModal()}}
      onCancel={()=>setZoom(null)} onClick={e=>{if(e.target===e.currentTarget)setZoom(null)}}
      className="fixed inset-0 m-0 h-full w-full max-h-none max-w-none items-center justify-center bg-transparent p-4 open:flex backdrop:bg-black/80">
      <img src={src} alt={title} referrerPolicy="no-referrer" onError={unavailable} className="max-h-full max-w-full rounded-lg object-contain"/>
      <button type="button" aria-label="Fermer" onClick={()=>setZoom(null)} className="absolute right-4 top-4 grid h-10 w-10 place-items-center rounded-full bg-white text-2xl text-slate-800">×</button>
    </dialog>}
  </>
}
