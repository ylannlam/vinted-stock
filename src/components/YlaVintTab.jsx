import {useEffect,useMemo,useState,lazy,Suspense} from 'react'
import {buttonClass,primaryClass,fieldClass} from './WorkspaceUI'
import VintedWatchPanel,{vintedWatchRequest} from './VintedWatchPanel'

const YlaVintInbox=lazy(()=>import('./YlaVintInbox'))
const YlaVintAi=lazy(()=>import('./YlaVintAi'))
const YlaVintWardrobe=lazy(()=>import('./YlaVintWardrobe'))
const YlaVintSales=lazy(()=>import('./YlaVintSales'))

export const ylavintRequest=(method='GET',body,query='')=>import('../lib/api').then(m=>m.resourcesRequest(method,body,`?scope=agent${query}`))
export const when=v=>v?new Date(v).toLocaleString('fr-FR',{day:'2-digit',month:'short',hour:'2-digit',minute:'2-digit',timeZone:'Europe/Paris'}):'—'
export const compactClass=fieldClass.replace('w-full ','')
export const SECTIONS=[['accueil','Tableau de bord'],['messagerie','Messagerie'],['ia','Agent IA'],['dressing','Dressing'],['ventes','Ventes'],['publication','Publication'],['reglages','Réglages'],['journal','Journal']]
export const FEATURES=[['inbox','Messagerie centralisée'],['ai','Agent IA'],['orders','Lecture des ventes'],['sales','Ventes → onglet Ventes'],['labels','Bordereaux'],['dressing','Dressing'],['unmask','Démasquage'],['pricing','Prix & cycle de vie'],['publish','Publication'],['likes','Messages aux likes']]
const STATES={queued:'en attente',running:'en cours',done:'terminée',failed:'échec',cancelled:'annulée'}
const LEVELS={info:'text-slate-600',warn:'text-amber-700',error:'text-rose-700'}
const ALERTS={temporary:'Bloqué temporairement',restricted:'Restreint',permanent:'Bloqué définitivement',blocked:'Bloqué'}
// Bridge connecté : l'extension s'est signalée dans les 15 dernières minutes.
export const bridgeOnline=a=>!!a.last_seen_at&&Date.now()-Date.parse(a.last_seen_at)<15*60000

export function Stat({value,label,tone='slate',onClick}){
 const tones={teal:'text-teal-700',amber:'text-amber-700',rose:'text-rose-700',pink:'text-[#c83469]',slate:'text-slate-800'}
 const Tag=onClick?'button':'div'
 return <Tag onClick={onClick} className={`rounded-2xl border border-slate-200 bg-white px-4 py-3 text-left ${onClick?'hover:border-teal-300':''}`}><p className={`text-2xl font-bold tabular-nums ${tones[tone]}`}>{value}</p><p className="mt-0.5 text-xs text-slate-500">{label}</p></Tag>
}
export function Section({title,hint,aside,children}){
 return <section className="space-y-3 rounded-2xl border border-slate-200 bg-white p-4 sm:p-5">
  <header className="flex flex-wrap items-start justify-between gap-2"><div className="min-w-0"><h2 className="font-semibold">{title}</h2>{hint&&<p className="mt-1 text-xs text-slate-500">{hint}</p>}</div>{aside}</header>
  {children}
 </section>
}
const Num=({label,value,onChange,step=1,min=0,max,suffix})=><label className="block text-xs text-slate-600">{label}
 <span className="mt-1 flex items-center gap-1"><input type="number" className={fieldClass+' py-1.5'} value={value} step={step} min={min} max={max} onChange={e=>onChange(e.target.value===''?'':Number(e.target.value))}/>{suffix&&<span className="text-slate-400">{suffix}</span>}</span></label>
const Legend=({children})=><legend className="col-span-full text-xs font-semibold uppercase tracking-wide text-slate-500">{children}</legend>

function AccountSettings({account,defaults,onSave,busy}){
 const start=account.settings||{...structuredClone(defaults),enabled:false,version:0}
 const [form,setForm]=useState(()=>({...structuredClone(start),messaging:{...defaults.messaging,...(start.messaging||{})}}))
 const set=(group,key,value)=>setForm(f=>({...f,[group]:{...f[group],[key]:value}}))
 return <div className="mt-3 space-y-4 rounded-xl bg-slate-50 p-3">
  <label className="flex items-center gap-2 text-sm font-medium"><input type="checkbox" checked={form.enabled} onChange={e=>setForm({...form,enabled:e.target.checked})}/> YlaVint actif sur ce compte</label>
  <fieldset><Legend>Fonctions</Legend>
   <div className="mt-2 grid gap-2 sm:grid-cols-2 lg:grid-cols-3">{FEATURES.map(([k,l])=><label key={k} className="flex items-center gap-1.5 text-sm"><input type="checkbox" checked={!!form.features[k]} onChange={e=>set('features',k,e.target.checked)}/>{l}</label>)}</div>
   <p className="mt-2 text-xs text-slate-500">« Ventes → onglet Ventes » remplace le webhook Dotb pour ce compte : coupe d’abord Dotb sur ce compte pour éviter deux sources. Une vente déjà reçue de Dotb n’est jamais dupliquée.</p>
  </fieldset>
  <fieldset className="grid grid-cols-2 gap-3 sm:grid-cols-3"><Legend>Messagerie</Legend>
   <Num label="Relire la messagerie toutes les" value={form.messaging.sync_minutes} min={2} max={120} suffix="min" onChange={v=>set('messaging','sync_minutes',v)}/>
   <Num label="Réponses / jour" value={form.messaging.reply_per_day} max={300} onChange={v=>set('messaging','reply_per_day',v)}/>
   <Num label="Écart entre deux réponses" value={form.messaging.reply_gap_seconds} min={10} max={600} suffix="s" onChange={v=>set('messaging','reply_gap_seconds',v)}/>
  </fieldset>
  <fieldset className="grid grid-cols-2 gap-3 sm:grid-cols-4"><Legend>Plafonds des modifications (heure de Paris)</Legend>
   <Num label="De" value={form.limits.from_hour} max={23} suffix="h" onChange={v=>set('limits','from_hour',v)}/>
   <Num label="À" value={form.limits.to_hour} max={23} suffix="h" onChange={v=>set('limits','to_hour',v)}/>
   <Num label="Modifications / jour" value={form.limits.writes_per_day} max={200} onChange={v=>set('limits','writes_per_day',v)}/>
   <Num label="Écart minimal" value={form.limits.min_gap_minutes} min={1} max={240} suffix="min" onChange={v=>set('limits','min_gap_minutes',v)}/>
   <Num label="Démasquages / jour" value={form.limits.unmask_item_per_day} max={100} onChange={v=>set('limits','unmask_item_per_day',v)}/>
   <Num label="Baisses de prix / jour" value={form.limits.reprice_item_per_day} max={100} onChange={v=>set('limits','reprice_item_per_day',v)}/>
   <Num label="Publications / jour" value={form.limits.publish_item_per_day} max={100} onChange={v=>set('limits','publish_item_per_day',v)}/>
   <Num label="Messages aux likes / jour" value={form.limits.like_message_per_day} max={100} onChange={v=>set('limits','like_message_per_day',v)}/>
  </fieldset>
  <fieldset className="grid grid-cols-2 gap-3 sm:grid-cols-5"><Legend>Démasquage</Legend>
   <Num label="Baisse par réparation" value={form.unmask.price_drop} step={0.5} max={10} suffix="€" onChange={v=>set('unmask','price_drop',v)}/>
   <Num label="Baisse maximale" value={form.unmask.max_drop} step={0.5} max={50} suffix="€" onChange={v=>set('unmask','max_drop',v)}/>
   <Num label="Jamais sous" value={form.unmask.floor} min={1} step={0.5} suffix="€" onChange={v=>set('unmask','floor',v)}/>
   <Num label="Réparations max" value={form.unmask.max_repairs} max={10} onChange={v=>set('unmask','max_repairs',v)}/>
   <Num label="Attente entre deux" value={form.unmask.wait_hours} min={1} max={168} suffix="h" onChange={v=>set('unmask','wait_hours',v)}/>
  </fieldset>
  <fieldset className="grid grid-cols-2 gap-3 sm:grid-cols-5"><Legend>Prix & cycle de vie</Legend>
   <Num label="Première baisse après" value={form.pricing.after_days} min={1} max={90} suffix="j" onChange={v=>set('pricing','after_days',v)}/>
   <Num label="Baisse" value={form.pricing.step} min={0.5} step={0.5} max={20} suffix="€" onChange={v=>set('pricing','step',v)}/>
   <Num label="Puis tous les" value={form.pricing.every_days} min={1} max={60} suffix="j" onChange={v=>set('pricing','every_days',v)}/>
   <Num label="Baisse maximale" value={form.pricing.max_drop} max={200} suffix="€" onChange={v=>set('pricing','max_drop',v)}/>
   <Num label="Jamais sous" value={form.pricing.floor} min={1} step={0.5} suffix="€" onChange={v=>set('pricing','floor',v)}/>
  </fieldset>
  <fieldset className="grid gap-3 sm:grid-cols-[1fr_10rem]"><Legend>Messages aux likes</Legend>
   <label className="block text-xs text-slate-600">Message <span className="text-slate-400">({'{article}'} et {'{prix}'} sont remplacés)</span><textarea className={fieldClass+' mt-1'} rows={2} maxLength={500} value={form.likes.message} onChange={e=>set('likes','message',e.target.value)}/></label>
   <Num label="Attente après le like" value={form.likes.wait_minutes} min={5} max={1440} suffix="min" onChange={v=>set('likes','wait_minutes',v)}/>
  </fieldset>
  <div className="flex justify-end"><button className={primaryClass} disabled={busy} onClick={()=>onSave(form)}>Enregistrer</button></div>
 </div>
}

function AccountRow({a,data,busy,act,open,setOpen,onInbox}){
 const s=a.settings,online=bridgeOnline(a),unread=data.unread_by_account?.[a.id]||0
 return <li className="py-3">
  <div className="flex flex-wrap items-center justify-between gap-2">
   <div className="min-w-0">
    <p className="flex flex-wrap items-center gap-2 font-medium"><span className={`h-2.5 w-2.5 rounded-full ${online?'bg-emerald-500':'bg-slate-300'}`} title={online?'Bridge connecté':'Bridge non connecté'}/>{a.login||'Compte sans pseudo'}
     {a.alert&&<span className="rounded-full bg-rose-50 px-2 py-0.5 text-xs text-rose-700">{ALERTS[a.alert.status]||a.alert.title}</span>}
     {unread>0&&<button onClick={onInbox} className="rounded-full bg-[#c83469] px-2 py-0.5 text-xs text-white">{unread} non lu{unread>1?'s':''}</button>}</p>
    <p className="text-xs text-slate-500">{online?`Bridge connecté · ${when(a.last_seen_at)}`:a.last_seen_at?`Bridge vu ${when(a.last_seen_at)}`:'Bridge jamais vu'}{a.extension_version?` · v${a.extension_version}`:''} · {!s?.enabled?'YlaVint non activé':s.paused?`En pause · ${s.pause_reason||''}`:`Actif · ${FEATURES.filter(([k])=>s.features[k]).map(([,l])=>l).join(', ')||'aucune fonction'} · ${a.today.writes||0}/${s.limits.writes_per_day} modif. aujourd’hui`}</p>
   </div>
   <div className="flex flex-wrap gap-2">
    {s?.enabled&&(s.paused?<button className={buttonClass+' py-1.5'} disabled={busy||!!a.alert} title={a.alert?'Le compte a une alerte Vinted en cours':''} onClick={()=>act({action:'resume',account_id:a.id},'YlaVint relancé.')}>Reprendre</button>
     :<button className={buttonClass+' py-1.5'} disabled={busy} onClick={()=>act({action:'pause',account_id:a.id},'YlaVint mis en pause.')}>Pause</button>)}
    {s?.enabled&&!s.paused&&<select className={compactClass+' py-1.5'} value="" disabled={busy} onChange={e=>e.target.value&&act({action:'enqueue',account_id:a.id,kind:e.target.value},'Lecture demandée à YlaVint.')}>
     <option value="">Lire maintenant…</option><option value="sync_inbox">La messagerie</option><option value="scan_wardrobe">Le dressing</option><option value="sync_orders">Les ventes</option><option value="scan_likes">Les likes</option></select>}
    <button className={buttonClass+' py-1.5'} aria-expanded={open===a.id} onClick={()=>setOpen(open===a.id?null:a.id)}>{open===a.id?'Fermer':'Régler'}</button>
   </div>
  </div>
  {open===a.id&&<AccountSettings account={a} defaults={data.defaults} busy={busy} onSave={form=>act({action:'save_settings',account_id:a.id,enabled:form.enabled,version:s?.version,settings:{features:form.features,limits:form.limits,unmask:form.unmask,pricing:form.pricing,likes:form.likes,messaging:form.messaging}},'Réglages enregistrés.')}/>}
 </li>
}

function readSection(){const [,sub]=window.location.hash.slice(1).split('?')[0].split('/');return SECTIONS.some(([k])=>k===sub)?sub:'accueil'}

export default function YlaVintTab({request=ylavintRequest,watchRequest=vintedWatchRequest}){
 const [section,setSectionState]=useState(readSection)
 const [data,setData]=useState(null),[error,setError]=useState(''),[busy,setBusy]=useState(false),[open,setOpen]=useState(null),[filter,setFilter]=useState(''),[picked,setPicked]=useState(()=>new Set()),[notice,setNotice]=useState('')
 const setSection=s=>{setSectionState(s);const hash=`#ylavint/${s}`;if(window.location.hash!==hash)history.replaceState(null,'',hash)}
 useEffect(()=>{const f=()=>setSectionState(readSection());window.addEventListener('hashchange',f);return()=>window.removeEventListener('hashchange',f)},[])
 const load=()=>request('GET').then(r=>{setData(r);setError('')}).catch(e=>setError(e.message))
 useEffect(()=>{load();const t=setInterval(()=>{if(document.visibilityState==='visible')load()},30000);return()=>clearInterval(t)},[])
 async function act(body,message){
  setBusy(true);setError('');setNotice('')
  try{const r=await request('POST',body);if(message)setNotice(typeof message==='function'?message(r):message);await load();return r}catch(e){setError(e.message)}finally{setBusy(false)}
 }
 const logins=useMemo(()=>new Map((data?.accounts||[]).map(a=>[a.id,a.login])),[data])
 if(!data)return <main className="workspace-page mx-auto max-w-screen-2xl p-4 text-slate-800 sm:p-6">{error?<p role="alert" className="text-sm text-red-700">{error}</p>:<p className="text-sm text-slate-500">Chargement de YlaVint…</p>}</main>
 const accounts=data.accounts,active=accounts.filter(a=>a.settings?.enabled),paused=active.filter(a=>a.settings.paused),online=accounts.filter(bridgeOnline)
 const queued=data.tasks.filter(t=>t.state==='queued').length,writes=active.reduce((n,a)=>n+(a.today.writes||0),0),cap=active.reduce((n,a)=>n+a.settings.limits.writes_per_day,0)
 const learned=data.recipes.filter(r=>r.learned_at||r.default).length
 const shown=accounts.filter(a=>!filter||a.login?.toLowerCase().includes(filter.toLowerCase())).sort((a,b)=>(b.settings?.enabled?1:0)-(a.settings?.enabled?1:0)||(bridgeOnline(b)?1:0)-(bridgeOnline(a)?1:0))
 const publishable=new Set(active.filter(a=>a.settings.features.publish).map(a=>a.id))
 const unread=data.unread_total||0
 const accountList=<Section title={`Comptes (${accounts.length})`} hint="Point vert : le Bridge YlaVint de ce profil s’est signalé il y a moins de 15 min. Commence par un compte de test et une ou deux fonctions, puis élargis." aside={<input className={compactClass+' w-48 py-1.5'} placeholder="Rechercher un compte" value={filter} onChange={e=>setFilter(e.target.value)}/>}>
  <ul className="divide-y divide-slate-100">{shown.map(a=><AccountRow key={a.id} a={a} data={data} busy={busy} act={act} open={open} setOpen={setOpen} onInbox={()=>setSection('messagerie')}/>)}</ul>
 </Section>
 return <main className="workspace-page mx-auto max-w-screen-2xl space-y-5 p-3 text-slate-800 sm:p-6">
  <header className="flex flex-wrap items-center justify-between gap-3">
   <div className="flex items-center gap-3">
    <span className="relative grid h-12 w-12 place-items-center rounded-2xl bg-[#08664c] text-2xl font-black text-white shadow-[0_8px_20px_#08664c44]">Y<span className="absolute right-1.5 top-1.5 h-2 w-2 rounded-full bg-amber-300"/></span>
    <div><h1 className="text-2xl font-bold tracking-tight">YlaVint</h1>
     <p className="text-sm text-slate-500">{online.length} Bridge{online.length>1?'s':''} connecté{online.length>1?'s':''} · {active.length-paused.length} compte{active.length-paused.length>1?'s':''} actif{active.length-paused.length>1?'s':''}{paused.length?` · ${paused.length} en pause`:''}</p></div>
   </div>
   <div className="flex gap-2"><button className={buttonClass} onClick={load} disabled={busy}>Actualiser</button>
    <button className={buttonClass+' text-rose-700'} disabled={busy||!active.length} onClick={()=>window.confirm('Mettre YlaVint en pause sur tous les comptes ?')&&act({action:'pause_all'},r=>`${r.paused} compte(s) mis en pause.`)}>Tout mettre en pause</button></div>
  </header>
  <nav aria-label="Rubriques YlaVint" className="-mx-3 flex gap-1 overflow-x-auto px-3 pb-1 sm:mx-0 sm:px-0">{SECTIONS.map(([k,l])=><button key={k} aria-current={section===k?'page':undefined} onClick={()=>setSection(k)}
   className={`shrink-0 rounded-xl px-3.5 py-2 text-sm font-medium ${section===k?'bg-[#08664c] text-white':'bg-white text-slate-600 ring-1 ring-slate-200 hover:bg-slate-50'}`}>{l}{k==='messagerie'&&unread>0&&<span className={`ml-1.5 rounded-full px-1.5 text-xs ${section===k?'bg-white/25':'bg-[#c83469] text-white'}`}>{unread}</span>}</button>)}</nav>
  {error&&<p role="alert" className="rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-700">{error}</p>}
  {notice&&<p role="status" className="rounded-xl border border-teal-200 bg-teal-50 p-3 text-sm text-teal-800">{notice}</p>}

  <Suspense fallback={<p className="text-sm text-slate-500">Chargement…</p>}>
  {section==='accueil'&&<>
   <div className="grid grid-cols-2 gap-3 sm:grid-cols-4 lg:grid-cols-8">
    <Stat value={online.length} label="Bridges connectés" tone="teal"/>
    <Stat value={active.length-paused.length} label="Comptes actifs" tone="teal"/>
    <Stat value={paused.length} label="En pause" tone={paused.length?'amber':'slate'}/>
    <Stat value={unread} label="Messages non lus" tone={unread?'pink':'slate'} onClick={()=>setSection('messagerie')}/>
    <Stat value={data.human_total||0} label="À traiter toi-même" tone={data.human_total?'amber':'slate'} onClick={()=>setSection('messagerie')}/>
    <Stat value={queued} label="Tâches en attente"/>
    <Stat value={`${writes} / ${cap}`} label="Modifications aujourd’hui"/>
    <Stat value={data.hidden.filter(h=>h.state==='hidden').length} label="Annonces masquées" tone={data.hidden.length?'rose':'slate'} onClick={()=>setSection('dressing')}/>
   </div>
   {!data.ai_ready&&<p className="rounded-xl border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">La clé Gemini du site est absente : l’agent IA ne pourra pas rédiger de réponses.</p>}
   <VintedWatchPanel request={watchRequest}/>
   {accountList}
  </>}
  {section==='messagerie'&&<YlaVintInbox request={request} accounts={accounts}/>}
  {section==='ia'&&<YlaVintAi request={request} accounts={accounts} onAccounts={()=>setSection('reglages')}/>}
  {section==='dressing'&&<YlaVintWardrobe request={request} accounts={accounts}/>}
  {section==='ventes'&&<YlaVintSales request={request} accounts={accounts}/>}
  {section==='publication'&&<Section title="Publication par YlaVint" hint="Fiches prêtes de l’onglet Annonces. YlaVint les publie au créneau prévu (ou les espace de 15 à 45 min), dans les plafonds du compte. Tu peux aussi publier directement depuis l’atelier d’annonces avec le bouton « Publier avec YlaVint ». Il faut avoir appris « Envoi d’une photo » et « Création d’une annonce »."
   aside={<button className={primaryClass} disabled={busy||!picked.size} onClick={()=>act({action:'publish_drafts',ids:[...picked]},r=>`${r.queued} fiche(s) confiée(s) à YlaVint.${r.refused?.length?` ${r.refused.length} refusée(s) : ${[...new Set(r.refused.map(x=>x.reason))].join(' ; ')}.`:''}`).then(()=>setPicked(new Set()))}>Envoyer à YlaVint ({picked.size})</button>}>
   {data.drafts.length?<ul className="divide-y divide-slate-100 text-sm">{data.drafts.map(d=><li key={d.id} className="flex items-center gap-3 py-2">
    <input type="checkbox" aria-label={`Choisir ${d.title}`} checked={picked.has(d.id)} disabled={!publishable.has(d.account_id)} onChange={e=>setPicked(p=>{const n=new Set(p);e.target.checked?n.add(d.id):n.delete(d.id);return n})}/>
    <span className="min-w-0 flex-1 truncate">{d.title}</span><span className="text-xs text-slate-500">{logins.get(d.account_id)||'compte ?'} · {d.price?`${d.price} €`:'sans prix'} · {d.photos} photo(s){!publishable.has(d.account_id)?' · publication non activée sur ce compte':''}</span>
   </li>)}</ul>:<p className="text-sm text-slate-500">Aucune fiche prête.</p>}
  </Section>}
  {section==='reglages'&&<>
   {accountList}
   <Section title={`Actions connues (${learned}/${data.recipes.length})`} hint="Les lectures (dressing, ventes, likes, messagerie) marchent dès le départ. Les actions qui modifient Vinted (envoyer un message, modifier, publier) ne partent jamais sans avoir été faites une fois à la main avec le mode apprentissage du popup YlaVint, sur un compte de test : une seule fois suffit pour tous les comptes.">
    <ul className="divide-y divide-slate-100 text-sm">{data.recipes.map(r=><li key={r.kind} className="flex flex-wrap items-center justify-between gap-2 py-2">
     <div><p className="font-medium">{r.label} {r.learned_at?<span className="ml-1 rounded-full bg-teal-50 px-2 py-0.5 text-xs text-teal-700">apprise</span>:r.default?<span className="ml-1 rounded-full bg-slate-100 px-2 py-0.5 text-xs text-slate-600">lecture par défaut</span>:<span className="ml-1 rounded-full bg-amber-50 px-2 py-0.5 text-xs text-amber-700">à apprendre</span>}</p>
      <p className="text-xs text-slate-500">{r.learned_at?`${r.method} ${r.path} · ${when(r.learned_at)}${r.learned_login?` · ${r.learned_login}`:''}`:r.how}</p></div>
     {r.learned_at&&<button className="text-xs text-slate-500 underline" disabled={busy} onClick={()=>window.confirm('Oublier cette action ? Il faudra la refaire en mode apprentissage.')&&act({action:'forget_recipe',kind:r.kind})}>Oublier</button>}
    </li>)}</ul>
   </Section>
  </>}
  {section==='journal'&&<div className="grid gap-5 lg:grid-cols-2">
   <Section title="File de tâches">
    <ul className="divide-y divide-slate-100 text-sm">{data.tasks.slice(0,60).map(t=><li key={t.id} className="flex items-center justify-between gap-2 py-1.5">
     <span className="min-w-0 truncate">{data.kinds[t.kind]?.label||t.kind} · {logins.get(t.account_id)}{t.error?<span className="text-rose-700"> · {t.error}</span>:''}</span>
     <span className="shrink-0 text-xs text-slate-500">{STATES[t.state]} · {when(t.state==='queued'?t.not_before:t.finished_at||t.started_at)}{t.state==='queued'&&<button className="ml-2 underline" disabled={busy} onClick={()=>act({action:'cancel',task_id:t.id})}>Annuler</button>}</span>
    </li>)}{!data.tasks.length&&<li className="py-2 text-slate-500">Aucune tâche.</li>}</ul>
   </Section>
   <Section title="Journal">
    <ul className="divide-y divide-slate-100 text-sm">{data.log.slice(0,80).map(l=><li key={l.id} className={`py-1.5 ${LEVELS[l.level]}`}><span className="text-xs text-slate-400">{when(l.created_at)}{l.account_id?` · ${logins.get(l.account_id)||''}`:''}</span> {l.message}</li>)}
     {!data.log.length&&<li className="py-2 text-slate-500">Rien pour l’instant.</li>}</ul>
   </Section>
  </div>}
  </Suspense>
 </main>
}
