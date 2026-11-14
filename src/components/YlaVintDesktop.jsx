import {useCallback,useEffect,useState} from 'react'
import {adsPowerRequest} from '../lib/adspower'
import {vintedWatchRequest} from './VintedWatchPanel'
import {buttonClass,primaryClass,fieldClass,Card,PageTitle,Icon,Pill,StatCard} from './YlaVintUI'

const active=s=>['opening','reading','typing','preparing','running','waiting','browsing','break','stopping'].includes(s?.state)
export default function YlaVintDesktop({accounts,onConfigure,onActions,request=adsPowerRequest,pair=vintedWatchRequest}){
 const [state,setState]=useState(null),[profiles,setProfiles]=useState([]),[selected,setSelected]=useState(''),[profile,setProfile]=useState(''),[error,setError]=useState(''),[connectionError,setConnectionError]=useState(''),[busy,setBusy]=useState(false)
 const account=accounts.find(a=>a.id===selected)
 const load=useCallback(async(list=false)=>{try{const r=await request('/state');setState(r);if(list&&r.configured){const p=await request('/profiles');setProfiles(p.profiles)}setConnectionError('')}catch(e){setConnectionError(e.message)}},[request])
 useEffect(()=>{load(true);const timer=setInterval(()=>{if(document.visibilityState==='visible')load()},5000);return()=>clearInterval(timer)},[load])
 async function start(checkOnly,rehearse=false){
  if(!account||!profile)return
  setBusy(true);setError('')
  try{const binding=await pair('POST',{action:'desktop_pair',account_id:account.id,profile_id:profile});const r=await request('/ylavint/start',{...binding,check_only:checkOnly,rehearse});setState(s=>({...s,assistants:r.assistants}))}catch(e){setError(e.message)}finally{setBusy(false)}
 }
 async function stop(id){setBusy(true);try{const r=await request('/ylavint/stop',{account_id:id});setState(s=>({...s,assistants:r.assistants}))}catch(e){setError(e.message)}finally{setBusy(false)}}
 async function takeover(id){setBusy(true);try{const r=await request('/ylavint/takeover',{account_id:id});setState(s=>({...s,assistants:r.assistants}))}catch(e){setError(e.message)}finally{setBusy(false)}}
 const currentVersion=state?.publication_ui===true
 const connected=!!state&&!connectionError,configured=connected&&state?.configured&&currentVersion
 const running=connected?(state?.assistants||[]).filter(active).length:0
 const ready=account&&profile&&currentVersion&&state?.ylavint&&state?.configured&&!connectionError&&account.settings?.messaging?.executor==='desktop'&&!busy&&!(state?.assistants||[]).some(active)
 return <div className="space-y-5">
  <PageTitle title="Assistant PC" hint="Tes conversations et annonces, pilotées depuis les pages Vinted ouvertes dans AdsPower." aside={<><button className={buttonClass} onClick={onActions}><Icon name="clock"/>Prochaines actions</button><button className={buttonClass} onClick={()=>load(true)}>↻ Actualiser</button></>}/>
  <div className="grid gap-4 sm:grid-cols-3">
   <StatCard label="Connecteur" value={connected?'Connecté':'Hors ligne'} tone={connected?'green':'amber'} icon={<Icon name="monitor"/>} sub={configured?'Prêt pour les pages visibles':connected?'Configuration à terminer':'Ouvre le connecteur sur ce PC'}/>
   <StatCard label="Assistants sur ce PC" value={connected?running:'—'} tone="violet" icon={<Icon name="spark"/>} sub="Sessions ouvertes, pauses comprises"/>
   <StatCard label="Profils AdsPower" value={configured?profiles.length:'—'} tone="blue" icon={<Icon name="users"/>} sub="Disponibles dans le sélecteur"/>
  </div>
  <Card className="p-5 sm:p-6"><div className="mb-5 flex items-center justify-between gap-3"><h2 className="text-lg font-semibold text-white">Tout commence ici</h2><Pill tone="blue">3 étapes</Pill></div>
   <div className="grid gap-6 md:grid-cols-3">
    <div><span className="ylv-step-number mb-3 grid h-9 w-9 place-items-center rounded-xl text-sm font-semibold">01</span><h3 className="text-sm font-semibold text-white">Relie ton ordinateur</h3><p className="mt-2 text-sm leading-relaxed text-zinc-400">Télécharge le connecteur et ouvre-le sur le PC où tourne AdsPower.</p><a className={buttonClass+' mt-4'} href="/downloads/adspower-companion.zip" download>Télécharger la version 1.5</a></div>
    <div><span className="ylv-step-number mb-3 grid h-9 w-9 place-items-center rounded-xl text-sm font-semibold">02</span><h3 className="text-sm font-semibold text-white">Connecte AdsPower</h3><p className="mt-2 text-sm leading-relaxed text-zinc-400">Renseigne la connexion locale pour retrouver tes profils dans YlaVint.</p><a className={buttonClass+' mt-4'} href="http://127.0.0.1:17442/setup" target="_blank" rel="noreferrer">Configurer AdsPower<Icon name="arrow"/></a></div>
    <div><span className="ylv-step-number mb-3 grid h-9 w-9 place-items-center rounded-xl text-sm font-semibold">03</span><h3 className="text-sm font-semibold text-white">Choisis et vérifie ton compte</h3><p className="mt-2 text-sm leading-relaxed text-zinc-400">Associe le bon profil ci-dessous, active le mode Assistant PC et lance la vérification.</p><p className="mt-4 text-xs text-indigo-300">L’identité Vinted est vérifiée avant toute action.</p></div>
   </div>
   {state&&!currentVersion&&<p role="status" className="mt-5 rounded-xl bg-amber-500/10 p-3 text-sm text-amber-200">Mets à jour le connecteur avec cette archive, puis relance run.bat pour utiliser la publication visible, le planning et la reprise en main.</p>}
  </Card>
  {(connectionError||error)&&<p role="alert" className="rounded-lg bg-rose-950 p-3 text-sm text-rose-200">{connectionError||error}</p>}
  <Card className="p-5 sm:p-6"><div className="mb-5 flex items-center gap-3"><span className="ylv-avatar grid h-10 w-10 place-items-center rounded-xl"><Icon name="monitor"/></span><div><h2 className="font-semibold text-white">Piloter un assistant</h2><p className="mt-1 text-xs text-zinc-400">Un compte Vinted, son profil AdsPower et tes réglages.</p></div></div><div className="grid gap-4 sm:grid-cols-2">
   <label className="text-sm">Compte Vinted<select className={fieldClass+' mt-2'} value={selected} onChange={e=>setSelected(e.target.value)}><option value="">Choisir un compte</option>{accounts.map(a=><option key={a.id} value={a.id}>{a.login}</option>)}</select></label>
   <label className="text-sm">Son profil AdsPower<select className={fieldClass+' mt-2'} value={profile} onChange={e=>setProfile(e.target.value)}><option value="">Choisir un profil</option>{profiles.map(p=><option key={p.id} value={p.id}>#{p.number} · {p.name}</option>)}</select></label>
   {account&&<div className="space-y-3 sm:col-span-2">
    <p className="text-sm text-zinc-400">Le compte connecté sera vérifié avant toute action. Mode actuel : {account.settings?.messaging?.executor==='desktop'?'Assistant PC':'Extension'}.</p>
    <button className={buttonClass} onClick={()=>onConfigure(account)}><Icon name="settings"/>Réglages de {account.login}</button>
    <div className="flex flex-wrap gap-3"><button className={buttonClass} disabled={!ready} onClick={()=>start(true)}>Vérifier le compte sans envoyer</button><button className={buttonClass} disabled={!ready} onClick={()=>start(false,true)}>Répéter sans envoyer</button><button className={primaryClass} disabled={!ready||!account.settings?.enabled||account.settings?.paused} onClick={()=>start(false)}>Démarrer cet assistant</button></div>
    <p className="text-xs text-zinc-400">La répétition lit les pages et présente les actions prévues, sans saisir de brouillon ni prendre de tâche. Un seul profil est piloté à la fois sur ce PC.</p>
    {account.settings?.paused&&<p className="text-sm text-amber-300">Compte en pause : vérifie le journal puis reprends-le dans Comptes & réglages.</p>}
   </div>}
  </div></Card>
  <div className="rounded-2xl border border-amber-400/20 bg-amber-500/5 px-5 py-4 text-sm leading-relaxed text-amber-200"><strong>Version pilote.</strong> Commence par « Vérifier le compte sans envoyer ». Le premier envoi réel reste à valider avant une utilisation sur plusieurs comptes.</div>
  {!!state?.assistants?.length&&<h2 className="pt-1 text-lg font-semibold text-white">Sessions sur cet ordinateur</h2>}
  {(state?.assistants||[]).map(s=><Card className="space-y-4 p-5" key={s.account_id}><div className="flex flex-wrap items-center justify-between gap-4"><div><p className="font-medium">{accounts.find(a=>a.id===s.account_id)?.login||'Compte Vinted'}</p><p role="status" className="mt-1 text-sm text-zinc-400">{s.message}</p></div>{active(s)&&<div className="flex flex-wrap gap-2"><button className={primaryClass} disabled={busy||s.state==='stopping'} onClick={()=>takeover(s.account_id)}>Je reprends la main</button><button className={buttonClass} disabled={busy||s.state==='stopping'} onClick={()=>stop(s.account_id)}>Arrêter</button></div>}</div>
   {s.summary&&<div className="grid grid-cols-2 gap-3 rounded-xl bg-zinc-900 p-4 text-xs sm:grid-cols-4">{[['conversations_read','Conversations lues'],['messages_sent','Messages confirmés'],['offers_sent','Réductions confirmées'],['actions_cancelled','Actions écartées'],['articles_read','Articles du dressing'],['likes_read','Favoris lus'],['articles_browsed','Annonces consultées'],['photos_opened','Photos suivantes ouvertes']].map(([k,label])=><div key={k}><p className="text-zinc-400">{label}</p><p className="mt-1 text-lg font-semibold">{s.summary[k]||0}</p></div>)}</div>}
   {s.actions_preview?.length>0&&<details><summary className="cursor-pointer text-sm text-indigo-300">Aperçu au dernier contrôle · {s.actions_preview.length} action(s)</summary><div className="mt-3 space-y-3">{s.actions_preview.slice(0,10).map(a=><div key={a.id} className="rounded-xl border border-zinc-700 p-3 text-sm"><p className="font-medium">{a.recipient}</p><p className="mt-1 text-xs text-zinc-400">{a.reason}</p><p className="mt-2 whitespace-pre-wrap">{a.body||'Offre sans message'}</p>{a.offer_requested&&<p className="mt-2 text-emerald-300">Offre : {a.offer_price==null?'à confirmer':a.offer_price+' €'}</p>}</div>)}</div><button className={buttonClass+' mt-3'} onClick={onActions}>Voir la liste actualisée</button></details>}
  </Card>)}
  <Card className="p-5 sm:p-6"><details className="text-sm text-zinc-400"><summary className="cursor-pointer font-medium text-zinc-200">Fonctionnement et réglages à connaître</summary><div className="mt-4 space-y-3 leading-relaxed">
   <p>Les textes, réductions et délais restent ceux des rubriques <strong>Likes d’articles</strong> et <strong>Smart Agent</strong>. Les lectures, la saisie et les clics passent par les pages Vinted ouvertes.</p>
   <p>Dans les réglages du compte, <strong>Rythme et navigation sur Vinted</strong> permet de régler la saisie, les pauses et la consultation d’annonces avec défilement. Aucun favori automatique.</p>
   <p>Garde ce PC, AdsPower et le connecteur ouverts, avec la fenêtre du profil non réduite. Arrête Scalency ou Dotb sur le compte choisi avant de démarrer. L’extension YlaVint cède la place lorsque tu choisis « Assistant PC ».</p>
   <p>Le dressing et la messagerie sont lus sur les pages chargées : l’historique complet n’est pas garanti. Les annonces se préparent et se publient depuis l’atelier avec le connecteur 1.5. Les ventes et bordereaux utilisent le mode Extension. Après un redémarrage du connecteur, démarre à nouveau tes assistants depuis cette page.</p>
  </div></details></Card>
 </div>
}
