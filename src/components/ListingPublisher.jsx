import {useState} from 'react'
import {listingStateLabels} from '../lib/listingStudio'

export default function ListingPublisher({value,onChange,disabled=false,ylavint,dotb,compact=false,accountId,onEnabled,mode,onEdit}){
 const name=`publisher-${compact?'compact':'full'}`
 const [enabling,setEnabling]=useState(false),[enableError,setEnableError]=useState('')
 // YlaVint ou la publication coupés sur ce compte : on les allume d'ici, sans passer par les réglages.
 const canEnable=value==='ylavint'&&ylavint&&!ylavint.ready&&accountId&&/^Active /.test(ylavint.reason||'')
 const enable=async()=>{setEnabling(true);setEnableError('');try{await (await import('../lib/api')).resourcesRequest('POST',{action:'enable_publish',account_id:accountId},'?scope=agent');await onEnabled?.()}catch(e){setEnableError(e.message)}finally{setEnabling(false)}}
 return <fieldset disabled={disabled} className="space-y-2">
  {onChange?<><legend className="mb-2 text-sm font-semibold">Publier avec</legend>
  <div className="grid gap-2 sm:grid-cols-2">{[['ylavint','YlaVint','Ton extension dans le profil AdsPower ciblé.'],['dotb','Dotb','Le parcours Dotb reste disponible.']].map(([id,label,hint])=><label key={id} className={`flex cursor-pointer items-start gap-3 rounded-xl border p-3 text-sm ${value===id?'border-teal-600 bg-teal-50':'border-slate-200 bg-white'}`}>
   <input type="radio" name={name} value={id} checked={value===id} onChange={()=>onChange(id)} className="mt-1 accent-teal-700"/>
   <span><strong className="block">{label}</strong><span className="mt-1 block text-xs text-slate-600">{hint}</span></span>
  </label>)}</div></>
  :<div className="flex items-center justify-between gap-2 rounded-xl border border-teal-200 bg-teal-50 px-3 py-2.5 text-sm"><span><strong>{value==='ylavint'?'YlaVint':'Dotb'}</strong> · {mode==='draft'?'brouillon Vinted':'en ligne'}</span>{onEdit&&<button type="button" className="text-xs font-medium text-teal-800 underline underline-offset-4" onClick={onEdit}>Modifier</button>}</div>}
  {value==='ylavint'&&ylavint&&<p role="status" className="text-xs text-slate-600">{ylavint.waiting||ylavint.reason||'Bridge YlaVint présent.'} {ylavint.ready&&`Plafond : ${ylavint.limit} publication(s) par jour. ${ylavint.from_hour===ylavint.to_hour?'Toute la journée.':`Créneau : ${ylavint.from_hour} h – ${ylavint.to_hour} h.`}`} {!ylavint.ready&&<a href="/ylavint" target="_blank" rel="noreferrer" className="underline">Ouvrir les réglages YlaVint ↗</a>}</p>}
  {canEnable&&<button type="button" className="w-full rounded-xl bg-teal-700 px-4 py-2.5 text-sm font-semibold text-white hover:bg-teal-800 disabled:opacity-50" disabled={enabling} onClick={enable}>{enabling?'Activation…':'Activer la publication YlaVint sur ce compte'}</button>}
  {enableError&&<p role="alert" className="text-xs text-red-700">{enableError}</p>}
  {value==='dotb'&&dotb===false&&<p className="text-xs text-amber-800">Dotb est désactivé pour ce compte ou sur le site. Tes réglages Dotb sont conservés pour le réutiliser plus tard.</p>}
 </fieldset>
}

export function YlavintTransfer({draft,busy,onRefresh,onCancel}){
 return <section aria-label="Suivi YlaVint" className="space-y-3 rounded-2xl border border-teal-200 bg-white p-4 sm:p-5">
  <h2 className="font-semibold text-teal-900">YlaVint · {listingStateLabels[draft.state]}</h2>
  <p role="status" className={`rounded-xl p-3 text-sm ${draft.state==='attention'?'bg-amber-50 text-amber-950':'bg-teal-50 text-teal-950'}`}>{draft.message||draft.last_error||'En attente du profil AdsPower.'}</p>
  {draft.state==='attention'&&<p className="text-sm text-amber-900">Vérifie le dressing et les brouillons du compte ciblé. Cet envoi ne sera pas rejoué automatiquement.</p>}
  {draft.state==='vinted_draft'&&<p className="text-sm text-slate-600">Le brouillon est privé sur Vinted. Ouvre les brouillons du compte ciblé pour le vérifier et le publier.</p>}
  <div className="flex flex-wrap gap-3 text-sm">{['scheduled','preparing','attention'].includes(draft.state)&&<button type="button" className="rounded-xl border px-4 py-2 disabled:opacity-50" disabled={!!busy} onClick={onRefresh}>Actualiser le suivi</button>}
   {draft.can_cancel&&onCancel&&<button type="button" className="rounded-xl border px-4 py-2 disabled:opacity-50" disabled={!!busy} onClick={onCancel}>Annuler avant l’envoi</button>}
   {draft.url&&<a className="rounded-xl bg-teal-700 px-4 py-2 text-white" href={draft.url} target="_blank" rel="noreferrer">Voir l’annonce ↗</a>}
  </div>
 </section>
}
