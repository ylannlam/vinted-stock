import {useEffect,useRef,useState} from 'react'
import ResourceDialog from './ResourceDialog'
import {ErrorNotice,buttonClass,primaryClass} from './WorkspaceUI'
import {safeUrl} from '../lib/fulfillment'

export default function ShippingLabelDialog({line,request,onClose}) {
  const [label,setLabel]=useState(null),[error,setError]=useState(''),[attempt,setAttempt]=useState(0),[ready,setReady]=useState(false)
  const frame=useRef(null)
  useEffect(()=>{
    let active=true,url
    setLabel(null);setError('');setReady(false)
    request('POST',{action:'shipping_label',id:line.id}).then(result=>{
      if(!active)return
      const bytes=Uint8Array.from(atob(result.pdf),c=>c.charCodeAt(0))
      url=URL.createObjectURL(new Blob([bytes],{type:'application/pdf'}))
      setLabel({...result,pdf:undefined,url})
    }).catch(e=>{if(active)setError(e.message)})
    return()=>{active=false;if(url)URL.revokeObjectURL(url)}
  },[line.id,request,attempt])
  function print(){
    if(!ready){window.open(label.url,'_blank','noopener,noreferrer');return}
    try{frame.current.contentWindow.focus();frame.current.contentWindow.print()}
    catch{window.open(label.url,'_blank','noopener,noreferrer')}
  }
  return <ResourceDialog title="Bordereau 100 × 150 mm" onClose={onClose}>
    <div className="space-y-4">
      <div><p className="font-medium">{line.source?.title||'Étiquette d’envoi'}</p><p className="text-sm text-slate-500 mt-1">{line.order?.account_login} · Imprimante thermique</p></div>
      {!label&&!error&&<div role="status" className="rounded-xl bg-teal-50 text-teal-900 p-6 flex items-center gap-3"><span className="h-5 w-5 shrink-0 rounded-full border-2 border-teal-200 border-t-teal-700 animate-spin" aria-hidden="true"/>Récupération et découpe du bordereau…</div>}
      <ErrorNotice error={error}/>
      {error&&<div className="flex flex-wrap gap-2"><button type="button" className={primaryClass} onClick={()=>setAttempt(n=>n+1)}>Réessayer</button>{safeUrl(line.order?.label_url)&&<a href={safeUrl(line.order.label_url)} target="_blank" rel="noreferrer" className={buttonClass}>Voir l’original dans Dotb</a>}</div>}
      {label&&<>
        <div className="rounded-xl bg-teal-50 p-4 text-teal-900"><p className="font-semibold">Prêt à imprimer · {label.format}</p><p className="text-sm mt-1">{label.carrier} · Une étiquette, déjà découpée et orientée, avec le titre de l’article en bas.</p></div>
        <div className="flex flex-wrap gap-2"><button type="button" className={primaryClass} onClick={print}>Imprimer l’étiquette</button><a className={buttonClass} href={label.url} download={label.filename}>Télécharger le PDF</a><a className={buttonClass} href={label.url} target="_blank" rel="noreferrer">Ouvrir le PDF ↗</a></div>
        <p className="text-xs text-slate-500">À l’impression : papier 100 × 150 mm, taille réelle (100 %), sans marges.</p>
        {label.preview&&<div className="rounded-xl border bg-slate-100 p-4"><img alt="Aperçu du bordereau découpé en 100 × 150 mm" src={'data:image/png;base64,'+label.preview} className="block mx-auto w-full max-w-[320px] h-auto bg-white shadow-sm"/></div>}
        <iframe ref={frame} title="Document pour l’impression" src={label.url} onLoad={()=>setReady(true)} className="sr-only" tabIndex={-1} aria-hidden="true"/>
      </>}
    </div>
  </ResourceDialog>
}
