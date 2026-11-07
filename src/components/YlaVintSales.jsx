import {useEffect,useState} from 'react'
import {buttonClass,fieldClass} from './WorkspaceUI'
import {Section,when} from './YlaVintTab'
import {ORDER_LABELS} from '../lib/fulfillment'

// Ventes lues par YlaVint sur chaque compte : statut, bordereau, passage dans l'onglet Ventes.
export default function YlaVintSales({request,accounts=[]}){
 const [account,setAccount]=useState(''),[data,setData]=useState(null),[busy,setBusy]=useState(false),[error,setError]=useState(''),[notice,setNotice]=useState('')
 const load=()=>request('GET',undefined,`&view=sales${account?`&account_id=${account}`:''}`).then(r=>{setData(r);setError('')}).catch(e=>setError(e.message))
 useEffect(()=>{load()},[account])
 async function act(body,message){setBusy(true);setError('');setNotice('');try{const r=await request('POST',body);if(message)setNotice(message);await load();return r}catch(e){setError(e.message)}finally{setBusy(false)}}
 async function label(o){const r=await act({action:'label_link',transaction_id:o.transaction_id});if(r?.url)window.open(r.url,'_blank','noopener')}
 const bridged=accounts.filter(a=>a.settings?.enabled&&a.settings.features.sales).map(a=>a.login)
 return <Section title="Ventes lues par YlaVint" hint={`Lues toutes les 30 min sur les comptes où « Lecture des ventes » est active. ${bridged.length?`Envoyées dans l’onglet Ventes pour : ${bridged.join(', ')}.`:'Active « Ventes → onglet Ventes » sur un compte pour remplacer le webhook Dotb.'} Le bordereau récupéré s’imprime depuis l’onglet Ventes comme avant (100 × 150).`}
  aside={<div className="flex flex-wrap gap-2"><select className={fieldClass.replace('w-full ','')+' py-1.5'} value={account} onChange={e=>setAccount(e.target.value)}><option value="">Tous les comptes</option>{accounts.map(a=><option key={a.id} value={a.id}>{a.login}</option>)}</select>
   {account&&<button className={buttonClass+' py-1.5'} disabled={busy} onClick={()=>act({action:'enqueue',account_id:account,kind:'sync_orders'},'Lecture des ventes demandée à YlaVint.')}>Relire les ventes</button>}</div>}>
  {error&&<p role="alert" className="text-sm text-red-700">{error}</p>}
  {notice&&<p role="status" className="text-sm text-teal-800">{notice}</p>}
  {!data?<p className="text-sm text-slate-500">Chargement…</p>:!data.orders.length?<p className="text-sm text-slate-500">Aucune vente lue pour l’instant.</p>:
  <ul className="divide-y divide-slate-100 text-sm">{data.orders.map(o=><li key={o.transaction_id} className="flex flex-wrap items-center gap-x-3 gap-y-1 py-2.5">
   <span className="min-w-0 flex-1"><span className="block truncate font-medium">{o.title||`Vente ${o.transaction_id}`}</span><span className="text-xs text-slate-500">{o.login} · {when(o.order_date)} · {o.status||'—'}</span></span>
   <span className="rounded-full bg-slate-100 px-2 py-0.5 text-xs text-slate-600">{ORDER_LABELS[o.normalized]||o.normalized}</span>
   {o.price!=null&&<span className="w-16 text-right font-semibold">{String(o.price).replace('.',',')} €</span>}
   {o.sales_order_id?<span className="rounded-full bg-teal-50 px-2 py-0.5 text-xs text-teal-700">Dans l’onglet Ventes</span>:<span className="rounded-full bg-slate-50 px-2 py-0.5 text-xs text-slate-400">Hors onglet Ventes</span>}
   {o.label_path?<button className={buttonClass+' py-1 text-xs'} disabled={busy} onClick={()=>label(o)}>Bordereau</button>:<span className="text-xs text-slate-400">sans bordereau</span>}
  </li>)}</ul>}
 </Section>
}
