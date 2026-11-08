import {useEffect,useMemo,useState} from 'react'
import {buttonClass,compactClass,Pill,PageTitle,Table,Td} from './YlaVintUI'
import {ORDER_LABELS} from '../lib/fulfillment'

const date=v=>v?new Date(v):null
const TONES={payment_received:'blue',label_sent:'blue',shipped:'green',ready_for_pickup:'green',delivered:'green',completed:'green',cancelled:'red',returning:'red',suspended:'amber'}

// Commandes Vinted lues par YlaVint : statut, suivi du bordereau, passage dans l'onglet Ventes.
export default function YlaVintSales({request,accounts=[]}){
 const [account,setAccount]=useState(''),[status,setStatus]=useState(''),[q,setQ]=useState(''),[data,setData]=useState(null),[busy,setBusy]=useState(false),[error,setError]=useState(''),[notice,setNotice]=useState('')
 const load=()=>request('GET',undefined,`&view=sales${account?`&account_id=${account}`:''}`).then(r=>{setData(r);setError('')}).catch(e=>setError(e.message))
 useEffect(()=>{load()},[account])
 async function act(body,message){setBusy(true);setError('');setNotice('');try{const r=await request('POST',body);if(message)setNotice(message);await load();return r}catch(e){setError(e.message)}finally{setBusy(false)}}
 async function label(o){const r=await act({action:'label_link',transaction_id:o.transaction_id});if(r?.url)window.open(r.url,'_blank','noopener')}
 const rows=useMemo(()=>(data?.orders||[]).filter(o=>(!status||o.normalized===status)&&(!q||`${o.title} ${o.transaction_id}`.toLowerCase().includes(q.toLowerCase()))),[data,status,q])
 const statuses=[...new Set((data?.orders||[]).map(o=>o.normalized))]
 return <div className="space-y-4">
  <PageTitle title="Commandes Vinted" hint="Lues toutes les 30 min sur les comptes où « Lecture des ventes » est active. Avec « Ventes → onglet Ventes », elles arrivent dans ton onglet Ventes à la place du webhook Dotb."/>
  <div className="flex flex-wrap items-center gap-2">
   <input className={compactClass+' w-64'} placeholder="Rechercher titre, n° de transaction" value={q} onChange={e=>setQ(e.target.value)}/>
   <select className={compactClass} value={status} onChange={e=>setStatus(e.target.value)}><option value="">⊕ Statut</option>{statuses.map(s=><option key={s} value={s}>{ORDER_LABELS[s]||s}</option>)}</select>
   <select className={compactClass} value={account} onChange={e=>setAccount(e.target.value)}><option value="">⊕ Compte</option>{accounts.map(a=><option key={a.id} value={a.id}>{a.login}</option>)}</select>
   {account&&<button className={buttonClass} disabled={busy} onClick={()=>act({action:'enqueue',account_id:account,kind:'sync_orders'},'Lecture des ventes demandée à YlaVint.')}>↻ Relire les ventes</button>}
   <span className="ml-auto text-xs text-zinc-500">{rows.length} commande(s)</span>
  </div>
  {error&&<p role="alert" className="text-sm text-rose-400">{error}</p>}
  {notice&&<p role="status" className="text-sm text-blue-300">{notice}</p>}
  {!data?<p className="text-sm text-zinc-500">Chargement…</p>:
  <Table head={['Date de commande','Titre','Compte','Statut transaction','Statut','Prix','Onglet Ventes','Bordereau']} empty={!rows.length&&'Aucune commande lue pour l’instant.'}>
   {rows.map(o=>{const d=date(o.order_date);return <tr key={o.transaction_id} className="hover:bg-zinc-800/30">
    <Td className="whitespace-nowrap"><p className="font-semibold text-white">{d?d.toLocaleDateString('fr-FR',{day:'numeric',month:'short',year:'numeric'}):'—'}</p><p className="text-xs text-zinc-500">{d?d.toLocaleTimeString('fr-FR',{hour:'2-digit',minute:'2-digit'}):''}</p></Td>
    <Td className="max-w-xs"><a className="block truncate text-blue-400 hover:underline" href={`https://www.vinted.fr/transactions/${o.transaction_id}`} target="_blank" rel="noreferrer" title={o.title}>{o.title||`Vente ${o.transaction_id}`} ↗</a></Td>
    <Td className="text-blue-400">{o.login||'—'}</Td>
    <Td className="max-w-[12rem] truncate text-xs text-zinc-300" title={o.status}>{o.status||'—'}</Td>
    <Td><Pill tone={TONES[o.normalized]||'zinc'}>{ORDER_LABELS[o.normalized]||o.normalized}</Pill></Td>
    <Td className="whitespace-nowrap font-semibold">{o.price!=null?`${String(o.price).replace('.',',')} €`:'—'}</Td>
    <Td>{o.sales_order_id?<Pill tone="green">Envoyée</Pill>:<Pill>—</Pill>}</Td>
    <Td>{o.label_path?<button className="text-sm text-blue-400 hover:underline" disabled={busy} onClick={()=>label(o)}>🖨 Bordereau</button>:<span className="text-xs text-zinc-500">—</span>}</Td>
   </tr>})}
  </Table>}
 </div>
}
