import {useEffect,useRef,useState} from 'react'
import {PageTitle,Card,Pill,fieldClass,buttonClass,Icon} from './YlaVintUI'

const when=v=>v?new Date(v).toLocaleString('fr-FR',{day:'numeric',month:'short',hour:'2-digit',minute:'2-digit',timeZone:'Europe/Paris'}):'Dès que possible'
export default function YlaVintActions({request,accounts,onAssistant}){
 const [account,setAccount]=useState(''),[data,setData]=useState(null),[error,setError]=useState(''),[busy,setBusy]=useState(null)
 const query='&view=actions'+(account?'&account_id='+account:''),current=useRef(query);current.current=query
 const load=async()=>{try{const r=await request('GET',undefined,query);if(current.current===query){setData(r);setError('')}}catch(e){if(current.current===query)setError(e.message)}}
 useEffect(()=>{current.current=query;setData(null);load();const t=setInterval(()=>{if(document.visibilityState==='visible')load()},5000);return()=>{clearInterval(t);current.current=null}},[query])
 async function cancel(id){setBusy(id);try{await request('POST',{action:'cancel',task_id:id});await load()}catch(e){setError(e.message)}finally{setBusy(null)}}
 return <div className="space-y-5">
  <PageTitle title="Prochaines actions" hint="Relis les messages, les réductions et les annonces avant la prise en charge." aside={<button className={buttonClass} onClick={onAssistant}><Icon name="monitor"/>Assistant PC</button>}/>
  <div className="flex flex-wrap items-center gap-3"><label className="text-sm">Compte<select className={fieldClass+' mt-1'} value={account} onChange={e=>setAccount(e.target.value)}><option value="">Tous les comptes</option>{accounts.map(a=><option key={a.id} value={a.id}>{a.login}</option>)}</select></label><button className={buttonClass+' mt-5'} onClick={load}>Actualiser</button><p className="text-xs text-zinc-400">{data?.actions?.length??'…'} action(s) affichée(s) · 100 au maximum</p></div>
  <p className="rounded-xl border border-indigo-400/20 bg-indigo-400/5 p-4 text-sm text-zinc-300">Les heures indiquent le début possible : planning, pauses et délais peuvent repousser l’action. Le prix et la conversation sont revérifiés avant l’envoi. Une consultation de cette liste ne déclenche aucune action.</p>
  {error&&<p role="alert" className="text-sm text-rose-300">{error}</p>}
  {data&&!data.actions.length&&<Card className="p-8 text-center text-zinc-400">Aucune action en attente.</Card>}
  <div className="grid gap-4 xl:grid-cols-2">{(data?.actions||[]).map(a=><Card key={a.id} className="space-y-4 p-5">
   <div className="flex items-start justify-between gap-3"><div><p className="font-semibold">{a.recipient}</p><p className="mt-1 text-xs text-zinc-400">{a.login} · {a.executor==='desktop'?'Assistant PC':'Extension'}{a.item_title?' · '+a.item_title:''}</p></div><Pill tone={a.state==='running'?'violet':a.blocked_reason?'amber':'blue'}>{a.state==='running'?'Prise en charge':a.blocked_reason?'En attente':'Prévue'}</Pill></div>
   <p className="text-xs text-zinc-400">{a.reason}</p>
   {a.body?<p className="rounded-xl border border-zinc-700 bg-zinc-900 p-4 text-sm leading-relaxed whitespace-pre-wrap">{a.body}</p>:<p className="text-sm text-zinc-400">Aucun texte prévu.</p>}
   {a.offer_requested&&<p className="text-sm text-emerald-300">Réduction prévue : {a.offer_price==null?'prix à confirmer':Number(a.offer_price).toLocaleString('fr-FR',{style:'currency',currency:'EUR'})}</p>}
   {a.kind==='publish_item'&&<p className="text-sm text-violet-200">{Number(a.listing_price).toLocaleString('fr-FR',{style:'currency',currency:'EUR'})} · {a.photo_count} photo(s) · aucun envoi avant les contrôles</p>}
   {a.blocked_reason&&<p className="text-xs text-amber-200">{a.blocked_reason}</p>}
   <div className="flex items-center justify-between gap-3 border-t border-zinc-700 pt-3"><span className="text-xs text-zinc-400">À partir du {when(a.not_before)}</span><button className={buttonClass+' text-xs'} disabled={!!busy||a.state!=='queued'} onClick={()=>cancel(a.id)}>{busy===a.id?'Annulation…':'Annuler'}</button></div>
  </Card>)}</div>
 </div>
}
