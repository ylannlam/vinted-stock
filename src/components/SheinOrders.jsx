import {useEffect,useRef,useState} from 'react'
import {collectorBridge as defaultBridge} from '../lib/collectorBridge'
import {extensionNeedsUpdate} from '../lib/collector'
import {money} from '../lib/fulfillment'
import {buttonClass,primaryClass,fieldClass,ErrorNotice} from './WorkspaceUI'
import ResourceDialog from './ResourceDialog'
import SheinSyncPanel from './SheinSyncPanel'
import SheinParcels from './SheinParcels'
import {associationReasons} from '../lib/sheinAssistant'

const labels={processing:'En préparation',shipped:'Expédié par Shein',delivered:'Livré · réception à confirmer',exception:'Annulé ou retourné · à vérifier',unpaid:'Paiement en attente',unknown:'État à vérifier'}
const active=state=>state?.enabled&&!['done','partial','idle','blocked'].includes(state.phase)
export default function SheinOrders({request,bridge=defaultBridge,isAdmin,onOpenSale,onChanged}) {
  const [data,setData]=useState({orders:[],lines:[],count:0}),[page,setPage]=useState(0),[state,setState]=useState(null)
  const [error,setError]=useState(''),[busy,setBusy]=useState(false),[extensionError,setExtensionError]=useState(''),[selected,setSelected]=useState(null),[choice,setChoice]=useState(''),[confirmed,setConfirmed]=useState(false)
  const running=useRef(false),lastCompleted=useRef(null),generation=useRef(0)
  async function load() {
    const id=++generation.current
    const next=await request('GET',undefined,'?'+new URLSearchParams({view:'shein_orders',page}))
    if(id===generation.current)setData(next)
  }
  useEffect(()=>{let live=true;setBusy(true);load().catch(e=>live&&setError(e.message)).finally(()=>live&&setBusy(false));return()=>{live=false;generation.current++}},[page,request])
  useEffect(()=>{
    let live=true,pending=false
    async function status() {
      if(pending||document.visibilityState!=='visible')return
      pending=true
      try {
        const next=await bridge('status')
        if(!live)return
        setState(next);setExtensionError('')
        if(next.orders?.lastCompletedAt&&lastCompleted.current!==next.orders.lastCompletedAt){lastCompleted.current=next.orders.lastCompletedAt;await load();onChanged?.()}
      }catch(e){if(live){setState(null);setExtensionError(e.message)}}finally{pending=false}
    }
    status();const timer=setInterval(status,3000)
    return()=>{live=false;clearInterval(timer)}
  },[bridge,page,request])
  async function run(fn) {
    if(running.current)return
    running.current=true;setBusy(true);setError('')
    try{await fn()}catch(e){setError(e.message)}finally{running.current=false;setBusy(false)}
  }
  const command=(action,options={})=>run(async()=>{const next=await bridge(action,options);setState(next);await load()})
  async function review(item,line,operation) {
    await request('PATCH',{action:'shein_review',operation,item_id:item.id,line_id:line.id,updated_at:line.updated_at,confirm_variant:confirmed})
    setSelected(null);setChoice('');setConfirmed(false);await load();onChanged?.()
  }
  const o=state?.orders,percent=o?.phase==='done'?100:o?.total?Math.min(95,Math.round(o.done/o.total*95)):0
  const compatible=!!state?.orders&&!extensionNeedsUpdate(state?.version)
  const choices=selected?data.lines.filter(l=>!l.item_id&&!l.blocked&&['to_order','ordered','in_transit'].includes(l.stage)&&l.sku?.toLowerCase()===selected.sku.toLowerCase()):[]
  return <section className="space-y-5" aria-label="Mes commandes Shein">
    <SheinSyncPanel data={data} state={state} compatible={compatible} error={extensionError} busy={busy} isAdmin={isAdmin} onCommand={command} onRefresh={()=>run(load)}/>
    <ErrorNotice error={error}/>
    {data.orders.map(order=><article key={order.ref} className="rounded-2xl border border-slate-200 bg-white overflow-hidden">
      <header className="px-5 py-4 bg-stone-50 flex flex-wrap gap-2 justify-between"><div><h3 className="font-semibold">Commande {order.ref}</h3><p className="text-xs text-slate-500 mt-1">{new Date(order.order_date+'T12:00:00').toLocaleDateString('fr-FR',{day:'numeric',month:'long',year:'numeric'})} · {order.items.reduce((sum,i)=>sum+i.quantity,0)} article(s)</p></div><a href={`https://fr.shein.com/user/orders/detail/${order.ref}`} target="_blank" rel="noopener noreferrer" className="text-sm text-teal-800 underline underline-offset-4">Voir sur Shein ↗</a></header>
      <div className="px-5 py-3 border-t text-sm"><p>{order.payment?`Total payé : ${money(order.payment.paid_total)} · ajouté au Budget`:'Total payé non relevé : relis cette commande avec l’extension à jour.'}</p>{order.payment?.shipping!=null&&<p className="text-xs text-slate-500 mt-1">Dont livraison : {money(order.payment.shipping)}. Les frais restent séparés des prix des articles.</p>}</div>
      <div className="divide-y">{order.items.map(item=>{
        const warning=!item.present||['exception','unknown','unpaid'].includes(item.status)||item.links.length>item.quantity
        return <div key={item.id} className="p-5 flex gap-4 flex-wrap sm:flex-nowrap">
          {item.photo?<img className="w-20 h-28 rounded-xl object-cover bg-stone-100" src={item.photo} alt="" loading="lazy" referrerPolicy="no-referrer"/>:<div className="w-20 h-28 rounded-xl bg-stone-100 flex items-center justify-center text-slate-300" aria-hidden="true">◇</div>}
          <div className="flex-1 min-w-48"><a href={item.product_url} target="_blank" rel="noopener noreferrer" className="font-medium text-sm hover:underline">{item.title}</a><p className="text-sm text-slate-500 mt-1">{item.color||'Couleur à vérifier'} · {item.size||'Taille à vérifier'} · Quantité {item.quantity}</p><p className="text-xs text-slate-400 mt-1 break-all">{item.sku}</p>
            <div className="flex flex-wrap items-center gap-2 mt-3"><span className={'rounded-full px-3 py-1 text-xs font-medium '+(warning?'bg-amber-50 text-amber-900':'bg-teal-50 text-teal-900')}>{!item.present?'Article absent du dernier relevé':labels[item.status]}</span>{item.eta&&<span className="text-xs text-slate-500">Livraison estimée : {item.eta}</span>}</div>
            {item.status==='unknown'&&item.status_text&&<p className="text-xs text-amber-800 mt-2">Texte relevé sur Shein : {item.status_text}</p>}
            {!item.links.length&&<details className="mt-3 text-xs text-slate-600"><summary className="cursor-pointer">Pourquoi cet achat n’est-il pas associé ?</summary><div className="mt-2 space-y-2">{data.lines.filter(l=>l.sku?.toLowerCase()===item.sku.toLowerCase()).map(l=><p key={l.id}><strong>{l.account} · {l.title}</strong> : {associationReasons(item,l,order).join(' · ')}</p>)}{!data.lines.some(l=>l.sku?.toLowerCase()===item.sku.toLowerCase())&&<p>Aucune vente suivie avec ce SKU exact.</p>}</div></details>}
            {item.links.length>item.quantity&&<p className="text-xs text-amber-800 mt-2">La quantité Shein a diminué. Vérifie les ventes associées.</p>}
            <div className="space-y-2 mt-3">{item.links.map(link=>{const line=data.lines.find(l=>l.id===link.line_id);return <div key={link.line_id} className="rounded-xl bg-stone-50 p-3 text-xs flex flex-wrap items-center gap-2"><button className="text-teal-800 underline mr-auto text-left" onClick={()=>onOpenSale(link.line_id)}>{line?.title||'Vente associée'}{line?.account?' · '+line.account:''}</button><span className="text-slate-400">{link.origin==='auto'?'Associée automatiquement':'Association confirmée'}</span>{line?.currency==='EUR'&&line?.selling_price!=null&&line?.actual_cost!=null&&<span>Coût : {money(line.actual_cost)} · Marge calculée : {money(Number(line.selling_price)-Number(line.actual_cost)-Number(line.fees_amount||0)-Number(line.refund_amount||0))}</span>}{line&&<button disabled={busy} className="text-slate-500 underline" onClick={()=>run(()=>review(item,line,'unlink'))}>Dissocier</button>}{line&&item.status==='delivered'&&line.stage==='in_transit'&&<button disabled={busy} className={buttonClass} onClick={()=>{if(window.confirm('Confirmer que tu as reçu physiquement cet article ?'))run(()=>review(item,line,'confirm_received'))}}>J’ai reçu cet article</button>}</div>})}</div>
          </div>
          <div className="sm:w-40 sm:text-right"><strong>{item.unit_price!=null?money(item.unit_price):'Prix individuel à vérifier'}</strong><p className="text-xs text-slate-400 mt-1">{item.unit_price!=null?'Payé par article · remises SHEIN incluses, hors livraison':item.paid_amounts?.length?'Plusieurs montants relevés : '+item.paid_amounts.map(v=>money(v)).join(' / '):'Montant individuel non lisible, aucune estimation'}</p><p className="text-sm mt-3 text-slate-500">{item.links.length} / {item.quantity} associé(s)</p>{!warning&&item.links.length<item.quantity&&<button disabled={busy} className={buttonClass+' mt-2'} onClick={()=>{setSelected(item);setChoice('');setConfirmed(false);setError('')}}>Associer une vente</button>}</div>
        </div>
      })}</div>
      <div className="p-5 border-t"><SheinParcels orders={[order]}/>{!order.shipment_observations?.length&&<p className="text-xs text-slate-500">Aucun numéro de suivi lisible sur le dernier relevé. Les colis saisis dans « Mes colis Shein » restent disponibles.</p>}</div>
    </article>)}
    {!data.orders.length&&<div className="workspace-empty"><span className="workspace-empty-symbol" aria-hidden="true">◇</span><h3>{busy?'Chargement des commandes…':'Tes achats Shein apparaîtront ici'}</h3><p>Active la synchronisation pour retrouver les commandes depuis le début de ton suivi.</p></div>}
    {(data.count>20||page>0)&&<div className="flex items-center justify-between"><button disabled={busy||page===0} className={buttonClass} onClick={()=>setPage(p=>p-1)}>Précédent</button><span className="text-sm">Page {page+1}</span><button disabled={busy||(page+1)*20>=data.count} className={buttonClass} onClick={()=>setPage(p=>p+1)}>Suivant</button></div>}
    {selected&&<ResourceDialog title="Associer cet achat à une vente" busy={busy} onClose={()=>setSelected(null)}><form className="space-y-4" onSubmit={e=>{e.preventDefault();const line=choices.find(l=>l.id===choice);if(line&&confirmed)run(()=>review(selected,line,'link'))}}>
      <p className="text-sm">{selected.title}<br/><strong>{selected.color} · {selected.size}</strong></p>
      <select required className={fieldClass} value={choice} onChange={e=>setChoice(e.target.value)} aria-label="Vente à associer"><option value="">Choisir une vente avec ce SKU</option>{choices.map(l=><option key={l.id} value={l.id}>{l.account} · {l.title} · {l.size||'taille à préciser'} · {l.color||'couleur à préciser'}</option>)}</select>
      {!choices.length&&<p className="text-sm text-slate-500">Aucune vente disponible avec ce SKU exact. Ajoute ou corrige le SKU dans la fiche de vente.</p>}
      <label className="flex items-start gap-2 text-sm"><input type="checkbox" required checked={confirmed} onChange={e=>setConfirmed(e.target.checked)}/>Je confirme que la taille et la couleur commandées correspondent à cette vente.</label>
      <ErrorNotice error={error}/><button disabled={busy||!choice||!confirmed} className={primaryClass}>Confirmer l’association</button>
    </form></ResourceDialog>}
  </section>
}
