import {useEffect,useMemo,useState,lazy,Suspense} from 'react'
import {buttonClass,primaryClass,fieldClass,compactClass,Pill,Card,PageTitle,Table,Td,Icon} from './YlaVintUI'
import YlaVintDashboard from './YlaVintDashboard'
import YlaVintAccountSettings from './YlaVintAccountSettings'
import '../ylavint.css'
import {vintedWatchRequest} from '../lib/assistantConnection'
import {ORDER_LABELS} from '../lib/fulfillment'
import {isDesktop,supportsFeature,supportsTask} from '../lib/ylavintExecution'

const YlaVintInbox=lazy(()=>import('./YlaVintInbox'))
const YlaVintAi=lazy(()=>import('./YlaVintAi'))
const YlaVintWardrobe=lazy(()=>import('./YlaVintWardrobe'))
const YlaVintSales=lazy(()=>import('./YlaVintSales'))
const YlaVintWallet=lazy(()=>import('./YlaVintWallet'))
const YlaVintDesktop=lazy(()=>import('./YlaVintDesktop'))
const YlaVintActions=lazy(()=>import('./YlaVintActions'))
const YlaVintOperations=lazy(()=>import('./YlaVintOperations'))

export const ylavintRequest=(method='GET',body,query='')=>import('../lib/api').then(m=>m.resourcesRequest(method,body,`?scope=agent${query}`))
export const when=v=>v?new Date(v).toLocaleString('fr-FR',{day:'2-digit',month:'short',hour:'2-digit',minute:'2-digit',timeZone:'Europe/Paris'}):'—'
export {compactClass}
const ago=v=>{if(!v)return '—';const m=Math.round((Date.now()-Date.parse(v))/60000);if(m<1)return 'à l’instant';if(m<60)return `il y a ${m} min`;if(m<1440)return `il y a ${Math.round(m/60)} h`;const d=Math.round(m/1440);return d===1?'hier':d===2?'avant-hier':`il y a ${d} jours`}
const euro=n=>`${(Number(n)||0).toLocaleString('fr-FR',{minimumFractionDigits:2,maximumFractionDigits:2})} €`
export const FEATURES=[['inbox','Messagerie centralisée'],['ai','Agent IA'],['orders','Lecture des ventes'],['sales','Ventes → onglet Ventes'],['labels','Bordereau automatique'],['wallet','Porte-monnaie'],['dressing','Dressing'],['unmask','Démasquage'],['pricing','Prix & cycle de vie'],['publish','Publication'],['likes','Messages aux likes']]
const STATES={queued:'en attente',running:'en cours',done:'terminée',failed:'échec',cancelled:'annulée'}
const ALERTS={temporary:'Bloqué temporairement',restricted:'Restreint',permanent:'Bloqué définitivement',blocked:'Bloqué'}
export const bridgeOnline=a=>!!a.last_seen_at&&Date.now()-Date.parse(a.last_seen_at)<15*60000

// Navigation latérale (rubriques et sous-rubriques), comme un tableau de bord de gestion Vinted.
const NAV=[
 {key:'accueil',label:'Dashboard',icon:'▦'},
 {key:'aujourdhui',label:'À traiter aujourd’hui',icon:'◷'},
 {key:'resultats',label:'Résultats de l’assistant',icon:'▦'},
 {key:'porte-monnaie',label:'Porte-monnaie',icon:'◉'},
 {label:'Commandes',icon:'🛒',children:[['commandes','Commandes'],['preparation','Préparation des colis'],['classement','Classement']]},
 {label:'Articles',icon:'◈',children:[['dressing','Articles Vinted'],['publication','Publications planifiées']]},
 {label:'Automatisations',icon:'⚙',children:[['likes','Favoris & réductions'],['agent','Consignes IA']]},
 {key:'messagerie',label:'Messagerie',icon:'💬'},
 {key:'assistant-pc',label:'Assistant PC',icon:'▣'},
 {key:'actions',label:'Prochaines actions',icon:'◷'},
 {label:'Plus',icon:'⋯',children:[['reglages','Comptes & réglages'],['journal','Journal']]},
]
const KEYS=NAV.flatMap(n=>n.children?n.children.map(c=>c[0]):[n.key])
const ALIASES={ventes:'commandes',ia:'agent',extension:'assistant-pc',flux:'assistant-pc',prix:'assistant-pc'}
// Dans le site : « #ylavint/messagerie ». Dans l'interface à part (/ylavint) : « #messagerie ».
function readSection(){const parts=window.location.hash.slice(1).split('?')[0].split('/').filter(Boolean);const sub=parts[0]==='ylavint'?parts[1]:parts[0];const k=ALIASES[sub]||sub;return KEYS.includes(k)?k:'accueil'}

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
     <p className="text-xs text-zinc-500">{!a.settings?.enabled?'YlaVint non activé':a.settings.paused?'En pause':'Activé'} · Assistant PC</p></Td>
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
 const [conversationTarget,setConversationTarget]=useState(null)
 const [data,setData]=useState(null),[sales,setSales]=useState(null),[error,setError]=useState(''),[busy,setBusy]=useState(false),[notice,setNotice]=useState('')
 const [configure,setConfigure]=useState(null),[range,setRange]=useState('7d'),[accountFilter,setAccountFilter]=useState(''),[mobileNav,setMobileNav]=useState(false)
 const setSection=s=>{setSectionState(s);setMobileNav(false);const hash=standalone?`#${s}`:`#ylavint/${s}`;if(window.location.hash!==hash)history.replaceState(null,'',hash)}
 useEffect(()=>{const f=()=>setSectionState(readSection());window.addEventListener('hashchange',f);return()=>window.removeEventListener('hashchange',f)},[])
 const load=()=>request('GET').then(r=>{setData(r);setError('')}).catch(e=>setError(e.message))
 const loadSales=()=>request('GET',undefined,'&view=sales').then(r=>setSales(r.orders)).catch(()=>setSales([]))
 useEffect(()=>{load();loadSales();const t=setInterval(()=>{if(document.visibilityState==='visible')load()},30000);return()=>clearInterval(t)},[])
 async function act(body,message,quiet,rethrow=false){
  if(!body){setNotice(message||'');await load();return}
  setBusy(true);if(!quiet){setError('');setNotice('')}
  try{const r=await request('POST',body);if(message)setNotice(typeof message==='function'?message(r):message);if(!quiet)await load();return r}catch(e){setError(e.message);if(rethrow)throw e}finally{setBusy(false)}
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
   <Icon className="h-4 w-4" name={({accueil:'grid','porte-monnaie':'chart',messagerie:'message','assistant-pc':'monitor',actions:'clock'})[n.key]}/>{n.label}{n.key==='messagerie'&&unread>0&&<span className="ml-auto rounded-full bg-indigo-500/25 px-2 py-0.5 text-[10px] text-indigo-200">{unread}</span>}</button>)}
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
   {notice&&<p role="status" className="rounded-lg border border-blue-500/30 bg-blue-500/10 p-3 text-sm text-blue-200">{notice}</p>}
   <Suspense fallback={<p className="text-sm text-zinc-500">Chargement…</p>}>

   {section==='accueil'&&<YlaVintDashboard accounts={accounts} data={data} orders={valid} revenue={revenue} toShip={toShip} transit={transit} range={range} periodPicker={periodPicker} chart={<SalesChart orders={valid} range={range}/>} onNavigate={setSection} onRefresh={()=>{load();loadSales()}} busy={busy}/>}

   {section==='commandes'&&<YlaVintSales request={request} accounts={accounts} onPrepare={()=>setSection('preparation')}/>}
   {['preparation','aujourdhui','resultats'].includes(section)&&<YlaVintOperations key={section} view={({preparation:'preparation',aujourdhui:'today',resultats:'results'})[section]} request={request} accounts={accounts} onNavigate={setSection} onConversation={c=>{setConversationTarget(c);setSection('messagerie')}}/>}
   {section==='porte-monnaie'&&<YlaVintWallet request={request} accounts={accounts} onConfigure={()=>setSection('reglages')} onOrders={()=>setSection('commandes')}/>}

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
    <PageTitle title="Formulaires Vinted" hint="Dans Annonces, confie une fiche à l’Assistant PC : préparer le formulaire ou publier après les contrôles, selon ton choix."/>
    <Table head={['Titre','Prix','Photos','Compte','État']} empty={!data.drafts.length&&'Aucune fiche prête.'}>
     {data.drafts.map(d=><tr key={d.id}><Td className="max-w-md truncate font-medium text-white">{d.title}</Td><Td>{d.price?euro(d.price):'—'}</Td><Td>{d.photos}</Td><Td className="text-blue-400">{logins.get(d.account_id)||'—'}</Td>
      <Td>{publishable.has(d.account_id)?<Pill tone="blue">Prête</Pill>:<Pill>Publication non activée</Pill>}</Td></tr>)}
    </Table>
    <p className="pt-2 text-sm font-semibold text-white">File de publication</p>
    <Table head={['Compte','Statut','Planifié pour','Terminé','Raison']} empty={!data.tasks.some(t=>t.kind==='publish_item')&&'Aucune publication en file.'}>
     {data.tasks.filter(t=>t.kind==='publish_item').map(t=><tr key={t.id}><Td className="text-blue-400">{logins.get(t.account_id)}</Td>
      <Td><Pill tone={t.state==='done'?'blue':t.state==='failed'?'red':t.state==='cancelled'?'zinc':'amber'}>{t.state==='done'?(t.payload?.listing?.submit?'Publié':t.payload?.listing?.assisted?'Formulaire préparé':t.payload?.live===false?'Brouillon créé':'Publié'):t.state==='failed'?'Échec':STATES[t.state]}</Pill></Td>
      <Td>{when(t.not_before)}</Td><Td>{when(t.finished_at)}</Td><Td className="text-xs text-zinc-400">{t.error||'—'}</Td></tr>)}
    </Table>
   </>}

   {section==='likes'&&<><PageTitle title="Likes d’articles" hint="Quand un membre like une annonce, YlaVint lui envoie ton message après le délai choisi. Configure les messages, réductions et relances de chaque compte séparément."/>
    <AutomationTable kind="likes" accounts={accounts} data={data} busy={busy} act={act} setConfigure={setConfigure}
     chips={a=><><Pill tone={on(a,'likes')?'green':'zinc'} icon="●">Likes {on(a,'likes')?'Activé':'Désactivé'}</Pill><Pill icon="💬">{((a.settings||data.defaults).likes.messages||[]).length||1} message(s)</Pill><Pill icon="⏱">{(a.settings||data.defaults).likes.wait_minutes?`Après ${(a.settings||data.defaults).likes.wait_minutes} min`:'Aucun délai'}</Pill><Pill icon="↔">{(a.settings||data.defaults).messaging?.action_gap_min??30}–{(a.settings||data.defaults).messaging?.action_gap_max??45} s entre deux envois</Pill></>}/></>}



   {section==='agent'&&<><PageTitle title="Smart Agent" hint="L’agent IA répond aux acheteurs avec tes consignes. Règle-le une fois ci-dessous, puis active-le compte par compte."/>
    <YlaVintAi request={request} accounts={accounts} onAccounts={()=>{}}/>
    <AutomationTable kind="agent" accounts={accounts} data={data} busy={busy} act={act} setConfigure={setConfigure}
     chips={a=><><Pill icon="✦">{data.ai?.mode==='auto'?'Répond seul':'Propose'}</Pill><Pill tone={on(a,'ai')&&data.ai?.enabled?'green':'zinc'} icon="●">Agent IA {on(a,'ai')&&data.ai?.enabled?'Activé':'Désactivé'}</Pill><Pill tone={on(a,'inbox')?'green':'zinc'} icon="💬">Messagerie {on(a,'inbox')?'Activée':'Désactivée'}</Pill><Pill icon="↻">Lecture {(a.settings?.messaging||data.defaults.messaging).sync_seconds} s</Pill></>}/></>}



   {section==='messagerie'&&<YlaVintInbox request={request} accounts={accounts} initialConversation={conversationTarget}/>}

   {section==='reglages'&&<>
    <PageTitle title="Comptes & réglages" hint="Le point vert indique un contact récent, pas un assistant forcément en marche. Vérifie son état et démarre-le dans Assistant PC."/>
    <Table head={['Compte','Dernier contact','État','Aujourd’hui','']} empty={!accounts.length&&'Aucun compte.'}>
     {accounts.map(a=>{const s=a.settings;return <tr key={a.id}>
      <Td><p className="font-semibold text-white">{a.login}</p><p className="text-xs text-zinc-400">Assistant PC</p>{a.alert&&<Pill tone="red">{ALERTS[a.alert.status]||a.alert.title}</Pill>}</Td>
      <Td className="whitespace-nowrap text-xs"><span className={`mr-1.5 inline-block h-2 w-2 rounded-full ${bridgeOnline(a)?'bg-emerald-400':'bg-zinc-600'}`}/>{a.last_seen_at?`Vu ${ago(a.last_seen_at)}`:'Jamais vu'}</Td>
      <Td>{!s?.enabled?<Pill>Non activé</Pill>:s.paused?<Pill tone="amber">En pause</Pill>:<Pill tone="green">Activé</Pill>}{isDesktop(s)&&<button className="block text-xs text-blue-400 underline" onClick={()=>setSection('assistant-pc')}>Voir l’assistant sur ce PC</button>}{s?.paused&&s.pause_reason&&<p className="mt-1 max-w-xs text-xs text-zinc-500">{s.pause_reason}</p>}</Td>
      <Td className="text-xs text-zinc-400">{s?.enabled?(isDesktop(s)?`${a.today.like_sent||0}/${s.limits.like_message_per_day} messages aux likes`:`${a.today.writes||0}/${s.limits.writes_per_day} modif.`):'—'}</Td>
      <Td className="whitespace-nowrap text-right">
       {s?.enabled&&(s.paused?<button className={buttonClass+' mr-2 py-1.5'} disabled={busy||!!a.alert} onClick={()=>act({action:'resume',account_id:a.id},isDesktop(s)?'Pause levée. Démarre à nouveau ce compte dans Assistant PC.':'YlaVint relancé.')}>Reprendre</button>:<button className={buttonClass+' mr-2 py-1.5'} disabled={busy} onClick={()=>act({action:'pause',account_id:a.id},'YlaVint mis en pause.')}>Pause</button>)}
       {s?.enabled&&!s.paused&&<select className={compactClass+' mr-2 py-1.5'} value="" disabled={busy} onChange={e=>e.target.value&&act({action:'enqueue',account_id:a.id,kind:e.target.value},'Lecture demandée à YlaVint.')}><option value="">Lire maintenant…</option><option value="sync_inbox">La messagerie</option><option value="scan_wardrobe">Le dressing</option>{supportsTask(s,'sync_orders')&&<option value="sync_orders">Les ventes</option>}<option value="scan_likes">Les likes</option></select>}
       <button className="text-sm font-medium text-blue-400 hover:text-blue-300" onClick={()=>setConfigure({account:a,only:'all'})}>Configurer ↗</button>
       <button className="ml-3 text-sm font-medium text-rose-400 hover:text-rose-300" disabled={busy} onClick={()=>window.confirm(`Délier ${a.login} de YlaVint ?\n\nL’assistant ne s’occupera plus de ce compte et tout ce que YlaVint a gardé pour lui sera effacé : commandes, bordereaux, messagerie, tâches et journal.\nLes ventes déjà dans ton onglet Ventes restent.`)&&act({action:'unlink',account_id:a.id},r=>r?.message||'Compte délié.')}>Délier</button></Td>
     </tr>})}
    </Table>
    {data.unlinked?.length>0&&<div className="space-y-2"><p className="pt-2 text-sm font-semibold text-white">Comptes déliés</p>
     <Table head={['Compte','Délié le','']}>{data.unlinked.map(u=><tr key={u.id}><Td className="text-zinc-300">{u.login}</Td><Td className="text-xs text-zinc-500">{when(u.unlinked_at)}</Td>
      <Td className="text-right"><button className="text-sm font-medium text-blue-400 hover:text-blue-300" disabled={busy} onClick={()=>act({action:'relink',account_id:u.id},`${u.login} relié à YlaVint.`)}>Relier</button></Td></tr>)}</Table></div>}
   </>}

   {section==='journal'&&<div className="grid gap-5 xl:grid-cols-2">
    <div className="space-y-2"><p className="font-semibold text-white">File de tâches</p>
     <Table head={['Tâche','Compte','État','Quand']} empty={!data.tasks.length&&'Aucune tâche.'}>
      {data.tasks.slice(0,80).map(t=><tr key={t.id}><Td>{data.kinds[t.kind]?.label||t.kind}{t.error&&<p className="text-xs text-rose-400">{t.error}</p>}</Td><Td className="text-blue-400">{logins.get(t.account_id)}</Td>
       <Td><Pill tone={t.state==='done'?'green':t.state==='failed'?'red':t.state==='running'?'blue':'zinc'}>{t.state==='queued'&&!supportsTask(accounts.find(a=>a.id===t.account_id)?.settings,t.kind)?'non prise en charge par le PC':STATES[t.state]}</Pill></Td>
       <Td className="whitespace-nowrap text-xs text-zinc-400">{when(t.state==='queued'?t.not_before:t.finished_at||t.started_at)}{t.state==='queued'&&<button className="ml-2 underline" disabled={busy} onClick={()=>act({action:'cancel',task_id:t.id})}>Annuler</button>}</Td></tr>)}
     </Table></div>
    <div className="space-y-2"><p className="font-semibold text-white">Journal</p>
     <Card><ul className="divide-y divide-zinc-800 text-sm">{data.log.slice(0,100).map(l=><li key={l.id} className={`px-4 py-2 ${l.level==='error'?'text-rose-300':l.level==='warn'?'text-amber-300':'text-zinc-300'}`}><span className="text-xs text-zinc-500">{when(l.created_at)}{l.account_id?` · ${logins.get(l.account_id)||''}`:''}</span> {l.message}</li>)}
      {!data.log.length&&<li className="p-4 text-zinc-500">Rien pour l’instant.</li>}</ul></Card></div>
   </div>}

   {section==='assistant-pc'&&<Suspense fallback={<p>Chargement…</p>}><YlaVintDesktop accounts={accounts} onActions={()=>setSection('actions')} onConfigure={(account,only='general')=>setConfigure({account,only})} pair={watchRequest} request={desktopRequest}/></Suspense>}
   {section==='actions'&&<YlaVintActions request={request} accounts={accounts} onAssistant={()=>setSection('assistant-pc')}/>}
   </Suspense>
  </main>
  {configure&&<YlaVintAccountSettings key={configure.account.id} onNavigate={setSection} onClose={()=>setConfigure(null)} account={configure.account} defaults={data.defaults} busy={busy} only={configure.only}
    onSave={async form=>{const r=await act({action:'save_settings',account_id:configure.account.id,enabled:form.enabled,version:configure.account.settings?.version,settings:{features:form.features,limits:form.limits,unmask:form.unmask,pricing:form.pricing,likes:form.likes,messaging:form.messaging,order_flow:form.order_flow}},'Réglages enregistrés.',false,true);if(r)setConfigure(null);return r}}/>}
 </div>
}

export {Section} from './YlaVintUI'
