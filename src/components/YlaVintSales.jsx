import {lazy,Suspense,useCallback,useEffect,useMemo,useState} from 'react'
import {buttonClass,compactClass,Pill,PageTitle,Table,Td} from './YlaVintUI'
import {ORDER_LABELS} from '../lib/fulfillment'
import ExtensionDialog,{ExtensionStatus} from './YlaVintExtensionDialog'
const ShippingLabelDialog=lazy(()=>import('./ShippingLabelDialog'))

const date=v=>v?new Date(v):null
const day=d=>d.toLocaleDateString('fr-FR',{day:'numeric',month:'short',year:'numeric'})
const hour=d=>d.toLocaleTimeString('fr-FR',{hour:'2-digit',minute:'2-digit'})
const CLOSED=['cancelled','returning','shipped','ready_for_pickup','delivered','completed']
// Date limite d'envoi : rouge si dépassée ou à moins de 24 h (vente encore à expédier).
const deadlineTone=o=>{if(!o.ship_deadline||CLOSED.includes(o.normalized))return 'text-zinc-300';const h=(Date.parse(o.ship_deadline)-Date.now())/36e5;return h<0?'text-rose-400 font-bold':h<24?'text-amber-300 font-semibold':'text-zinc-200'}
const orderUrl=o=>o.source==='desktop'?`https://www.vinted.fr/inbox/${o.conversation_id}`:`https://www.vinted.fr/transactions/${o.transaction_id}`
const itemUrl=o=>o.item_ids?.[0]?`https://www.vinted.fr/items/${o.item_ids[0]}`:orderUrl(o)
const TONES={payment_received:'blue',label_sent:'blue',shipped:'green',ready_for_pickup:'green',delivered:'green',completed:'green',cancelled:'red',returning:'red',suspended:'amber'}

// Commandes Vinted lues par YlaVint : statut, suivi du bordereau, passage dans l'onglet Ventes.
export default function YlaVintSales({request,accounts=[],onPrepare}){
 const [account,setAccount]=useState(''),[status,setStatus]=useState(''),[q,setQ]=useState(''),[data,setData]=useState(null),[busy,setBusy]=useState(false),[error,setError]=useState(''),[notice,setNotice]=useState('')
 const [printOrder,setPrintOrder]=useState(null)
 const [extension,setExtension]=useState(null)
 const labelRequest=useCallback(method=>request(method,{action:'label_print',account_id:printOrder?.account_id,conversation_id:printOrder?.conversation_id}),[request,printOrder?.account_id,printOrder?.conversation_id])
 const load=()=>request('GET',undefined,`&view=sales${account?`&account_id=${account}`:''}`).then(r=>{setData(r);setError('')}).catch(e=>setError(e.message))
 useEffect(()=>{load()},[account])
 async function act(body,message){setBusy(true);setError('');setNotice('');try{const r=await request('POST',body);if(message)setNotice(message);await load();return r}catch(e){setError(e.message)}finally{setBusy(false)}}
 async function label(o){const r=await act(o.source==='desktop'&&o.label_source!=='extension'?{action:'label_link',source:'desktop',account_id:o.account_id,conversation_id:o.conversation_id}:{action:'label_link',transaction_id:o.legacy_transaction_id||o.transaction_id});if(r?.url)window.open(r.url,'_blank','noopener')}
 const rows=useMemo(()=>(data?.orders||[]).filter(o=>(!status||o.normalized===status)&&(!q||`${o.title} ${o.transaction_id}`.toLowerCase().includes(q.toLowerCase()))),[data,status,q])
 const statuses=[...new Set((data?.orders||[]).map(o=>o.normalized))]
 return <div className="space-y-4">
  <PageTitle title="Commandes Vinted" hint="L’Assistant PC consulte les ventes toutes les 30 min et récupère les bordereaux accessibles. Il prépare le format thermique 100 × 150 mm avec le titre de l’article, en conservant l’original. Les passages suivent le planning du compte."/>
  <div className="flex flex-wrap items-center gap-2">
   {onPrepare&&<button className={buttonClass} onClick={onPrepare}>Préparer des colis</button>}
   <input className={compactClass+' w-64'} placeholder="Rechercher titre, n° de transaction" value={q} onChange={e=>setQ(e.target.value)}/>
   <select className={compactClass} value={status} onChange={e=>setStatus(e.target.value)}><option value="">⊕ Statut</option>{statuses.map(s=><option key={s} value={s}>{ORDER_LABELS[s]||s}</option>)}</select>
   <select className={compactClass} value={account} onChange={e=>setAccount(e.target.value)}><option value="">⊕ Compte</option>{accounts.map(a=><option key={a.id} value={a.id}>{a.login}</option>)}</select>
   {account&&<button className={buttonClass} disabled={busy} onClick={()=>act({action:'enqueue',account_id:account,kind:'sync_orders'},'Lecture des ventes demandée à YlaVint.')}>↻ Relire les ventes</button>}
   <span className="ml-auto text-xs text-zinc-500">{rows.length} commande(s)</span>
  </div>
  {error&&<p role="alert" className="text-sm text-rose-400">{error}</p>}
  {notice&&<p role="status" className="text-sm text-blue-300">{notice}</p>}
  {!data?<p className="text-sm text-zinc-500">Chargement…</p>:
  <Table head={['Date de commande','Article','Compte','Statut transaction','Statut','Prix','Expédier avant','Transporteur','Onglet Ventes','Bordereau','Prolongation']} empty={!rows.length&&'Aucune commande lue pour l’instant.'}>
   {rows.map(o=>{const d=date(o.order_date),dl=date(o.ship_deadline),colissimo=/colissimo/i.test(o.carrier||'');return <tr key={o.transaction_id} className="hover:bg-zinc-800/30">
    <Td className="whitespace-nowrap"><p className="font-semibold text-white">{d?day(d):'—'}</p><p className="text-xs text-zinc-500">{d?hour(d):''}</p></Td>
    <Td className="max-w-sm"><div className="flex items-center gap-3">
     <a href={itemUrl(o)} target="_blank" rel="noreferrer" className="shrink-0">{o.photo_url?<img src={o.photo_url} alt="" loading="lazy" className="h-12 w-12 rounded-md object-cover ring-1 ring-zinc-700"/>:<span className="grid h-12 w-12 place-items-center rounded-md bg-zinc-800 text-zinc-500">◈</span>}</a>
     <div className="min-w-0"><a className="block truncate text-blue-400 hover:underline" href={itemUrl(o)} target="_blank" rel="noreferrer" title={o.title}>{o.title||`Vente ${o.transaction_id}`} ↗</a>
      <a className="text-xs text-zinc-500 hover:text-zinc-300" href={orderUrl(o)} target="_blank" rel="noreferrer">Voir la vente</a>{o.source==='desktop'&&<p className="mt-1 text-xs text-indigo-300">Lecture visible · {o.seen_at?new Date(o.seen_at).toLocaleString('fr-FR'):''}</p>}</div>
    </div></Td>
    <Td className="text-blue-400">{o.login||'—'}</Td>
    <Td className="max-w-[12rem] truncate text-xs text-zinc-300" title={o.status}>{o.status||'—'}</Td>
    <Td><Pill tone={TONES[o.normalized]||'zinc'}>{o.source==='desktop'&&o.normalized==='label_sent'?'À expédier':ORDER_LABELS[o.normalized]||o.normalized}</Pill></Td>
    <Td className="whitespace-nowrap font-semibold">{o.price!=null?`${Number(o.price).toFixed(2).replace('.',',')} €`:'—'}</Td>
    <Td className={deadlineTone(o)}>{dl?<><p>{day(dl)}</p><p className="text-xs opacity-70">{hour(dl)}</p></>:o.deadline_text||'—'}</Td>
    <Td className="whitespace-nowrap text-xs">{o.carrier?<Pill tone={colissimo?'amber':'zinc'}>{o.carrier}</Pill>:'—'}</Td>
    <Td>{o.sales_order_id?<Pill tone="green">Envoyée</Pill>:<Pill>—</Pill>}</Td>
    <Td>{o.label_path?o.source==='desktop'&&o.label_source!=='extension'?<div className="min-w-40 space-y-2"><button className="text-sm text-blue-400 hover:underline" disabled={busy} onClick={()=>setPrintOrder(o)}>100 × 150 mm + titre</button>{o.thermal_error&&<p className="text-xs text-amber-300">Format à vérifier · original conservé</p>}</div>:<button className="text-sm text-blue-400 hover:underline" disabled={busy} onClick={()=>label(o)}>Ouvrir le PDF</button>:o.source==='desktop'?<div className="min-w-40"><Pill tone={o.label_state==='ready'?'blue':'amber'}>{o.label_state==='ready'?'À récupérer':'En attente'}</Pill>{o.label_note&&<p className="mt-2 text-xs text-zinc-400">{o.label_note}</p>}</div>:colissimo?<span className="text-xs text-amber-300" title="Bordereau à vérifier manuellement">À faire sur Vinted</span>:<span className="text-xs text-zinc-500">—</span>}</Td>
    <Td>{o.source==='desktop'?<ExtensionStatus order={o} onRequest={setExtension}/>:<span className="text-xs text-zinc-500">Assistant PC requis</span>}</Td>
   </tr>})}
  </Table>}
  {printOrder&&<div className="text-slate-900"><Suspense fallback={<p role="status">Préparation de l’aperçu…</p>}><ShippingLabelDialog line={{id:printOrder.transaction_id,source:{title:printOrder.title},order:{account_login:printOrder.login}}} request={labelRequest} onOriginal={()=>label(printOrder)} onClose={()=>setPrintOrder(null)}/></Suspense></div>}
  {extension&&<ExtensionDialog order={extension} request={request} onClose={()=>setExtension(null)} onSaved={r=>{setNotice(r.message);load()}}/>}
 </div>
}
