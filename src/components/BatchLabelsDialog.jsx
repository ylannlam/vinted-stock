import {useEffect,useRef,useState} from 'react'
import ResourceDialog from './ResourceDialog'
import {buttonClass,primaryClass} from './WorkspaceUI'
import {labelTargets,mergeLabels} from '../lib/batchLabels'

// Plusieurs colis d'un coup : chaque bordereau est préparé l'un après l'autre, puis tout part dans un seul PDF.
export default function BatchLabelsDialog({lines,request,onClose,onPacked}){
 const targets=labelTargets(lines)
 const [states,setStates]=useState(()=>Object.fromEntries(targets.map(l=>[l.id,{state:'waiting'}])))
 const [file,setFile]=useState(null),[ready,setReady]=useState(false),[packing,setPacking]=useState(false),[packed,setPacked]=useState(false),[error,setError]=useState('')
 const frame=useRef(null),stopped=useRef(false)
 useEffect(()=>{
  stopped.current=false
  let url
  ;(async()=>{
   const pdfs=[]
   for(const line of targets){
    if(stopped.current)return
    setStates(s=>({...s,[line.id]:{state:'running'}}))
    try{
     const r=await request('POST',{action:'shipping_label',id:line.id,preview:false})
     pdfs.push(r.pdf);setStates(s=>({...s,[line.id]:{state:'done',carrier:r.carrier}}))
    }catch(e){setStates(s=>({...s,[line.id]:{state:'error',message:e.message}}))}
   }
   if(stopped.current||!pdfs.length)return
   try{
    const bytes=await mergeLabels(pdfs)
    url=URL.createObjectURL(new Blob([bytes],{type:'application/pdf'}))
    setFile({url,count:pdfs.length,name:`bordereaux-${new Date().toISOString().slice(0,10)}-${pdfs.length}.pdf`})
   }catch{setError('Les bordereaux n’ont pas pu être réunis en un seul PDF. Réessaie.')}
  })()
  return()=>{stopped.current=true;if(url)URL.revokeObjectURL(url)}
 },[])
 const done=Object.values(states).filter(s=>s.state==='done').length,failed=targets.filter(l=>states[l.id]?.state==='error')
 const finished=Object.values(states).every(s=>['done','error'].includes(s.state))
 function print(){
  if(!ready){window.open(file.url,'_blank','noopener,noreferrer');return}
  try{frame.current.contentWindow.focus();frame.current.contentWindow.print()}catch{window.open(file.url,'_blank','noopener,noreferrer')}
 }
 async function packAll(){
  setPacking(true);setError('')
  try{for(const l of targets.filter(l=>states[l.id]?.state==='done'))await request('PATCH',{action:'pack',order_id:l.order_id});setPacked(true);onPacked?.()}
  catch(e){setError(e.message)}finally{setPacking(false)}
 }
 return <ResourceDialog title={`${targets.length} bordereau${targets.length>1?'x':''} à imprimer`} onClose={onClose}>
  <div className="space-y-4">
   <div><div className="h-2 rounded-full bg-slate-100 overflow-hidden"><div className="h-full bg-teal-600 transition-all" style={{width:`${Math.round((done+failed.length)/Math.max(1,targets.length)*100)}%`}}/></div>
    <p className="mt-1 text-sm text-slate-600">{finished?`${done} prêt${done>1?'s':''}${failed.length?` · ${failed.length} en erreur`:''}`:`Préparation ${done+failed.length+1} / ${targets.length}…`}</p></div>
   <ul className="max-h-64 overflow-y-auto divide-y rounded-xl border text-sm">{targets.map((l,i)=>{const s=states[l.id];return <li key={l.id} className="flex items-center gap-3 px-3 py-2">
    <span className={`h-6 w-6 shrink-0 grid place-items-center rounded-full text-xs font-bold ${s.state==='done'?'bg-teal-100 text-teal-800':s.state==='error'?'bg-rose-100 text-rose-700':s.state==='running'?'bg-amber-100 text-amber-800':'bg-slate-100 text-slate-500'}`}>{s.state==='done'?'✓':s.state==='error'?'!':i+1}</span>
    <span className="min-w-0 flex-1"><span className="block truncate">{l.source?.title||'Article'}</span><span className="text-xs text-slate-500">{l.account_login||l.order?.account_login}{s.carrier?` · ${s.carrier}`:''}{s.state==='error'?` · ${s.message}`:''}</span></span>
   </li>})}</ul>
   {error&&<p role="alert" className="rounded-lg bg-red-50 p-3 text-sm text-red-800">{error}</p>}
   {file&&<>
    <div className="rounded-xl bg-teal-50 p-4 text-teal-900"><p className="font-semibold">{file.count} bordereau{file.count>1?'x':''} dans un seul PDF · 100 × 150 mm</p><p className="text-sm mt-1">Un bordereau par page, dans l’ordre de la liste, avec le titre de l’article en bas.</p></div>
    <div className="flex flex-wrap gap-2"><button className={primaryClass} onClick={print}>Imprimer les {file.count} bordereaux</button><a className={buttonClass} href={file.url} download={file.name}>Télécharger le PDF</a></div>
    <p className="text-xs text-slate-500">À l’impression : papier 100 × 150 mm, taille réelle (100 %), sans marges.</p>
    {onPacked&&(packed?<p className="text-sm text-teal-800">Colis marqués emballés : pose-les dans « À déposer ».</p>:<button className={buttonClass} disabled={packing} onClick={packAll}>{packing?'Enregistrement…':`Tout marquer emballé (${file.count})`}</button>)}
    <iframe ref={frame} title="Bordereaux à imprimer" src={file.url} onLoad={()=>setReady(true)} className="sr-only" tabIndex={-1} aria-hidden="true"/>
   </>}
  </div>
 </ResourceDialog>
}
