// Réglages façon Dotb : « Likes d'articles » (jusqu'à 3 messages, offre, relance, filtres) et « Flux de commande » (4 onglets).
import {useState} from 'react'
import {fieldClass,compactClass,buttonClass} from './YlaVintUI'

const DISCOUNT={mode:'none',amount:3,unit:'eur',rounding:'none'}
const newStep=()=>({message:'',discount:{...DISCOUNT},followup:{enabled:false,delay_hours:24,message:'',discount:{...DISCOUNT}}})
const LIKE_DELAYS=[[0,'Aucun délai'],[5,'5 minutes'],[15,'15 minutes'],[30,'30 minutes'],[60,'1 heure'],[120,'2 heures'],[360,'6 heures'],[720,'12 heures'],[1440,'24 heures']]
const FOLLOWUP_DELAYS=[[6,'6 heures'],[12,'12 heures'],[24,'1 jour'],[48,'2 jours'],[72,'3 jours'],[120,'5 jours'],[168,'7 jours']]
const days=(from,to)=>Array.from({length:to-from+1},(_,i)=>[from+i,from+i===0?'Le jour même':from+i===1?'1 jour':`${from+i} jours`])

export function Switch({checked,onChange,label,hint}){
 return <label className="flex cursor-pointer items-start justify-between gap-4 py-2">
  <span><span className="block text-sm font-medium text-white">{label}</span>{hint&&<span className="block text-xs text-zinc-500">{hint}</span>}</span>
  <span className="relative mt-0.5 inline-block h-6 w-11 shrink-0">
   <input type="checkbox" className="peer sr-only" checked={!!checked} onChange={e=>onChange(e.target.checked)}/>
   <span className="absolute inset-0 rounded-full bg-zinc-600 transition peer-checked:bg-blue-600 peer-focus-visible:ring-2 peer-focus-visible:ring-blue-400"/>
   <span className="absolute left-0.5 top-0.5 h-5 w-5 rounded-full bg-white transition peer-checked:translate-x-5"/>
  </span>
 </label>
}
const Select=({value,onChange,options,className=''})=><select className={compactClass+' '+className} value={value} onChange={e=>onChange(Number.isNaN(Number(e.target.value))?e.target.value:Number(e.target.value))}>{options.map(([v,l])=><option key={v} value={v}>{l}</option>)}</select>
const Box=({title,icon,children})=><section className="rounded-xl border border-zinc-800 bg-zinc-900/60 p-4">{title&&<h4 className="mb-2 flex items-center gap-2 text-sm font-semibold text-white">{icon&&<span aria-hidden>{icon}</span>}{title}</h4>}{children}</section>
const Field=({label,hint,children})=><label className="block py-1.5"><span className="block text-xs font-medium text-zinc-300">{label}</span><span className="mt-1 block">{children}</span>{hint&&<span className="mt-1 block text-[11px] text-zinc-500">{hint}</span>}</label>
const Area=({value,onChange,max=500,rows=3,placeholder})=><><textarea className={fieldClass} rows={rows} maxLength={max} value={value||''} placeholder={placeholder} onChange={e=>onChange(e.target.value)}/><span className="block text-right text-[10px] text-zinc-500">{(value||'').length}/{max}</span></>

function Discount({value,onChange}){
 const d={...DISCOUNT,...value},set=(k,v)=>onChange({...d,[k]:v})
 return <div className="space-y-2">
  <div className="flex items-center gap-2"><span className="text-xs font-medium text-zinc-300">Options de réduction</span>
   <Select value={d.mode} onChange={v=>set('mode',v)} options={[['none','Aucune réduction'],['simple','Réduction simple']]}/></div>
  {d.mode==='simple'&&<div className="rounded-lg border border-zinc-800 p-3"><p className="mb-1 text-xs font-medium text-zinc-300">Montant de la réduction</p>
   <div className="flex flex-wrap items-center gap-2">
    <input type="number" className={compactClass+' w-24'} min={0.5} step={0.5} value={d.amount} onChange={e=>set('amount',e.target.value===''?'':Number(e.target.value))}/>
    <Select value={d.unit} onChange={v=>set('unit',v)} options={[['eur','€'],['pct','%']]}/>
    <Select value={d.rounding} onChange={v=>set('rounding',v)} options={[['none','Pas d’arrondi'],['half','Arrondi à 0,50 €'],['euro','Arrondi à l’euro']]}/>
   </div>
   <p className="mt-1 text-[11px] text-zinc-500">L’offre part dans la conversation, calculée sur le prix du moment (arrondie vers le bas, jamais sous 1 €).</p></div>}
 </div>
}

// ---------- Likes d'articles ----------
export function LikesSettings({likes,onChange,gap,onGap}){
 const L=likes,set=(k,v)=>onChange({...L,[k]:v})
 const steps=L.messages?.length?L.messages:[newStep()]
 const setStep=(i,patch)=>set('messages',steps.map((s,j)=>j===i?{...s,...patch}:s))
 const ordinal=i=>['premier','deuxième','troisième'][i]
 return <div className="space-y-4">
  <div className="rounded-xl border border-blue-900/60 bg-blue-950/40 p-3 text-xs text-blue-100">
   <p className="mb-1 font-semibold">Comment ça marche ?</p>
   <ul className="list-disc space-y-0.5 pl-4"><li>Les messages suivent l’ordre prévu, en respectant le délai entre deux contacts.</li><li>Plusieurs favoris du même membre sont regroupés tant qu’un premier message attend son envoi. Un nouveau contact éligible utilisera le message suivant.</li>
    <li>S’il n’y a que 2 messages, la rotation s’arrête au message 2.</li><li>Aucun message au même membre pendant le nombre de jours choisi plus bas.</li></ul></div>
  {steps.map((s,i)=><Box key={i}>
   <div className="mb-1 flex items-center justify-between"><p className="text-sm font-semibold text-white">Ce message / cette offre sera envoyé(e) au {ordinal(i)} article aimé par un membre</p>
    {steps.length>1&&<button type="button" className={buttonClass+' px-2 py-1 text-xs text-red-300'} onClick={()=>set('messages',steps.filter((_,j)=>j!==i))}>Supprimer</button>}</div>
   <Field label="Message (optionnel)" hint="Laisse vide pour n’envoyer qu’une offre de réduction. @username = pseudo du membre, {article} = titre, {prix} = prix."><Area value={s.message} onChange={v=>setStep(i,{message:v})}/></Field>
   <Discount value={s.discount} onChange={v=>setStep(i,{discount:v})}/>
   <div className="mt-3 border-t border-zinc-800 pt-2">
    <Switch checked={s.followup?.enabled} onChange={v=>setStep(i,{followup:{...s.followup,enabled:v}})} label="↩ Envoyer un message de relance si le membre n’a pas répondu" hint="Un seul rappel, après le délai choisi, si le membre n’a pas répondu et que l’article est toujours en vente."/>
    {s.followup?.enabled&&<div className="space-y-2 border-l border-zinc-800 pl-3">
     <Field label="Délai avant la relance"><Select value={s.followup.delay_hours} onChange={v=>setStep(i,{followup:{...s.followup,delay_hours:v}})} options={FOLLOWUP_DELAYS}/></Field>
     <Field label="Message de relance" hint="@username = pseudo du membre."><Area value={s.followup.message} onChange={v=>setStep(i,{followup:{...s.followup,message:v}})}/></Field>
     <Discount value={s.followup.discount} onChange={v=>setStep(i,{followup:{...s.followup,discount:v}})}/>
    </div>}
   </div>
  </Box>)}
  {steps.length<3&&<div className="flex justify-center"><button type="button" className={buttonClass+' text-sm'} onClick={()=>set('messages',[...steps,newStep()])}>＋ Ajouter un message ({steps.length}/3)</button></div>}
  <Box title="Paramètres membres" icon="👥">
   <div className="flex flex-wrap items-center gap-3 py-2"><Switch checked={L.per_item?.enabled} onChange={v=>set('per_item',{...L.per_item,enabled:v})} label="Limiter les messages par article à"/>
    <input type="number" className={compactClass+' w-20'} min={1} max={1000} disabled={!L.per_item?.enabled} value={L.per_item?.max??10} onChange={e=>set('per_item',{...L.per_item,max:Number(e.target.value)})}/><span className="text-sm text-zinc-400">messages</span></div>
   <Field label="Jours avant d’envoyer à nouveau des messages automatiques au même membre" hint="Après un message automatique à un membre, attendre ce nombre de jours avant de lui en envoyer un autre.">
    <input type="number" className={compactClass+' w-24'} min={0} max={365} value={L.cooldown_days} onChange={e=>set('cooldown_days',e.target.value===''?'':Number(e.target.value))}/></Field>
   <div className="flex flex-wrap items-center gap-3"><Switch checked={L.min_rating?.enabled} onChange={v=>set('min_rating',{...L.min_rating,enabled:v})} label="Ignorer les membres avec une évaluation inférieure à"/>
    <Select value={L.min_rating?.value??4} onChange={v=>set('min_rating',{...L.min_rating,value:v})} options={[[1,'1 ★'],[2,'2 ★'],[3,'3 ★'],[4,'4 ★'],[5,'5 ★']]}/></div>
   <Switch checked={L.skip_unrated} onChange={v=>set('skip_unrated',v)} label="Ignorer les membres sans évaluation"/>
   <Field label="Membres ignorés" hint="Pseudos Vinted séparés par des virgules : ils ne reçoivent jamais de message automatique.">
    <textarea className={fieldClass} rows={2} value={(L.ignored||[]).join(', ')} onChange={e=>set('ignored',e.target.value.split(',').map(x=>x.trim()))} placeholder="pseudo1, pseudo2"/></Field>
  </Box>
  <Box title="Paramètres de délai" icon="⏱">
   <Field label="Délai avant d’envoyer un message après un J’aime" hint="Les J’aime en attente sont conservés même si le profil se ferme."><Select value={L.wait_minutes} onChange={v=>set('wait_minutes',v)} options={LIKE_DELAYS.some(([v])=>v===L.wait_minutes)?LIKE_DELAYS:[...LIKE_DELAYS,[L.wait_minutes,`${L.wait_minutes} minutes`]]}/></Field>
   {onGap&&<Field label="Délai entre chaque envoi" hint="Les envois sont espacés dans cette plage et respectent les horaires et plafonds du compte.">
    <span className="flex items-center gap-2 text-sm text-zinc-300">entre <input type="number" className={compactClass+' w-20'} min={5} max={3600} value={gap?.action_gap_min??30} onChange={e=>onGap('action_gap_min',e.target.value===''?'':Number(e.target.value))}/> et <input type="number" className={compactClass+' w-20'} min={5} max={3600} value={gap?.action_gap_max??45} onChange={e=>onGap('action_gap_max',e.target.value===''?'':Number(e.target.value))}/> secondes</span></Field>}
  </Box>
 </div>
}

// ---------- Flux de commande ----------
const TABS=[['shipping','Expédition'],['delay','Délai'],['pickup','Retrait'],['final','Finalisation']]
export function FlowSettings({flow,onChange,features,onFeature}){
 const [tab,setTab]=useState('shipping')
 const F=flow,set=(group,patch)=>onChange({...F,[group]:typeof patch==='object'&&!Array.isArray(patch)?{...F[group],...patch}:patch})
 const [carrier,setCarrier]=useState('')
 return <div className="rounded-xl border border-zinc-800 bg-zinc-900/60 p-4">
  <div className="mb-4 grid grid-cols-4 rounded-lg bg-zinc-800/70 p-1 text-sm" role="tablist">
   {TABS.map(([k,l])=><button key={k} type="button" role="tab" aria-selected={tab===k} className={`rounded-md px-2 py-1.5 font-medium ${tab===k?'bg-black text-white':'text-zinc-400 hover:text-white'}`} onClick={()=>setTab(k)}>{l}</button>)}
  </div>
  {tab==='shipping'&&<div className="divide-y divide-zinc-800">
   <div><Switch checked={F.confirm.enabled} onChange={v=>set('confirm',{enabled:v})} label="Confirmation de commande" hint="Message envoyé à l’acheteur dès que la vente est payée."/>
    {F.confirm.enabled&&<div className="pb-2 pl-3"><Field label="Message" hint="@username = pseudo de l’acheteur, {article} = titre."><Area value={F.confirm.message} max={1000} onChange={v=>set('confirm',{message:v})}/></Field></div>}</div>
   <div><Switch checked={features.labels} onChange={v=>onFeature('labels',v)} label="Récupérer automatiquement les bordereaux" hint="Dès que Vinted a créé le bordereau d’une vente, YlaVint l’enregistre et l’ajoute à la vente (onglet Ventes)."/>
    {features.labels&&<div className="pb-2 pl-3"><Field label="Transporteurs à ignorer" hint="Nom du transporteur tel qu’il apparaît sur la vente. Ces ventes sont ignorées pour les bordereaux.">
     <span className="flex gap-2"><input className={compactClass+' w-56'} value={carrier} placeholder="Entre le nom du transporteur…" onChange={e=>setCarrier(e.target.value)} onKeyDown={e=>{if(e.key==='Enter'){e.preventDefault();carrier.trim()&&set('labels',{ignore_carriers:[...new Set([...F.labels.ignore_carriers,carrier.trim().toLowerCase()])]});setCarrier('')}}}/>
      <button type="button" className={buttonClass+' px-3'} onClick={()=>{carrier.trim()&&set('labels',{ignore_carriers:[...new Set([...F.labels.ignore_carriers,carrier.trim().toLowerCase()])]});setCarrier('')}}>＋</button></span>
     <span className="mt-2 flex flex-wrap gap-1.5">{F.labels.ignore_carriers.map(c=><span key={c} className="inline-flex items-center gap-1 rounded bg-zinc-800 px-2 py-0.5 text-xs text-zinc-200">{c}<button type="button" aria-label={`Retirer ${c}`} className="text-zinc-500 hover:text-white" onClick={()=>set('labels',{ignore_carriers:F.labels.ignore_carriers.filter(x=>x!==c)})}>×</button></span>)}</span></Field></div>}</div>
  </div>}
  {tab==='delay'&&<div className="divide-y divide-zinc-800">
   <div><Switch checked={F.extension.enabled} onChange={v=>set('extension',{enabled:v})} label="Extension de délai" hint="Demander automatiquement à l’acheteur un délai supplémentaire pour l’envoi."/>
    {F.extension.enabled&&<div className="space-y-1 border-l border-zinc-800 pb-2 pl-3">
     <Field label="Délai de demande" hint="Jours après la vente avant d’envoyer la demande."><Select value={F.extension.after_days} onChange={v=>set('extension',{after_days:v})} options={days(1,5)}/></Field>
     <Field label="Message de demande"><Area value={F.extension.message} max={200} onChange={v=>set('extension',{message:v})}/></Field>
     <Field label="Relance à +1 jour — envoyée si le délai n’a pas encore été accordé (optionnel)"><Area value={F.extension.relance1} onChange={v=>set('extension',{relance1:v})}/></Field>
     <Field label="Relance à +2 jours — envoyée si le délai n’a pas encore été accordé (optionnel)"><Area value={F.extension.relance2} onChange={v=>set('extension',{relance2:v})}/></Field>
    </div>}</div>
   <div><Switch checked={F.cancel.enabled} onChange={v=>set('cancel',{enabled:v})} label="Annulation automatique" hint="Annuler la vente juste avant la date limite d’envoi si elle n’a toujours pas été expédiée. YlaVint reprend le motif de ta dernière annulation faite à la main sur Vinted : choisis-y un motif qui correspond à la réalité."/>
    {F.cancel.enabled&&<div className="pb-2 pl-3"><Field label="Combien de temps avant la date limite"><Select value={F.cancel.minutes_before} onChange={v=>set('cancel',{minutes_before:v})} options={[[30,'30 minutes'],[60,'1 heure'],[120,'2 heures'],[360,'6 heures'],[720,'12 heures']]}/></Field>
     <p className="text-[11px] text-amber-300/90">L’annulation ne part que pendant la plage horaire du compte : choisis un délai assez large pour qu’elle tombe dedans.</p></div>}</div>
   <p className="pt-3 text-xs text-zinc-500">« J’ai expédié » n’est jamais cliqué automatiquement : YlaVint ne déclare pas un envoi qui n’a pas eu lieu.</p>
  </div>}
  {tab==='pickup'&&<div>
   <Switch checked={F.pickup.enabled} onChange={v=>set('pickup',{enabled:v})} label="Prêt à retirer" hint="Jusqu’à deux messages une fois le colis disponible au point de retrait."/>
   {F.pickup.enabled&&<div className="space-y-1 border-l border-zinc-800 pl-3">
    <Field label="Message 1 — envoyer après" hint="Jours après que le colis est disponible au point de retrait."><Select value={F.pickup.first_days} onChange={v=>set('pickup',{first_days:v})} options={days(0,7)}/></Field>
    <Field label="Message 1"><Area value={F.pickup.first} max={1000} onChange={v=>set('pickup',{first:v})}/></Field>
    <Field label="Message 2 — envoyer après"><Select value={F.pickup.second_days} onChange={v=>set('pickup',{second_days:v})} options={days(1,14)}/></Field>
    <Field label="Message 2 (optionnel)"><Area value={F.pickup.second} max={1000} onChange={v=>set('pickup',{second:v})}/></Field>
   </div>}
  </div>}
  {tab==='final'&&<div className="divide-y divide-zinc-800">
   <div><Switch checked={F.review.enabled} onChange={v=>set('review',{enabled:v})} label="Évaluation automatique" hint="Laisser une évaluation 5 étoiles à l’acheteur quand la commande est terminée."/>
    {F.review.enabled&&<div className="space-y-1 border-l border-zinc-800 pb-2 pl-3">
     <Field label="Envoyer l’avis après" hint="Jours après la fin de la commande."><Select value={F.review.after_days} onChange={v=>set('review',{after_days:v})} options={days(0,14)}/></Field>
     <Field label="Texte de l’évaluation"><Area value={F.review.text} onChange={v=>set('review',{text:v})}/></Field>
     <Field label="Message de fin (optionnel) — envoyé dans le chat de la commande"><Area value={F.review.end_message} max={1000} onChange={v=>set('review',{end_message:v})}/></Field>
    </div>}</div>
   <div><Switch checked={F.delete_sold} onChange={v=>set('delete_sold',v)} label="Supprimer l’article vendu" hint="Supprimer l’article de ton dressing une fois la commande terminée."/></div>
  </div>}
 </div>
}
