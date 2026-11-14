import {useCallback,useEffect,useState} from 'react'
import {Card,PageTitle,StatCard,Pill,Icon,buttonClass,compactClass} from './YlaVintUI'
import {isDesktop,DESKTOP_DEFAULTS} from '../lib/ylavintExecution'

const euro=v=>v==null?'—':Number(v).toLocaleString('fr-FR',{style:'currency',currency:'EUR'})
const date=v=>new Date(v).toLocaleString('fr-FR',{day:'2-digit',month:'short',hour:'2-digit',minute:'2-digit',timeZone:'Europe/Paris'})
export default function YlaVintWallet({request,accounts,onConfigure,onOrders}){
 const [data,setData]=useState(null),[selected,setSelected]=useState(''),[error,setError]=useState(''),[notice,setNotice]=useState(''),[busy,setBusy]=useState(null)
 const load=useCallback(async()=>{try{const r=await request('GET',undefined,'&view=wallet');setData(r);setError('')}catch(e){setError(e.message)}},[request])
 useEffect(()=>{load();const timer=setInterval(()=>{if(document.visibilityState==='visible')load()},60000);return()=>clearInterval(timer)},[load])
 async function refresh(account){setBusy(account.id);setNotice('');try{await request('POST',{action:'enqueue',account_id:account.id,kind:'scan_wallet'});setNotice(`Lecture demandée pour ${account.login}. Elle sera effectuée au prochain passage autorisé de l’assistant.`);setError('')}catch(e){setError(e.message)}finally{setBusy(null)}}
 const rows=accounts.filter(a=>!selected||a.id===selected),wallets=new Map((data?.wallets||[]).map(w=>[w.account_id,w]))
 return <div className="space-y-5">
  <PageTitle title="Porte-monnaie" hint="Les montants lus sur Vinted, compte par compte. Deux passages par jour, à tes horaires." aside={<button className={buttonClass} onClick={load}>↻ Actualiser l’affichage</button>}/>
  <div className="flex flex-wrap items-center gap-3"><select aria-label="Compte du porte-monnaie" className={compactClass} value={selected} onChange={e=>setSelected(e.target.value)}><option value="">Tous les comptes</option>{accounts.map(a=><option key={a.id} value={a.id}>{a.login}</option>)}</select><button className={buttonClass} onClick={onConfigure}><Icon name="settings"/>Régler les passages</button><button className={buttonClass} onClick={onOrders}><Icon name="box"/>Mes bordereaux</button></div>
  {error&&<p role="alert" className="text-sm text-rose-300">{error}</p>}
  {notice&&<p role="status" className="rounded-xl bg-indigo-500/10 p-4 text-sm text-indigo-200">{notice}</p>}
  {!data&&!error&&<p className="text-sm text-zinc-400">Chargement des dernières lectures…</p>}
  <div className="grid gap-5 xl:grid-cols-2">{rows.map(a=>{
   const w=wallets.get(a.id),enabled=isDesktop(a.settings)&&a.settings?.features.wallet,active=enabled&&a.settings.enabled&&!a.settings.paused,hours=a.settings?.messaging?.desktop?.wallet_hours||DESKTOP_DEFAULTS.wallet_hours
   const stale=w&&Date.now()-Date.parse(w.checked_at)>24*3600000
   return <Card key={a.id} className="space-y-5 p-5 sm:p-6">
    <div className="flex flex-wrap items-center justify-between gap-3"><div><p className="ylv-eyebrow">Boutique</p><h2 className="mt-1 text-lg font-semibold text-white">{a.login}</h2></div><Pill tone={active?'green':'zinc'}>{active?'Suivi activé':enabled?'Compte arrêté ou en pause':'Suivi non activé'}</Pill></div>
    <div className="grid gap-3 sm:grid-cols-2"><StatCard label="Montant disponible" value={euro(w?.available)} tone="green" icon={<Icon name="chart"/>}/><StatCard label="Montant en attente" value={euro(w?.pending)} tone="amber" icon={<Icon name="clock"/>}/></div>
    <div className="flex flex-wrap items-center gap-2"><Pill tone={w?.withdrawal==='available'?'green':w?'zinc':'amber'}>{!w?'Première lecture attendue':w.withdrawal==='available'?'Transfert proposé par Vinted':w.available===0?'Aucun montant disponible':w.withdrawal==='unavailable'?'Transfert indisponible':'Disponibilité du transfert à vérifier'}</Pill>{stale&&<Pill tone="amber">Lecture de plus de 24 h</Pill>}</div>
    <div className="space-y-1 text-xs text-zinc-400"><p>{w?`Dernière lecture : ${date(w.checked_at)}`:'Aucun montant lu : les tirets ne signifient pas zéro.'}</p><p>Passages à partir de {hours.map(h=>`${String(h).padStart(2,'0')} h`).join(' et ')} · heure de Paris</p></div>
    <div className="flex flex-wrap gap-2"><button className={buttonClass} disabled={!active||!!busy} onClick={()=>refresh(a)}>{busy===a.id?'Demande en cours…':'Vérifier maintenant'}</button></div>
   </Card>
  })}</div>
  {!rows.length&&<Card className="p-6 text-sm text-zinc-400">Relie un compte depuis Assistant PC pour suivre son porte-monnaie.</Card>}
  <p className="text-sm leading-relaxed text-zinc-400">L’assistant relève les montants et la disponibilité du transfert. Le retrait reste à faire par toi sur Vinted. Garde le PC et le connecteur ouverts : les passages respectent les pauses, les jours et les horaires du compte. Un créneau manqué attend le prochain passage possible, sans enchaîner deux lectures de rattrapage.</p>
 </div>
}
