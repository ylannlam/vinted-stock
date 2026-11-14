import {fieldClass,buttonClass} from './YlaVintUI'
import {DESKTOP_DEFAULTS} from '../lib/ylavintExecution'

const days=[[1,'Lundi'],[2,'Mardi'],[3,'Mercredi'],[4,'Jeudi'],[5,'Vendredi'],[6,'Samedi'],[7,'Dimanche']]
const localDate=v=>v?new Date(Date.parse(v)-new Date(v).getTimezoneOffset()*60000).toISOString().slice(0,16):''
export default function YlaVintRoutineSettings({messaging,onChange,desktop}){
 const pace={...DESKTOP_DEFAULTS,...messaging.desktop},setPace=(k,v)=>onChange('desktop',{...pace,[k]:v})
 return <>
  {desktop&&<fieldset className="space-y-4 rounded-xl border border-zinc-700 p-4"><legend className="text-sm font-semibold">Planning et reprise</legend>
   <p className="text-xs text-zinc-400">Heure de Paris pour les créneaux. Après une pause ou un redémarrage, les conversations sont relues avant les actions en attente.</p>
   <div className="flex flex-wrap gap-2">{days.map(([n,label])=><label key={n} className="flex items-center gap-2 rounded-lg border border-zinc-700 px-2.5 py-2 text-xs"><input type="checkbox" checked={pace.active_days.includes(n)} onChange={e=>setPace('active_days',e.target.checked?[...pace.active_days,n].sort():pace.active_days.filter(d=>d!==n))}/>{label}</label>)}</div>
   {!pace.active_days.length&&<p className="text-xs text-amber-200">Aucun jour sélectionné : toutes les actions attendront.</p>}
   <label className="block text-xs text-zinc-400">Absent jusqu’au (heure de cet appareil)<input type="datetime-local" className={fieldClass+' mt-1'} value={localDate(pace.absent_until)} onInput={e=>{const value=e.currentTarget.value;if(!value)setPace('absent_until',null);else if(Number.isFinite(Date.parse(value)))setPace('absent_until',new Date(value).toISOString())}}/></label>
   <label className="block text-xs text-zinc-400">Revoir les réponses en attente après (heures)<input type="number" className={fieldClass+' mt-1'} min="1" max="72" value={pace.reply_max_age_hours} onChange={e=>setPace('reply_max_age_hours',Number(e.target.value))}/></label>
   <p className="text-xs text-zinc-400">Une réponse trop ancienne revient à ta validation. Les envois déjà confirmés ne sont pas rejoués.</p>
  </fieldset>}
  {desktop&&pace.browse_enabled&&<fieldset className="space-y-3 rounded-xl border border-zinc-700 p-4"><legend className="text-sm font-semibold">Consultations choisies</legend>
   <label className="block text-xs text-zinc-400">Mots-clés, séparés par des virgules<textarea rows={2} className={fieldClass+' mt-1'} maxLength={200} value={pace.browse_keywords} onChange={e=>setPace('browse_keywords',e.target.value)} placeholder="robe, Sézane, taille M"/></label>
   <p className="text-xs text-zinc-400">Un mot-clé doit apparaître dans la carte de l’annonce. Seules les annonces de la page chargée sont consultées ; s’il n’y en a aucune, l’assistant attend.</p>
   <div className="grid gap-3 sm:grid-cols-2">{[['browse_price_min','Prix minimum (€)'],['browse_price_max','Prix maximum (€, 0 = aucun)'],['browse_memory_hours','Éviter les annonces déjà vues pendant (h)']].map(([key,label])=><label className="block text-xs text-zinc-400" key={key}>{label}<input type="number" className={fieldClass+' mt-1'} min={key==='browse_memory_hours'?1:0} max={key==='browse_memory_hours'?168:10000} value={pace[key]} onChange={e=>setPace(key,Number(e.target.value))}/></label>)}</div>
   <label className="flex gap-2 text-sm"><input type="checkbox" checked={pace.browse_photos} onChange={e=>setPace('browse_photos',e.target.checked)}/> Consulter aussi la photo suivante lorsque son bouton est identifiable</label>
   <p className="text-xs text-zinc-400">Défilement par étapes, puis retour à la liste. La mémoire des articles consultés reste sur ce PC. Aucun like automatique.</p>
  </fieldset>}
  <fieldset className="space-y-3 rounded-xl border border-zinc-700 p-4"><legend className="text-sm font-semibold">Mémoire et style de cette boutique</legend>
   <label className="block text-xs text-zinc-400">Ton, informations fiables et disponibilités d’expédition<textarea className={fieldClass+' mt-1'} rows={4} maxLength={1500} value={messaging.reply_notes||''} onChange={e=>onChange('reply_notes',e.target.value)} placeholder="Je tutoie, réponses courtes, peu d’emojis. Mes jours réels d’expédition sont…"/></label>
   <p className="text-xs text-zinc-400">Renseigne uniquement des informations réelles. Les mesures ou photos manquantes et les demandes particulières te sont confiées.</p>
   {!!messaging.reply_examples?.length&&<div className="space-y-2">{messaging.reply_examples.map((e,i)=><div key={i} className="rounded-xl bg-zinc-900 p-3"><p className="text-xs text-indigo-300">Exemple de style {i+1}</p><p className="mt-2 whitespace-pre-wrap text-sm">{e.after}</p><button className={buttonClass+' mt-2 text-xs'} onClick={()=>onChange('reply_examples',messaging.reply_examples.filter((_,n)=>n!==i))}>Retirer cet exemple</button></div>)}</div>}
   <p className="text-xs text-zinc-400">Dans une conversation, corrige une proposition puis choisis « Retenir cette correction ». Les trois derniers exemples servent au style, sans réutiliser leurs détails d’article.</p>
  </fieldset>
 </>
}
