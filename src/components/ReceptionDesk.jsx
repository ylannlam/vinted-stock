import {useEffect,useMemo,useRef,useState} from 'react'
import ShippingLabelDialog from './ShippingLabelDialog'
import BatchLabelsDialog from './BatchLabelsDialog'
import {ErrorNotice,buttonClass,primaryClass,fieldClass} from './WorkspaceUI'
import {safeUrl} from '../lib/fulfillment'
import {candidatesFor,codeKey,daySummary,deadlineOf,expectedItems,lotState,matchCode,nextSlot,orderLines,skuOfLine,variantOf,variantsFor,WAITING} from '../lib/reception'

const ALIASES='vs-reception-codes'
const readAliases=()=>{try{return JSON.parse(localStorage.getItem(ALIASES)||'{}')||{}}catch{return {}}}
const when=v=>{const t=Date.parse(v);return Number.isFinite(t)?new Date(t).toLocaleDateString('fr-FR',{weekday:'short',day:'numeric',month:'short',timeZone:'Europe/Paris'}):'date inconnue'}
const urgency=v=>{const h=(Date.parse(v)-Date.now())/3600000;return !Number.isFinite(h)?'text-slate-500':h<0?'text-rose-700 font-semibold':h<24?'text-rose-700':h<48?'text-amber-700':'text-slate-600'}

function Photo({src,label,className='h-40'}){
 const url=safeUrl(src)
 return <figure className={`relative ${className} rounded-xl overflow-hidden bg-stone-100`}>{url?<img src={url} alt="" loading="lazy" className="h-full w-full object-cover"/>:<span className="grid h-full place-items-center text-xs text-slate-400">Pas de photo</span>}{label&&<figcaption className="absolute left-1.5 top-1.5 rounded-full bg-white/90 px-2 py-0.5 text-[10px] font-semibold">{label}</figcaption>}</figure>
}

// Lecture du code-barres par la caméra (Chrome Android / ordinateur). Sur iPhone, la saisie reste possible.
function CameraScanner({onCode,onClose}){
 const video=useRef(null),[error,setError]=useState('')
 useEffect(()=>{
  let stream,timer,stopped=false
  if(!('BarcodeDetector' in window)){setError('Ce navigateur ne lit pas les codes-barres. Tape les derniers chiffres du SKU ou passe en mode visuel.');return}
  const detector=new window.BarcodeDetector()
  navigator.mediaDevices.getUserMedia({video:{facingMode:'environment'}}).then(s=>{
   if(stopped){s.getTracks().forEach(t=>t.stop());return}
   stream=s;video.current.srcObject=s;video.current.play()
   const tick=async()=>{
    if(stopped)return
    try{const codes=await detector.detect(video.current);if(codes[0]?.rawValue){onCode(codes[0].rawValue);return}}catch{/* image suivante */}
    timer=setTimeout(tick,250)
   }
   tick()
  }).catch(()=>setError('Caméra indisponible : autorise-la dans le navigateur, ou tape le SKU.'))
  return()=>{stopped=true;clearTimeout(timer);stream?.getTracks().forEach(t=>t.stop())}
 },[])
 return <div className="rounded-2xl border bg-black/90 p-3 space-y-2">
  {error?<p className="text-sm text-amber-200 p-3">{error}</p>:<video ref={video} muted playsInline className="w-full max-h-72 rounded-xl object-cover"/>}
  <div className="flex justify-between items-center"><span className="text-xs text-white/70">Vise le code-barres de l’étiquette du sachet</span><button className={buttonClass} onClick={onClose}>Fermer la caméra</button></div>
 </div>
}

export default function ReceptionDesk({request,onOpenSale}){
 const [data,setData]=useState({lines:[],catalog:[]}),[loading,setLoading]=useState(true),[busy,setBusy]=useState(false)
 const [error,setError]=useState(''),[toast,setToast]=useState('')
 const [mode,setMode]=useState(()=>{try{return localStorage.getItem('vs-reception-mode')||'scan'}catch{return 'scan'}})
 const [code,setCode]=useState(''),[camera,setCamera]=useState(false),[search,setSearch]=useState(''),[arrivingOnly,setArrivingOnly]=useState(false)
 const [pick,setPick]=useState(null) // {sku,variant,lineId}
 const [step,setStep]=useState(null) // {line, slot, gather:[...]} après réception
 const [labelLine,setLabelLine]=useState(null),[aliases,setAliases]=useState(readAliases),[checked,setChecked]=useState([]),[batchLines,setBatchLines]=useState(null)
 const input=useRef(null)
 async function load(){const r=await request('GET',undefined,'?view=reception');setData(r);setLoading(false)}
 async function run(fn){if(busy)return;setBusy(true);setError('');try{await fn()}catch(e){setError(e.message)}finally{setBusy(false)}}
 useEffect(()=>{run(load)},[])
 useEffect(()=>{if(pick||step||labelLine||batchLines)return;const t=setInterval(()=>{if(document.visibilityState==='visible')load().catch(()=>{})},20000);return()=>clearInterval(t)},[pick,step,labelLine,batchLines])
 useEffect(()=>{try{localStorage.setItem('vs-reception-mode',mode)}catch{}},[mode])
 useEffect(()=>{if(!toast)return;const t=setTimeout(()=>setToast(''),3500);return()=>clearTimeout(t)},[toast])

 const lines=data.lines,photoOf=sku=>data.catalog.find(c=>c.sku===sku)?.photo_url
 const summary=daySummary(lines)
 const waitingSkus=[...new Set(lines.filter(l=>WAITING.includes(l.effective_stage)).map(skuOfLine).filter(Boolean))]
 const matches=code.trim()?matchCode(code,waitingSkus,aliases):[]
 const grid=useMemo(()=>expectedItems(lines),[lines])
 const shownGrid=grid.filter(g=>(!arrivingOnly||g.lines.some(l=>l.parcel&&(l.parcel.delivered||/livraison/i.test(l.parcel.status_text||''))))&&codeKey(`${g.title} ${g.sku} ${g.variant.label}`).includes(codeKey(search)))
 // Un seul SKU trouvé : on ouvre directement sa fiche (la taille se choisit si plusieurs sont attendues).
 useEffect(()=>{if(mode==='scan'&&matches.length===1&&!pick)choose(matches[0])},[matches.join('|')])

 function choose(sku,variantKey=null){
  const variants=variantsFor(lines,sku)
  setPick({sku,variant:variantKey||(variants.length===1?variants[0].key:null),lineId:null,code:code.trim()})
 }
 function reset(){setPick(null);setStep(null);setCode('');setCamera(false);setTimeout(()=>input.current?.focus(),50)}
 function remember(sku){const c=codeKey(pick?.code||code);if(c.length<8)return;const next={...aliases,[c]:sku};setAliases(next);try{localStorage.setItem(ALIASES,JSON.stringify(next))}catch{}}

 async function receive(candidate){
  const {line,lot}=candidate,completes=!lot.lot||lot.missing===1
  const slot=completes?null:(orderLines(lines,line).find(l=>/^A\d+$/i.test(l.location||''))?.location||nextSlot(lines)).toUpperCase()
  await request('PATCH',{action:'receive',id:line.id,updated_at:line.updated_at,location:slot})
  if(pick?.code&&codeKey(pick.code)!==codeKey(skuOfLine(line)))remember(skuOfLine(line))
  const gather=completes&&lot.lot?orderLines(lines,line).filter(l=>l.id!==line.id).map(l=>({title:l.source?.title,location:l.location})):[]
  await load()
  setStep({line,slot,gather,completes,candidate})
 }
 async function pack(line){
  const r=await request('PATCH',{action:'pack',order_id:line.order_id})
  await load();reset();setToast(r.dotb_packed?'Colis emballé · signalé à Dotb. Pose-le dans « À déposer ».':'Colis emballé. Pose-le dans « À déposer ».')
 }

 const candidates=pick?.variant?candidatesFor(lines,pick.sku,pick.variant):[]
 // Après la réception, la fiche garde la vente servie (elle n'est plus « attendue »).
 const chosen=step?.candidate||candidates.find(c=>c.line.id===pick?.lineId)||candidates[0]
 const toPack=lines.filter(l=>l.effective_stage==='received'&&lotState(lines,l).missing===0)
 const packOrders=[...new Map(toPack.map(l=>[l.order_id,l])).values()]
 const waitingLots=[...new Map(lines.filter(l=>l.effective_stage==='received'&&lotState(lines,l).missing>0).map(l=>[l.order_id,l])).values()]
 const toDeposit=lines.filter(l=>l.effective_stage==='prepared')
 const byAccount=Object.entries(toDeposit.reduce((a,l)=>{(a[l.account_login||'Compte']??=[]).push(l);return a},{}))

 const fiche=()=>{
  if(!pick)return null
  const variants=variantsFor(lines,pick.sku)
  if(!pick.variant)return <section className="rounded-2xl border-2 border-teal-600 bg-white p-4 space-y-3">
   <p className="font-semibold">Quelle taille as-tu dans les mains ?</p>
   <div className="flex flex-wrap gap-2">{variants.map(v=><button key={v.key} className={`${buttonClass} !text-base !px-5 !py-3`} onClick={()=>setPick(p=>({...p,variant:v.key}))}>{v.label} <span className="ml-2 text-xs text-slate-500">{v.count} vente{v.count>1?'s':''}</span></button>)}</div>
   <button className="text-sm text-slate-500 underline" onClick={reset}>Annuler</button>
  </section>
  if(!chosen)return <section className="rounded-2xl border bg-white p-4"><p>Plus aucune vente n’attend cet article. Il part en stock.</p><button className={`${buttonClass} mt-3`} onClick={reset}>Article suivant</button></section>
  const {line,lot}=chosen,v=variantOf(line),completes=!lot.lot||lot.missing===1
  return <section className="rounded-2xl border-2 border-teal-600 bg-white p-4 sm:p-5 space-y-4 shadow-sm" aria-label="Vente à servir">
   <div className="flex flex-wrap items-start gap-4">
    <div className="grid grid-cols-2 gap-2 w-full sm:w-80 shrink-0"><Photo src={photoOf(skuOfLine(line))} label="Shein"/><Photo src={line.listing_photo_url||line.source?.thumbnail_url} label="Annonce"/></div>
    <div className="min-w-0 flex-1 space-y-2">
     <p className="text-xs font-semibold uppercase tracking-widest text-teal-700">{!step&&candidates.length>1?`À servir en premier · ${candidates.length} ventes attendent cet article`:'Vente à servir'}</p>
     <p className="text-3xl font-black">{v.size||'Taille ?'}{v.color&&<span className="text-xl font-semibold text-slate-600"> · {v.color}</span>}</p>
     <p className="text-sm font-medium">{line.source?.title}</p>
     <p className="text-sm text-slate-600">Compte <b>{line.account_login}</b> · vendu le {when(line.sale_date)}</p>
     <p className={`text-sm ${urgency(deadlineOf(line))}`}>À envoyer avant le {when(deadlineOf(line))}</p>
     {lot.lot&&<p className="rounded-lg bg-violet-50 px-3 py-2 text-sm text-violet-900">Lot de {lot.size} articles · {completes?'c’est le dernier qui manquait':`il en manque encore ${lot.missing-1} après celui-ci`}</p>}
    </div>
   </div>
   {!step?<div className="flex flex-wrap gap-2">
    <button className={`${primaryClass} !text-base !px-6 !py-3`} disabled={busy} onClick={()=>run(()=>receive(chosen))}>{completes?'C’est le bon article · reçu':`Reçu · ranger dans le bac d’attente`}</button>
    <button className={buttonClass} disabled={busy} onClick={reset}>Ce n’est pas ça</button>
   </div>:<div className="space-y-3">
    {step.slot?<p className="rounded-xl bg-amber-50 p-4 text-lg font-bold text-amber-900">Range-le en <span className="rounded-lg bg-amber-200 px-2">{step.slot}</span> (bac d’attente). Il sera emballé quand le lot sera complet.</p>
     :<>{step.gather.length>0&&<div className="rounded-xl bg-violet-50 p-3 text-sm text-violet-900"><p className="font-semibold">Lot complet : va chercher les autres articles</p><ul className="mt-1 list-disc pl-5">{step.gather.map((g,i)=><li key={i}>{g.title}{g.location?<b> · place {g.location}</b>:''}</li>)}</ul></div>}
      <div className="flex flex-wrap gap-2"><button className={`${primaryClass} !text-base !px-6 !py-3`} onClick={()=>setLabelLine(step.line)}>1 · Imprimer l’étiquette</button><button className={`${buttonClass} !text-base !px-6 !py-3 !border-teal-600 !text-teal-800`} disabled={busy} onClick={()=>run(()=>pack(step.line))}>2 · Emballé ✓</button></div></>}
    <button className={buttonClass} onClick={reset}>Article suivant →</button>
   </div>}
   {!step&&candidates.length>1&&<details className="text-sm"><summary className="cursor-pointer text-slate-600">Servir une autre vente à la place ({candidates.length-1})</summary><ul className="mt-2 divide-y rounded-xl border">{candidates.slice(1).map(c=><li key={c.line.id}><button className="w-full text-left px-3 py-2 hover:bg-slate-50" onClick={()=>setPick(p=>({...p,lineId:c.line.id}))}><b>{c.line.account_login}</b> · avant le {when(deadlineOf(c.line))}{c.lot.lot&&!c.ready?' · lot incomplet':''}</button></li>)}</ul></details>}
  </section>
 }

 return <section className="space-y-4" aria-label="Réception du jour">
  <div className="grid grid-cols-3 sm:grid-cols-5 gap-2">{[[summary.waiting,'à recevoir',summary.arriving?`dont ${summary.arriving} livré${summary.arriving>1?'s':''} ou en livraison`:''],[summary.received,'reçus',''],[packOrders.length,'colis à emballer',''],[summary.toDeposit,'à déposer',''],[summary.shippedToday,'envoyés aujourd’hui','']].map(([n,l,sub])=><div key={l} className="rounded-2xl border bg-white px-4 py-3"><p className="text-2xl font-bold">{n}</p><p className="text-xs text-slate-500">{l}</p>{sub&&<p className="text-[11px] text-teal-700">{sub}</p>}</div>)}</div>
  {summary.late>0&&<p className="rounded-xl bg-rose-50 px-4 py-2 text-sm text-rose-800">{summary.late} vente{summary.late>1?'s':''} à envoyer sous 24 h dont l’article n’est pas encore reçu.</p>}
  <ErrorNotice error={error} retry={()=>run(load)} busy={busy}/>
  <div className="inline-flex rounded-xl bg-slate-100 p-1" role="group" aria-label="Mode de réception">{[['scan','Scanner / taper le SKU'],['visual','Choisir visuellement']].map(([k,l])=><button key={k} aria-pressed={mode===k} className={`rounded-lg px-4 py-2 text-sm font-medium ${mode===k?'bg-white shadow-sm text-teal-800':'text-slate-600'}`} onClick={()=>{setMode(k);if(!step)setPick(null)}}>{l}</button>)}</div>

  {mode==='scan'&&!pick&&<div className="space-y-3">
   <form className="flex flex-wrap gap-2" onSubmit={e=>{e.preventDefault();if(matches.length===1)choose(matches[0])}}>
    <input ref={input} autoFocus className={`${fieldClass} flex-1 min-w-56 !text-lg !py-3 font-mono`} aria-label="SKU de l’article" placeholder="Scanne le code-barres ou tape les derniers chiffres du SKU…" value={code} onChange={e=>setCode(e.target.value)}/>
    <button type="button" className={buttonClass} onClick={()=>setCamera(c=>!c)}>{camera?'Fermer la caméra':'Caméra'}</button>
   </form>
   {camera&&<CameraScanner onCode={value=>{setCamera(false);setCode(value)}} onClose={()=>setCamera(false)}/>}
   {code.trim().length>=3&&matches.length===0&&<div className="rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900 space-y-2"><p>Aucun article attendu ne correspond à « {code.trim()} ».</p><p>{codeKey(code).length>=8?'Choisis-le visuellement : le site retiendra ce code pour la prochaine fois.':'Tape au moins 4 chiffres, ou choisis-le visuellement.'}</p><button className={buttonClass} onClick={()=>setMode('visual')}>Choisir visuellement</button></div>}
   {matches.length>1&&<div className="space-y-2"><p className="text-sm text-slate-600">Plusieurs articles correspondent : lequel as-tu ?</p><div className="grid grid-cols-2 sm:grid-cols-4 gap-2">{matches.slice(0,8).map(sku=>{const g=grid.find(x=>x.sku===sku);return <button key={sku} className="rounded-xl border bg-white p-2 text-left hover:ring-2 hover:ring-teal-500" onClick={()=>choose(sku)}><Photo src={photoOf(sku)} className="h-32"/><p className="mt-1 text-xs line-clamp-2">{g?.title||sku}</p><p className="text-[11px] font-mono text-slate-500">…{sku.slice(-6)}</p></button>})}</div></div>}
  </div>}

  {mode==='visual'&&!pick&&<div className="space-y-3">
   <div className="flex flex-wrap gap-2 items-center"><input className={`${fieldClass} flex-1 min-w-56`} aria-label="Chercher un article attendu" placeholder="Couleur, type, taille…" value={search} onChange={e=>setSearch(e.target.value)}/><label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={arrivingOnly} onChange={e=>setArrivingOnly(e.target.checked)}/>Livrés ou en livraison seulement</label></div>
   {codeKey(code).length>=8&&<p className="text-xs text-slate-500">Le code « {code.trim()} » sera associé à l’article que tu choisis.</p>}
   <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3">{shownGrid.map(g=><button key={g.key} className="rounded-2xl border bg-white p-2 text-left hover:ring-2 hover:ring-teal-500" onClick={()=>{setPick({sku:g.sku,variant:g.variant.key,lineId:null,code:code.trim()})}}>
    <div className="grid grid-cols-2 gap-1"><Photo src={photoOf(g.sku)} className="h-36"/><Photo src={g.lines[0].listing_photo_url} className="h-36"/></div>
    <p className="mt-2 text-lg font-black leading-tight">{g.variant.size||'?'}<span className="text-sm font-semibold text-slate-600">{g.variant.color?` · ${g.variant.color}`:''}</span></p>
    <p className="text-xs line-clamp-2">{g.title}</p>
    <p className="mt-1 text-[11px] text-slate-500">{g.lines.length>1?`${g.lines.length} ventes · `:''}<span className={urgency(new Date(g.deadline).toISOString())}>avant le {when(new Date(g.deadline).toISOString())}</span></p>
   </button>)}</div>
   {!loading&&!shownGrid.length&&<p className="rounded-xl border border-dashed bg-white p-8 text-center text-sm text-slate-500">Aucun article attendu{arrivingOnly?' parmi les colis livrés ou en livraison':''}.</p>}
  </div>}

  {fiche()}

  <div className="grid gap-4 lg:grid-cols-3">
   <section className="rounded-2xl border bg-white p-4 space-y-2"><div className="flex flex-wrap items-center gap-2"><h3 className="font-semibold mr-auto">Reçus · à emballer <span className="text-slate-400 font-normal">{packOrders.length}</span></h3>
     {packOrders.length>1&&<button className="text-xs text-teal-700 underline" onClick={()=>setChecked(c=>c.length===packOrders.length?[]:packOrders.map(l=>l.order_id))}>{checked.length===packOrders.length?'Tout décocher':'Tout cocher'}</button>}</div>
    {packOrders.length?<ul className="divide-y text-sm">{packOrders.map(l=><li key={l.order_id} className="py-2 flex items-center gap-2"><input type="checkbox" className="h-4 w-4 accent-teal-700 shrink-0" aria-label={`Sélectionner ${l.source?.title||'ce colis'}`} checked={checked.includes(l.order_id)} onChange={e=>setChecked(c=>e.target.checked?[...c,l.order_id]:c.filter(x=>x!==l.order_id))}/><span className="min-w-0 flex-1"><span className="block truncate">{l.source?.title}</span><span className={`text-xs ${urgency(deadlineOf(l))}`}>{l.account_login} · avant le {when(deadlineOf(l))}</span></span><button className={buttonClass+' !px-2 !py-1.5 !text-xs'} onClick={()=>setLabelLine(l)}>Étiquette</button><button className={buttonClass+' !px-2 !py-1.5 !text-xs'} disabled={busy} onClick={()=>run(()=>pack(l))}>Emballé</button></li>)}</ul>:<p className="text-sm text-slate-500">Rien en attente d’emballage.</p>}
    {checked.filter(id=>packOrders.some(l=>l.order_id===id)).length>0&&<button className={`${primaryClass} w-full`} onClick={()=>setBatchLines(packOrders.filter(l=>checked.includes(l.order_id)))}>Imprimer les {checked.filter(id=>packOrders.some(l=>l.order_id===id)).length} bordereaux à la suite</button>}
   </section>
   <section className="rounded-2xl border bg-white p-4 space-y-2"><h3 className="font-semibold">Bac d’attente · lots incomplets <span className="text-slate-400 font-normal">{waitingLots.length}</span></h3>
    {waitingLots.length?<ul className="divide-y text-sm">{waitingLots.map(l=>{const lot=lotState(lines,l);return <li key={l.order_id} className="py-2 flex items-center gap-2"><span className="rounded-lg bg-amber-100 px-2 py-1 text-xs font-bold text-amber-900">{orderLines(lines,l).find(x=>x.location)?.location||'—'}</span><span className="min-w-0 flex-1"><span className="block truncate">{l.account_login}</span><span className="text-xs text-slate-500">il manque {lot.missing} article{lot.missing>1?'s':''} · avant le {when(deadlineOf(l))}</span></span></li>})}</ul>:<p className="text-sm text-slate-500">Bac vide.</p>}
   </section>
   <section className="rounded-2xl border bg-white p-4 space-y-2"><h3 className="font-semibold">À déposer <span className="text-slate-400 font-normal">{toDeposit.length}</span></h3>
    {byAccount.length?<ul className="text-sm space-y-1">{byAccount.map(([account,ls])=><li key={account} className="flex justify-between"><span>{account}</span><span className="text-slate-500">{ls.length} colis</span></li>)}</ul>:<p className="text-sm text-slate-500">Aucun colis à déposer.</p>}
    <p className="text-[11px] text-slate-400">Ils passent en « Expédié » tout seuls quand le transporteur scanne le colis.</p>
   </section>
  </div>
  {toast&&<p role="status" className="fixed bottom-5 left-1/2 z-40 -translate-x-1/2 rounded-full bg-slate-900 px-4 py-2 text-sm text-white shadow-lg">{toast}</p>}
  {labelLine&&<ShippingLabelDialog line={labelLine} request={request} onClose={()=>setLabelLine(null)}/>}
  {batchLines&&<BatchLabelsDialog lines={batchLines} request={request} onClose={()=>{setBatchLines(null);setChecked([]);load().catch(()=>{})}} onPacked={()=>load().catch(()=>{})}/>}
 </section>
}
