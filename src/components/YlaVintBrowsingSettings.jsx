import {buttonClass,fieldClass} from './YlaVintUI'
import {DESKTOP_BOUNDS,DESKTOP_LABELS,DRESS_ROUTINE} from '../lib/ylavintExecution'

export default function YlaVintBrowsingSettings({pace,onChange,onPreset}){
 const number=key=><label key={key} className="block text-xs text-zinc-400">{DESKTOP_LABELS[key]}<input type="number" className={fieldClass+' mt-1'} min={DESKTOP_BOUNDS[key][0]} max={DESKTOP_BOUNDS[key][1]} value={pace[key]} onChange={e=>onChange(key,Number(e.target.value))}/></label>
 return <>
  <fieldset className="space-y-4 rounded-xl border border-indigo-400/25 bg-indigo-500/5 p-4"><legend className="text-sm font-semibold text-indigo-200">Consultations et pauses</legend>
   <p className="text-xs leading-relaxed text-zinc-400">Entre des tâches terminées : un passage dans le fil, quelques annonces, puis la reprise du travail. Les messages et formulaires en cours restent prioritaires.</p>
   <div className="rounded-xl border border-indigo-400/20 bg-zinc-950/40 p-3">
    <p className="text-sm font-medium text-white">Ta routine · robes de 20 à 50 €</p>
    <div className="my-3 flex flex-wrap gap-2 text-xs text-indigo-200"><span className="rounded-lg bg-indigo-500/10 px-2 py-1">5 favoris maximum / jour</span><span className="rounded-lg bg-indigo-500/10 px-2 py-1">Pauses de 5 min</span><span className="rounded-lg bg-indigo-500/10 px-2 py-1">Fermeture occasionnelle</span></div>
    <button type="button" className={buttonClass} onClick={()=>onPreset(DRESS_ROUTINE)}>Appliquer la routine robes 20–50 €</button>
    <p className="mt-2 text-xs text-zinc-400">Applique ces réglages au formulaire, puis clique sur Enregistrer.</p>
   </div>
   <label className="block text-xs text-zinc-400">Fermer l’onglet pendant les pauses<select className={fieldClass+' mt-1'} value={pace.pause_close_percent} onChange={e=>onChange('pause_close_percent',Number(e.target.value))}>{[0,25,50,75,100].map(v=><option key={v} value={v}>{v===0?'Jamais':v===100?'À chaque pause':`Environ ${v} % des pauses`}</option>)}</select></label>
   <p className="text-xs text-zinc-400">Seul l’onglet de l’assistant se ferme. Il rouvre dans le même profil, vérifie le compte et relit les conversations. AdsPower et tes autres onglets restent ouverts. « Je reprends la main » annule toute reprise automatique.</p>
   {pace.browse_enabled&&<>
    <label className="flex gap-2 text-sm"><input type="checkbox" checked={pace.browse_variety} onChange={e=>onChange('browse_variety',e.target.checked)}/> Varier les annonces, les défilements et les durées de lecture</label>
    <label className="flex gap-2 text-sm"><input type="checkbox" checked={pace.browse_between_actions} onChange={e=>onChange('browse_between_actions',e.target.checked)}/> Consulter aussi entre les tâches, même s’il reste du travail</label>
    {pace.browse_between_actions&&<div className="grid gap-3 sm:grid-cols-2">{['browse_after_actions_min','browse_after_actions_max'].map(number)}</div>}
    <p className="text-xs text-zinc-400">Le nombre d’actions est choisi entre ces deux valeurs. L’intervalle de consultation doit aussi être écoulé. Les durées varient jusqu’à 20 % ; chaque passage reste limité à deux minutes environ.</p>
   </>}
  </fieldset>
  {pace.browse_enabled&&<fieldset className="space-y-3 rounded-xl border border-rose-400/20 bg-rose-500/5 p-4"><legend className="text-sm font-semibold text-rose-200">Favoris pendant les consultations</legend>
   <label className="flex gap-2 text-sm"><input type="checkbox" checked={pace.browse_like_enabled} onChange={e=>onChange('browse_like_enabled',e.target.checked)}/> Ajouter occasionnellement une annonce aux favoris</label>
   {pace.browse_like_enabled&&<>
    <label className="block text-xs text-zinc-400">Mots-clés du titre, séparés par des virgules<input className={fieldClass+' mt-1'} maxLength={200} value={pace.browse_like_keywords} onChange={e=>onChange('browse_like_keywords',e.target.value)} placeholder="robe"/></label>
    <div className="grid gap-3 sm:grid-cols-2">{['browse_like_price_min','browse_like_price_max','browse_like_per_day','browse_like_percent'].map(number)}</div>
    <p className="text-xs text-zinc-400">Fréquence en % des annonces qui correspondent aux critères. Prix de l’article hors frais. Au moins dix minutes entre deux tentatives ; une annonce déjà en favori est laissée telle quelle.</p>
    <p className="text-xs text-zinc-400">Plafond par compte et par jour, heure de Paris. Le suivi reste sur ce PC et survit au redémarrage. Une tentative non confirmée compte dans le plafond. Utilise un seul PC pour piloter ce compte.</p>
   </>}
  </fieldset>}
 </>
}
