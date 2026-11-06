import {useState,useSyncExternalStore} from 'react'
import {getRunnerState,subscribeRunner,stopRunner} from '../lib/publicationRunner'

// Rappel affiché sur tous les écrans sauf Publication : l'envoi continue en arrière-plan.
export default function PublicationRunnerBadge({onOpen}){
 const run=useSyncExternalStore(subscribeRunner,getRunnerState)
 const [closed,setClosed]=useState(0)
 const p=run.progress
 if(run.running){
  const text=p?.phase==='reserve'?`Réservation des créneaux ${p.index}/${p.total}`:p?.phase==='cancel'?`Annulation ${p.index}/${p.total}`:p?`Envoi à Dotb ${p.index}/${p.total}`:'Envoi en cours…'
  return <div role="status" className="fixed bottom-4 right-4 z-40 w-72 rounded-2xl border border-teal-200 bg-white p-3 shadow-lg text-sm text-slate-700">
   <p className="font-medium text-teal-800">{text}</p>
   <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-slate-100"><div className="h-full bg-teal-600 transition-all" style={{width:`${p?Math.round(p.index/p.total*100):5}%`}}/></div>
   <p className="mt-2 text-xs text-slate-500">Tu peux changer d’onglet : l’envoi continue. Garde le site ouvert.</p>
   <div className="mt-2 flex gap-3 text-xs"><button type="button" className="font-medium text-teal-700 underline" onClick={onOpen}>Voir Publication</button><button type="button" className="text-slate-500 underline" onClick={stopRunner}>Arrêter</button></div>
  </div>
 }
 if(!run.finished||run.finished===closed||!(run.notice||run.error))return null
 return <div role="status" className={`fixed bottom-4 right-4 z-40 w-72 rounded-2xl border bg-white p-3 shadow-lg text-sm ${run.error?'border-red-200 text-red-800':'border-teal-200 text-slate-700'}`}>
  <p>{run.error||run.notice}</p>
  <div className="mt-2 flex gap-3 text-xs"><button type="button" className="font-medium text-teal-700 underline" onClick={onOpen}>Voir Publication</button><button type="button" className="text-slate-500 underline" onClick={()=>setClosed(run.finished)}>Fermer</button></div>
 </div>
}
