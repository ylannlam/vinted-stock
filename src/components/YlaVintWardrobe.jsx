import {useEffect,useState} from 'react'
import {buttonClass,fieldClass} from './WorkspaceUI'
import {Section,when} from './YlaVintTab'

const STATES=[['all','Toutes'],['visible','En ligne'],['hidden','Masquées'],['repairing','En réparation'],['sold','Vendues'],['draft','Brouillons']]
const BADGE={visible:['En ligne','bg-emerald-50 text-emerald-700'],hidden:['Masquée du catalogue','bg-rose-50 text-rose-700'],repairing:['Réparée, en vérification','bg-amber-50 text-amber-800'],sold:['Vendue','bg-slate-100 text-slate-600'],closed:['Fermée','bg-slate-100 text-slate-600'],draft:['Brouillon','bg-slate-100 text-slate-600']}
const euros=v=>v==null?'—':`${String(Number(v).toFixed(2)).replace('.',',').replace(',00','')} €`

// Dressing de chaque compte, relu par YlaVint : état des annonces, démasquage et prix à la main.
export default function YlaVintWardrobe({request,accounts=[]}){
 const usable=accounts.filter(a=>a.settings?.enabled)
 const [account,setAccount]=useState(()=>usable[0]?.id||accounts[0]?.id||''),[state,setState]=useState('all'),[data,setData]=useState(null),[busy,setBusy]=useState(false),[error,setError]=useState(''),[notice,setNotice]=useState('')
 const load=()=>account&&request('GET',undefined,`&view=wardrobe&account_id=${account}`).then(r=>{setData(r);setError('')}).catch(e=>setError(e.message))
 useEffect(()=>{setData(null);load()},[account])
 async function act(body){setBusy(true);setError('');setNotice('');try{const r=await request('POST',{account_id:account,...body});setNotice(r.message||(r.queued?'Demandé à YlaVint.':'Déjà prévu.'));await load()}catch(e){setError(e.message)}finally{setBusy(false)}}
 const reprice=l=>{const v=window.prompt(`Nouveau prix pour « ${l.title||l.item_id} » (actuel ${euros(l.price)}) :`,l.price!=null?String(Math.max(1,Number(l.price)-1)):'');if(v)act({action:'item_reprice',item_id:l.item_id,new_price:Number(v.replace(',','.'))})}
 const rows=(data?.listings||[]).filter(l=>state==='all'||l.state===state)
 const features=data?.settings?.features||{}
 return <Section title="Dressing" hint="Relu par YlaVint toutes les 2 h quand « Dressing », « Démasquage » ou « Prix & cycle de vie » est actif sur le compte. Il alimente aussi le suivi « Tes publications, jour après jour »."
  aside={<div className="flex flex-wrap gap-2"><select className={fieldClass.replace('w-full ','')+' py-1.5'} value={account} onChange={e=>setAccount(e.target.value)}>{accounts.map(a=><option key={a.id} value={a.id}>{a.login}{a.settings?.enabled?'':' (non activé)'}</option>)}</select>
   <button className={buttonClass+' py-1.5'} disabled={busy||!data?.settings?.enabled} onClick={()=>act({action:'enqueue',kind:'scan_wardrobe'})}>Relire le dressing</button></div>}>
  {error&&<p role="alert" className="text-sm text-red-700">{error}</p>}
  {notice&&<p role="status" className="text-sm text-teal-800">{notice}</p>}
  {data&&<>
   <div className="flex flex-wrap items-center gap-1">{STATES.map(([k,l])=><button key={k} onClick={()=>setState(k)} className={`rounded-lg px-2.5 py-1 text-xs font-medium ${state===k?'bg-slate-800 text-white':'text-slate-600 hover:bg-slate-100'}`}>{l} <span className="opacity-70">{k==='all'?data.listings.length:data.counts[k]||0}</span></button>)}
    <span className="ml-auto text-xs text-slate-500">Dernière lecture : {when(data.last_scan)} · démasquage {features.unmask?'auto':'manuel'} · prix {features.pricing?'auto':'manuels'}</span></div>
   {!rows.length?<p className="text-sm text-slate-500">{data.listings.length?'Aucune annonce dans ce filtre.':'Dressing pas encore lu : active « Dressing » sur ce compte, ou clique sur Relire le dressing.'}</p>
   :<ul className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5 2xl:grid-cols-6">{rows.map(l=>{const [label,cls]=BADGE[l.state]||[l.state,'bg-slate-100']
    return <li key={l.item_id} className="overflow-hidden rounded-xl border border-slate-200 bg-white">
     <a href={`https://www.vinted.fr/items/${l.item_id}`} target="_blank" rel="noreferrer" className="block aspect-[3/4] bg-slate-100">{l.photo_url&&<img src={l.photo_url} alt="" loading="lazy" className="h-full w-full object-cover"/>}</a>
     <div className="space-y-1 p-2.5">
      <p className="truncate text-sm font-medium" title={l.title}>{l.title||l.item_id}</p>
      <p className="flex items-center justify-between gap-1 text-sm"><span className="font-semibold">{euros(l.price)}</span>{Number(l.total_drop)>0&&<span className="text-xs text-slate-500">−{euros(l.total_drop)}</span>}</p>
      <span className={`inline-block rounded-full px-2 py-0.5 text-[11px] ${cls}`}>{label}</span>
      <p className="text-[11px] text-slate-400">{l.listed_at?`Depuis ${when(l.listed_at)}`:''}{l.repairs?` · ${l.repairs} réparation(s)`:''}</p>
      {['visible','hidden','repairing'].includes(l.state)&&<div className="flex gap-1 pt-1">
       {l.state==='hidden'&&<button className="flex-1 rounded-lg bg-rose-600 px-2 py-1 text-xs font-medium text-white disabled:opacity-50" disabled={busy||l.busy} onClick={()=>act({action:'item_unmask',item_id:l.item_id})}>Démasquer</button>}
       <button className="flex-1 rounded-lg border border-slate-200 px-2 py-1 text-xs disabled:opacity-50" disabled={busy||l.busy} onClick={()=>reprice(l)}>{l.busy?'Prévu…':'Prix'}</button>
      </div>}
     </div>
    </li>})}</ul>}
  </>}
 </Section>
}
