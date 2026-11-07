import {useEffect,useState} from 'react'
import {buttonClass,primaryClass,fieldClass} from './WorkspaceUI'
import {Section} from './YlaVintTab'

const EXAMPLE=`Je vends des vêtements femme neufs ou comme neufs.
- Envoi sous 24 à 48 h après la vente, bien emballé.
- Mesures : si on me les demande, dis que je les prends et que je reviens vers la personne.
- Remise : jusqu’à 10 % pour un lot de 2 articles ou plus. Jamais de remise sur un seul article sous 10 €.
- Toujours tutoyer, ton chaleureux, une petite touche positive.
- Si quelqu’un demande si l’article est toujours dispo : oui, il peut l’acheter directement.`

// Agent IA : la personnalité et les règles que tu programmes, testables avant de l'activer.
export default function YlaVintAi({request,accounts=[],onAccounts}){
 const [data,setData]=useState(null),[form,setForm]=useState(null),[busy,setBusy]=useState(false),[error,setError]=useState(''),[notice,setNotice]=useState('')
 const [test,setTest]=useState({message:'Bonjour, elle taille comment ? Et vous pouvez faire un prix ?',item_title:'Robe longue satin noire',item_price:25}),[answer,setAnswer]=useState(null)
 const load=()=>request('GET',undefined,'&view=ai').then(r=>{setData(r);setForm(r.config);setError('')}).catch(e=>setError(e.message))
 useEffect(()=>{load()},[])
 const set=(k,v)=>setForm(f=>({...f,[k]:v}))
 async function save(){
  setBusy(true);setError('');setNotice('')
  try{const {version,updated_at,...config}=form;const r=await request('POST',{action:'save_ai',version:data.config.version,config});setNotice(config.enabled?`Agent IA enregistré : il ${config.mode==='auto'?'répond seul (avec un délai)':'propose les réponses, tu valides'}.`:'Agent IA enregistré (coupé).');await load();return r}catch(e){setError(e.message)}finally{setBusy(false)}
 }
 async function tryIt(){
  setBusy(true);setError('');setAnswer(null)
  try{const {version,updated_at,...config}=form;setAnswer(await request('POST',{action:'test_ai',config,...test}))}catch(e){setError(e.message)}finally{setBusy(false)}
 }
 if(!form)return <Section title="Agent IA">{error?<p className="text-sm text-red-700">{error}</p>:<p className="text-sm text-slate-500">Chargement…</p>}</Section>
 const on=accounts.filter(a=>a.settings?.enabled&&a.settings.features.ai)
 return <div className="grid gap-5 xl:grid-cols-[1fr_24rem]">
  <Section title="Agent IA de réponse" hint="L’agent lit chaque nouveau message d’acheteur et prépare une réponse avec tes consignes. Il ne propose jamais de paiement ni de contact hors Vinted, n’invente rien sur l’article, et laisse les litiges, retours et colis abîmés à toi."
   aside={<label className="flex items-center gap-2 text-sm font-semibold"><input type="checkbox" checked={form.enabled} onChange={e=>set('enabled',e.target.checked)}/> Agent IA actif</label>}>
   {!data.ready&&<p className="rounded-xl border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">La clé Gemini du site est absente (variable GEMINI_API_KEY sur Vercel) : l’agent ne peut pas rédiger.</p>}
   <fieldset className="grid gap-2 sm:grid-cols-2">
    {[['suggest','Proposer les réponses','Tu valides chaque réponse d’un geste, sur le site ou le téléphone.'],['auto','Répondre seul','Il envoie après un délai naturel. Les messages sensibles te restent.']].map(([k,l,h])=>
     <label key={k} className={`cursor-pointer rounded-xl border p-3 ${form.mode===k?'border-teal-600 bg-teal-50/60':'border-slate-200'}`}><span className="flex items-center gap-2 text-sm font-semibold"><input type="radio" name="ai-mode" checked={form.mode===k} onChange={()=>set('mode',k)}/>{l}</span><span className="mt-1 block text-xs text-slate-500">{h}</span></label>)}
   </fieldset>
   <label className="block text-sm font-medium">Tes consignes <span className="font-normal text-slate-500">(ton, règles de la boutique, remises, délais, réponses types)</span>
    <textarea className={fieldClass+' mt-1 font-mono text-[13px]'} rows={12} maxLength={6000} placeholder={EXAMPLE} value={form.instructions} onChange={e=>set('instructions',e.target.value)}/></label>
   {!form.instructions&&<button className="text-xs text-teal-700 underline" onClick={()=>set('instructions',EXAMPLE)}>Partir de l’exemple</button>}
   <div className="grid gap-3 sm:grid-cols-2">
    <label className="block text-xs text-slate-600">Signature (facultatif)<input className={fieldClass+' mt-1'} maxLength={120} value={form.signature} onChange={e=>set('signature',e.target.value)} placeholder="Belle journée ✨"/></label>
    <label className="block text-xs text-slate-600">Modèle<select className={fieldClass+' mt-1'} value={form.model} onChange={e=>set('model',e.target.value)}>{data.models.map(m=><option key={m.id} value={m.id}>{m.label}</option>)}</select></label>
   </div>
   <label className="block text-xs text-slate-600">Mots qui te laissent la main (séparés par des virgules)<textarea className={fieldClass+' mt-1'} rows={2} maxLength={800} value={form.human_keywords} onChange={e=>set('human_keywords',e.target.value)}/></label>
   {form.mode==='auto'&&<div className="grid grid-cols-3 gap-3">
    <label className="block text-xs text-slate-600">Délai minimum<span className="mt-1 flex items-center gap-1"><input type="number" className={fieldClass+' py-1.5'} min={10} max={3600} value={form.delay_min_seconds} onChange={e=>set('delay_min_seconds',Number(e.target.value))}/><span className="text-slate-400">s</span></span></label>
    <label className="block text-xs text-slate-600">Délai maximum<span className="mt-1 flex items-center gap-1"><input type="number" className={fieldClass+' py-1.5'} min={10} max={7200} value={form.delay_max_seconds} onChange={e=>set('delay_max_seconds',Number(e.target.value))}/><span className="text-slate-400">s</span></span></label>
    <label className="block text-xs text-slate-600">Réponses seules par conversation<input type="number" className={fieldClass+' mt-1 py-1.5'} min={0} max={20} value={form.max_auto_per_conversation} onChange={e=>set('max_auto_per_conversation',Number(e.target.value))}/></label>
   </div>}
   <p className="text-xs text-slate-500">Comptes avec l’agent IA : {on.length?on.map(a=>a.login).join(', '):<>aucun — <button className="underline" onClick={onAccounts}>active « Agent IA » et « Messagerie centralisée » sur un compte</button></>}. Les réponses seules respectent la plage horaire et les plafonds de réponses du compte.</p>
   {error&&<p role="alert" className="text-sm text-red-700">{error}</p>}
   {notice&&<p role="status" className="text-sm text-teal-800">{notice}</p>}
   <div className="flex justify-end"><button className={primaryClass} disabled={busy} onClick={save}>Enregistrer l’agent IA</button></div>
  </Section>
  <Section title="Tester" hint="Rien n’est envoyé : tu vois ce que l’agent répondrait avec les réglages ci-contre (même non enregistrés).">
   <label className="block text-xs text-slate-600">Message de l’acheteur<textarea className={fieldClass+' mt-1'} rows={3} value={test.message} onChange={e=>setTest({...test,message:e.target.value})}/></label>
   <div className="grid grid-cols-[1fr_6rem] gap-2"><label className="block text-xs text-slate-600">Article<input className={fieldClass+' mt-1 py-1.5'} value={test.item_title} onChange={e=>setTest({...test,item_title:e.target.value})}/></label>
    <label className="block text-xs text-slate-600">Prix<input type="number" className={fieldClass+' mt-1 py-1.5'} value={test.item_price} onChange={e=>setTest({...test,item_price:e.target.value})}/></label></div>
   <button className={buttonClass+' w-full'} disabled={busy||!test.message.trim()} onClick={tryIt}>{busy?'Rédaction…':'Voir la réponse'}</button>
   {answer&&<div className="space-y-2"><div className="rounded-2xl rounded-br-md bg-[#08664c] px-3.5 py-2 text-sm text-white"><p className="whitespace-pre-wrap">{answer.reply||'—'}</p></div>
    {answer.needs_human&&<p className="rounded-xl bg-amber-50 p-2 text-xs text-amber-900">Ce message te serait laissé{answer.reason?` : ${answer.reason}`:''}.</p>}</div>}
  </Section>
 </div>
}
