import {useCallback,useEffect,useState} from 'react'
import {adsPowerRequest} from '../lib/adspower'
import {vintedWatchRequest} from './VintedWatchPanel'
import {buttonClass,primaryClass,fieldClass,Card,PageTitle} from './YlaVintUI'

const active=s=>['opening','running','waiting','stopping'].includes(s?.state)
export default function YlaVintDesktop({accounts,onConfigure,request=adsPowerRequest,pair=vintedWatchRequest}){
 const [state,setState]=useState(null),[profiles,setProfiles]=useState([]),[selected,setSelected]=useState(''),[profile,setProfile]=useState(''),[error,setError]=useState(''),[connectionError,setConnectionError]=useState(''),[busy,setBusy]=useState(false)
 const account=accounts.find(a=>a.id===selected),session=state?.assistants?.find(s=>s.account_id===selected)
 const load=useCallback(async(list=false)=>{try{const r=await request('/state');setState(r);if(list&&r.configured){const p=await request('/profiles');setProfiles(p.profiles)}setConnectionError('')}catch(e){setConnectionError(e.message)}},[request])
 useEffect(()=>{load(true);const timer=setInterval(()=>{if(document.visibilityState==='visible')load()},5000);return()=>clearInterval(timer)},[load])
 async function start(checkOnly){
  if(!account||!profile)return
  setBusy(true);setError('')
  try{const binding=await pair('POST',{action:'desktop_pair',account_id:account.id,profile_id:profile});const r=await request('/ylavint/start',{...binding,check_only:checkOnly});setState(s=>({...s,assistants:r.assistants}))}catch(e){setError(e.message)}finally{setBusy(false)}
 }
 async function stop(id){setBusy(true);try{const r=await request('/ylavint/stop',{account_id:id});setState(s=>({...s,assistants:r.assistants}))}catch(e){setError(e.message)}finally{setBusy(false)}}
 const ready=account&&profile&&state?.ylavint&&state?.configured&&!connectionError&&account.settings?.messaging?.executor==='desktop'&&!busy&&!active(session)
 return <div className="space-y-5">
  <PageTitle title="Assistant PC" hint="Favoris, réductions, relances et réponses IA dans AdsPower, sans extension."/>
  <Card className="space-y-3 p-5 text-sm text-zinc-300">
   <p>Les textes, réductions et délais restent ceux des rubriques <strong>Likes d’articles</strong> et <strong>Smart Agent</strong>. Les messages sont saisis progressivement dans Vinted.</p>
   <p className="text-amber-200">Version pilote : commence par « Vérifier le compte sans envoyer ». Le premier envoi réel reste à valider avant une utilisation sur plusieurs comptes.</p>
   <p>Garde ce PC, AdsPower et le connecteur ouverts. Arrête Scalency ou Dotb sur le compte choisi avant de démarrer. L’extension YlaVint cède la place lorsque tu choisis « Assistant PC ».</p>
   <p className="text-zinc-400">Cette version couvre les favoris et la messagerie. Les annonces, ventes et bordereaux utilisent encore le mode Extension. Après un redémarrage du connecteur, démarre à nouveau tes assistants depuis cette page.</p>
   <div className="flex flex-wrap gap-3"><a className={buttonClass} href="/downloads/adspower-companion.zip" download>Télécharger le connecteur 1.2</a><a className={buttonClass} href="http://127.0.0.1:17442/setup" target="_blank" rel="noreferrer">Configurer AdsPower</a><button className={buttonClass} onClick={()=>load(true)}>Actualiser</button></div>
   {state&&!state.ylavint&&<p role="status">Mets à jour le connecteur avec cette archive, puis relance run.bat.</p>}
  </Card>
  {(connectionError||error)&&<p role="alert" className="rounded-lg bg-rose-950 p-3 text-sm text-rose-200">{connectionError||error}</p>}
  <Card className="p-5"><div className="grid gap-4 sm:grid-cols-2">
   <label className="text-sm">Compte Vinted<select className={fieldClass+' mt-2'} value={selected} onChange={e=>setSelected(e.target.value)}><option value="">Choisir un compte</option>{accounts.map(a=><option key={a.id} value={a.id}>{a.login}</option>)}</select></label>
   <label className="text-sm">Son profil AdsPower<select className={fieldClass+' mt-2'} value={profile} onChange={e=>setProfile(e.target.value)}><option value="">Choisir un profil</option>{profiles.map(p=><option key={p.id} value={p.id}>#{p.number} · {p.name}</option>)}</select></label>
   {account&&<div className="space-y-3 sm:col-span-2">
    <p className="text-sm text-zinc-400">Le compte connecté sera vérifié avant toute action. Mode actuel : {account.settings?.messaging?.executor==='desktop'?'Assistant PC':'Extension'}.</p>
    <button className={buttonClass} onClick={()=>onConfigure(account)}>Réglages de {account.login}</button>
    <div className="flex flex-wrap gap-3"><button className={buttonClass} disabled={!ready} onClick={()=>start(true)}>Vérifier le compte sans envoyer</button><button className={primaryClass} disabled={!ready||!account.settings?.enabled||account.settings?.paused} onClick={()=>start(false)}>Démarrer cet assistant</button></div>
    {account.settings?.paused&&<p className="text-sm text-amber-300">Compte en pause : vérifie le journal puis reprends-le dans Comptes & réglages.</p>}
   </div>}
  </div></Card>
  {(state?.assistants||[]).map(s=><Card className="p-5" key={s.account_id}><div className="flex items-center justify-between gap-4"><div><p className="font-medium">{accounts.find(a=>a.id===s.account_id)?.login||'Compte Vinted'}</p><p role="status" className="mt-1 text-sm text-zinc-400">{s.message}</p></div>{active(s)&&<button className={buttonClass} disabled={busy||s.state==='stopping'} onClick={()=>stop(s.account_id)}>Arrêter</button>}</div></Card>)}
 </div>
}
