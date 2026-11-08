import {useRef,useState} from 'react'
import {DEFAULT_LISTING_SETTINGS,LISTING_AI_MODELS,LISTING_CONDITIONS,LISTING_PACKAGES,LISTING_PUBLISHERS,LISTING_MODES,MAX_SPACING_MINUTES} from '../lib/listingSettings'

const input='w-full rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-sm focus:outline-teal-600 disabled:bg-slate-50'
const button='rounded-xl border border-slate-200 bg-white px-4 py-2.5 text-sm font-medium hover:bg-slate-50 disabled:opacity-40'
const primary='rounded-xl bg-teal-700 px-5 py-2.5 text-sm font-semibold text-white hover:bg-teal-800 disabled:opacity-40'
const SHARED=['no_brand','condition','package','size_in_title','keywords_line','title_rules','description_footer']
const pick=(source,keys)=>Object.fromEntries(keys.map(k=>[k,source[k]]))
const same=(a,b)=>JSON.stringify(a)===JSON.stringify(b)

function Check({label,hint,checked,onChange,disabled}){
 return <label className="flex gap-3 items-start text-sm"><input type="checkbox" className="mt-1 h-4 w-4 accent-teal-700" checked={checked} disabled={disabled} onChange={e=>onChange(e.target.checked)}/><span><span className="font-medium">{label}</span>{hint&&<span className="block text-xs text-slate-500 mt-0.5">{hint}</span>}</span></label>
}

// Réglages appliqués à chaque article préparé. Ils se règlent une fois pour tous les comptes,
// ou pour un seul compte, et chaque fiche reste modifiable ensuite.
export default function ListingSettingsPanel({settings,account,request,serverDotb,aiModels=LISTING_AI_MODELS,onSaved,onClose}){
 const own=settings?.account?.settings||{},global=settings?.global?.settings||null
 const [scope,setScope]=useState(own.custom?'account':'default')
 const [form,setForm]=useState(()=>pick({...DEFAULT_LISTING_SETTINGS,...(settings?.effective||{})},SHARED))
 const [model,setModel]=useState(settings?.effective?.ai_model||DEFAULT_LISTING_SETTINGS.ai_model)
 const [publisher,setPublisher]=useState(settings?.effective?.publisher||DEFAULT_LISTING_SETTINGS.publisher),[mode,setMode]=useState(settings?.effective?.publish_mode||DEFAULT_LISTING_SETTINGS.publish_mode)
 const [dotb,setDotb]=useState(own.dotb===true),[spacing,setSpacing]=useState(String(own.spacing_minutes??30))
 const [busy,setBusy]=useState(false),[error,setError]=useState('')
 const versions=useRef({global:settings?.global?.version??0,account:settings?.account?.version??0})
 const savedValues=useRef({global,own})
 const change=patch=>{setForm(f=>({...f,...patch}));setError('')}
 async function save(){
  const minutes=Number(spacing)
  if(!Number.isSafeInteger(minutes)||minutes<0||minutes>MAX_SPACING_MINUTES){setError(`Indique un écart entre 0 et ${MAX_SPACING_MINUTES} minutes.`);return}
  setBusy(true);setError('')
  try{
   const sharedBefore={...DEFAULT_LISTING_SETTINGS,...(global||{})}
   const nextGlobal=scope==='default'?{...form,ai_model:model,publisher,publish_mode:mode}:{...pick(sharedBefore,SHARED),ai_model:model,publisher,publish_mode:mode}
   const nextAccount={dotb,spacing_minutes:minutes,custom:scope==='account',...(scope==='account'?form:{})}
   if(!same(nextGlobal,savedValues.current.global)){
    const result=await request('POST',{action:'settings',scope:'default',version:versions.current.global,settings:nextGlobal})
    versions.current.global=result.global.version;savedValues.current.global=nextGlobal
   }
   if(!same(nextAccount,savedValues.current.own)){
    const result=await request('POST',{action:'settings',scope:account.id,version:versions.current.account,settings:nextAccount})
    versions.current.account=result.account.version;savedValues.current.own=nextAccount
   }
   onSaved(await request('GET',undefined,`action=settings&account_id=${account.id}`))
  }catch(e){setError(e.message)}finally{setBusy(false)}
 }
 return <section aria-label="Réglages des annonces" className="rounded-2xl border border-teal-200 bg-white p-4 sm:p-6 space-y-5">
  <div className="flex flex-wrap items-start justify-between gap-3"><div><h2 className="text-lg font-bold">Réglages des annonces</h2><p className="text-sm text-slate-500 mt-1">Appliqués automatiquement à chaque article préparé. Tu peux toujours les changer sur une fiche.</p></div><button className={button} onClick={onClose} disabled={busy}>Fermer</button></div>
  <fieldset className="rounded-xl border border-teal-200 bg-teal-50/60 p-4 space-y-3" disabled={busy}>
   <legend className="text-sm font-semibold">Publication · tous les comptes</legend>
   <div><p className="text-xs text-slate-500 mb-1.5">Publier avec</p><div className="flex flex-wrap gap-2">{LISTING_PUBLISHERS.map(([key,text])=><button key={key} type="button" aria-pressed={publisher===key} onClick={()=>setPublisher(key)} className={button+(publisher===key?' !border-teal-700 !bg-teal-700 !text-white':'')}>{text}</button>)}</div></div>
   <div><p className="text-xs text-slate-500 mb-1.5">Envoi</p><div className="flex flex-wrap gap-2">{LISTING_MODES.map(([key,text])=><button key={key} type="button" aria-pressed={mode===key} onClick={()=>setMode(key)} className={button+(mode===key?' !border-teal-700 !bg-teal-700 !text-white':'')}>{text}</button>)}</div></div>
  </fieldset>
  <fieldset className="flex flex-wrap gap-2" disabled={busy}><legend className="sr-only">Portée des réglages</legend>
   {[['default','Pour tous les comptes'],['account',`Seulement pour ${account.login}`]].map(([key,label])=><button key={key} type="button" aria-pressed={scope===key} onClick={()=>setScope(key)} className={button+(scope===key?' !border-teal-700 !bg-teal-700 !text-white':'')}>{label}</button>)}
  </fieldset>
  <p className="text-xs text-slate-500 -mt-2">{scope==='account'?`Ces réglages ne concernent que ${account.login}. Les autres comptes gardent les réglages communs.`:`${account.login} suit les réglages communs, comme les autres comptes sans réglage propre.`}</p>
  <fieldset className="grid gap-4 sm:grid-cols-2" disabled={busy}>
   <label className="text-sm font-medium">État par défaut<select className={input+' mt-1.5'} value={form.condition} onChange={e=>change({condition:e.target.value})}>{LISTING_CONDITIONS.map(c=><option key={c}>{c}</option>)}</select></label>
   <label className="text-sm font-medium">Format du colis par défaut<select className={input+' mt-1.5'} value={form.package} onChange={e=>change({package:e.target.value})}>{LISTING_PACKAGES.map(c=><option key={c}>{c}</option>)}</select></label>
   <div className="sm:col-span-2 space-y-3">
    <Check label="Mettre « Sans marque » automatiquement" checked={form.no_brand} onChange={v=>change({no_brand:v})}/>
    <Check label="Terminer le titre par « taille … »" hint="Comme tes titres qui vendent : « … princesse cérémonie taille S »." checked={form.size_in_title} onChange={v=>change({size_in_title:v})}/>
   </div>
   <label className="text-sm font-medium sm:col-span-2">Consignes en plus pour le titre · facultatif<textarea className={input+' mt-1.5 min-h-16'} maxLength={600} value={form.title_rules} placeholder="Ex. toujours écrire « femme » juste après le type d’article" onChange={e=>change({title_rules:e.target.value})}/></label>
   <label className="text-sm font-medium sm:col-span-2">Texte ajouté à la fin de chaque description · facultatif<textarea className={input+' mt-1.5 min-h-20'} maxLength={600} value={form.description_footer} placeholder="Ex. Envoi soigné sous 48 h. N’hésite pas à regarder mes autres articles !" onChange={e=>change({description_footer:e.target.value})}/><span className="block text-xs font-normal text-slate-500 mt-1">Ajouté tel quel, sans modification par l’IA.</span></label>
  </fieldset>
  <fieldset className="rounded-xl bg-slate-50 p-4 space-y-2" disabled={busy}>
   <legend className="text-sm font-semibold">Rédaction automatique · tous les comptes</legend>
   <select aria-label="Modèle de rédaction" className={input} value={model} onChange={e=>setModel(e.target.value)}>{aiModels.map(m=><option key={m.id} value={m.id}>{m.label}</option>)}</select>
   <p className="text-xs text-slate-500">Le modèle « Plus précis » demande des crédits sur ta clé Google AI Studio.</p>
  </fieldset>
  <fieldset className="rounded-xl border border-amber-200 bg-amber-50/60 p-4 space-y-3" disabled={busy}>
   <legend className="text-sm font-semibold">Publication · {account.login}</legend>
   {publisher==='dotb'&&<Check label="Publier via Dotb sur ce compte" hint="Dotb crée l’annonce dans son espace (elle y reste sauvegardée)." checked={dotb} onChange={setDotb}/>}
   <label className="block text-sm font-medium">Espacer les publications de<span className="flex items-center gap-2 mt-1.5"><input className={input+' !w-24'} inputMode="numeric" value={spacing} onChange={e=>setSpacing(e.target.value.replace(/\D/g,''))} aria-label="Minutes entre deux publications"/><span className="font-normal">minutes</span></span></label>
   {publisher==='dotb'&&<p className="text-xs text-amber-900">Vinted détecte l’automatisation de Dotb : des comptes ont déjà été bloqués 24 h. Active-le seulement sur les comptes où tu acceptes ce risque.</p>}
   {publisher==='dotb'&&!serverDotb&&<p className="text-xs text-amber-900 font-medium">L’envoi par Dotb est actuellement coupé pour tout le site. Ton choix sera appliqué quand il sera rallumé.</p>}
  </fieldset>
  {error&&<p role="alert" className="rounded-xl border border-rose-200 bg-rose-50 p-3 text-sm text-rose-800">{error}</p>}
  <div className="flex flex-wrap gap-3 justify-end"><button className={button} onClick={onClose} disabled={busy}>Annuler</button><button className={primary} onClick={save} disabled={busy}>{busy?'Enregistrement…':'Enregistrer les réglages'}</button></div>
 </section>
}
