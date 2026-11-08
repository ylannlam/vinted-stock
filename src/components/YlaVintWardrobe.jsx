import {useEffect,useState} from 'react'
import {buttonClass,compactClass,Pill,PageTitle,Table,Td} from './YlaVintUI'
import {when} from './YlaVintTab'

const STATES=[['all','Toutes'],['visible','En ligne'],['hidden','Masquées'],['repairing','En réparation'],['sold','Vendues'],['draft','Brouillons']]
const BADGE={visible:['En ligne','green'],hidden:['Masquée du catalogue','red'],repairing:['Réparée, en vérification','amber'],sold:['Vendue','blue'],closed:['Fermée','zinc'],draft:['Brouillon','zinc']}
const euros=v=>v==null?'—':`${Number(v).toFixed(2).replace('.',',')} €`

// Articles Vinted de chaque compte, relus par YlaVint : état, démasquage et prix à la main.
export default function YlaVintWardrobe({request,accounts=[]}){
 const usable=accounts.filter(a=>a.settings?.enabled)
 const [account,setAccount]=useState(()=>usable[0]?.id||accounts[0]?.id||''),[state,setState]=useState('all'),[q,setQ]=useState(''),[data,setData]=useState(null),[busy,setBusy]=useState(false),[error,setError]=useState(''),[notice,setNotice]=useState('')
 const load=()=>account&&request('GET',undefined,`&view=wardrobe&account_id=${account}`).then(r=>{setData(r);setError('')}).catch(e=>setError(e.message))
 useEffect(()=>{setData(null);load()},[account])
 async function act(body){setBusy(true);setError('');setNotice('');try{const r=await request('POST',{account_id:account,...body});setNotice(r.message||(r.queued?'Demandé à YlaVint.':'Déjà prévu.'));await load()}catch(e){setError(e.message)}finally{setBusy(false)}}
 const reprice=l=>{const v=window.prompt(`Nouveau prix pour « ${l.title||l.item_id} » (actuel ${euros(l.price)}) :`,l.price!=null?String(Math.max(1,Number(l.price)-1)):'');if(v)act({action:'item_reprice',item_id:l.item_id,new_price:Number(v.replace(',','.'))})}
 const rows=(data?.listings||[]).filter(l=>(state==='all'||l.state===state)&&(!q||`${l.title} ${l.item_id}`.toLowerCase().includes(q.toLowerCase())))
 const f=data?.settings?.features||{}
 return <div className="space-y-4">
  <PageTitle title="Articles Vinted" hint="Le dressing de chaque compte, relu par YlaVint toutes les 2 h quand « Dressing », « Démasquage » ou « Prix » est actif. Il alimente aussi le suivi « Tes publications, jour après jour »."/>
  <div className="flex flex-wrap items-center gap-2">
   <input className={compactClass+' w-60'} placeholder="Rechercher titre ou ID" value={q} onChange={e=>setQ(e.target.value)}/>
   <select className={compactClass} value={account} onChange={e=>setAccount(e.target.value)}>{accounts.map(a=><option key={a.id} value={a.id}>{a.login}{a.settings?.enabled?'':' (non activé)'}</option>)}</select>
   <button className={buttonClass} disabled={busy||!data?.settings?.enabled} onClick={()=>act({action:'enqueue',kind:'scan_wardrobe'})}>↻ Relire le dressing</button>
   <span className="ml-auto text-xs text-zinc-500">Dernière lecture : {when(data?.last_scan)} · démasquage {f.unmask?'auto':'manuel'} · prix {f.pricing?'auto':'manuels'}</span>
  </div>
  {data&&<div className="flex flex-wrap gap-1">{STATES.map(([k,l])=><button key={k} onClick={()=>setState(k)} className={`rounded-md px-2.5 py-1 text-xs font-medium ${state===k?'bg-zinc-100 text-zinc-900':'text-zinc-400 hover:bg-zinc-800'}`}>{l} <span className="opacity-60">{k==='all'?data.listings.length:data.counts[k]||0}</span></button>)}</div>}
  {error&&<p role="alert" className="text-sm text-rose-400">{error}</p>}
  {notice&&<p role="status" className="text-sm text-blue-300">{notice}</p>}
  {!data?<p className="text-sm text-zinc-500">{account?'Chargement…':'Aucun compte.'}</p>:
  <Table head={['','ID Vinted','Titre','Prix','État','En ligne depuis','Réparations','']} empty={!rows.length&&(data.listings.length?'Aucune annonce dans ce filtre.':'Dressing pas encore lu : active « Dressing » sur ce compte, ou clique sur Relire le dressing.')}>
   {rows.map(l=>{const [label,tone]=BADGE[l.state]||[l.state,'zinc'];return <tr key={l.item_id} className="hover:bg-zinc-800/30">
    <Td className="w-12">{l.photo_url?<img src={l.photo_url} alt="" loading="lazy" className="h-10 w-8 rounded object-cover"/>:<span className="block h-10 w-8 rounded bg-zinc-800"/>}</Td>
    <Td><a className="text-blue-400 hover:underline" href={`https://www.vinted.fr/items/${l.item_id}`} target="_blank" rel="noreferrer">{l.item_id} ↗</a></Td>
    <Td className="max-w-xs truncate font-medium text-white" title={l.title}>{l.title||'—'}</Td>
    <Td className="whitespace-nowrap font-semibold">{euros(l.price)}{Number(l.total_drop)>0&&<span className="ml-1 text-xs font-normal text-zinc-500">−{euros(l.total_drop)}</span>}</Td>
    <Td><Pill tone={tone}>{label}</Pill></Td>
    <Td className="whitespace-nowrap text-xs text-zinc-400">{when(l.listed_at)}</Td>
    <Td className="text-xs text-zinc-400">{l.repairs||0}</Td>
    <Td className="whitespace-nowrap text-right">{['visible','hidden','repairing'].includes(l.state)&&<>
     {l.state==='hidden'&&<button className="mr-2 rounded-md bg-rose-600 px-2.5 py-1 text-xs font-semibold text-white hover:bg-rose-500 disabled:opacity-50" disabled={busy||l.busy} onClick={()=>act({action:'item_unmask',item_id:l.item_id})}>Démasquer</button>}
     <button className="rounded-md border border-zinc-700 px-2.5 py-1 text-xs hover:bg-zinc-800 disabled:opacity-50" disabled={busy||l.busy} onClick={()=>reprice(l)}>{l.busy?'Prévu…':'Prix'}</button></>}</Td>
   </tr>})}
  </Table>}
 </div>
}
