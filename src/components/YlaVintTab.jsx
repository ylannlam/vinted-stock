import {useEffect,useMemo,useState,lazy,Suspense} from 'react'
import {buttonClass,primaryClass,fieldClass,compactClass,Pill,Card,PageTitle,Table,Td,Icon} from './YlaVintUI'
import YlaVintDashboard from './YlaVintDashboard'
import YlaVintRoutineSettings from './YlaVintRoutineSettings'
import '../ylavint.css'
import VintedWatchPanel,{vintedWatchRequest} from './VintedWatchPanel'
import {ORDER_LABELS} from '../lib/fulfillment'
import {LikesSettings,FlowSettings} from './YlaVintFlows'
import ylavintManifest from '../../extensions/ylavint/manifest.json'
import {isDesktop,supportsFeature,supportsTask,DESKTOP_DEFAULTS,DESKTOP_BOUNDS,DESKTOP_LABELS} from '../lib/ylavintExecution'

const YlaVintInbox=lazy(()=>import('./YlaVintInbox'))
const YlaVintAi=lazy(()=>import('./YlaVintAi'))
const YlaVintWardrobe=lazy(()=>import('./YlaVintWardrobe'))
const YlaVintSales=lazy(()=>import('./YlaVintSales'))
const YlaVintDesktop=lazy(()=>import('./YlaVintDesktop'))
const YlaVintActions=lazy(()=>import('./YlaVintActions'))

export const ylavintRequest=(method='GET',body,query='')=>import('../lib/api').then(m=>m.resourcesRequest(method,body,`?scope=agent${query}`))
export const when=v=>v?new Date(v).toLocaleString('fr-FR',{day:'2-digit',month:'short',hour:'2-digit',minute:'2-digit',timeZone:'Europe/Paris'}):'—'
export {compactClass}
const ago=v=>{if(!v)return '—';const m=Math.round((Date.now()-Date.parse(v))/60000);if(m<1)return 'à l’instant';if(m<60)return `il y a ${m} min`;if(m<1440)return `il y a ${Math.round(m/60)} h`;const d=Math.round(m/1440);return d===1?'hier':d===2?'avant-hier':`il y a ${d} jours`}
const euro=n=>`${(Number(n)||0).toLocaleString('fr-FR',{minimumFractionDigits:2,maximumFractionDigits:2})} €`
export const FEATURES=[['inbox','Messagerie centralisée'],['ai','Agent IA'],['orders','Lecture des ventes'],['sales','Ventes → onglet Ventes'],['labels','Bordereau automatique'],['dressing','Dressing'],['unmask','Démasquage'],['pricing','Prix & cycle de vie'],['publish','Publication'],['likes','Messages aux likes']]
const STATES={queued:'en attente',running:'en cours',done:'terminée',failed:'échec',cancelled:'annulée'}
const ALERTS={temporary:'Bloqué temporairement',restricted:'Restreint',permanent:'Bloqué définitivement',blocked:'Bloqué'}
// Dernière version d'YlaVint = celle du dépôt. Un compte qui remonte une version plus ancienne doit être mis à jour.
export const LATEST_YLAVINT=ylavintManifest.version
const vparts=v=>String(v||'').split('.').map(n=>parseInt(n,10)||0)
export const outdated=v=>{if(!v||String(v).startsWith('pc-'))return false;const a=vparts(v),b=vparts(LATEST_YLAVINT);for(let i=0;i<3;i++){if((a[i]||0)!==(b[i]||0))return (a[i]||0)<(b[i]||0)}return false}
export const bridgeOnline=a=>!!a.last_seen_at&&Date.now()-Date.parse(a.last_seen_at)<15*60000

// Navigation latérale (rubriques et sous-rubriques), comme un tableau de bord de gestion Vinted.
const NAV=[
 {key:'accueil',label:'Dashboard',icon:'▦'},
 {label:'Commandes',icon:'🛒',children:[['commandes','Commandes'],['classement','Classement']]},
 {label:'Articles',icon:'◈',children:[['dressing','Articles Vinted'],['publication','Publications planifiées']]},
 {label:'Automatisations',icon:'⚙',children:[['likes','Likes d’articles'],['flux','Flux de commande'],['agent','Smart Agent'],['prix','Démasquage & prix']]},
 {key:'messagerie',label:'Messagerie',icon:'💬'},
 {key:'assistant-pc',label:'Assistant PC',icon:'▣'},
 {key:'actions',label:'Prochaines actions',icon:'◷'},
 {label:'Plus',icon:'⋯',children:[['reglages','Comptes & réglages'],['journal','Journal'],['extension','Extension']]},
]
const KEYS=NAV.flatMap(n=>n.children?n.children.map(c=>c[0]):[n.key])
const ALIASES={ventes:'commandes',ia:'agent'}
// Dans le site : « #ylavint/messagerie ». Dans l'interface à part (/ylavint) : « #messagerie ».
function readSection(){const parts=window.location.hash.slice(1).split('?')[0].split('/').filter(Boolean);const sub=parts[0]==='ylavint'?parts[1]:parts[0];const k=ALIASES[sub]||sub;return KEYS.includes(k)?k:'accueil'}

// Plage horaire façon Dotb : 0 = seulement les nouveaux, sinon les dernières heures puis les nouveaux.
const HISTORY=[2,6,12,24,48,72,96,120,144,168]
const historyLabel=h=>h===24?'Traiter le dernier jour':h%24===0?`Traiter les ${h/24} derniers jours`:`Traiter les ${h} dernières heures`
const HistorySelect=({label,what,value,onChange})=>{const v=Number(value)||0,opts=[0,...HISTORY,...(v&&!HISTORY.includes(v)?[v]:[])]
 return <label className="block text-xs text-zinc-400">{label}<select className="mt-1 w-full rounded-lg border border-zinc-800 bg-zinc-900 px-3 py-2 text-sm text-zinc-100" value={v} onChange={e=>onChange(Number(e.target.value))}>{opts.map(h=><option key={h} value={h}>{h?historyLabel(h):`Traiter uniquement les ${what}`}</option>)}</select></label>}
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
 const desktop=isDesktop(form)
 const pace={...DESKTOP_DEFAULTS,...form.messaging.desktop}
 const setPace=(key,value)=>set('messaging','desktop',{...pace,[key]:value})
 return <div className="space-y-4">
  <label className="flex items-center gap-2 text-sm font-medium text-white"><input type="checkbox" className="accent-blue-500" checked={form.enabled} onChange={e=>setForm({...form,enabled:e.target.checked})}/> YlaVint actif sur ce compte</label>
  <label className="block text-sm">Exécution<select className={fieldClass+' mt-2'} value={form.messaging.executor||'extension'} onChange={e=>set('messaging','executor',e.target.value)}><option value="extension">Extension — toutes les fonctions</option><option value="desktop">Assistant PC — favoris et réponses IA</option></select></label>
  {form.messaging.executor==='desktop'&&<p className="text-xs text-zinc-400">L’extension attend pendant que l’assistant PC gère ce compte. Les autres fonctions reprendront en repassant au mode Extension.</p>}
  {desktop&&<fieldset className="space-y-3 rounded-xl border border-zinc-700 p-4"><Legend>Rythme et navigation sur Vinted</Legend>
   <p className="text-xs text-zinc-400">L’assistant utilise les pages visibles pour lire et agir. Ces réglages contrôlent son rythme ; ils ne garantissent pas qu’une automatisation soit indétectable.</p>
   <div className="grid gap-3 sm:grid-cols-2">{['typing_delay_ms','page_wait_seconds','session_minutes','pause_minutes'].map(k=><Num key={k} label={DESKTOP_LABELS[k]} value={pace[k]} min={DESKTOP_BOUNDS[k][0]} max={DESKTOP_BOUNDS[k][1]} suffix={k==='typing_delay_ms'?'ms':k==='page_wait_seconds'?'s':'min'} onChange={v=>setPace(k,v)}/>)}</div>
   <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={pace.browse_enabled} onChange={e=>setPace('browse_enabled',e.target.checked)}/> Consulter des annonces entre les tâches</label>
   <p className="text-xs text-zinc-400">Consultation et défilement uniquement, sans like, abonnement, achat ni message. Les messages à traiter restent prioritaires.</p>
   {pace.browse_enabled&&<div className="grid gap-3 sm:grid-cols-2">{['browse_every_minutes','browse_items','browse_item_seconds','browse_scrolls'].map(k=><Num key={k} label={DESKTOP_LABELS[k]} value={pace[k]} min={DESKTOP_BOUNDS[k][0]} max={DESKTOP_BOUNDS[k][1]} suffix={k==='browse_every_minutes'?'min':k==='browse_item_seconds'?'s':undefined} onChange={v=>setPace(k,v)}/>)}</div>}
  </fieldset>}
  {show('messaging')&&<YlaVintRoutineSettings messaging={form.messaging} desktop={desktop} onChange={(k,v)=>set('messaging',k,v)}/>}
  <fieldset><Legend>Fonctions</Legend>
   <div className="mt-2 grid gap-2 sm:grid-cols-2">{feats.map(([k,l])=><label key={k} className="flex items-center gap-2 rounded-lg border border-zinc-800 bg-zinc-900/60 px-3 py-2 text-sm text-zinc-200"><input type="checkbox" className="accent-blue-500" disabled={!supportsFeature(form,k)} checked={!!form.features[k]} onChange={e=>set('features',k,e.target.checked)}/>{l}{!supportsFeature(form,k)&&<span className="text-xs text-amber-300">Mode Extension requis</span>}</label>)}</div>
   {feats.some(([k])=>k==='sales')&&<p className="mt-2 text-xs text-zinc-500">« Ventes → onglet Ventes » remplace le webhook Dotb pour ce compte : coupe d’abord Dotb sur ce compte. Une vente déjà reçue de Dotb n’est jamais dupliquée.</p>}
  </fieldset>
  {show('messaging')&&<fieldset className="grid grid-cols-2 gap-3 sm:grid-cols-3"><Legend>Messagerie</Legend>
   <Num label="Relire toutes les" value={form.messaging.sync_seconds} min={20} max={7200} suffix="s" onChange={v=>set('messaging','sync_seconds',v)}/>
   <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={!!form.messaging.reply_unlimited} onChange={e=>set('messaging','reply_unlimited',e.target.checked)}/> Réponses par jour illimitées</label>
   {!form.messaging.reply_unlimited&&<Num label="Réponses / jour" value={form.messaging.reply_per_day} max={300} onChange={v=>set('messaging','reply_per_day',v)}/>}
   <Num label="Délai entre deux envois : min" value={form.messaging.action_gap_min} min={5} max={3600} suffix="s" onChange={v=>set('messaging','action_gap_min',v)}/>
   <Num label="Délai entre deux envois : max" value={form.messaging.action_gap_max} min={5} max={3600} suffix="s" onChange={v=>set('messaging','action_gap_max',v)}/>
  </fieldset>}
  {(show('likes')||show('messaging'))&&<fieldset className="space-y-3"><Legend>Plage horaire de conversation</Legend>
   <p className="text-xs text-zinc-400">Appliqué à l’activation ou au changement de plage, sans refaire les actions déjà effectuées.</p>
   <div className="grid gap-3 sm:grid-cols-3">
   {show('likes')&&<HistorySelect label="Likes" what="nouvelles notifications" value={form.likes.history_hours??0} onChange={v=>set('likes','history_hours',v)}/>}
   {show('messaging')&&<><HistorySelect label="Messages (Smart Agent)" what="nouveaux messages" value={form.messaging.history_hours??0} onChange={v=>set('messaging','history_hours',v)}/><HistorySelect label="Offres" what="nouvelles offres" value={form.messaging.offers?.history_hours??0} onChange={v=>set('messaging','offers',{...defaults.messaging.offers,...form.messaging.offers,history_hours:v})}/></>}
   </div>
  </fieldset>}
  {(show('likes')||show('messaging'))&&<fieldset className="grid grid-cols-2 gap-3"><Legend>Horaires et plafonds d’envoi</Legend>
   <Num label="Début des envois (heure de Paris)" value={form.limits.from_hour} max={23} suffix="h" onChange={v=>set('limits','from_hour',v)}/>
   <Num label="Fin des envois (heure de Paris)" value={form.limits.to_hour} max={23} suffix="h" onChange={v=>set('limits','to_hour',v)}/>
   <p className="col-span-full text-xs text-zinc-400">Deux heures identiques autorisent les envois toute la journée. Ces horaires s’appliquent aux messages de ce compte.</p>
   {show('likes')&&<Num label="Messages aux likes / jour (relances incluses)" value={form.limits.like_message_per_day} max={1000000} onChange={v=>set('limits','like_message_per_day',v)}/>}
  </fieldset>}
  {show('messaging')&&<fieldset disabled={desktop} className="space-y-3"><Legend>Acceptation automatique des offres</Legend>
   {desktop&&<p className="text-xs text-amber-300">Mode Extension requis pour accepter les offres reçues. L’Assistant PC peut envoyer les réductions réglées dans Likes d’articles.</p>}
   <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={!!form.messaging.offers?.enabled} onChange={e=>set('messaging','offers',{...defaults.messaging.offers,...form.messaging.offers,enabled:e.target.checked})}/> Accepter les offres qui atteignent mes seuils</label>
   <div className="grid grid-cols-2 gap-3">{[['single_discount','Remise maximale — article seul',0,80,'%'],['bundle_discount','Remise maximale — lot',0,80,'%'],['max_per_buyer','Offres par acheteur',1,100,''],['period_days','Sur une période de',1,30,'jours']].map(([key,label,min,max,suffix])=><Num key={key} label={label} value={form.messaging.offers?.[key]??defaults.messaging.offers?.[key]} min={min} max={max} suffix={suffix} onChange={v=>set('messaging','offers',{...defaults.messaging.offers,...form.messaging.offers,[key]:v})}/>)}</div>
   <p className="text-xs text-zinc-400">Acceptation réelle sur Vinted, sans message. Prix et statut revérifiés avant l’action. Les offres sous le seuil et les négociations écrites restent à traiter par toi. Nécessite YlaVint 3.6.0 pour le choix de l’historique.</p>
  </fieldset>}
  {show('likes')&&<LikesSettings likes={form.likes} onChange={likes=>setForm(f=>({...f,likes}))} gap={form.messaging} onGap={(k,v)=>set('messaging',k,v)}/>}
  {show('order_flow')&&<fieldset disabled={desktop}>{desktop&&<p className="mb-2 text-xs text-amber-300">Le flux de commande reste réservé au mode Extension.</p>}<FlowSettings flow={form.order_flow} onChange={order_flow=>setForm(f=>({...f,order_flow}))} features={form.features} onFeature={(k,v)=>set('features',k,v)}/></fieldset>}
  {show('limits')&&<fieldset className="grid grid-cols-2 gap-3 sm:grid-cols-4"><Legend>Plafonds des modifications</Legend>
   <Num label="Modifications / jour" value={form.limits.writes_per_day} max={200} onChange={v=>set('limits','writes_per_day',v)}/>
   <Num label="Écart minimal" value={form.limits.min_gap_minutes} min={1} max={240} suffix="min" onChange={v=>set('limits','min_gap_minutes',v)}/>
   <Num label="Démasquages / jour" value={form.limits.unmask_item_per_day} max={100} onChange={v=>set('limits','unmask_item_per_day',v)}/>
   <Num label="Baisses de prix / jour" value={form.limits.reprice_item_per_day} max={100} onChange={v=>set('limits','reprice_item_per_day',v)}/>
   <Num label="Publications / jour" value={form.limits.publish_item_per_day} max={100} onChange={v=>set('limits','publish_item_per_day',v)}/>
  </fieldset>}
  {show('unmask')&&<fieldset disabled={desktop} className="grid grid-cols-2 gap-3 sm:grid-cols-5"><Legend>Démasquage{desktop?' — mode Extension requis':''}</Legend>
   <Num label="Baisse par réparation" value={form.unmask.price_drop} step={0.5} max={10} suffix="€" onChange={v=>set('unmask','price_drop',v)}/>
   <Num label="Baisse maximale" value={form.unmask.max_drop} step={0.5} max={50} suffix="€" onChange={v=>set('unmask','max_drop',v)}/>
   <Num label="Jamais sous" value={form.unmask.floor} min={1} step={0.5} suffix="€" onChange={v=>set('unmask','floor',v)}/>
   <Num label="Réparations max" value={form.unmask.max_repairs} max={10} onChange={v=>set('unmask','max_repairs',v)}/>
   <Num label="Attente entre deux" value={form.unmask.wait_hours} min={1} max={168} suffix="h" onChange={v=>set('unmask','wait_hours',v)}/>
  </fieldset>}
  {show('pricing')&&<fieldset disabled={desktop} className="grid grid-cols-2 gap-3 sm:grid-cols-5"><Legend>Prix & cycle de vie{desktop?' — mode Extension requis':''}</Legend>
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
  <aside role="dialog" aria-modal="true" aria-label={title} className="ylv-drawer h-full w-full max-w-2xl overflow-y-auto border-l border-zinc-800 p-5 text-zinc-100 sm:p-7" onClick={e=>e.stopPropagation()}>
   <div className="mb-4 flex items-center justify-between gap-2"><h2 className="font-semibold text-white">{title}</h2><button className={buttonClass+' px-2.5 py-1.5'} onClick={onClose} aria-label="Fermer">✕</button></div>
   {children}
  </aside>
 </div>
}

// Tableau « Compte · Réglages actuels · Dernière mise à jour · Configurer », avec copie des réglages d'un compte vers les autres.
function AutomationTable({kind,accounts,data,busy,act,chips,setConfigure}){
 const [q,setQ]=useState('')
 const rows=accounts.filter(a=>!q||a.login?.toLowerCase().includes(q.toLowerCase())).sort((a,b)=>Date.parse(b.settings?.updated_at||0)-Date.parse(a.settings?.updated_at||0))
 async function useAsSource(src,section=kind){
  const others=accounts.filter(a=>a.id!==src.id)
  const label={all:'Tous les paramètres',likes:'Likes',flux:'Flux de commande',agent:'Smart Agent',prix:'Démasquage et prix'}[section]
  if(!window.confirm(`Copier les réglages « ${label} » de ${src.login} sur les ${others.length} autres comptes ? Leur état actif / coupé ne change pas.`))return
  const result=await act({action:'copy_settings',account_id:src.id,section},null,true)
  if(result)act(null,`${result.copied} compte(s) mis à jour.${result.errors?.length?' Échecs : '+result.errors.map(e=>e.login+': '+e.error).join(' ; '):''}`)

 }
 return <>
  <div className="flex justify-end"><input className={compactClass+' w-60'} placeholder="Rechercher des comptes…" value={q} onChange={e=>setQ(e.target.value)}/></div>
  <Table head={['','Compte','Réglages actuels','Dernière mise à jour','']} empty={!rows.length&&'Aucun compte.'}>
   {rows.map(a=><tr key={a.id} className="hover:bg-zinc-800/30">
    <Td className="w-48"><button className={buttonClass+' py-1.5 text-xs'} disabled={busy||!a.settings} title={a.settings?'':'Configure d’abord ce compte'} onClick={()=>useAsSource(a)}>Copier ces réglages vers tous</button><button className={buttonClass+' mt-2 py-1.5 text-xs'} disabled={busy||!a.settings} onClick={()=>useAsSource(a,'all')}>Copier tous les paramètres</button></Td>
    <Td><p className="flex items-center gap-2 font-semibold text-white"><span className={`h-2 w-2 rounded-full ${bridgeOnline(a)?'bg-emerald-400':'bg-zinc-600'}`} title={bridgeOnline(a)?'Contact récent':'Pas de contact récent'}/>{a.login}<span className="rounded bg-zinc-800 px-1 text-[10px] text-zinc-400">FR</span></p>
     <p className="text-xs text-zinc-500">{!a.settings?.enabled?'YlaVint non activé':a.settings.paused?'En pause':'Activé'} · {isDesktop(a.settings)?'Assistant PC':'Extension'}</p>{isDesktop(a.settings)&&['flux','prix'].includes(kind)&&<p className="text-xs text-amber-300">Ces actions attendent le mode Extension.</p>}</Td>
    <Td><div className="flex max-w-xl flex-wrap gap-1.5">{isDesktop(a.settings)&&['flux','prix'].includes(kind)?<Pill tone="amber">Disponible en mode Extension</Pill>:chips(a)}</div></Td>
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
 const max=Math.ceil(Math.max(4,...buckets.map(b=>b.v))/4)*4,W=720,H=190,left=44,top=12,step=(W-left)/buckets.length
 return <svg viewBox={`0 0 ${W} ${H+40}`} className="h-56 w-full" role="img" aria-label="Chiffre d’affaires par jour ou par heure, en euros">
  <defs><linearGradient id="ylv-sales-gradient" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor="#a49aff"/><stop offset="100%" stopColor="#586fe0"/></linearGradient></defs>
  {[0,.25,.5,.75,1].map(t=><g key={t}><line x1={left} x2={W} y1={top+H-H*t} y2={top+H-H*t} stroke="#2d3b57" strokeDasharray="3 6"/><text x={left-8} y={top+H-H*t+4} fill="#9aaac4" fontSize="10" textAnchor="end">{Math.round(max*t)} €</text></g>)}
  {buckets.map((b,i)=><g key={b.label}><rect className="ylv-chart-bar" x={left+i*step+step*.24} width={step*.52} y={top+H-(b.v/max)*H} height={(b.v/max)*H} rx="5" fill="url(#ylv-sales-gradient)"><title>{b.label} : {euro(b.v)}</title></rect>
   {(buckets.length<=12||i%Math.ceil(buckets.length/8)===0)&&<text x={left+i*step+step/2} y={top+H+23} fill="#9aaac4" fontSize="10" textAnchor="middle">{b.label}</text>}</g>)}
 </svg>
}

export default function YlaVintTab({request=ylavintRequest,watchRequest=vintedWatchRequest,desktopRequest,standalone=false,onLogout}){
 const [section,setSectionState]=useState(readSection)
 const [data,setData]=useState(null),[sales,setSales]=useState(null),[error,setError]=useState(''),[busy,setBusy]=useState(false),[notice,setNotice]=useState('')
 const [configure,setConfigure]=useState(null),[range,setRange]=useState('7d'),[accountFilter,setAccountFilter]=useState(''),[mobileNav,setMobileNav]=useState(false)
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
 const publishable=new Set(active.filter(a=>a.settings.features.publish&&supportsFeature(a.settings,'publish')).map(a=>a.id))
 const on=(a,k)=>!!a.settings?.enabled&&!!a.settings.features[k]&&supportsFeature(a.settings,k)
 const label=(k)=>NAV.flatMap(n=>n.children||[[n.key,n.label]]).find(([x])=>x===k)?.[1]
 const periodPicker=<><select aria-label="Filtrer par compte" className={compactClass} value={accountFilter} onChange={e=>setAccountFilter(e.target.value)}><option value="">Tous les comptes</option>{accounts.map(a=><option key={a.id} value={a.id}>{a.login}</option>)}</select>
  <select aria-label="Période des ventes" className={compactClass} value={range} onChange={e=>setRange(e.target.value)}><option value="today">Aujourd’hui</option><option value="7d">7 derniers jours</option><option value="30d">30 derniers jours</option></select></>

 const sidebar=<nav aria-label="YlaVint" className="flex h-full flex-col gap-1 p-3 text-sm">
  <div className="mb-4 flex items-center gap-3 px-2 py-3"><span className="ylv-brand-mark grid h-10 w-10 place-items-center rounded-xl text-xl font-bold">Y</span><div><span className="text-lg font-semibold tracking-tight text-white">YlaVint<span className="text-indigo-300">.</span></span><p className="mt-0.5 text-[10px] tracking-wide text-zinc-400">L’espace de tes boutiques</p></div></div>
  {NAV.map(n=>n.children?<div key={n.label} className="mt-1">
   <p className="ylv-nav-group px-3 py-1.5">{n.label}</p>
   {n.children.map(([k,l])=><button key={k} aria-current={section===k?'page':undefined} onClick={()=>setSection(k)} className={`ylv-nav-link flex w-full items-center gap-3 rounded-xl px-3 py-2 text-left text-[13px] ${section===k?'font-semibold text-white':'text-zinc-400 hover:text-zinc-100'}`}><Icon className="h-4 w-4 opacity-70" name={({commandes:'bag',classement:'chart',dressing:'box',publication:'grid',likes:'heart',flux:'box',agent:'spark',prix:'chart',reglages:'settings',journal:'clock',extension:'grid'})[k]}/>{l}</button>)}
  </div>:<button key={n.key} aria-current={section===n.key?'page':undefined} onClick={()=>setSection(n.key)} className={`ylv-nav-link flex items-center gap-3 rounded-xl px-3 py-2.5 text-left text-[13px] font-medium ${section===n.key?'text-white':'text-zinc-300'}`}>
   <Icon className="h-4 w-4" name={({accueil:'grid',messagerie:'message','assistant-pc':'monitor',actions:'clock'})[n.key]}/>{n.label}{n.key==='messagerie'&&unread>0&&<span className="ml-auto rounded-full bg-indigo-500/25 px-2 py-0.5 text-[10px] text-indigo-200">{unread}</span>}</button>)}
  <div className="mt-auto space-y-2 border-t border-zinc-800 px-2 pt-3 text-xs text-zinc-400">
   <p><span className="mr-1.5 inline-block h-2 w-2 rounded-full bg-emerald-400"/>{online.length} contact{online.length>1?'s':''} récent{online.length>1?'s':''}</p>
   <p>{active.length-paused.length} compte{active.length-paused.length>1?'s':''} activé{active.length-paused.length>1?'s':''}{paused.length?` · ${paused.length} en pause`:''}</p>
   <button className="w-full rounded-lg border border-rose-500/40 px-2 py-1.5 text-rose-300 hover:bg-rose-500/10 disabled:opacity-40" disabled={busy||!active.length} onClick={()=>window.confirm('Mettre YlaVint en pause sur tous les comptes ?')&&act({action:'pause_all'},r=>`${r.paused} compte(s) mis en pause.`)}>Tout mettre en pause</button>
   {standalone&&<div className="flex items-center justify-between gap-2 pt-1"><a className="hover:text-zinc-100" href="/">← Stock Vinted</a>{onLogout&&<button className="hover:text-zinc-100" onClick={onLogout}>Déconnexion</button>}</div>}
  </div>
 </nav>

 const full=standalone?'100vh':'calc(100vh - 130px)'
 return <div className="ylv flex text-zinc-100" style={{minHeight:full}}>
  <aside className="ylv-sidebar hidden w-60 shrink-0 lg:block"><div className="sticky top-0 overflow-y-auto" style={{height:full}}>{sidebar}</div></aside>
  {mobileNav&&<div className="fixed inset-0 z-50 bg-black/60 lg:hidden" onClick={()=>setMobileNav(false)}><aside className="ylv-sidebar h-full w-72 overflow-y-auto" onClick={e=>e.stopPropagation()}>{sidebar}</aside></div>}
  <main className="ylv-main min-w-0 flex-1 space-y-5">
   <div className="flex items-center justify-between gap-2 lg:hidden"><button className={buttonClass} onClick={()=>setMobileNav(true)}>☰ {label(section)}</button><button className={buttonClass} onClick={()=>setSection('messagerie')}>💬{unread>0&&<span className="rounded-full bg-rose-500 px-1.5 text-[11px]">{unread}</span>}</button></div>
   {error&&<p role="alert" className="rounded-lg border border-rose-500/30 bg-rose-500/10 p-3 text-sm text-rose-300">{error}</p>}
   {(()=>{const old=accounts.filter(a=>!isDesktop(a.settings)&&outdated(a.extension_version));if(!old.length)return null
    return <div role="alert" className="ylv-update rounded-2xl border p-4">
     <div className="flex flex-wrap items-center justify-between gap-3"><p className="text-sm text-rose-200"><strong>Mise à jour disponible</strong> · {old.length} compte{old.length>1?'s':''} utilise{old.length>1?'nt':''} une ancienne extension.</p>{section!=='extension'&&<button className="text-xs font-semibold text-rose-200 hover:text-white" onClick={()=>setSection('extension')}>Passer à la v{LATEST_YLAVINT} →</button>}</div>
     <details className="mt-2 text-xs text-zinc-400"><summary className="cursor-pointer">Voir les comptes concernés</summary><ul className="mt-3 flex flex-wrap gap-2">{old.map(a=><li key={a.id} className="rounded-lg bg-rose-500/10 px-3 py-1.5 text-zinc-200">{a.login} · v{a.extension_version}</li>)}</ul></details>
    </div>})()}
   {notice&&<p role="status" className="rounded-lg border border-blue-500/30 bg-blue-500/10 p-3 text-sm text-blue-200">{notice}</p>}
   <Suspense fallback={<p className="text-sm text-zinc-500">Chargement…</p>}>

   {section==='accueil'&&<YlaVintDashboard accounts={accounts} data={data} orders={valid} revenue={revenue} toShip={toShip} transit={transit} range={range} periodPicker={periodPicker} chart={<SalesChart orders={valid} range={range}/>} onNavigate={setSection} onRefresh={()=>{load();loadSales()}} busy={busy}/>}

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
    <PageTitle title="Formulaires Vinted" hint="Dans l’atelier Annonces, utilise « Préparer sur Vinted » pour chaque fiche. YlaVint ouvre le formulaire ; tu vérifies les photos et termines toi-même la publication."/>
    <Table head={['Titre','Prix','Photos','Compte','État']} empty={!data.drafts.length&&'Aucune fiche prête.'}>
     {data.drafts.map(d=><tr key={d.id}><Td className="max-w-md truncate font-medium text-white">{d.title}</Td><Td>{d.price?euro(d.price):'—'}</Td><Td>{d.photos}</Td><Td className="text-blue-400">{logins.get(d.account_id)||'—'}</Td>
      <Td>{publishable.has(d.account_id)?<Pill tone="blue">Prête</Pill>:<Pill>Publication non activée</Pill>}</Td></tr>)}
    </Table>
    <p className="pt-2 text-sm font-semibold text-white">File de publication</p>
    <Table head={['Compte','Statut','Planifié pour','Terminé','Raison']} empty={!data.tasks.some(t=>t.kind==='publish_item')&&'Aucune publication en file.'}>
     {data.tasks.filter(t=>t.kind==='publish_item').map(t=><tr key={t.id}><Td className="text-blue-400">{logins.get(t.account_id)}</Td>
      <Td><Pill tone={t.state==='done'?'blue':t.state==='failed'?'red':t.state==='cancelled'?'zinc':'amber'}>{t.state==='done'?(t.payload?.listing?.assisted?'Formulaire préparé':t.payload?.live===false?'Brouillon créé':'Publié'):t.state==='failed'?'Échec':STATES[t.state]}</Pill></Td>
      <Td>{when(t.not_before)}</Td><Td>{when(t.finished_at)}</Td><Td className="text-xs text-zinc-400">{t.error||'—'}</Td></tr>)}
    </Table>
   </>}

   {section==='likes'&&<><PageTitle title="Likes d’articles" hint="Quand un membre like une annonce, YlaVint lui envoie ton message après le délai choisi. Choisis un compte dont tu veux répliquer les réglages sur les autres, ou configure-les un par un."/>
    <AutomationTable kind="likes" accounts={accounts} data={data} busy={busy} act={act} setConfigure={setConfigure}
     chips={a=><><Pill tone={on(a,'likes')?'green':'zinc'} icon="●">Likes {on(a,'likes')?'Activé':'Désactivé'}</Pill><Pill icon="💬">{((a.settings||data.defaults).likes.messages||[]).length||1} message(s)</Pill><Pill icon="⏱">{(a.settings||data.defaults).likes.wait_minutes?`Après ${(a.settings||data.defaults).likes.wait_minutes} min`:'Aucun délai'}</Pill><Pill icon="↔">{(a.settings||data.defaults).messaging?.action_gap_min??30}–{(a.settings||data.defaults).messaging?.action_gap_max??45} s entre deux envois</Pill></>}/></>}

   {section==='flux'&&<><PageTitle title="Flux de commande" hint="Expédition, délai, retrait et finalisation, comme dans Dotb. Les ventes sont relues toutes les 30 min ; chaque action part une seule fois par vente, dans les plafonds du compte."/>
    <AutomationTable kind="flux" accounts={accounts} data={data} busy={busy} act={act} setConfigure={setConfigure}
     chips={a=><><Pill tone={on(a,'orders')?'green':'zinc'} icon="🛒">Lecture des ventes</Pill><Pill tone={on(a,'sales')?'green':'zinc'} icon="⇄">Ventes → onglet Ventes</Pill><Pill tone={on(a,'labels')?'green':'zinc'} icon="🖨">Bordereau automatique</Pill>{(()=>{const f=(a.settings||data.defaults).order_flow||{};return [['confirm','Confirmation'],['extension','Délai'],['cancel','Annulation'],['pickup','Retrait'],['review','Évaluation']].filter(([k])=>f[k]?.enabled).map(([k,l])=><Pill key={k} tone="green" icon="✓">{l}</Pill>)})()}</>}/></>}

   {section==='agent'&&<><PageTitle title="Smart Agent" hint="L’agent IA répond aux acheteurs avec tes consignes. Règle-le une fois ci-dessous, puis active-le compte par compte."/>
    <YlaVintAi request={request} accounts={accounts} onAccounts={()=>{}}/>
    <AutomationTable kind="agent" accounts={accounts} data={data} busy={busy} act={act} setConfigure={setConfigure}
     chips={a=><><Pill icon="✦">{data.ai?.mode==='auto'?'Répond seul':'Propose'}</Pill><Pill tone={on(a,'ai')&&data.ai?.enabled?'green':'zinc'} icon="●">Agent IA {on(a,'ai')&&data.ai?.enabled?'Activé':'Désactivé'}</Pill><Pill tone={on(a,'inbox')?'green':'zinc'} icon="💬">Messagerie {on(a,'inbox')?'Activée':'Désactivée'}</Pill><Pill icon="↻">Lecture {(a.settings?.messaging||data.defaults.messaging).sync_seconds} s</Pill></>}/></>}

   {section==='prix'&&<><PageTitle title="Démasquage & prix" hint="Annonces « masquées du catalogue » réparées (mêmes photos, un point dans la description, −1 €), et baisses de prix programmées. Toujours dans les plafonds du compte."/>
    <AutomationTable kind="prix" accounts={accounts} data={data} busy={busy} act={act} setConfigure={setConfigure}
     chips={a=>{const s=a.settings||data.defaults;return <><Pill tone={on(a,'unmask')?'green':'zinc'} icon="◉">Démasquage {on(a,'unmask')?'Activé':'Désactivé'}</Pill><Pill tone={on(a,'pricing')?'green':'zinc'} icon="€">Prix {on(a,'pricing')?'Activé':'Désactivé'}</Pill><Pill icon="↘">−{s.unmask.price_drop} € / réparation</Pill><Pill icon="⏱">Baisse après {s.pricing.after_days} j</Pill></>}}/></>}

   {section==='messagerie'&&<YlaVintInbox request={request} accounts={accounts}/>}

   {section==='reglages'&&<>
    <PageTitle title="Comptes & réglages" hint="Le point vert indique un contact récent, pas un assistant forcément en marche. Pour un compte en mode PC, vérifie son état et démarre-le dans Assistant PC."/>
    <Table head={['Compte','Dernier contact','État','Aujourd’hui','']} empty={!accounts.length&&'Aucun compte.'}>
     {accounts.map(a=>{const s=a.settings;return <tr key={a.id}>
      <Td><p className="font-semibold text-white">{a.login}</p><p className="text-xs text-zinc-400">{isDesktop(s)?'Assistant PC':'Extension'}</p>{a.alert&&<Pill tone="red">{ALERTS[a.alert.status]||a.alert.title}</Pill>}</Td>
      <Td className="whitespace-nowrap text-xs"><span className={`mr-1.5 inline-block h-2 w-2 rounded-full ${bridgeOnline(a)?'bg-emerald-400':'bg-zinc-600'}`}/>{a.last_seen_at?`Vu ${ago(a.last_seen_at)}`:'Jamais vu'}{a.extension_version&&<span className={!isDesktop(s)&&outdated(a.extension_version)?'font-bold text-rose-400':''}> · {a.extension_version}{!isDesktop(s)&&outdated(a.extension_version)&&' ⚠️ à mettre à jour'}</span>}</Td>
      <Td>{!s?.enabled?<Pill>Non activé</Pill>:s.paused?<Pill tone="amber">En pause</Pill>:<Pill tone="green">Activé</Pill>}{isDesktop(s)&&<button className="block text-xs text-blue-400 underline" onClick={()=>setSection('assistant-pc')}>Voir l’assistant sur ce PC</button>}{s?.paused&&s.pause_reason&&<p className="mt-1 max-w-xs text-xs text-zinc-500">{s.pause_reason}</p>}</Td>
      <Td className="text-xs text-zinc-400">{s?.enabled?(isDesktop(s)?`${a.today.like_sent||0}/${s.limits.like_message_per_day} messages aux likes`:`${a.today.writes||0}/${s.limits.writes_per_day} modif.`):'—'}</Td>
      <Td className="whitespace-nowrap text-right">
       {s?.enabled&&(s.paused?<button className={buttonClass+' mr-2 py-1.5'} disabled={busy||!!a.alert} onClick={()=>act({action:'resume',account_id:a.id},isDesktop(s)?'Pause levée. Démarre à nouveau ce compte dans Assistant PC.':'YlaVint relancé.')}>Reprendre</button>:<button className={buttonClass+' mr-2 py-1.5'} disabled={busy} onClick={()=>act({action:'pause',account_id:a.id},'YlaVint mis en pause.')}>Pause</button>)}
       {s?.enabled&&!s.paused&&<select className={compactClass+' mr-2 py-1.5'} value="" disabled={busy} onChange={e=>e.target.value&&act({action:'enqueue',account_id:a.id,kind:e.target.value},'Lecture demandée à YlaVint.')}><option value="">Lire maintenant…</option><option value="sync_inbox">La messagerie</option><option value="scan_wardrobe">Le dressing</option>{supportsTask(s,'sync_orders')&&<option value="sync_orders">Les ventes</option>}<option value="scan_likes">Les likes</option></select>}
       <button className="text-sm font-medium text-blue-400 hover:text-blue-300" onClick={()=>setConfigure({account:a,only:'all'})}>Configurer ↗</button>
       <button className="ml-3 text-sm font-medium text-rose-400 hover:text-rose-300" disabled={busy} onClick={()=>window.confirm(`Délier ${a.login} de YlaVint ?\n\nL’extension ne s’occupera plus de ce compte et tout ce que YlaVint a gardé pour lui sera effacé : commandes, bordereaux, messagerie, tâches et journal.\nLes ventes déjà dans ton onglet Ventes restent.`)&&act({action:'unlink',account_id:a.id},r=>r?.message||'Compte délié.')}>Délier</button></Td>
     </tr>})}
    </Table>
    {data.unlinked?.length>0&&<div className="space-y-2"><p className="pt-2 text-sm font-semibold text-white">Comptes déliés</p>
     <Table head={['Compte','Délié le','']}>{data.unlinked.map(u=><tr key={u.id}><Td className="text-zinc-300">{u.login}</Td><Td className="text-xs text-zinc-500">{when(u.unlinked_at)}</Td>
      <Td className="text-right"><button className="text-sm font-medium text-blue-400 hover:text-blue-300" disabled={busy} onClick={()=>act({action:'relink',account_id:u.id},`${u.login} relié à YlaVint.`)}>Relier</button></Td></tr>)}</Table></div>}
    <p className="pt-2 text-sm font-semibold text-white">Actions connues ({data.recipes.filter(r=>r.learned_at||r.default).length}/{data.recipes.length})</p>
    <p className="text-xs text-zinc-500">Ce tableau concerne les actions du mode Extension. L’Assistant PC utilise les formulaires Vinted pour les messages et réductions ; il reste en version pilote.</p>
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
       <Td><Pill tone={t.state==='done'?'green':t.state==='failed'?'red':t.state==='running'?'blue':'zinc'}>{t.state==='queued'&&!supportsTask(accounts.find(a=>a.id===t.account_id)?.settings,t.kind)?'attend le mode Extension':STATES[t.state]}</Pill></Td>
       <Td className="whitespace-nowrap text-xs text-zinc-400">{when(t.state==='queued'?t.not_before:t.finished_at||t.started_at)}{t.state==='queued'&&<button className="ml-2 underline" disabled={busy} onClick={()=>act({action:'cancel',task_id:t.id})}>Annuler</button>}</Td></tr>)}
     </Table></div>
    <div className="space-y-2"><p className="font-semibold text-white">Journal</p>
     <Card><ul className="divide-y divide-zinc-800 text-sm">{data.log.slice(0,100).map(l=><li key={l.id} className={`px-4 py-2 ${l.level==='error'?'text-rose-300':l.level==='warn'?'text-amber-300':'text-zinc-300'}`}><span className="text-xs text-zinc-500">{when(l.created_at)}{l.account_id?` · ${logins.get(l.account_id)||''}`:''}</span> {l.message}</li>)}
      {!data.log.length&&<li className="p-4 text-zinc-500">Rien pour l’instant.</li>}</ul></Card></div>
   </div>}

   {section==='assistant-pc'&&<Suspense fallback={<p>Chargement…</p>}><YlaVintDesktop accounts={accounts} onActions={()=>setSection('actions')} onConfigure={account=>setConfigure({account,only:'all'})} pair={watchRequest} request={desktopRequest}/></Suspense>}
   {section==='actions'&&<YlaVintActions request={request} accounts={accounts} onAssistant={()=>setSection('assistant-pc')}/>}
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
