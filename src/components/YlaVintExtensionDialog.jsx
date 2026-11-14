import {useEffect,useRef,useState} from 'react'
import {buttonClass,primaryClass,fieldClass,Pill} from './YlaVintUI'
import {extensionLabels,toPrepare} from '../lib/ylavintOperations'

export const canRequestExtension=o=>o.source==='desktop'&&o.conversation_id&&toPrepare(o)&&['unknown','available','cancelled'].includes(o.extension?.state||'unknown')
export function ExtensionStatus({order,onRequest}){
 const state=order.extension?.state||'unknown'
 return <div className="space-y-2"><Pill tone={state==='accepted'?'green':['failed','declined'].includes(state)?'red':state==='pending'?'violet':'zinc'}>{extensionLabels[state]||state}</Pill>{canRequestExtension(order)&&<button className="block text-sm text-blue-300 hover:underline" onClick={()=>onRequest(order)}>Demander un délai</button>}</div>
}
export function OperationsDialog({title,children,onClose,busy=false}){
 const ref=useRef(null)
 useEffect(()=>{const previous=document.activeElement;ref.current?.showModal();return()=>previous?.focus?.()},[])
 return <dialog ref={ref} onCancel={e=>{e.preventDefault();if(!busy)onClose()}} aria-label={title} className="ylv w-[min(680px,94vw)] max-h-[90vh] overflow-y-auto rounded-2xl border border-zinc-700 bg-zinc-950 p-0 text-zinc-100 backdrop:bg-black/70"><header className="flex items-center justify-between gap-3 border-b border-zinc-800 p-5"><h2 className="text-lg font-semibold">{title}</h2><button autoFocus className={buttonClass} disabled={busy} onClick={onClose} aria-label="Fermer">×</button></header><div className="space-y-4 p-5">{children}</div></dialog>
}
export default function YlaVintExtensionDialog({order,request,onClose,onSaved}){
 const [days,setDays]=useState(3),[reason,setReason]=useState(''),[busy,setBusy]=useState(false),[error,setError]=useState('')
 async function submit(e){e.preventDefault();setBusy(true);setError('');try{const r=await request('POST',{action:'request_extension',account_id:order.account_id,conversation_id:order.conversation_id,days,reason});onSaved(r);onClose()}catch(e){setError(e.message)}finally{setBusy(false)}}
 return <OperationsDialog title="Demander une prolongation" onClose={onClose} busy={busy}><p className="text-sm text-zinc-300">{order.title}<br/><span className="text-blue-300">Compte {order.login}</span></p><form onSubmit={submit} className="space-y-4"><fieldset disabled={busy} className="space-y-4"><legend className="mb-3 text-sm">Délai supplémentaire</legend><div className="grid grid-cols-2 gap-3">{[3,5].map(n=><label key={n} className={`cursor-pointer rounded-xl border p-4 ${days===n?'border-blue-400 bg-blue-500/10':'border-zinc-700'}`}><input type="radio" name="extension-days" value={n} checked={days===n} onChange={()=>setDays(n)} className="mr-2 accent-blue-500"/>+{n} jours ouvrés</label>)}</div><label className="block text-sm">Message à l’acheteur <span className="text-zinc-500">· facultatif</span><textarea className={fieldClass+' mt-2'} value={reason} onChange={e=>setReason(e.target.value)} maxLength={200} rows={3} placeholder="Explique le motif réel de ta demande…"/><span className="mt-1 block text-right text-xs text-zinc-500">{reason.length}/200</span></label></fieldset><p className="rounded-xl bg-blue-500/10 p-3 text-xs leading-relaxed text-blue-200">L’assistant ouvrira la vente, relira le délai et remplira le formulaire Vinted. L’acheteur devra accepter pour prolonger le délai. La demande respecte le planning du compte et ne part que lorsque son assistant est démarré.</p>{error&&<p role="alert" className="text-sm text-rose-400">{error}</p>}<button className={primaryClass+' w-full'} disabled={busy}>{busy?'Préparation…':'Confier cette demande à l’assistant'}</button></form></OperationsDialog>
}
