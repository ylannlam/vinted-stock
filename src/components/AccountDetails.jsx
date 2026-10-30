import { useEffect, useRef, useState } from 'react'
import { CREATION_STAGES, accountDeadline, nextCreationStep, readyWithoutTracking } from '../lib/accountTracking'
import { nextAccountAction } from '../lib/accountOverview'

export function CopyValue({value,label='Copier'}) {
  const [message,setMessage]=useState('')
  useEffect(()=>{if(!message)return;const timer=setTimeout(()=>setMessage(''),2000);return()=>clearTimeout(timer)},[message])
  if(!value)return null
  return <button type="button" title={label} aria-label={label} className="shrink-0 text-gray-400 hover:text-teal-600 text-[10px]" onClick={async()=>{try{await navigator.clipboard.writeText(String(value));setMessage('Copié')}catch{setMessage('Copie indisponible')}}}>{message||<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true"><rect x="8" y="8" width="12" height="13" rx="2"/><path d="M16 8V5a2 2 0 0 0-2-2H5a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h3"/></svg>}</button>
}

export default function AccountDetails({account,busy,error,now,onClose,onEdit,onAdvance,onDelete,onShadowban,onMarkReady}) {
  const dialog=useRef(null)
  const [reveal,setReveal]=useState(false),[confirmDelete,setConfirmDelete]=useState(false)
  useEffect(()=>{const element=dialog.current;element.showModal();return()=>element.close()},[])
  function info(label,value,copy=false){return <div><dt className="text-[11px] text-gray-400 mb-1">{label}</dt><dd className="text-sm text-gray-800 break-words flex items-center gap-2"><span>{value||'Non renseigné'}</span>{copy&&<CopyValue value={value} label={`Copier ${label.toLowerCase()}`}/>}</dd></div>}
  return <dialog ref={dialog} aria-labelledby="account-details-title" onCancel={onClose} onClick={e=>{if(e.target===e.currentTarget)onClose()}} className="fixed inset-y-0 left-auto right-0 m-0 h-full max-h-none w-full max-w-md border-0 p-0 bg-white shadow-2xl backdrop:bg-black/30">
    <div className="flex flex-col h-full" onClick={e=>e.stopPropagation()}>
      <header className="p-5 border-b border-gray-100 flex justify-between items-start gap-3"><div><p className="text-xs text-gray-400 mb-1">Fiche du compte {account.ads_power_num?`· AdsPower #${account.ads_power_num}`:''}</p><h2 id="account-details-title" className="text-xl font-bold text-gray-900 break-all">{account.pseudo}</h2></div><button autoFocus onClick={onClose} aria-label="Fermer la fiche" className="w-8 h-8 bg-gray-100 rounded-full text-gray-500">×</button></header>
      <div className="flex-1 overflow-y-auto p-5 space-y-6">
        {error&&<p role="alert" className="bg-red-50 text-red-700 rounded-lg p-3 text-sm">{error}</p>}
        <section className="bg-gray-50 border border-gray-200 rounded-xl p-4"><p className="text-xs text-gray-500">Prochaine étape</p><h3 className="font-semibold text-gray-900 mt-1">{nextAccountAction(account)}</h3>{accountDeadline(account,now)&&<p className="text-xs text-gray-500 mt-2">{accountDeadline(account,now)}</p>}
          {readyWithoutTracking(account)&&<div className="mt-3"><p className="text-xs text-gray-500 mb-2">Si ce compte est déjà préparé, tu peux le sortir de l’isolement.</p><button disabled={busy} onClick={()=>onMarkReady(account)} className="px-3 py-2 text-xs font-semibold bg-teal-500 text-white rounded-lg disabled:opacity-50">Marquer comme prêt</button></div>}
          {nextCreationStep(account,now)&&<button disabled={busy} onClick={()=>onAdvance(account)} className="mt-3 px-3 py-2 text-xs font-semibold bg-teal-500 text-white rounded-lg disabled:opacity-50">{{post1:'Confirmer la 1re annonce postée',post2:'Confirmer la 2e annonce postée',wait:'Sortir de l’isolement · compte prêt'}[account.creation_stage]}</button>}
        </section>
        <section><h3 className="font-semibold text-sm text-gray-900 mb-3">Connexion et coordonnées</h3><dl className="grid grid-cols-2 gap-4">
          <div className="col-span-2">{info('Email',account.email,true)}</div>{info('Téléphone',account.telephone,true)}{info('Connexion',account.methode_connexion)}
          {account.telephone_type&&info('Service téléphone',account.telephone_type==='onoff'?'OnOff':account.telephone_type)}{account.telephone_email&&info('Email du service',account.telephone_email,true)}
          {account.password&&<div className="col-span-2"><dt className="text-[11px] text-gray-400 mb-1">Mot de passe</dt><dd className="flex flex-wrap items-center gap-3"><span className="font-mono text-sm break-all">{reveal?account.password:'••••••••'}</span><button onClick={()=>setReveal(!reveal)} className="text-xs text-teal-600">{reveal?'Masquer':'Afficher'}</button><CopyValue value={account.password} label="Copier le mot de passe"/></dd></div>}
        </dl></section>
        <section><h3 className="font-semibold text-sm text-gray-900 mb-3">Environnement</h3><dl className="grid grid-cols-2 gap-4 mb-3">{info('Profil AdsPower',account.ads_power_num?`#${account.ads_power_num}`:null)}{info('Navigateur',account.browser)}</dl>
        </section>
        <section><h3 className="font-semibold text-sm text-gray-900 mb-3">Suivi</h3><dl className="grid grid-cols-2 gap-4">{info('Statut Vinted',({actif:'Actif',en_preparation:'En préparation',banni_temp:'Banni temporairement',banni_def:'Banni définitivement',suspendu:'Suspendu'})[account.statut]||account.statut)}{info('Étape interne',CREATION_STAGES.find(s=>s.value===account.creation_stage)?.label)}{info('Créé le',account.created_at?new Date(account.created_at).toLocaleDateString('fr-FR'):null)}{info('Échéance',account.creation_next_at?new Date(account.creation_next_at).toLocaleString('fr-FR'):null)}{account.deban_at&&info('Fin de bannissement prévue',new Date(account.deban_at).toLocaleDateString('fr-FR'))}</dl></section>
        <section><h3 className="font-semibold text-sm text-gray-900 mb-2">Notes</h3><p className="text-sm text-gray-500 whitespace-pre-wrap break-words">{account.notes||'Aucune note.'}</p></section>
        {!account.is_shadowbanned&&<button disabled={busy} onClick={onShadowban} className="w-full border border-gray-300 bg-gray-100 text-gray-700 rounded-lg px-3 py-2 text-sm font-semibold disabled:opacity-40">Classer en Shadowban · ne plus utiliser</button>}
        {confirmDelete?<div className="bg-red-50 p-3 rounded-lg text-sm text-red-700"><p>Supprimer définitivement « {account.pseudo} » du suivi ?</p><p className="mt-1 text-xs">Cela ne ferme pas le compte sur Vinted.</p><div className="flex gap-3 mt-3"><button disabled={busy} onClick={()=>onDelete(account.id)} className="font-semibold disabled:opacity-40">{busy?'Suppression…':'Confirmer la suppression'}</button><button disabled={busy} onClick={()=>setConfirmDelete(false)}>Annuler</button></div></div>:<button disabled={busy} onClick={()=>setConfirmDelete(true)} className="text-sm text-red-600 border border-red-200 rounded-lg px-3 py-2 hover:bg-red-50 disabled:opacity-40">Supprimer ce compte</button>}
      </div>
      <footer className="border-t border-gray-100 p-4 bg-white"><button disabled={busy} onClick={()=>onEdit(account)} className="w-full bg-teal-500 text-white rounded-lg py-2.5 text-sm font-semibold disabled:opacity-50">Modifier le compte</button></footer>
    </div>
  </dialog>
}
