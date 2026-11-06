import {useEffect,useState} from 'react'
import {buttonClass,primaryClass} from './WorkspaceUI'

export const vintedWatchRequest=(method='GET',body)=>import('../lib/api').then(m=>m.resourcesRequest(method,body,'?scope=watch'))
const when=v=>v?new Date(v).toLocaleString('fr-FR',{day:'2-digit',month:'short',hour:'2-digit',minute:'2-digit'}):'jamais'

// Extension de veille : lit le bandeau « Compte restreint / bloqué » de Vinted dans les profils AdsPower ouverts.
export default function VintedWatchPanel({request=vintedWatchRequest}){
 const [keys,setKeys]=useState(null),[busy,setBusy]=useState(false),[error,setError]=useState(''),[open,setOpen]=useState(false)
 const load=()=>request('GET').then(r=>setKeys(r.keys||[])).catch(e=>setError(e.message))
 useEffect(()=>{load()},[])
 async function download(){
  setBusy(true);setError('')
  try{
   const r=await request('POST',{action:'download'})
   const bytes=Uint8Array.from(atob(r.zip_base64),c=>c.charCodeAt(0)),url=URL.createObjectURL(new Blob([bytes],{type:'application/zip'}))
   const a=document.createElement('a');a.href=url;a.download=r.filename;a.click();setTimeout(()=>URL.revokeObjectURL(url),5000)
   setOpen(true);await load()
  }catch(e){setError(e.message)}finally{setBusy(false)}
 }
 async function revoke(id){if(!window.confirm('Désactiver cette extension ? Les profils qui l’utilisent n’enverront plus rien.'))return;setBusy(true);try{await request('POST',{action:'revoke',id});await load()}catch(e){setError(e.message)}finally{setBusy(false)}}
 const active=(keys||[]).filter(k=>!k.revoked_at),seen=active.filter(k=>k.last_seen_at)
 return <section className="rounded-2xl border border-slate-200 bg-white p-4 sm:p-5 space-y-3" aria-label="Veille des comptes Vinted">
  <header className="flex flex-wrap items-start justify-between gap-3">
   <div><h2 className="font-semibold">Veille des comptes · bandeau Vinted</h2>
    <p className="mt-1 text-xs text-slate-500">Une extension dans tes profils AdsPower lit l’état du compte que Vinted met dans ses pages (« Compte restreint jusqu’au … », compte bloqué) : à chaque page Vinted ouverte et toutes les 45 min tant que le profil est ouvert. L’état se met à jour ici tout seul, avec le bandeau d’alerte.</p></div>
   <div className="flex gap-2"><button className={primaryClass} disabled={busy} onClick={download}>{busy?'Préparation…':'Télécharger l’extension'}</button><button className={buttonClass} onClick={()=>setOpen(!open)} aria-expanded={open}>Installation</button></div>
  </header>
  {error&&<p role="alert" className="text-sm text-red-700">{error}</p>}
  {keys&&<p className="text-xs text-slate-600">{active.length?`${active.length} extension(s) active(s) · dernier signal ${when(seen.map(k=>k.last_seen_at).sort().at(-1))}${seen[0]?.last_login?` (${seen.sort((a,b)=>String(b.last_seen_at).localeCompare(String(a.last_seen_at)))[0].last_login})`:''}`:'Aucune extension installée pour l’instant.'}</p>}
  {open&&<ol className="list-decimal space-y-1 pl-5 text-sm text-slate-700">
   <li>Dans AdsPower, ouvre <strong>Extensions</strong> (menu de gauche), puis <strong>Ajouter une extension</strong> → <strong>Téléverser un fichier</strong> et choisis le zip téléchargé.</li>
   <li>Active son <strong>interrupteur</strong> : elle se charge alors dans tous tes profils, nouveaux compris, à leur prochain lancement. Pour une nouvelle version, utilise <strong>··· → Mise à jour</strong> sur la même extension.</li>
   <li>C’est tout : l’extension reconnaît seule le compte Vinted connecté dans chaque profil, et vérifie son état à chaque page Vinted ouverte et toutes les 45 min tant que le profil est ouvert.</li>
  </ol>}
  {active.length>0&&<details><summary className="cursor-pointer text-xs text-slate-500">Extensions téléchargées ({active.length})</summary><ul className="mt-2 space-y-1 text-xs">{active.map(k=><li key={k.id} className="flex items-center justify-between gap-2"><span>Téléchargée le {when(k.created_at)} · dernier signal {when(k.last_seen_at)}</span><button className="text-red-700 underline" disabled={busy} onClick={()=>revoke(k.id)}>Désactiver</button></li>)}</ul></details>}
 </section>
}
