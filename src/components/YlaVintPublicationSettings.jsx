import {fieldClass} from './YlaVintUI'

export default function YlaVintPublicationSettings({pace,onChange}){
 const seconds=(pace.publication_typing_ms/1000).toFixed(2).replace('.',',')
 return <fieldset className="space-y-4 rounded-2xl border border-violet-400/30 bg-gradient-to-br from-violet-500/10 to-sky-500/5 p-5">
  <legend className="px-2 text-sm font-semibold text-violet-200">Publication à l’écran</legend>
  <div className="flex flex-wrap items-center justify-between gap-3"><div><p className="font-semibold text-white">Une annonce, étape par étape</p><p className="mt-1 text-xs text-zinc-400">Photos → choix des détails → saisie → relecture → validation</p></div><span className="rounded-full bg-violet-400/15 px-3 py-1 text-xs text-violet-200">Connecteur 1.5</span></div>
  <label className="block text-sm text-zinc-200">Vitesse du clavier · environ {(1000/pace.publication_typing_ms).toFixed(1).replace('.',',')} caractères / seconde
   <input aria-label="Vitesse de saisie des annonces" type="range" min="200" max="350" step="10" className="mt-3 w-full accent-violet-400" value={pace.publication_typing_ms} onChange={e=>onChange('publication_typing_ms',Number(e.target.value))}/>
   <span className="mt-1 flex justify-between text-xs text-zinc-400"><span>Plus rapide</span><span>{seconds} s entre les caractères</span><span>Plus lent</span></span>
  </label>
  <div className="grid gap-3 sm:grid-cols-3">{[['publication_punctuation_ms','Pause à la ponctuation (ms)',200,1500],['publication_field_seconds','Entre les champs (s)',1,10],['publication_review_seconds','Temps de relecture (s)',3,20]].map(([key,label,min,max])=><label className="block text-xs text-zinc-400" key={key}>{label}<input type="number" className={fieldClass+' mt-2'} min={min} max={max} value={pace[key]} onChange={e=>onChange(key,Number(e.target.value))}/></label>)}</div>
  <label className="flex items-start gap-3 rounded-xl bg-zinc-950/40 p-3 text-sm"><input type="checkbox" className="mt-1 accent-violet-400" checked={pace.publication_corrections} onChange={e=>onChange('publication_corrections',e.target.checked)}/><span>Petites fautes corrigées pendant la saisie<span className="mt-1 block text-xs leading-relaxed text-zinc-400">Au plus une lettre dans un mot courant du titre et de la description, aussitôt effacée et retapée. Le texte final doit correspondre exactement à ta fiche.</span></span></label>
  <div className="grid gap-2 text-xs text-zinc-300 sm:grid-cols-2"><p>✓ Prix, marque, taille, état et colis exacts</p><p>✓ Photos contrôlées avant validation</p><p>✓ Arrêt si tu modifies le formulaire</p><p>✓ Une coupure ne relance jamais un envoi</p></div>
  <p className="text-xs leading-relaxed text-zinc-400">Dans l’atelier, choisis pour chaque annonce « Préparer le formulaire » ou « Publier après les contrôles ». Le planning, les plafonds et l’intervalle entre les publications restent applicables. La vitesse des messages garde son propre réglage.</p>
 </fieldset>
}
