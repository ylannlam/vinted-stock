import {parcelState,since,toneClass} from '../lib/parcels'

// Colis Shein de la vente : transporteur, étape, dernière nouvelle.
export default function ParcelStrip({parcel,now=Date.now()}){
 const state=parcelState(parcel)
 if(!state)return null
 const event=parcel.last_event
 return <div className="sale-parcel rounded-xl border border-slate-200 bg-slate-50/70 px-3 py-2" aria-label={`Colis ${parcel.carrier} ${parcel.tracking_number}`}>
  <div className="flex items-center justify-between gap-2">
   <span className={`rounded-full px-2 py-0.5 text-[11px] font-semibold ${toneClass[state.tone]}`}>{parcel.carrier?`${parcel.carrier} · `:''}{state.label}</span>
   {parcel.track_url&&<a className="shrink-0 text-xs font-medium text-teal-700 underline" href={parcel.track_url} target="_blank" rel="noreferrer">Suivre ↗</a>}
  </div>
  {parcel.steps_total>0&&<div className="mt-2 flex gap-1" aria-hidden="true">{Array.from({length:parcel.steps_total},(_,i)=><span key={i} className={`h-1 flex-1 rounded-full ${i<parcel.steps_done?'bg-teal-600':'bg-slate-200'}`}/>)}</div>}
  {event?<p className="mt-1.5 text-xs leading-snug text-slate-600"><span className="font-medium text-slate-700">{since(event.at,now)}{event.place?` · ${event.place}`:''}</span> — {event.text}</p>
   :<p className="mt-1.5 text-xs text-slate-500">{parcel.tracking_number}{parcel.eta?` · livraison prévue ${parcel.eta}`:''}</p>}
 </div>
}
