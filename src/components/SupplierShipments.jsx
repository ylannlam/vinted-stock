import {useEffect,useRef,useState} from 'react'
import ResourceDialog from './ResourceDialog'
import SheinParcels from './SheinParcels'
import {ErrorNotice,Pagination,fieldClass,buttonClass,primaryClass} from './WorkspaceUI'
import {SHIPMENT_STATES,shipmentState,shipmentLink,shipmentInput} from '../lib/shipments'

export function ShipmentSummary({parcel}){
  const link=shipmentLink(parcel)
  return <div className="space-y-2"><div className="flex flex-wrap items-center justify-between gap-2"><strong>{parcel.carrier==='gofo'?'GOFO':'Transporteur'} · {parcel.tracking_number}</strong><span className="rounded-full bg-teal-50 text-teal-800 px-3 py-1 text-xs">{shipmentState(parcel)}</span></div>
    {parcel.order_ref&&<p className="text-sm">Commande Shein : {parcel.order_ref}</p>}
    {parcel.eta&&<p className="text-sm">Livraison prévue : {parcel.eta} <span className="text-slate-500">· renseignée depuis Shein</span></p>}
    <p className="text-xs text-slate-500">{parcel.manual_status?'Statut renseigné manuellement':parcel.observed_at?`Relevé GOFO du ${new Date(parcel.observed_at).toLocaleString('fr-FR')}`:'Aucun statut confirmé par le transporteur'}</p>
    {parcel.last_error&&<p className="text-xs text-amber-800">{parcel.last_error}</p>}
    {parcel.checked_at&&<p className="text-xs text-slate-500">Dernière vérification : {new Date(parcel.checked_at).toLocaleString('fr-FR')}</p>}
    {link&&<a className="inline-block text-sm text-teal-700 underline" href={link} target="_blank" rel="noreferrer">Ouvrir le suivi GOFO ↗</a>}
    {!!parcel.events?.length&&<details><summary className="text-sm cursor-pointer text-slate-600">Parcours du colis · {parcel.events.length} événement(s)</summary><ol className="mt-3 border-l pl-4 space-y-3">{parcel.events.map((e,i)=><li key={i}><p className="text-xs text-slate-500">{e.date||'Date non fournie'}</p><p className="text-sm">{e.text}</p></li>)}</ol></details>}
  </div>
}

export function ShipmentForm({parcel,lines=[],request,onClose,onSaved}){
  const [value,setValue]=useState(parcel?{...parcel,lines:[]}:{carrier:'gofo',tracking_number:'',order_ref:lines[0]?.supplier_order_ref||'',eta:'',manual_status:'',lines:lines.map(l=>({id:l.id,updated_at:l.updated_at}))})
  const [busy,setBusy]=useState(false),[error,setError]=useState('')
  const change=(key,val)=>setValue(v=>({...v,[key]:val}))
  async function save(e){e.preventDefault();if(busy)return;setBusy(true);setError('');try{shipmentInput(value);await request('PATCH',{...value,action:'shipment'});await onSaved()}catch(e){setError(e.message)}finally{setBusy(false)}}
  return <ResourceDialog title={parcel?'Modifier le colis Shein':'Relier un colis Shein'} busy={busy} onClose={onClose}><form className="space-y-4" onSubmit={save}>
    {!parcel&&<><p className="text-sm">Ce même colis contiendra {lines.length} article(s) sélectionné(s). Une commande Shein peut avoir plusieurs colis.</p><ul className="max-h-36 overflow-y-auto text-sm list-disc pl-5">{lines.map(l=><li key={l.id}>{l.source?.title||l.title} · {l.supplier_size||'taille à vérifier'}</li>)}</ul></>}
    <div className="grid sm:grid-cols-2 gap-3"><label className="text-sm">Transporteur<select className={fieldClass+' mt-1'} disabled={busy||!!parcel} value={value.carrier} onChange={e=>change('carrier',e.target.value)}><option value="gofo">GOFO</option><option value="other">Autre transporteur · suivi manuel</option></select></label><label className="text-sm">Numéro de suivi<input required autoComplete="off" className={fieldClass+' mt-1'} maxLength={60} disabled={busy||!!parcel} value={value.tracking_number} onChange={e=>change('tracking_number',e.target.value)} placeholder="Ex. GFR…"/></label>
    <label className="text-sm">Commande Shein (facultatif)<input className={fieldClass+' mt-1'} maxLength={200} disabled={busy} value={value.order_ref||''} onChange={e=>change('order_ref',e.target.value)}/></label><label className="text-sm">Livraison prévue sur Shein (facultatif)<input className={fieldClass+' mt-1'} maxLength={100} disabled={busy} value={value.eta||''} onChange={e=>change('eta',e.target.value)} placeholder="Ex. 6 au 12 novembre"/></label></div>
    <label className="block text-sm">Statut du colis<select className={fieldClass+' mt-1'} disabled={busy} value={value.manual_status||''} onChange={e=>change('manual_status',e.target.value)}><option value="">{value.carrier==='gofo'?'Suivre automatiquement GOFO':'Non renseigné'}</option>{Object.entries(SHIPMENT_STATES).map(([k,v])=><option key={k} value={k}>{v} · manuel</option>)}</select></label>
    <p className="text-xs text-slate-500">GOFO est vérifié toutes les 15 minutes tant que l’écran des colis est ouvert. Si le transporteur ne transmet rien, tu peux renseigner le statut affiché dans Shein. L’expédition Vinted reste indépendante.</p>
    {parcel&&<p className="text-xs text-slate-500">Pour corriger le numéro, détache les articles puis associe le bon colis depuis les ventes.</p>}
    <ErrorNotice error={error}/><button disabled={busy} className={primaryClass}>{busy?'Enregistrement…':parcel?'Enregistrer le colis':'Associer le colis aux ventes'}</button>
  </form></ResourceDialog>
}

export default function SupplierShipments({request,onOpenSale,onChanged}){
  const [data,setData]=useState({shipments:[],count:0}),[page,setPage]=useState(0),[busy,setBusy]=useState(false),[error,setError]=useState(''),[editing,setEditing]=useState(null),[notice,setNotice]=useState('')
  const working=useRef(false),seq=useRef(0),current=useRef(data);current.current=data
  async function load(){const ticket=++seq.current;const r=await request('GET',undefined,`?view=shipments&page=${page}`);if(ticket===seq.current)setData(r);return r}
  async function run(fn){if(working.current)return;working.current=true;setBusy(true);setError('');try{await fn()}catch(e){setError(e.message)}finally{working.current=false;setBusy(false)}}
  async function refreshDue(rows){for(const s of rows.filter(s=>s.carrier==='gofo'&&(!s.refresh_after||s.refresh_after==='-infinity'||Date.parse(s.refresh_after)<=Date.now())).slice(0,4))await request('POST',{action:'shipment_refresh',id:s.id})}
  useEffect(()=>{let active=true;run(async()=>{const r=await load();if(active){await refreshDue(r.shipments);await load()}});return()=>{active=false;seq.current++}},[page])
  useEffect(()=>{if(editing)return;const timer=setInterval(()=>{if(document.visibilityState==='visible')run(async()=>{await refreshDue(current.current.shipments);await load()})},60000);return()=>clearInterval(timer)},[editing,page])
  return <section className="space-y-4"><div className="flex flex-wrap justify-between gap-3"><div><h2 className="text-lg font-semibold">Colis Shein · livraison chez toi</h2><p className="text-sm text-slate-500">Sélectionne les ventes d’un même colis puis « Associer un colis ».</p></div><button className={buttonClass} disabled={busy} onClick={()=>run(async()=>{await refreshDue(data.shipments);await load();setNotice('Liste actualisée. GOFO est interrogé au maximum une fois toutes les 15 minutes par colis.')})}>{busy?'Vérification…':'Actualiser les colis'}</button></div>
    <ErrorNotice error={error}/>{notice&&<p role="status" className="text-sm text-teal-700">{notice}</p>}
    <SheinParcels orders={data.shein_orders||[]}/>
    {!data.count&&!data.shein_orders?.length&&!busy&&<div className="rounded-xl border bg-white p-8 text-center text-slate-500">Aucun colis associé. Retourne aux ventes et sélectionne les articles de ta commande Shein.</div>}
    <div className="grid lg:grid-cols-2 gap-4">{data.shipments.map(s=><article key={s.id} className="rounded-xl border bg-white p-4 space-y-4"><ShipmentSummary parcel={s}/><div className="border-t pt-3 space-y-3"><h3 className="text-sm font-semibold">Articles du colis ({s.lines.length})</h3>{s.lines.map(l=><div key={l.id} className="flex items-start gap-3">{l.photo&&<img src={l.photo} alt="" className="w-10 h-14 rounded object-cover"/>}<div className="min-w-0 flex-1"><button className="text-left text-sm text-teal-800 underline" onClick={()=>onOpenSale(l.id)}>{l.title}</button><p className="text-xs text-slate-500">{l.account} · {l.size||'Taille à vérifier'}</p></div><button className="text-xs text-slate-500 underline" disabled={busy} onClick={()=>{if(window.confirm('Détacher cet article du colis ? La vente reste conservée.'))run(async()=>{await request('PATCH',{action:'shipment_unlink',id:s.id,line:l.id,updated_at:l.updated_at});await load();onChanged?.()})}}>Détacher</button></div>)}</div><button className={buttonClass} disabled={busy} onClick={()=>setEditing(s)}>Modifier le colis</button></article>)}</div>
    <Pagination page={page} count={data.count} size={30} onChange={setPage} busy={busy}/>
    {editing&&<ShipmentForm parcel={editing} request={request} onClose={()=>setEditing(null)} onSaved={async()=>{setEditing(null);await load();onChanged?.()}}/>}
  </section>
}
