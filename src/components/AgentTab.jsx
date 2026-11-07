import {useEffect,useMemo,useState} from 'react'
import {buttonClass,primaryClass,fieldClass} from './WorkspaceUI'
import VintedWatchPanel,{vintedWatchRequest} from './VintedWatchPanel'

export const agentRequest=(method='GET',body)=>import('../lib/api').then(m=>m.resourcesRequest(method,body,'?scope=agent'))
const when=v=>v?new Date(v).toLocaleString('fr-FR',{day:'2-digit',month:'short',hour:'2-digit',minute:'2-digit',timeZone:'Europe/Paris'}):'—'
const compactClass=fieldClass.replace('w-full ','')
const FEATURES=[['orders','Ventes'],['labels','Bordereaux'],['unmask','Démasquage'],['pricing','Prix & cycle de vie'],['publish','Publication'],['likes','Messages aux likes']]
const STATES={queued:'en attente',running:'en cours',done:'terminée',failed:'échec',cancelled:'annulée'}
const LEVELS={info:'text-slate-600',warn:'text-amber-700',error:'text-rose-700'}
const ALERTS={temporary:'Bloqué temporairement',restricted:'Restreint',permanent:'Bloqué définitivement',blocked:'Bloqué'}

function Stat({value,label,tone='slate'}){
 const tones={teal:'text-teal-700',amber:'text-amber-700',rose:'text-rose-700',slate:'text-slate-800'}
 return <div className="rounded-2xl border border-slate-200 bg-white px-4 py-3"><p className={`text-2xl font-bold ${tones[tone]}`}>{value}</p><p className="text-xs text-slate-500 mt-0.5">{label}</p></div>
}
function Section({title,hint,aside,children}){
 return <section className="rounded-2xl border border-slate-200 bg-white p-4 sm:p-5 space-y-3">
  <header className="flex flex-wrap items-start justify-between gap-2"><div><h2 className="font-semibold">{title}</h2>{hint&&<p className="mt-1 text-xs text-slate-500">{hint}</p>}</div>{aside}</header>
  {children}
 </section>
}
const Num=({label,value,onChange,step=1,min=0,max,suffix})=><label className="block text-xs text-slate-600">{label}
 <span className="mt-1 flex items-center gap-1"><input type="number" className={fieldClass+' py-1.5'} value={value} step={step} min={min} max={max} onChange={e=>onChange(e.target.value===''?'':Number(e.target.value))}/>{suffix&&<span className="text-slate-400">{suffix}</span>}</span></label>

function AccountSettings({account,defaults,onSave,busy}){
 const start=account.settings||{...defaults,enabled:false,version:0}
 const [form,setForm]=useState(()=>structuredClone(start))
 const set=(group,key,value)=>setForm(f=>({...f,[group]:{...f[group],[key]:value}}))
 return <div className="mt-3 space-y-4 rounded-xl bg-slate-50 p-3">
  <label className="flex items-center gap-2 text-sm font-medium"><input type="checkbox" checked={form.enabled} onChange={e=>setForm({...form,enabled:e.target.checked})}/> Agent actif sur ce compte</label>
  <fieldset><legend className="text-xs font-semibold uppercase tracking-wide text-slate-500">Fonctions</legend>
   <div className="mt-2 flex flex-wrap gap-3">{FEATURES.map(([k,l])=><label key={k} className="flex items-center gap-1.5 text-sm"><input type="checkbox" checked={!!form.features[k]} onChange={e=>set('features',k,e.target.checked)}/>{l}</label>)}</div>
  </fieldset>
  <fieldset className="grid grid-cols-2 gap-3 sm:grid-cols-4"><legend className="col-span-full text-xs font-semibold uppercase tracking-wide text-slate-500">Plafonds (heure de Paris)</legend>
   <Num label="De" value={form.limits.from_hour} max={23} suffix="h" onChange={v=>set('limits','from_hour',v)}/>
   <Num label="À" value={form.limits.to_hour} max={23} suffix="h" onChange={v=>set('limits','to_hour',v)}/>
   <Num label="Modifications / jour" value={form.limits.writes_per_day} max={200} onChange={v=>set('limits','writes_per_day',v)}/>
   <Num label="Écart minimal" value={form.limits.min_gap_minutes} min={1} max={240} suffix="min" onChange={v=>set('limits','min_gap_minutes',v)}/>
   <Num label="Démasquages / jour" value={form.limits.unmask_item_per_day} max={100} onChange={v=>set('limits','unmask_item_per_day',v)}/>
   <Num label="Baisses de prix / jour" value={form.limits.reprice_item_per_day} max={100} onChange={v=>set('limits','reprice_item_per_day',v)}/>
   <Num label="Publications / jour" value={form.limits.publish_item_per_day} max={100} onChange={v=>set('limits','publish_item_per_day',v)}/>
   <Num label="Messages aux likes / jour" value={form.limits.like_message_per_day} max={100} onChange={v=>set('limits','like_message_per_day',v)}/>
  </fieldset>
  <fieldset className="grid grid-cols-2 gap-3 sm:grid-cols-5"><legend className="col-span-full text-xs font-semibold uppercase tracking-wide text-slate-500">Démasquage</legend>
   <Num label="Baisse par réparation" value={form.unmask.price_drop} step={0.5} max={10} suffix="€" onChange={v=>set('unmask','price_drop',v)}/>
   <Num label="Baisse maximale" value={form.unmask.max_drop} step={0.5} max={50} suffix="€" onChange={v=>set('unmask','max_drop',v)}/>
   <Num label="Jamais sous" value={form.unmask.floor} min={1} step={0.5} suffix="€" onChange={v=>set('unmask','floor',v)}/>
   <Num label="Réparations max" value={form.unmask.max_repairs} max={10} onChange={v=>set('unmask','max_repairs',v)}/>
   <Num label="Attente entre deux" value={form.unmask.wait_hours} min={1} max={168} suffix="h" onChange={v=>set('unmask','wait_hours',v)}/>
  </fieldset>
  <fieldset className="grid grid-cols-2 gap-3 sm:grid-cols-5"><legend className="col-span-full text-xs font-semibold uppercase tracking-wide text-slate-500">Prix & cycle de vie</legend>
   <Num label="Première baisse après" value={form.pricing.after_days} min={1} max={90} suffix="j" onChange={v=>set('pricing','after_days',v)}/>
   <Num label="Baisse" value={form.pricing.step} min={0.5} step={0.5} max={20} suffix="€" onChange={v=>set('pricing','step',v)}/>
   <Num label="Puis tous les" value={form.pricing.every_days} min={1} max={60} suffix="j" onChange={v=>set('pricing','every_days',v)}/>
   <Num label="Baisse maximale" value={form.pricing.max_drop} max={200} suffix="€" onChange={v=>set('pricing','max_drop',v)}/>
   <Num label="Jamais sous" value={form.pricing.floor} min={1} step={0.5} suffix="€" onChange={v=>set('pricing','floor',v)}/>
  </fieldset>
  <fieldset className="grid gap-3 sm:grid-cols-[1fr_10rem]"><legend className="col-span-full text-xs font-semibold uppercase tracking-wide text-slate-500">Messages aux likes</legend>
   <label className="block text-xs text-slate-600">Message<textarea className={fieldClass+' mt-1'} rows={2} maxLength={500} value={form.likes.message} onChange={e=>set('likes','message',e.target.value)}/></label>
   <Num label="Attente après le like" value={form.likes.wait_minutes} min={5} max={1440} suffix="min" onChange={v=>set('likes','wait_minutes',v)}/>
  </fieldset>
  <div className="flex justify-end"><button className={primaryClass} disabled={busy} onClick={()=>onSave(form)}>Enregistrer</button></div>
 </div>
}

export default function AgentTab({request=agentRequest,watchRequest=vintedWatchRequest}){
 const [data,setData]=useState(null),[error,setError]=useState(''),[busy,setBusy]=useState(false),[open,setOpen]=useState(null),[filter,setFilter]=useState(''),[picked,setPicked]=useState(()=>new Set()),[notice,setNotice]=useState('')
 const load=()=>request('GET').then(r=>{setData(r);setError('')}).catch(e=>setError(e.message))
 useEffect(()=>{load();const t=setInterval(()=>{if(document.visibilityState==='visible')load()},30000);return()=>clearInterval(t)},[])
 async function act(body,message){
  setBusy(true);setError('');setNotice('')
  try{const r=await request('POST',body);if(message)setNotice(typeof message==='function'?message(r):message);await load();return r}catch(e){setError(e.message)}finally{setBusy(false)}
 }
 const logins=useMemo(()=>new Map((data?.accounts||[]).map(a=>[a.id,a.login])),[data])
 if(!data)return <main className="workspace-page max-w-screen-2xl mx-auto p-4 sm:p-6 text-slate-800">{error?<p role="alert" className="text-sm text-red-700">{error}</p>:<p className="text-sm text-slate-500">Chargement de l’agent…</p>}</main>
 const accounts=data.accounts,active=accounts.filter(a=>a.settings?.enabled),paused=active.filter(a=>a.settings.paused)
 const queued=data.tasks.filter(t=>t.state==='queued').length,writes=active.reduce((n,a)=>n+(a.today.writes||0),0),cap=active.reduce((n,a)=>n+a.settings.limits.writes_per_day,0)
 const learned=data.recipes.filter(r=>r.learned_at).length
 const shown=accounts.filter(a=>!filter||a.login?.toLowerCase().includes(filter.toLowerCase())).sort((a,b)=>(b.settings?.enabled?1:0)-(a.settings?.enabled?1:0))
 const publishable=new Set(active.filter(a=>a.settings.features.publish).map(a=>a.id))
 return <main className="workspace-page max-w-screen-2xl mx-auto p-4 sm:p-6 space-y-5 text-slate-800">
  <header className="flex flex-wrap items-start justify-between gap-3">
   <div><h1 className="text-2xl font-bold">Agent Vinted</h1>
    <p className="mt-1 max-w-3xl text-sm text-slate-500">Ton extension maison remplace Dotb : elle travaille dans les profils AdsPower ouverts, une action à la fois par compte, dans les plafonds que tu fixes ici. Elle se met en pause toute seule à la moindre alerte Vinted (captcha, restriction, déconnexion).</p></div>
   <div className="flex gap-2"><button className={buttonClass} onClick={load} disabled={busy}>Actualiser</button>
    <button className={buttonClass+' text-rose-700'} disabled={busy||!active.length} onClick={()=>window.confirm('Mettre en pause l’agent sur tous les comptes ?')&&act({action:'pause_all'},r=>`${r.paused} compte(s) mis en pause.`)}>Tout mettre en pause</button></div>
  </header>
  {error&&<p role="alert" className="rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-700">{error}</p>}
  {notice&&<p role="status" className="rounded-xl border border-teal-200 bg-teal-50 p-3 text-sm text-teal-800">{notice}</p>}
  <div className="grid grid-cols-2 gap-3 sm:grid-cols-5">
   <Stat value={active.length-paused.length} label="Comptes actifs" tone="teal"/>
   <Stat value={paused.length} label="En pause" tone={paused.length?'amber':'slate'}/>
   <Stat value={queued} label="Tâches en attente"/>
   <Stat value={`${writes} / ${cap}`} label="Modifications aujourd’hui"/>
   <Stat value={data.hidden.filter(h=>h.state==='hidden').length} label="Annonces masquées" tone={data.hidden.length?'rose':'slate'}/>
  </div>

  <VintedWatchPanel request={watchRequest}/>

  <Section title={`Actions apprises (${learned}/${data.recipes.length})`} hint="L’agent n’envoie jamais une requête devinée : chaque action est d’abord faite une fois à la main sur Vinted, avec le mode apprentissage de l’extension activé (popup de l’extension). Fais-le sur un compte de test.">
   <ul className="divide-y divide-slate-100 text-sm">{data.recipes.map(r=><li key={r.kind} className="flex flex-wrap items-center justify-between gap-2 py-2">
    <div><p className="font-medium">{r.label} {r.learned_at?<span className="ml-1 rounded-full bg-teal-50 px-2 py-0.5 text-xs text-teal-700">apprise</span>:<span className="ml-1 rounded-full bg-amber-50 px-2 py-0.5 text-xs text-amber-700">à apprendre</span>}</p>
     <p className="text-xs text-slate-500">{r.learned_at?`${r.method} ${r.path} · ${when(r.learned_at)}${r.learned_login?` · ${r.learned_login}`:''}`:r.how}</p></div>
    {r.learned_at&&<button className="text-xs text-slate-500 underline" disabled={busy} onClick={()=>window.confirm('Oublier cette action ? Il faudra la refaire en mode apprentissage.')&&act({action:'forget_recipe',kind:r.kind})}>Oublier</button>}
   </li>)}</ul>
  </Section>

  <Section title="Comptes" hint="Commence par un ou deux comptes de test, avec peu de fonctions. Les autres comptes peuvent rester sur Dotb pendant la transition." aside={<input className={compactClass+' w-48 py-1.5'} placeholder="Rechercher un compte" value={filter} onChange={e=>setFilter(e.target.value)}/>}>
   <ul className="divide-y divide-slate-100">{shown.map(a=>{const s=a.settings
    return <li key={a.id} className="py-3">
     <div className="flex flex-wrap items-center justify-between gap-2">
      <div className="min-w-0"><p className="font-medium">{a.login||'Compte sans pseudo'} {a.alert&&<span className="ml-1 rounded-full bg-rose-50 px-2 py-0.5 text-xs text-rose-700">{ALERTS[a.alert.status]||a.alert.title}</span>}</p>
       <p className="text-xs text-slate-500">{!s?.enabled?'Agent non activé':s.paused?`En pause · ${s.pause_reason||''}`:`Actif · ${FEATURES.filter(([k])=>s.features[k]).map(([,l])=>l).join(', ')||'aucune fonction'}`}{s?.enabled&&` · dernier signal ${when(s.last_seen_at)}${s.extension_version?` · v${s.extension_version}`:''} · ${a.today.writes||0}/${s.limits.writes_per_day} modif. aujourd’hui`}</p></div>
      <div className="flex flex-wrap gap-2">
       {s?.enabled&&(s.paused?<button className={buttonClass+' py-1.5'} disabled={busy||!!a.alert} title={a.alert?'Le compte a une alerte Vinted en cours':''} onClick={()=>act({action:'resume',account_id:a.id},'Agent relancé.')}>Reprendre</button>
        :<button className={buttonClass+' py-1.5'} disabled={busy} onClick={()=>act({action:'pause',account_id:a.id},'Agent mis en pause.')}>Pause</button>)}
       {s?.enabled&&!s.paused&&<select className={compactClass+' py-1.5'} value="" disabled={busy} onChange={e=>e.target.value&&act({action:'enqueue',account_id:a.id,kind:e.target.value},'Lecture ajoutée à la file.')}>
        <option value="">Lire maintenant…</option><option value="scan_wardrobe">Le dressing</option><option value="sync_orders">Les ventes</option><option value="scan_likes">Les likes</option></select>}
       <button className={buttonClass+' py-1.5'} aria-expanded={open===a.id} onClick={()=>setOpen(open===a.id?null:a.id)}>{open===a.id?'Fermer':'Régler'}</button>
      </div>
     </div>
     {open===a.id&&<AccountSettings account={a} defaults={data.defaults} busy={busy} onSave={form=>act({action:'save_settings',account_id:a.id,enabled:form.enabled,version:s?.version,settings:{features:form.features,limits:form.limits,unmask:form.unmask,pricing:form.pricing,likes:form.likes}},'Réglages enregistrés.')}/>}
    </li>})}</ul>
  </Section>

  <Section title="Publication par l’agent" hint="Fiches prêtes de l’onglet Annonces. L’agent les publie au créneau prévu (ou les espace de 15 à 45 min), dans les plafonds du compte. Il faut avoir appris « Envoi d’une photo » et « Création d’une annonce »."
   aside={<button className={primaryClass} disabled={busy||!picked.size} onClick={()=>act({action:'publish_drafts',ids:[...picked]},r=>`${r.queued} fiche(s) confiée(s) à l’agent.${r.refused?.length?` ${r.refused.length} refusée(s) : ${[...new Set(r.refused.map(x=>x.reason))].join(' ; ')}.`:''}`).then(()=>setPicked(new Set()))}>Envoyer à l’agent ({picked.size})</button>}>
   {data.drafts.length?<ul className="divide-y divide-slate-100 text-sm">{data.drafts.map(d=><li key={d.id} className="flex items-center gap-3 py-2">
    <input type="checkbox" aria-label={`Choisir ${d.title}`} checked={picked.has(d.id)} disabled={!publishable.has(d.account_id)} onChange={e=>setPicked(p=>{const n=new Set(p);e.target.checked?n.add(d.id):n.delete(d.id);return n})}/>
    <span className="min-w-0 flex-1 truncate">{d.title}</span><span className="text-xs text-slate-500">{logins.get(d.account_id)||'compte ?'} · {d.price?`${d.price} €`:'sans prix'} · {d.photos} photo(s){!publishable.has(d.account_id)?' · publication par l’agent non activée':''}</span>
   </li>)}</ul>:<p className="text-sm text-slate-500">Aucune fiche prête.</p>}
  </Section>

  <div className="grid gap-5 lg:grid-cols-2">
   <Section title={`Annonces masquées (${data.hidden.length})`} hint="Relues dans le dressing toutes les 2 h quand le démasquage ou les prix automatiques sont actifs. Vérifie cette liste avant d’activer le démasquage.">
    {data.hidden.length?<ul className="divide-y divide-slate-100 text-sm">{data.hidden.map(h=><li key={`${h.account_id}:${h.item_id}`} className="flex items-center gap-3 py-2">
     {h.photo_url?<img src={h.photo_url} alt="" className="h-10 w-8 rounded-md object-cover bg-slate-100"/>:<span className="h-10 w-8 rounded-md bg-slate-100"/>}
     <span className="min-w-0 flex-1"><span className="block truncate">{h.title||h.item_id}</span><span className="text-xs text-slate-500">{logins.get(h.account_id)} · {h.price} € · {h.state==='repairing'?'réparée, en vérification':`masquée depuis ${when(h.hidden_since)}`} · {h.repairs} réparation(s)</span></span>
    </li>)}</ul>:<p className="text-sm text-slate-500">Aucune annonce masquée suivie.</p>}
   </Section>
   <Section title="Ventes lues sur Vinted" hint="En parallèle de Dotb pendant la transition, pour comparer. Les bordereaux récupérés sont enregistrés sur le site.">
    {data.orders.length?<ul className="divide-y divide-slate-100 text-sm">{data.orders.map(o=><li key={o.transaction_id} className="flex items-center justify-between gap-2 py-2">
     <span className="min-w-0 truncate">{o.title||`Vente ${o.transaction_id}`}</span><span className="shrink-0 text-xs text-slate-500">{logins.get(o.account_id)} · {o.price!=null?`${o.price} €`:''} · {o.status||'—'} · {o.label_path?'bordereau ✓':'sans bordereau'}</span>
    </li>)}</ul>:<p className="text-sm text-slate-500">Aucune vente lue pour l’instant.</p>}
   </Section>
  </div>

  <div className="grid gap-5 lg:grid-cols-2">
   <Section title="File de tâches">
    <ul className="divide-y divide-slate-100 text-sm">{data.tasks.slice(0,40).map(t=><li key={t.id} className="flex items-center justify-between gap-2 py-1.5">
     <span className="min-w-0 truncate">{data.kinds[t.kind]?.label||t.kind} · {logins.get(t.account_id)}{t.error?<span className="text-rose-700"> · {t.error}</span>:''}</span>
     <span className="shrink-0 text-xs text-slate-500">{STATES[t.state]} · {when(t.state==='queued'?t.not_before:t.finished_at||t.started_at)}{t.state==='queued'&&<button className="ml-2 underline" disabled={busy} onClick={()=>act({action:'cancel',task_id:t.id})}>Annuler</button>}</span>
    </li>)}{!data.tasks.length&&<li className="py-2 text-slate-500">Aucune tâche.</li>}</ul>
   </Section>
   <Section title="Journal">
    <ul className="divide-y divide-slate-100 text-sm">{data.log.slice(0,60).map(l=><li key={l.id} className={`py-1.5 ${LEVELS[l.level]}`}><span className="text-xs text-slate-400">{when(l.created_at)}{l.account_id?` · ${logins.get(l.account_id)||''}`:''}</span> {l.message}</li>)}
     {!data.log.length&&<li className="py-2 text-slate-500">Rien pour l’instant.</li>}</ul>
   </Section>
  </div>
 </main>
}
