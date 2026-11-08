import {useEffect,useMemo,useState,lazy,Suspense} from 'react'
import {buttonClass,primaryClass,fieldClass,compactClass,Pill,Card,PageTitle,StatCard,Table,Td} from './YlaVintUI'
import VintedWatchPanel,{vintedWatchRequest} from './VintedWatchPanel'
import {ORDER_LABELS} from '../lib/fulfillment'
import {LikesSettings,FlowSettings} from './YlaVintFlows'

const YlaVintInbox=lazy(()=>import('./YlaVintInbox'))
const YlaVintAi=lazy(()=>import('./YlaVintAi'))
const YlaVintWardrobe=lazy(()=>import('./YlaVintWardrobe'))
const YlaVintSales=lazy(()=>import('./YlaVintSales'))

export const ylavintRequest=(method='GET',body,query='')=>import('../lib/api').then(m=>m.resourcesRequest(method,body,`?scope=agent${query}`))
export const when=v=>v?new Date(v).toLocaleString('fr-FR',{day:'2-digit',month:'short',hour:'2-digit',minute:'2-digit',timeZone:'Europe/Paris'}):'—'
export {compactClass}
const ago=v=>{if(!v)return '—';const m=Math.round((Date.now()-Date.parse(v))/60000);if(m<1)return 'à l’instant';if(m<60)return `il y a ${m} min`;if(m<1440)return `il y a ${Math.round(m/60)} h`;const d=Math.round(m/1440);return d===1?'hier':d===2?'avant-hier':`il y a ${d} jours`}
const euro=n=>`${(Number(n)||0).toLocaleString('fr-FR',{minimumFractionDigits:2,maximumFractionDigits:2})} €`
export const FEATURES=[['inbox','Messagerie centralisée'],['ai','Agent IA'],['orders','Lecture des ventes'],['sales','Ventes → onglet Ventes'],['labels','Bordereau automatique'],['dressing','Dressing'],['unmask','Démasquage'],['pricing','Prix & cycle de vie'],['publish','Publication'],['likes','Messages aux likes']]
const STATES={queued:'en attente',running:'en cours',done:'terminée',failed:'échec',cancelled:'annulée'}
const ALERTS={temporary:'Bloqué temporairement',restricted:'Restreint',permanent:'Bloqué définitivement',blocked:'Bloqué'}
export const bridgeOnline=a=>!!a.last_seen_at&&Date.now()-Date.parse(a.last_seen_at)<15*60000

// Navigation latérale (rubriques et sous-rubriques), comme un tableau de bord de gestion Vinted.
const NAV=[
 {key:'accueil',label:'Dashboard',icon:'▦'},
 {label:'Commandes',icon:'🛒',children:[['commandes','Commandes'],['classement','Classement']]},
 {label:'Articles',icon:'◈',children:[['dressing','Articles Vinted'],['publication','Publications planifiées']]},
 {label:'Automatisations',icon:'⚙',children:[['likes','Likes d’articles'],['flux','Flux de commande'],['agent','Smart Agent'],['prix','Démasquage & prix']]},
 {key:'messagerie',label:'Messagerie',icon:'💬'},
 {label:'Plus',icon:'⋯',children:[['reglages','Comptes & réglages'],['journal','Journal'],['extension','Extension']]},
]
const KEYS=NAV.flatMap(n=>n.children?n.children.map(c=>c[0]):[n.key])
const ALIASES={ventes:'commandes',ia:'agent'}
// Dans le site : « #ylavint/messagerie ». Dans l'interface à part (/ylavint) : « #messagerie ».
function readSection(){const parts=window.location.hash.slice(1).split('?')[0].split('/').filter(Boolean);const sub=parts[0]==='ylavint'?parts[1]:parts[0];const k=ALIASES[sub]||sub;return KEYS.includes(k)?k:'accueil'}

const Num=({label,value,onChange,step=1,min=0,max,suffix})=><label className="block text-xs text-zinc-400">{label}
 <span className="mt-1 flex items-center gap-1"><input type="number" className={fieldClass+' py-1.5'} value={value} step={step} min={min} max={max} onChange={e=>onChange(e.target.value===''?'':Number(e.target.value))}/>{suffix&&<span className="text-zinc-500">{suffix}</span>}</span></label>
const Legend=({children})=><legend className="col-span-full text-[11px] font-semibold uppercase tracking-wide text-zinc-500">{children}</legend>
const GROUPS={all:['features','messaging','limits','unmask','pricing'],likes:['likes'],flux:['order_flow'],agent:['messaging'],prix:['unmask','pricing']}
const FEATURE_SETS={likes:['likes'],flux:['orders','sales'],agent:['inbox','ai'],prix:['dressing','unmask','pricing']}

function AccountSettings({account,defaults,onSave,busy,only}){
 const start=account.settings||{...structuredClone(defaults),enabled:false,version:0}
 const [form,setForm]=useState(()=>({...structuredClone(start),messaging:{...defaults.messaging,...(start.messaging||{})},order_flow:structuredClone(start.order_flow||defaults.order_flow),likes:structuredClone(start.likes||defaults.likes)}))
 const set=(group,key,value)=>setForm(f=>({...f,[group]:{...f[group],[key]:value}}))
 const show=g=>!only||only==='all'||GROUPS[only]?.includes(g)
 const feats=only&&only!=='all'?FEATURES.filter(([k])=>FEATURE_SETS[only].includes(k)):FEATURES
 return <div className="space-y-4">
  <label className="flex items-center gap-2 text-sm font-medium text-white"><input type="checkbox" className="accent-blue-500" checked={form.enabled} onChange={e=>setForm({...form,enabled:e.target.checked})}/> YlaVint actif sur ce compte</label>
  <fieldset><Legend>Fonctions</Legend>
   <div className="mt-2 grid gap-2 sm:grid-cols-2">{feats.map(([k,l])=><label key={k} className="flex items-center gap-2 rounded-lg border border-zinc-800 bg-zinc-900/60 px-3 py-2 text-sm text-zinc-200"><input type="checkbox" className="accent-blue-500" checked={!!form.features[k]} onChange={e=>set('features',k,e.target.checked)}/>{l}</label>)}</div>
   {feats.some(([k])=>k==='sales')&&<p className="mt-2 text-xs text-zinc-500">« Ventes → onglet Ventes » remplace le webhook Dotb pour ce compte : coupe d’abord Dotb sur ce compte. Une vente déjà reçue de Dotb n’est jamais dupliquée.</p>}
  </fieldset>
  {show('messaging')&&<fieldset className="grid grid-cols-2 gap-3 sm:grid-cols-3"><Legend>Messagerie</Legend>
   <Num label="Relire toutes les" value={form.messaging.sync_minutes} min={2} max={120} suffix="min" onChange={v=>set('messaging','sync_minutes',v)}/>
   <Num label="Réponses / jour" value={form.messaging.reply_per_day} max={300} onChange={v=>set('messaging','reply_per_day',v)}/>
   <Num label="Écart entre deux réponses" value={form.messaging.reply_gap_seconds} min={10} max={600} suffix="s" onChange={v=>set('messaging','reply_gap_seconds',v)}/>
  </fieldset>}
  {show('likes')&&<LikesSettings likes={form.likes} onChange={likes=>setForm(f=>({...f,likes}))} perDay={form.limits.like_message_per_day} onPerDay={v=>set('limits','like_message_per_day',v)}/>}
  {show('order_flow')&&<FlowSettings flow={form.order_flow} onChange={order_flow=>setForm(f=>({...f,order_flow}))} features={form.features} onFeature={(k,v)=>set('features',k,v)}/>}
  {show('limits')&&<fieldset className="grid grid-cols-2 gap-3 sm:grid-cols-4"><Legend>Plafonds des modifications (heure de Paris)</Legend>
   <Num label="De" value={form.limits.from_hour} max={23} suffix="h" onChange={v=>set('limits','from_hour',v)}/>
   <Num label="À" value={form.limits.to_hour} max={23} suffix="h" onChange={v=>set('limits','to_hour',v)}/>
   <Num label="Modifications / jour" value={form.limits.writes_per_day} max={200} onChange={v=>set('limits','writes_per_day',v)}/>
   <Num label="Écart minimal" value={form.limits.min_gap_minutes} min={1} max={240} suffix="min" onChange={v=>set('limits','min_gap_minutes',v)}/>
   <Num label="Démasquages / jour" value={form.limits.unmask_item_per_day} max={100} onChange={v=>set('limits','unmask_item_per_day',v)}/>
   <Num label="Baisses de prix / jour" value={form.limits.reprice_item_per_day} max={100} onChange={v=>set('limits','reprice_item_per_day',v)}/>
   <Num label="Publications / jour" value={form.limits.publish_item_per_day} max={100} onChange={v=>set('limits','publish_item_per_day',v)}/>
   <Num label="Messages aux likes / jour" value={form.limits.like_message_per_day} max={100} onChange={v=>set('limits','like_message_per_day',v)}/>
  </fieldset>}
  {show('unmask')&&<fieldset className="grid grid-cols-2 gap-3 sm:grid-cols-5"><Legend>Démasquage</Legend>
   <Num label="Baisse par réparation" value={form.unmask.price_drop} step={0.5} max={10} suffix="€" onChange={v=>set('unmask','price_drop',v)}/>
   <Num label="Baisse maximale" value={form.unmask.max_drop} step={0.5} max={50} suffix="€" onChange={v=>set('unmask','max_drop',v)}/>
   <Num label="Jamais sous" value={form.unmask.floor} min={1} step={0.5} suffix="€" onChange={v=>set('unmask','floor',v)}/>
   <Num label="Réparations max" value={form.unmask.max_repairs} max={10} onChange={v=>set('unmask','max_repairs',v)}/>
   <Num label="Attente entre deux" value={form.unmask.wait_hours} min={1} max={168} suffix="h" onChange={v=>set('unmask','wait_hours',v)}/>
  </fieldset>}
  {show('pricing')&&<fieldset className="grid grid-cols-2 gap-3 sm:grid-cols-5"><Legend>Prix & cycle de vie</Legend>
   <Num label="Première baisse après" value={form.pricing.after_days} min={1} max={90} suffix="j" onChange={v=>set('pricing','after_days',v)}/>
   <Num label="Baisse" value={form.pricing.step} min={0.5} step={0.5} max={20} suffix="€" onChange={v=>set('pricing','step',v)}/>
   <Num label="Puis tous les" value={form.pricing.every_days} min={1} max={60} suffix="j" onChange={v=>set('pricing','every_days',v)}/>
   <Num label="Baisse maximale" value={form.pricing.max_drop} max={200} suffix="€" onChange={v=>set('pricing','max_drop',v)}/>
   <Num label="Jamais sous" value={form.pricing.floor} min={1} step={0.5} suffix="€" onChange={v=>set('pricing','floor',v)}/>
  </fieldset>}
  <div className="flex justify-end"><button className={primaryClass} disabled={busy} onClick={()=>onSave(form)}>Enregistrer</button></div>
 </div>
}

// Panneau latéral « Configurer » d'un compte.
function Drawer({title,onClose,children}){
 useEffect(()=>{const f=e=>e.key==='Escape'&&onClose();window.addEventListener('keydown',f);return()=>window.removeEventListener('keydown',f)},[])
 return <div className="fixed inset-0 z-50 flex justify-end bg-black/60" onClick={onClose}>
  <aside role="dialog" aria-label={title} className="h-full w-full max-w-2xl overflow-y-auto border-l border-zinc-800 bg-[#141416] p-5 text-zinc-100" onClick={e=>e.stopPropagation()}>
   <div className="mb-4 flex items-center justify-between gap-2"><h2 className="font-semibold text-white">{title}</h2><button className={buttonClass+' px-2.5 py-1.5'} onClick={onClose} aria-label="Fermer">✕</button></div>
   {children}
  </aside>
 </div>
}

// Tableau « Compte · Réglages actuels · Dernière mise à jour · Configurer », avec copie des réglages d'un compte vers les autres.
function AutomationTable({kind,accounts,data,busy,act,chips,setConfigure}){
 const [q,setQ]=useState('')
 const rows=accounts.filter(a=>!q||a.login?.toLowerCase().includes(q.toLowerCase())).sort((a,b)=>Date.parse(b.settings?.updated_at||0)-Date.parse(a.settings?.updated_at||0))
 async function useAsSource(src){
  const others=accounts.filter(a=>a.id!==src.id)
  if(!window.confirm(`Copier les réglages « ${kind} » de ${src.login} sur les ${others.length} autres comptes ? Leur état actif / coupé ne change pas.`))return
  const groups=[...(GROUPS[kind]||[])]
  for(const a of others){
   const base=a.settings||{...structuredClone(data.defaults),enabled:false}
   const settings={features:{...base.features},limits:base.limits,unmask:base.unmask,pricing:base.pricing,likes:base.likes,messaging:{...data.defaults.messaging,...(base.messaging||{})},order_flow:base.order_flow||data.defaults.order_flow}
   if(kind==='flux')settings.features.labels=!!src.settings?.features?.labels
   for(const f of FEATURE_SETS[kind]||[])settings.features[f]=!!src.settings?.features?.[f]
   for(const g of groups)settings[g]=structuredClone(src.settings?.[g]||data.defaults[g])
   const r=await act({action:'save_settings',account_id:a.id,enabled:!!a.settings?.enabled,version:a.settings?.version,settings},null,true)
   if(!r)break
  }
  act(null,`Réglages de ${src.login} copiés sur ${others.length} compte(s).`)
 }
 return <>
  <div className="flex justify-end"><input className={compactClass+' w-60'} placeholder="Rechercher des comptes…" value={q} onChange={e=>setQ(e.target.value)}/></div>
  <Table head={['','Compte','Réglages actuels','Dernière mise à jour','']} empty={!rows.length&&'Aucun compte.'}>
   {rows.map(a=><tr key={a.id} className="hover:bg-zinc-800/30">
    <Td className="w-48"><button className={buttonClass+' py-1.5 text-xs'} disabled={busy||!a.settings} title={a.settings?'':'Configure d’abord ce compte'} onClick={()=>useAsSource(a)}>Utiliser comme source</button></Td>
    <Td><p className="flex items-center gap-2 font-semibold text-white"><span className={`h-2 w-2 rounded-full ${bridgeOnline(a)?'bg-emerald-400':'bg-zinc-600'}`} title={bridgeOnline(a)?'Bridge connecté':'Bridge non connecté'}/>{a.login}<span className="rounded bg-zinc-800 px-1 text-[10px] text-zinc-400">FR</span></p>
     <p className="text-xs text-zinc-500">{!a.settings?.enabled?'YlaVint non activé':a.settings.paused?'En pause':'Actif'}</p></Td>
    <Td><div className="flex max-w-xl flex-wrap gap-1.5">{chips(a)}</div></Td>
    <Td className="whitespace-nowrap text-zinc-300">{ago(a.settings?.updated_at)}</Td>
    <Td className="text-right"><button className="text-sm font-medium text-blue-400 hover:text-blue-300" onClick={()=>setConfigure({account:a,only:kind})}>Configurer ↗</button></Td>
   </tr>)}
  </Table>
 </>
}

function SalesChart({orders,range}){
 const now=new Date(),buckets=[]
 if(range==='today'){for(let h=0;h<24;h++)buckets.push({label:`${String(h).padStart(2,'0')}:00`,v:0})}
 else{const n=range==='7d'?7:30;for(let i=n-1;i>=0;i--){const d=new Date(now);d.setDate(d.getDate()-i);buckets.push({label:d.toLocaleDateString('fr-FR',{day:'2-digit',month:'2-digit'}),key:d.toDateString(),v:0})}}
 for(const o of orders){const d=new Date(o.order_date);const b=range==='today'?buckets[d.getHours()]:buckets.find(x=>x.key===d.toDateString());if(b)b.v+=Number(o.price)||0}
 const max=Math.max(4,...buckets.map(b=>b.v)),W=900,H=200,step=W/buckets.length
 return <svg viewBox={`0 0 ${W} ${H+28}`} className="h-56 w-full" role="img" aria-label="Ventes au fil du temps">
  {[0,.25,.5,.75,1].map(t=><g key={t}><line x1="0" x2={W} y1={H-H*t} y2={H-H*t} stroke="#27272a" strokeDasharray="3 4"/><text x="2" y={H-H*t-3} fill="#71717a" fontSize="10">{Math.round(max*t)} €</text></g>)}
  {buckets.map((b,i)=><g key={i}><rect x={i*step+step*.18} width={step*.64} y={H-(b.v/max)*H} height={(b.v/max)*H} rx="3" fill="#3b82f6"><title>{b.label} : {euro(b.v)}</title></rect>
   {(buckets.length<=12||i%Math.ceil(buckets.length/12)===0)&&<text x={i*step+step/2} y={H+18} fill="#71717a" fontSize="10" textAnchor="middle">{b.label}</text>}</g>)}
 </svg>
}

export default function YlaVintTab({request=ylavintRequest,watchRequest=vintedWatchRequest,standalone=false,onLogout}){
 const [section,setSectionState]=useState(readSection)
 const [data,setData]=useState(null),[sales,setSales]=useState(null),[error,setError]=useState(''),[busy,setBusy]=useState(false),[notice,setNotice]=useState('')
 const [configure,setConfigure]=useState(null),[picked,setPicked]=useState(()=>new Set()),[range,setRange]=useState('7d'),[accountFilter,setAccountFilter]=useState(''),[mobileNav,setMobileNav]=useState(false)
 const setSection=s=>{setSectionState(s);setMobileNav(false);const hash=standalone?`#${s}`:`#ylavint/${s}`;if(window.location.hash!==hash)history.replaceState(null,'',hash)}
 useEffect(()=>{const f=()=>setSectionState(readSection());window.addEventListener('hashchange',f);return()=>window.removeEventListener('hashchange',f)},[])
 const load=()=>request('GET').then(r=>{setData(r);setError('')}).catch(e=>setError(e.message))
 const loadSales=()=>request('GET',undefined,'&view=sales').then(r=>setSales(r.orders)).catch(()=>setSales([]))
 useEffect(()=>{load();loadSales();const t=setInterval(()=>{if(document.visibilityState==='visible')load()},30000);return()=>clearInterval(t)},[])
 async function act(body,message,quiet){
  if(!body){setNotice(message||'');await load();return}
  setBusy(true);if(!quiet){setError('');setNotice('')}
  try{const r=await request('POST',body);if(message)setNotice(typeof message==='function'?message(r):message);if(!quiet)await load();return r}catch(e){setError(e.message)}finally{setBusy(false)}
 }
 const logins=useMemo(()=>new Map((data?.accounts||[]).map(a=>[a.id,a.login])),[data])
 const period=useMemo(()=>{
  const start=new Date();if(range==='today')start.setHours(0,0,0,0);else{start.setDate(start.getDate()-(range==='7d'?6:29));start.setHours(0,0,0,0)}
  return (sales||[]).filter(o=>Date.parse(o.order_date)>=start&&(!accountFilter||o.account_id===accountFilter))
 },[sales,range,accountFilter])

 if(!data)return <div className="ylv min-h-screen bg-[#0a0a0b] p-6 text-zinc-300">{error?<p role="alert" className="text-sm text-rose-400">{error}</p>:<p className="text-sm">Chargement de YlaVint…</p>}</div>
 const accounts=data.accounts,active=accounts.filter(a=>a.settings?.enabled),paused=active.filter(a=>a.settings.paused),online=accounts.filter(bridgeOnline)
 const unread=data.unread_total||0
 const valid=period.filter(o=>!['cancelled','returning'].includes(o.normalized))
 const revenue=valid.reduce((n,o)=>n+(Number(o.price)||0),0)
 const toShip=(sales||[]).filter(o=>['payment_received','label_sent'].includes(o.normalized)&&(!accountFilter||o.account_id===accountFilter)).length
 const transit=(sales||[]).filter(o=>['shipped','ready_for_pickup'].includes(o.normalized)&&(!accountFilter||o.account_id===accountFilter)).length
 const publishable=new Set(active.filter(a=>a.settings.features.publish).map(a=>a.id))
 const on=(a,k)=>!!a.settings?.enabled&&!!a.settings.features[k]
 const label=(k)=>NAV.flatMap(n=>n.children||[[n.key,n.label]]).find(([x])=>x===k)?.[1]
 const periodPicker=<><select className={compactClass} value={accountFilter} onChange={e=>setAccountFilter(e.target.value)}><option value="">Tous les comptes</option>{accounts.map(a=><option key={a.id} value={a.id}>{a.login}</option>)}</select>
  <select className={compactClass} value={range} onChange={e=>setRange(e.target.value)}><option value="today">Aujourd’hui</option><option value="7d">7 derniers jours</option><option value="30d">30 derniers jours</option></select></>

 const sidebar=<nav aria-label="YlaVint" className="flex h-full flex-col gap-1 p-3 text-sm">
  <div className="mb-3 flex items-center gap-2.5 px-2 py-2"><span className="relative grid h-8 w-8 place-items-center rounded-lg bg-zinc-100 text-base font-black text-zinc-900">Y<span className="absolute -right-0.5 -top-0.5 h-2 w-2 rounded-full bg-blue-500"/></span><span className="text-base font-bold text-white">YlaVint</span></div>
  {NAV.map(n=>n.children?<div key={n.label} className="mt-1">
   <p className="flex items-center gap-2.5 px-3 py-1.5 font-semibold text-zinc-200"><span className="w-4 text-center text-zinc-400" aria-hidden="true">{n.icon}</span>{n.label}</p>
   {n.children.map(([k,l])=><button key={k} aria-current={section===k?'page':undefined} onClick={()=>setSection(k)} className={`block w-full rounded-lg py-1.5 pl-10 pr-3 text-left ${section===k?'bg-zinc-800 font-semibold text-white':'text-zinc-400 hover:bg-zinc-800/60 hover:text-zinc-100'}`}>{l}</button>)}
  </div>:<button key={n.key} aria-current={section===n.key?'page':undefined} onClick={()=>setSection(n.key)} className={`flex items-center gap-2.5 rounded-lg px-3 py-2 text-left font-semibold ${section===n.key?'bg-zinc-800 text-white':'text-zinc-200 hover:bg-zinc-800/60'}`}>
   <span className="w-4 text-center text-zinc-400" aria-hidden="true">{n.icon}</span>{n.label}{n.key==='messagerie'&&unread>0&&<span className="ml-auto rounded-full bg-rose-500 px-1.5 text-[11px] text-white">{unread}</span>}</button>)}
  <div className="mt-auto space-y-2 border-t border-zinc-800 px-2 pt-3 text-xs text-zinc-400">
   <p><span className="mr-1.5 inline-block h-2 w-2 rounded-full bg-emerald-400"/>{online.length} Bridge{online.length>1?'s':''} connecté{online.length>1?'s':''}</p>
   <p>{active.length-paused.length} actif{active.length-paused.length>1?'s':''}{paused.length?` · ${paused.length} en pause`:''}</p>
   <button className="w-full rounded-lg border border-rose-500/40 px-2 py-1.5 text-rose-300 hover:bg-rose-500/10 disabled:opacity-40" disabled={busy||!active.length} onClick={()=>window.confirm('Mettre YlaVint en pause sur tous les comptes ?')&&act({action:'pause_all'},r=>`${r.paused} compte(s) mis en pause.`)}>Tout mettre en pause</button>
   {standalone&&<div className="flex items-center justify-between gap-2 pt-1"><a className="hover:text-zinc-100" href="/">← Stock Vinted</a>{onLogout&&<button className="hover:text-zinc-100" onClick={onLogout}>Déconnexion</button>}</div>}
  </div>
 </nav>

 const full=standalone?'100vh':'calc(100vh - 130px)'
 return <div className="ylv flex bg-[#0a0a0b] text-zinc-100" style={{minHeight:full}}>
  <aside className="hidden w-60 shrink-0 border-r border-zinc-800 bg-[#111113] lg:block"><div className="sticky top-0 overflow-y-auto" style={{height:full}}>{sidebar}</div></aside>
  {mobileNav&&<div className="fixed inset-0 z-50 bg-black/60 lg:hidden" onClick={()=>setMobileNav(false)}><aside className="h-full w-72 overflow-y-auto bg-[#111113]" onClick={e=>e.stopPropagation()}>{sidebar}</aside></div>}
  <main className="min-w-0 flex-1 space-y-5 p-3 sm:p-6">
   <div className="flex items-center justify-between gap-2 lg:hidden"><button className={buttonClass} onClick={()=>setMobileNav(true)}>☰ {label(section)}</button><button className={buttonClass} onClick={()=>setSection('messagerie')}>💬{unread>0&&<span className="rounded-full bg-rose-500 px-1.5 text-[11px]">{unread}</span>}</button></div>
   {error&&<p role="alert" className="rounded-lg border border-rose-500/30 bg-rose-500/10 p-3 text-sm text-rose-300">{error}</p>}
   {notice&&<p role="status" className="rounded-lg border border-blue-500/30 bg-blue-500/10 p-3 text-sm text-blue-200">{notice}</p>}
   <Suspense fallback={<p className="text-sm text-zinc-500">Chargement…</p>}>

   {section==='accueil'&&<>
    <div className="flex flex-wrap items-center justify-between gap-3"><h1 className="text-2xl font-bold text-white">Aperçu des commandes <span className="ml-2 align-middle text-sm font-normal text-blue-400">lues par YlaVint</span></h1><div className="flex flex-wrap gap-2">{periodPicker}<button className={buttonClass} onClick={()=>{load();loadSales()}} disabled={busy}>↻ Actualiser</button></div></div>
    {!data.ai_ready&&<p className="rounded-lg border border-amber-500/30 bg-amber-500/10 p-3 text-sm text-amber-200">La clé Gemini du site est absente : l’agent IA ne pourra pas rédiger de réponses.</p>}
    <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
     <StatCard label="Revenu total" value={euro(revenue)} icon="€"/>
     <StatCard label="Commandes" value={valid.length} icon="🛒"/>
     <StatCard label="Commande moyenne" value={euro(valid.length?revenue/valid.length:0)} icon="◈"/>
     <StatCard label="À expédier" value={toShip} icon="📦" onClick={()=>setSection('commandes')}/>
     <StatCard label="En transit" value={transit} icon="➤" onClick={()=>setSection('commandes')}/>
     <StatCard label="Messagerie" value={unread} sub={`${data.human_total||0} à traiter toi-même`} tone={unread?'blue':undefined} icon="💬" onClick={()=>setSection('messagerie')}/>
    </div>
    <div className="grid gap-4 xl:grid-cols-[2fr_1fr]">
     <Card className="p-5"><p className="font-semibold text-white">Ventes au fil du temps</p><p className="text-xs text-zinc-500">{range==='today'?'Aujourd’hui, par heure':range==='7d'?'7 derniers jours':'30 derniers jours'}</p><SalesChart orders={valid} range={range}/></Card>
     <Card className="p-5"><div className="flex items-start justify-between"><div><p className="font-semibold text-white">Bridges YlaVint</p><p className="text-xs text-zinc-500">Profils AdsPower signalés il y a moins de 15 min</p></div><p className="text-3xl font-bold text-white">{online.length}</p></div>
      <ul className="mt-4 max-h-56 space-y-2 overflow-y-auto text-sm">{accounts.slice().sort((a,b)=>Date.parse(b.last_seen_at||0)-Date.parse(a.last_seen_at||0)).map(a=><li key={a.id} className="flex items-center justify-between gap-2">
       <span className="flex min-w-0 items-center gap-2"><span className={`h-2 w-2 shrink-0 rounded-full ${bridgeOnline(a)?'bg-emerald-400':'bg-zinc-600'}`}/><span className="truncate">{a.login}</span>{a.alert&&<Pill tone="red">{ALERTS[a.alert.status]||'Alerte'}</Pill>}</span>
       <span className="shrink-0 text-xs text-zinc-500">{ago(a.last_seen_at)}</span></li>)}</ul></Card>
    </div>
   </>}

   {section==='commandes'&&<YlaVintSales request={request} accounts={accounts}/>}

   {section==='classement'&&<>
    <PageTitle title="Classement des comptes" hint="Ventes lues par YlaVint sur la période (annulations et retours exclus)." aside={periodPicker}/>
    {(()=>{const by=new Map();for(const o of valid){const r=by.get(o.account_id)||{n:0,ca:0};r.n++;r.ca+=Number(o.price)||0;by.set(o.account_id,r)}
     const rows=[...by.entries()].sort((a,b)=>b[1].ca-a[1].ca)
     return <Table head={['#','Compte','Commandes','Chiffre d’affaires','Panier moyen']} empty={!rows.length&&'Aucune vente sur cette période.'}>
      {rows.map(([id,r],i)=><tr key={id}><Td className="w-12 font-bold text-zinc-400">{i<3?['🥇','🥈','🥉'][i]:i+1}</Td><Td className="font-semibold text-white">{logins.get(id)||'—'}</Td><Td>{r.n}</Td><Td className="font-semibold">{euro(r.ca)}</Td><Td>{euro(r.ca/r.n)}</Td></tr>)}
     </Table>})()}
   </>}

   {section==='dressing'&&<YlaVintWardrobe request={request} accounts={accounts}/>}

   {section==='publication'&&<>
    <PageTitle title="Publications planifiées" hint="Fiches prêtes de l’onglet Annonces, publiées par YlaVint au créneau prévu (ou espacées de 15 à 45 min), dans les plafonds du compte. Tu peux aussi publier depuis l’atelier avec « Publier avec YlaVint »."
     aside={<button className={primaryClass} disabled={busy||!picked.size} onClick={()=>act({action:'publish_drafts',ids:[...picked]},r=>`${r.queued} fiche(s) confiée(s) à YlaVint.${r.refused?.length?` ${r.refused.length} refusée(s) : ${[...new Set(r.refused.map(x=>x.reason))].join(' ; ')}.`:''}`).then(()=>setPicked(new Set()))}>Planifier ({picked.size})</button>}/>
    <Table head={['','Titre','Prix','Photos','Compte','État']} empty={!data.drafts.length&&'Aucune fiche prête.'}>
     {data.drafts.map(d=><tr key={d.id}><Td className="w-10"><input type="checkbox" className="accent-blue-500" aria-label={`Choisir ${d.title}`} checked={picked.has(d.id)} disabled={!publishable.has(d.account_id)} onChange={e=>setPicked(p=>{const n=new Set(p);e.target.checked?n.add(d.id):n.delete(d.id);return n})}/></Td>
      <Td className="max-w-md truncate font-medium text-white">{d.title}</Td><Td>{d.price?euro(d.price):'—'}</Td><Td>{d.photos}</Td><Td className="text-blue-400">{logins.get(d.account_id)||'—'}</Td>
      <Td>{publishable.has(d.account_id)?<Pill tone="blue">Prête</Pill>:<Pill>Publication non activée</Pill>}</Td></tr>)}
    </Table>
    <p className="pt-2 text-sm font-semibold text-white">File de publication</p>
    <Table head={['Compte','Statut','Planifié pour','Terminé','Raison']} empty={!data.tasks.some(t=>t.kind==='publish_item')&&'Aucune publication en file.'}>
     {data.tasks.filter(t=>t.kind==='publish_item').map(t=><tr key={t.id}><Td className="text-blue-400">{logins.get(t.account_id)}</Td>
      <Td><Pill tone={t.state==='done'?'blue':t.state==='failed'?'red':t.state==='cancelled'?'zinc':'amber'}>{t.state==='done'?(t.payload?.live===false?'Brouillon créé':'Publié'):t.state==='failed'?'Échec':STATES[t.state]}</Pill></Td>
      <Td>{when(t.not_before)}</Td><Td>{when(t.finished_at)}</Td><Td className="text-xs text-zinc-400">{t.error||'—'}</Td></tr>)}
    </Table>
   </>}

   {section==='likes'&&<><PageTitle title="Likes d’articles" hint="Quand un membre like une annonce, YlaVint lui envoie ton message après le délai choisi. Choisis un compte dont tu veux répliquer les réglages sur les autres, ou configure-les un par un."/>
    <AutomationTable kind="likes" accounts={accounts} data={data} busy={busy} act={act} setConfigure={setConfigure}
     chips={a=><><Pill tone={on(a,'likes')?'green':'zinc'} icon="●">Likes {on(a,'likes')?'Activé':'Désactivé'}</Pill><Pill icon="💬">{((a.settings||data.defaults).likes.messages||[]).length||1} message(s)</Pill><Pill icon="⏱">{(a.settings||data.defaults).likes.wait_minutes?`Après ${(a.settings||data.defaults).likes.wait_minutes} min`:'Aucun délai'}</Pill><Pill icon="↗">{(a.settings||data.defaults).limits.like_message_per_day}/jour</Pill></>}/></>}

   {section==='flux'&&<><PageTitle title="Flux de commande" hint="Expédition, délai, retrait et finalisation, comme dans Dotb. Les ventes sont relues toutes les 30 min ; chaque action part une seule fois par vente, dans les plafonds du compte."/>
    <AutomationTable kind="flux" accounts={accounts} data={data} busy={busy} act={act} setConfigure={setConfigure}
     chips={a=><><Pill tone={on(a,'orders')?'green':'zinc'} icon="🛒">Lecture des ventes</Pill><Pill tone={on(a,'sales')?'green':'zinc'} icon="⇄">Ventes → onglet Ventes</Pill><Pill tone={on(a,'labels')?'green':'zinc'} icon="🖨">Bordereau automatique</Pill>{(()=>{const f=(a.settings||data.defaults).order_flow||{};return [['confirm','Confirmation'],['extension','Délai'],['cancel','Annulation'],['pickup','Retrait'],['review','Évaluation']].filter(([k])=>f[k]?.enabled).map(([k,l])=><Pill key={k} tone="green" icon="✓">{l}</Pill>)})()}</>}/></>}

   {section==='agent'&&<><PageTitle title="Smart Agent" hint="L’agent IA répond aux acheteurs avec tes consignes. Règle-le une fois ci-dessous, puis active-le compte par compte."/>
    <YlaVintAi request={request} accounts={accounts} onAccounts={()=>{}}/>
    <AutomationTable kind="agent" accounts={accounts} data={data} busy={busy} act={act} setConfigure={setConfigure}
     chips={a=><><Pill icon="✦">{data.ai?.mode==='auto'?'Répond seul':'Propose'}</Pill><Pill tone={on(a,'ai')&&data.ai?.enabled?'green':'zinc'} icon="●">Agent IA {on(a,'ai')&&data.ai?.enabled?'Activé':'Désactivé'}</Pill><Pill tone={on(a,'inbox')?'green':'zinc'} icon="💬">Messagerie {on(a,'inbox')?'Activée':'Désactivée'}</Pill><Pill icon="↻">Lecture {(a.settings?.messaging||data.defaults.messaging).sync_minutes} min</Pill></>}/></>}

   {section==='prix'&&<><PageTitle title="Démasquage & prix" hint="Annonces « masquées du catalogue » réparées (mêmes photos, un point dans la description, −1 €), et baisses de prix programmées. Toujours dans les plafonds du compte."/>
    <AutomationTable kind="prix" accounts={accounts} data={data} busy={busy} act={act} setConfigure={setConfigure}
     chips={a=>{const s=a.settings||data.defaults;return <><Pill tone={on(a,'unmask')?'green':'zinc'} icon="◉">Démasquage {on(a,'unmask')?'Activé':'Désactivé'}</Pill><Pill tone={on(a,'pricing')?'green':'zinc'} icon="€">Prix {on(a,'pricing')?'Activé':'Désactivé'}</Pill><Pill icon="↘">−{s.unmask.price_drop} € / réparation</Pill><Pill icon="⏱">Baisse après {s.pricing.after_days} j</Pill></>}}/></>}

   {section==='messagerie'&&<YlaVintInbox request={request} accounts={accounts}/>}

   {section==='reglages'&&<>
    <PageTitle title="Comptes & réglages" hint="Point vert : le Bridge YlaVint du profil s’est signalé il y a moins de 15 min. Commence par un compte de test, puis élargis."/>
    <Table head={['Compte','Bridge','État','Aujourd’hui','']} empty={!accounts.length&&'Aucun compte.'}>
     {accounts.map(a=>{const s=a.settings;return <tr key={a.id}>
      <Td><p className="font-semibold text-white">{a.login}</p>{a.alert&&<Pill tone="red">{ALERTS[a.alert.status]||a.alert.title}</Pill>}</Td>
      <Td className="whitespace-nowrap text-xs"><span className={`mr-1.5 inline-block h-2 w-2 rounded-full ${bridgeOnline(a)?'bg-emerald-400':'bg-zinc-600'}`}/>{bridgeOnline(a)?'Connecté':a.last_seen_at?`Vu ${ago(a.last_seen_at)}`:'Jamais vu'}{a.extension_version?` · v${a.extension_version}`:''}</Td>
      <Td>{!s?.enabled?<Pill>Non activé</Pill>:s.paused?<Pill tone="amber">En pause</Pill>:<Pill tone="green">Actif</Pill>}{s?.paused&&s.pause_reason&&<p className="mt-1 max-w-xs text-xs text-zinc-500">{s.pause_reason}</p>}</Td>
      <Td className="text-xs text-zinc-400">{s?.enabled?`${a.today.writes||0}/${s.limits.writes_per_day} modif.`:'—'}</Td>
      <Td className="whitespace-nowrap text-right">
       {s?.enabled&&(s.paused?<button className={buttonClass+' mr-2 py-1.5'} disabled={busy||!!a.alert} onClick={()=>act({action:'resume',account_id:a.id},'YlaVint relancé.')}>Reprendre</button>:<button className={buttonClass+' mr-2 py-1.5'} disabled={busy} onClick={()=>act({action:'pause',account_id:a.id},'YlaVint mis en pause.')}>Pause</button>)}
       {s?.enabled&&!s.paused&&<select className={compactClass+' mr-2 py-1.5'} value="" disabled={busy} onChange={e=>e.target.value&&act({action:'enqueue',account_id:a.id,kind:e.target.value},'Lecture demandée à YlaVint.')}><option value="">Lire maintenant…</option><option value="sync_inbox">La messagerie</option><option value="scan_wardrobe">Le dressing</option><option value="sync_orders">Les ventes</option><option value="scan_likes">Les likes</option></select>}
       <button className="text-sm font-medium text-blue-400 hover:text-blue-300" onClick={()=>setConfigure({account:a,only:'all'})}>Configurer ↗</button></Td>
     </tr>})}
    </Table>
    <p className="pt-2 text-sm font-semibold text-white">Actions connues ({data.recipes.filter(r=>r.learned_at||r.default).length}/{data.recipes.length})</p>
    <p className="text-xs text-zinc-500">Les lectures marchent dès le départ. Les actions qui modifient Vinted ne partent qu’après avoir été faites une fois à la main avec le mode apprentissage du popup YlaVint (une fois pour tous les comptes).</p>
    <Table head={['Action','État','Détail','']}>
     {data.recipes.map(r=><tr key={r.kind}><Td className="font-medium text-white">{r.label}</Td>
      <Td>{r.learned_at?<Pill tone="green">Apprise</Pill>:r.default?<Pill tone="blue">Lecture par défaut</Pill>:<Pill tone="amber">À apprendre</Pill>}</Td>
      <Td className="text-xs text-zinc-400">{r.learned_at?`${r.method} ${r.path} · ${when(r.learned_at)}`:r.how}</Td>
      <Td className="text-right">{r.learned_at&&<button className="text-xs text-zinc-400 underline" disabled={busy} onClick={()=>window.confirm('Oublier cette action ?')&&act({action:'forget_recipe',kind:r.kind})}>Oublier</button>}</Td></tr>)}
    </Table>
   </>}

   {section==='journal'&&<div className="grid gap-5 xl:grid-cols-2">
    <div className="space-y-2"><p className="font-semibold text-white">File de tâches</p>
     <Table head={['Tâche','Compte','État','Quand']} empty={!data.tasks.length&&'Aucune tâche.'}>
      {data.tasks.slice(0,80).map(t=><tr key={t.id}><Td>{data.kinds[t.kind]?.label||t.kind}{t.error&&<p className="text-xs text-rose-400">{t.error}</p>}</Td><Td className="text-blue-400">{logins.get(t.account_id)}</Td>
       <Td><Pill tone={t.state==='done'?'green':t.state==='failed'?'red':t.state==='running'?'blue':'zinc'}>{STATES[t.state]}</Pill></Td>
       <Td className="whitespace-nowrap text-xs text-zinc-400">{when(t.state==='queued'?t.not_before:t.finished_at||t.started_at)}{t.state==='queued'&&<button className="ml-2 underline" disabled={busy} onClick={()=>act({action:'cancel',task_id:t.id})}>Annuler</button>}</Td></tr>)}
     </Table></div>
    <div className="space-y-2"><p className="font-semibold text-white">Journal</p>
     <Card><ul className="divide-y divide-zinc-800 text-sm">{data.log.slice(0,100).map(l=><li key={l.id} className={`px-4 py-2 ${l.level==='error'?'text-rose-300':l.level==='warn'?'text-amber-300':'text-zinc-300'}`}><span className="text-xs text-zinc-500">{when(l.created_at)}{l.account_id?` · ${logins.get(l.account_id)||''}`:''}</span> {l.message}</li>)}
      {!data.log.length&&<li className="p-4 text-zinc-500">Rien pour l’instant.</li>}</ul></Card></div>
   </div>}

   {section==='extension'&&<><PageTitle title="Extension YlaVint" hint="À installer dans chaque profil AdsPower. Le gros bouton du popup allume ou coupe YlaVint dans le profil."/><div className="mx-auto max-w-4xl"><VintedWatchPanel request={watchRequest}/></div></>}
   </Suspense>
  </main>
  {configure&&<Drawer title={`Configurer ${configure.account.login}`} onClose={()=>setConfigure(null)}>
   <AccountSettings account={configure.account} defaults={data.defaults} busy={busy} only={configure.only}
    onSave={async form=>{const r=await act({action:'save_settings',account_id:configure.account.id,enabled:form.enabled,version:configure.account.settings?.version,settings:{features:form.features,limits:form.limits,unmask:form.unmask,pricing:form.pricing,likes:form.likes,messaging:form.messaging,order_flow:form.order_flow}},'Réglages enregistrés.');if(r)setConfigure(null)}}/>
  </Drawer>}
 </div>
}

export {Section} from './YlaVintUI'
