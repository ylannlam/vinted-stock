import {useEffect,useRef,useState} from 'react'
import {ASSISTANT_SECTIONS,assistantSettingsDraft,settingsSection,sectionStatus} from '../lib/assistantSettings'
import {DESKTOP_BOUNDS,DESKTOP_LABELS} from '../lib/ylavintExecution'
import {buttonClass,primaryClass,fieldClass,Icon,Pill} from './YlaVintUI'
import {LikesSettings,Switch} from './YlaVintFlows'
import YlaVintRoutineSettings from './YlaVintRoutineSettings'

const NumberField=({label,value,onChange,min=0,max,suffix})=><label className="block text-sm text-zinc-300">{label}<span className="mt-2 flex items-center gap-2"><input type="number" className={fieldClass} value={value??''} min={min} max={max} required onChange={e=>onChange(e.target.value===''?'':Number(e.target.value))}/>{suffix&&<span className="text-xs text-zinc-400">{suffix}</span>}</span></label>
const Box=({title,children})=><section className="space-y-4 rounded-2xl border border-zinc-700 bg-zinc-900/60 p-5"><h4 className="font-semibold text-white">{title}</h4>{children}</section>
const History=({value,onChange})=><label className="block text-sm text-zinc-300">Au démarrage, reprendre<select className={fieldClass+' mt-2'} value={value||0} onChange={e=>onChange(Number(e.target.value))}>{[...new Set([0,2,6,12,24,48,72,168,Number(value)||0])].map(h=><option key={h} value={h}>{h?`Les ${h} dernières heures`:'Uniquement les nouveaux événements'}</option>)}</select><span className="mt-2 block text-xs text-zinc-400">Les actions déjà effectuées ne sont pas répétées. L’historique dépend des pages chargées.</span></label>

export default function YlaVintAccountSettings({account,defaults,only,onSave,onClose,busy,onNavigate}){
 const [form,setForm]=useState(()=>assistantSettingsDraft(defaults,account.settings))
 const [section,setSection]=useState(()=>settingsSection(only)),[dirty,setDirty]=useState(false),[error,setError]=useState('')
 const dialog=useRef(null),closeButton=useRef(null),content=useRef(null),closeRef=useRef(null)
 const close=()=>{if(!busy&&(!dirty||window.confirm('Fermer sans enregistrer les modifications de ce compte ?')))onClose()}
 closeRef.current=close
 useEffect(()=>{
  const before=document.activeElement,overflow=document.body.style.overflow
  document.body.style.overflow='hidden';closeButton.current?.focus()
  const key=e=>{
   if(e.key==='Escape'){e.preventDefault();closeRef.current()}
   if(e.key==='Tab'){
    const nodes=[...dialog.current.querySelectorAll('button:not(:disabled),a[href],input:not(:disabled),select:not(:disabled),textarea:not(:disabled),[tabindex="0"]')].filter(n=>n.getClientRects().length)
    const first=nodes[0],last=nodes.at(-1)
    if(e.shiftKey&&document.activeElement===first){e.preventDefault();last?.focus()}
    else if(!e.shiftKey&&document.activeElement===last){e.preventDefault();first?.focus()}
   }
  }
  document.addEventListener('keydown',key)
  return()=>{document.removeEventListener('keydown',key);document.body.style.overflow=overflow;before?.focus()}
 },[])
 const update=fn=>{setDirty(true);setError('');setForm(fn)}
 const set=(group,key,value)=>update(f=>({...f,[group]:{...f[group],[key]:value}}))
 const setPace=(key,value)=>update(f=>({...f,messaging:{...f.messaging,desktop:{...f.messaging.desktop,[key]:value}}}))
 const pace=form.messaging.desktop
 const toggle=(key,label,hint)=><Switch checked={form.features[key]} onChange={v=>set('features',key,v)} label={label} hint={hint}/>
 const limit=(key,label,max=100,suffix)=><NumberField label={label} value={form.limits[key]} max={max} suffix={suffix} onChange={v=>set('limits',key,v)}/>
 const paceField=key=><NumberField key={key} label={DESKTOP_LABELS[key]} value={pace[key]} min={DESKTOP_BOUNDS[key][0]} max={DESKTOP_BOUNDS[key][1]} onChange={v=>setPace(key,v)} suffix={key==='typing_delay_ms'?'ms':key.includes('seconds')?'s':key.includes('minutes')?'min':null}/>
 const selected=ASSISTANT_SECTIONS.find(s=>s.id===section)
 const select=id=>{setSection(id);content.current?.scrollTo({top:0})}
 async function save(e){e.preventDefault();setError('');try{const saved=await onSave(form);if(!saved)setError('L’enregistrement a échoué. Tes modifications sont conservées ici ; consulte le message du site.')}catch(err){setError(err.message)}}
 return <div className="fixed inset-0 z-50 flex items-center justify-center bg-[#030817]/80 p-0 backdrop-blur-sm sm:p-5" onClick={close}>
  <section ref={dialog} role="dialog" aria-modal="true" aria-labelledby="assistant-settings-title" className="ylv-settings-dialog flex h-full w-full max-w-6xl flex-col overflow-hidden border border-zinc-700 bg-[#111b2e] text-zinc-100 sm:h-[90vh] sm:rounded-3xl" onClick={e=>e.stopPropagation()}>
   <header className="flex shrink-0 items-center justify-between gap-3 border-b border-zinc-700 px-5 py-4 sm:px-7"><div className="flex items-center gap-3"><span className="ylv-avatar grid h-11 w-11 place-items-center rounded-xl font-semibold">{account.login.slice(0,2).toUpperCase()}</span><div><p className="ylv-eyebrow">Réglages de l’assistant PC</p><h2 id="assistant-settings-title" className="mt-1 text-xl font-semibold text-white">{account.login}</h2></div></div><button ref={closeButton} type="button" className={buttonClass} onClick={close} disabled={busy} aria-label="Fermer les réglages">✕</button></header>
   <form onSubmit={save} className="flex min-h-0 flex-1 flex-col">
    <div className="flex min-h-0 flex-1 flex-col md:flex-row">
     <nav aria-label="Rubriques des réglages" className="ylv-settings-nav flex shrink-0 gap-2 overflow-x-auto border-b border-zinc-700 p-3 md:w-64 md:flex-col md:overflow-y-auto md:border-b-0 md:border-r md:p-4">{ASSISTANT_SECTIONS.map(s=><button type="button" key={s.id} aria-current={section===s.id?'page':undefined} className={`ylv-setting-nav flex shrink-0 items-center gap-3 rounded-xl p-3 text-left ${section===s.id?'is-selected':'text-zinc-400'}`} onClick={()=>select(s.id)}><Icon name={s.icon}/><span className="whitespace-nowrap text-sm"><span className="block font-medium">{s.title}</span><span className="mt-1 hidden text-xs opacity-75 md:block">{sectionStatus(s.id,form)}</span></span></button>)}</nav>
     <div ref={content} className="min-h-0 min-w-0 flex-1 overflow-y-auto p-5 sm:p-7">
      <header className="mb-6"><p className="ylv-eyebrow">Réglages indépendants · ce compte uniquement</p><h3 className="mt-2 text-2xl font-semibold text-white">{selected.title}</h3><p className="mt-2 text-sm text-zinc-400">{selected.hint}</p></header>
      <fieldset disabled={busy} className="min-w-0 space-y-5">
       {section==='general'&&<>
        <Box title="Autorisation du compte"><Switch checked={form.enabled} onChange={v=>update(f=>({...f,enabled:v}))} label="Autoriser l’assistant sur ce compte" hint="Le démarrage se fait ensuite depuis Assistant PC. Enregistrer les réglages ne lance aucune session."/>{account.settings?.paused&&<Pill tone="amber">Compte en pause · la pause reste conservée</Pill>}</Box>
        <Box title="Horaires d’activité · heure de Paris"><div className="grid gap-4 sm:grid-cols-2">{limit('from_hour','Début',23,'h')}{limit('to_hour','Fin',23,'h')}</div><p className="text-xs text-zinc-400">Deux heures identiques autorisent toute la journée. Ce créneau s’applique à toutes les fonctions du compte.</p></Box>
        <YlaVintRoutineSettings messaging={form.messaging} desktop section="general" onChange={(k,v)=>set('messaging',k,v)}/>
       </>}
       {section==='likes'&&<>
        <Box title="Quand quelqu’un aime ton article">{toggle('likes','Envoyer un message ou une réduction après un favori','Cette fonction utilise tes modèles ci-dessous. Elle est indépendante des réponses IA.')}{limit('like_message_per_day','Messages aux favoris par jour, relances incluses',1000000)}<History value={form.likes.history_hours} onChange={v=>set('likes','history_hours',v)}/></Box>
        <LikesSettings section="likes" likes={form.likes} onChange={likes=>update(f=>({...f,likes}))}/>
        <button type="button" className={buttonClass} onClick={()=>select('followups')}>Régler les relances séparément <Icon name="arrow"/></button>
       </>}
       {section==='messages'&&<>
        <Box title="Lecture et réponses">{toggle('inbox','Lire la messagerie','Les conversations lues sur Vinted apparaissent dans le site.')}{toggle('ai','Activer les réponses IA','Nécessite la lecture de la messagerie et l’IA activée dans les consignes communes.')}{form.features.ai&&!form.features.inbox&&<p role="status" className="text-sm text-amber-200">Active aussi la lecture de la messagerie pour recevoir de nouvelles réponses IA.</p>}<button type="button" className={buttonClass} onClick={()=>{if(!dirty||window.confirm('Quitter sans enregistrer pour ouvrir les consignes communes ?')){onClose();onNavigate('agent')}}}>Consignes et modèle IA communs <Icon name="arrow"/></button></Box>
        <YlaVintRoutineSettings messaging={form.messaging} desktop section="messages" onChange={(k,v)=>set('messaging',k,v)}/>
        <Box title="Fréquence et historique"><NumberField label="Relire les conversations toutes les" value={form.messaging.sync_seconds} min={20} max={7200} suffix="s" onChange={v=>set('messaging','sync_seconds',v)}/><Switch checked={form.messaging.reply_unlimited} onChange={v=>set('messaging','reply_unlimited',v)} label="Réponses par jour illimitées"/>{!form.messaging.reply_unlimited&&<NumberField label="Réponses par jour" value={form.messaging.reply_per_day} max={300} onChange={v=>set('messaging','reply_per_day',v)}/>}<History value={form.messaging.history_hours} onChange={v=>set('messaging','history_hours',v)}/></Box>
       </>}
       {section==='followups'&&<>
        <div className="rounded-xl border border-amber-400/20 bg-amber-500/5 p-4 text-sm leading-relaxed text-zinc-300">Un seul rappel après le message au favori, si le membre n’a pas répondu et si l’article est encore disponible. Les relances utilisent le plafond quotidien des favoris.</div>
        {!form.features.likes&&<p className="text-sm text-amber-200">Les messages aux favoris sont désactivés : les relances attendront leur activation.</p>}
        <LikesSettings section="followups" likes={form.likes} onChange={likes=>update(f=>({...f,likes}))}/>
       </>}
       {section==='publication'&&<>
        <Box title="Annonces et dressing">{toggle('publish','Autoriser la publication des annonces','Les fiches sont préparées dans Annonces, puis confiées à cet assistant.')}{toggle('dressing','Relire le dressing','Mettre à jour la liste des articles depuis les pages Vinted.')}<div className="grid gap-4 sm:grid-cols-2">{limit('publish_item_per_day','Publications par jour')}{limit('writes_per_day','Total des modifications par jour',200)}<NumberField label="Intervalle minimal entre les modifications" value={form.limits.min_gap_minutes} min={1} max={240} suffix="min" onChange={v=>set('limits','min_gap_minutes',v)}/></div></Box>
        <YlaVintRoutineSettings messaging={form.messaging} desktop section="publication" onChange={(k,v)=>set('messaging',k,v)}/>
       </>}
       {section==='navigation'&&<>
        <Box title="Clavier et pauses"><p className="text-xs text-zinc-400">Les lectures, saisies et clics passent par les pages visibles de Vinted.</p><div className="grid gap-4 sm:grid-cols-2">{['typing_delay_ms','page_wait_seconds','session_minutes','pause_minutes'].map(paceField)}</div><div className="grid gap-4 sm:grid-cols-2">{['action_gap_min','action_gap_max'].map((k,i)=><NumberField key={k} label={`Délai ${i?'maximum':'minimum'} entre les envois`} value={form.messaging[k]} min={5} max={3600} suffix="s" onChange={v=>set('messaging',k,v)}/>)}</div></Box>
        <Box title="Parcourir Vinted"><Switch checked={pace.browse_enabled} onChange={v=>setPace('browse_enabled',v)} label="Consulter des annonces entre les tâches" hint="Défilement, annonces et favoris selon tes critères."/>{pace.browse_enabled&&<div className="grid gap-4 sm:grid-cols-2">{['browse_every_minutes','browse_items','browse_item_seconds','browse_scrolls'].map(paceField)}</div>}</Box>
        <YlaVintRoutineSettings messaging={form.messaging} desktop section="navigation" onChange={(k,v)=>set('messaging',k,v)}/>
       </>}
       {section==='orders'&&<>
        <Box title="Ventes et bordereaux">{toggle('orders','Lire les ventes à expédier','Actualiser les commandes à partir des pages visibles.')}{toggle('labels','Récupérer les bordereaux','Les étiquettes disponibles rejoignent la préparation des colis.')}{form.features.labels&&!form.features.orders&&<p className="text-sm text-amber-200">Active aussi la lecture des ventes pour repérer les nouveaux bordereaux.</p>}</Box>
        <Box title="Impression thermique"><p className="text-sm leading-relaxed text-zinc-300">Retrouve les étiquettes au format 100 × 150 mm avec le nom de l’article dans Préparation des colis. L’impression automatique et l’imprimante se règlent sur ce PC.</p><a href="http://127.0.0.1:17442/setup" target="_blank" rel="noreferrer" className={buttonClass}>Réglages de l’imprimante <Icon name="arrow"/></a></Box>
        <Box title="Prolonger un délai d’envoi"><p className="text-sm leading-relaxed text-zinc-300">Depuis une vente à expédier, choisis « Demander un délai ». L’assistant remplit le formulaire Vinted avec le motif choisi. L’acheteur doit accepter la demande.</p>{limit('order_extension_per_day','Demandes de délai par jour')}<p className="text-xs text-zinc-400">Chaque demande est décidée depuis la commande. Il n’y a pas de demande automatique globale.</p></Box>
       </>}
       {section==='wallet'&&<><Box title="Suivi du solde">{toggle('wallet','Vérifier le porte-monnaie deux fois par jour','Relever le montant retirable et le montant en attente. Le virement reste manuel.')}</Box><YlaVintRoutineSettings messaging={form.messaging} desktop section="wallet" onChange={(k,v)=>set('messaging',k,v)}/></>}
      </fieldset>
     </div>
    </div>
    <footer className="shrink-0 border-t border-zinc-700 bg-[#101a2c] px-5 py-4 sm:px-7">{error&&<p role="alert" className="mb-3 text-sm text-rose-300">{error}</p>}<div className="flex flex-wrap items-center justify-between gap-3"><p role="status" className="text-xs text-zinc-400">{dirty?'Modifications non enregistrées · conservées entre les rubriques':'Réglages propres à '+account.login}</p><div className="flex gap-2"><button type="button" className={buttonClass} disabled={busy} onClick={close}>Fermer</button><button className={primaryClass} disabled={busy}>{busy?'Enregistrement…':'Enregistrer les réglages'}</button></div></div></footer>
   </form>
  </section>
 </div>
}
