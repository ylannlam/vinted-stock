import {useEffect,useRef,useState} from 'react'
import {purchaseDay,shiftPurchaseDay,dailyPurchaseText} from '../lib/dailyPurchases'
import {money} from '../lib/fulfillment'
import {collectorBridge as defaultBridge} from '../lib/collectorBridge'
import {buttonClass,primaryClass,fieldClass,ErrorNotice} from './WorkspaceUI'
import FallbackImage from './FallbackImage'

const defaultCollector=(...args)=>import('../lib/api').then(m=>m.collectorRequest(...args))
const labels={ready:'À commander',missing_sku:'SKU manquant',searching:'Recherche en cours',lookup_failed:'Recherche à reprendre',variant_missing:'Variante à compléter',variant_review:'Variante à vérifier',unavailable:'Taille indisponible',purchase_review:'Achat déjà détecté'}
const dayLabel=day=>new Date(day+'T12:00:00').toLocaleDateString('fr-FR',{weekday:'long',day:'numeric',month:'long'})

function MissingSku({line,busy,onSave}) {
  const [sku,setSku]=useState('')
  return <form className="flex gap-2 mt-4" onSubmit={e=>{e.preventDefault();onSave(line,sku)}}>
    <input aria-label={`SKU pour ${line.title}`} required pattern="[A-Za-z0-9_-]{1,200}" maxLength={200} autoComplete="off" className={fieldClass+' min-w-0 flex-1'} placeholder="Colle le SKU Shein" value={sku} onChange={e=>setSku(e.target.value.trim())}/>
    <button disabled={busy||!sku} className={primaryClass}>Rechercher</button>
  </form>
}

export default function DailyPurchaseCart({request,collectorRequest=defaultCollector,bridge=defaultBridge,onOpenSale,onOrders,onChanged,isAdmin}) {
  const [chosenDay,setChosenDay]=useState(''),[clock,setClock]=useState(Date.now()),[data,setData]=useState(null)
  const [busy,setBusy]=useState(false),[loading,setLoading]=useState(true),[error,setError]=useState(''),[notice,setNotice]=useState('')
  const generation=useRef(0),mutating=useRef(false),[refresh,setRefresh]=useState(0)
  const today=purchaseDay(clock),day=chosenDay||today
  useEffect(()=>{const timer=setInterval(()=>setClock(Date.now()),30000);return()=>clearInterval(timer)},[])
  useEffect(()=>{
    let live=true,pending=false
    const id=++generation.current
    setLoading(true);setError('');setNotice('')
    async function load(){
      if(pending||document.visibilityState!=='visible')return
      pending=true
      try{
        const next=await request('GET',undefined,'?'+new URLSearchParams({view:'daily_cart',day}))
        if(live&&id===generation.current){setData(next);setError('')}
      }catch(e){if(live)setError(e.message)}finally{pending=false;if(live)setLoading(false)}
    }
    load();const timer=setInterval(load,10000)
    document.addEventListener('visibilitychange',load)
    return()=>{live=false;clearInterval(timer);document.removeEventListener('visibilitychange',load)}
  },[day,request,refresh])
  async function run(fn){
    if(mutating.current)return
    mutating.current=true;setBusy(true);setError('');setNotice('')
    try{await fn();setRefresh(n=>n+1);onChanged?.()}catch(e){setError(e.message)}finally{mutating.current=false;setBusy(false)}
  }
  async function saveSku(line,sku){
    if(!/^[A-Za-z0-9_-]{1,200}$/.test(sku.trim()))throw Error('Colle uniquement le SKU, sans lien ni espaces.')
    await request('PATCH',{action:'sku',id:line.id,updated_at:line.updated_at,sku:sku.trim()})
  }
  async function retry(sku){
    await collectorRequest('POST',{action:'enqueue',references:sku})
    const browser=await bridge('status').catch(()=>null)
    if(browser?.connected)await bridge('start')
  }
  function choose(value){setChosenDay(value===today?'':value);setNotice('')}
  const cart=data?.day===day?data:null,counts=cart?.counts
  const ready=cart?.groups.filter(g=>g.state==='ready')||[],attention=cart?.groups.filter(g=>g.state!=='ready')||[]
  const syncOld=!cart?.orders_synced_at||clock-Date.parse(cart.orders_synced_at)>15*60000
  function renderGroup(group){
    const complete=group.state==='ready'
    return <article key={group.key} className="daily-cart-item">
      <FallbackImage urls={group.photos} className="daily-cart-photo" alt="" loading="lazy" referrerPolicy="no-referrer" empty={<div className="daily-cart-photo daily-cart-placeholder" aria-hidden="true">◇</div>}/>
      <div className="daily-cart-item-content">
        <div className="flex flex-wrap justify-between gap-3 items-start"><span className={'daily-cart-state '+(complete?'is-ready':'is-attention')}>{labels[group.state]}</span><strong className="daily-cart-quantity">× {group.quantity}</strong></div>
        <h4 className="font-semibold text-base mt-3 leading-snug">{group.title}</h4>
        <p className="text-sm text-slate-600 mt-2"><strong>{group.size||'Taille à préciser'}</strong><span className="mx-2 text-slate-300">/</span>{group.color||'Couleur à préciser'}</p>
        {group.sku&&<p className="text-xs text-slate-400 mt-2 break-all">SKU {group.sku}</p>}
        {!complete&&<p className="text-sm text-amber-900 mt-3">{group.message}</p>}
        <div className="daily-cart-item-actions">
          {complete?<><div><strong className="text-teal-950">{money(group.price==null?null:group.price*group.quantity)}</strong><p className="text-xs text-slate-400">{group.quantity>1?`${money(group.price)} / article · `:''}Estimation</p></div><a className={primaryClass} href={group.url} target="_blank" rel="noopener noreferrer">Ouvrir sur Shein ↗</a></>:group.state==='purchase_review'?<button className={buttonClass} onClick={onOrders}>Vérifier mes achats</button>:group.state==='lookup_failed'?<button disabled={busy||!isAdmin} className={buttonClass} onClick={()=>run(()=>retry(group.sku))}>Relancer la recherche</button>:group.state!=='missing_sku'&&group.state!=='searching'?<><button disabled={busy} className={buttonClass} onClick={()=>onOpenSale(group.lines[0].id)}>Vérifier la vente</button>{group.url&&<a className={buttonClass} href={group.url} target="_blank" rel="noopener noreferrer">Voir sur Shein ↗</a>}</>:null}
        </div>
        {group.state==='missing_sku'&&<MissingSku line={group.lines[0]} busy={busy} onSave={(line,sku)=>run(()=>saveSku(line,sku))}/>}
        <details className="mt-4 border-t border-slate-100 pt-3 text-xs text-slate-500"><summary className="cursor-pointer">{group.quantity} vente{group.quantity>1?'s':''} concernée{group.quantity>1?'s':''} · {[...new Set(group.lines.map(l=>l.account))].join(', ')}</summary><div className="flex flex-col gap-2 mt-3">{group.lines.map(line=><button key={line.id} className="text-left text-teal-800 underline underline-offset-2" onClick={()=>onOpenSale(line.id)}>{line.account} · {line.title}</button>)}</div></details>
      </div>
    </article>
  }
  return <section aria-label="Panier du jour" className="space-y-5">
    <header className="daily-cart-hero">
      <div><p className="daily-cart-eyebrow">TES VENTES, PRÊTES À COMMANDER</p><h2 className="text-2xl font-bold mt-2">{day===today?'Mon panier du jour':'Mon panier Shein'}</h2><p className="text-sm text-slate-500 mt-2">Les ventes du {dayLabel(day)}, regroupées par article, taille et couleur.</p><p className="text-xs text-slate-400 mt-2">Ajoute les SKU : l’extension retrouve les fiches et complète cette liste automatiquement.</p></div>
      <div className="flex flex-wrap gap-2 items-end"><label className="text-xs text-slate-500">Journée · heure de Paris<input type="date" aria-label="Date du panier" className={fieldClass+' mt-1'} value={day} max={today} onChange={e=>{if(e.target.value)choose(e.target.value)}}/></label><button className={buttonClass} onClick={()=>choose(shiftPurchaseDay(today,-1))}>Hier</button><button className={buttonClass} onClick={()=>choose(today)}>Aujourd’hui</button><button disabled={busy||loading} className={buttonClass} onClick={()=>setRefresh(n=>n+1)}>Actualiser</button></div>
    </header>
    <ErrorNotice error={error} retry={()=>setRefresh(n=>n+1)} busy={loading}/>
    {notice&&<p role="status" className="text-sm text-teal-800">{notice}</p>}
    {cart&&<>
      <div className="daily-cart-stats" aria-label="Résumé du panier">
        <div><span>À commander</span><strong>{counts.ready}<small> article{counts.ready>1?'s':''}</small></strong></div>
        <div><span>À compléter ou vérifier</span><strong>{counts.attention}<small> article{counts.attention>1?'s':''}</small></strong></div>
        <div><span>Déjà pris en charge</span><strong>{counts.ordered}<small> article{counts.ordered>1?'s':''}</small></strong></div>
        <div><span>Budget estimé</span><strong>{money(cart.estimated_total)}</strong><p>{cart.missing_prices?'Certains prix restent inconnus.':'Hors livraison et coupons'}</p></div>
      </div>
      {cart.earlier_pending?.count>0&&<div className="daily-cart-reminder"><p><strong>{cart.earlier_pending.count} vente{cart.earlier_pending.count>1?'s':''} plus ancienne{cart.earlier_pending.count>1?'s':''}</strong> reste{cart.earlier_pending.count>1?'nt':''} à traiter.</p><button className={buttonClass} onClick={()=>choose(cart.earlier_pending.oldest_day)}>Voir le panier du {new Date(cart.earlier_pending.oldest_day+'T12:00:00').toLocaleDateString('fr-FR')}</button></div>}
      {syncOld&&counts.sold>0&&<div className="daily-cart-reminder"><p className="text-sm">Actualise les commandes Shein avant d’acheter pour prendre en compte tes derniers achats.</p><button className={buttonClass} onClick={onOrders}>Mes commandes Shein</button></div>}
      {!!ready.length&&<section aria-label="Articles à commander"><div className="flex flex-wrap justify-between items-center gap-3 mb-4"><div><h3 className="font-semibold">Ta liste à commander</h3><p className="text-xs text-slate-500 mt-1">{ready.length} référence{ready.length>1?'s':''} · {counts.ready} article{counts.ready>1?'s':''}</p></div><button className={buttonClass} onClick={async()=>{try{await navigator.clipboard.writeText(dailyPurchaseText(cart));setNotice('La liste à commander est copiée.')}catch{setError('La copie n’est pas disponible dans ce navigateur. Les articles restent accessibles ci-dessous.')}}}>Copier la liste</button></div><div className="daily-cart-grid">{ready.map(renderGroup)}</div><p className="text-xs text-slate-400 mt-3">Prix et disponibilités du dernier relevé. Vérifie la taille, la couleur et le total sur Shein avant de payer.</p></section>}
      {!!attention.length&&<section aria-label="Articles à compléter"><h3 className="font-semibold mb-4">Pour terminer ton panier</h3><div className="daily-cart-grid">{attention.map(renderGroup)}</div></section>}
      {!cart.groups.length&&<div className="workspace-empty"><span className="workspace-empty-symbol" aria-hidden="true">✓</span><h3>{counts.sold?'Tout est déjà pris en charge':'Aucune vente à commander ce jour-là'}</h3><p>{counts.sold?'Les ventes commandées, reçues ou expédiées restent en dehors du panier.':'Les nouvelles ventes apparaîtront ici automatiquement.'}</p></div>}
      <p className="text-xs text-slate-400">{counts.excluded>0?`${counts.excluded} vente(s) annulée(s), suspendue(s) ou en retour exclue(s). `:''}Le panier se met à jour avec les ventes et les achats associés. Dernière lecture des commandes Shein : {cart.orders_synced_at?new Date(cart.orders_synced_at).toLocaleString('fr-FR'):'pas encore effectuée'}.</p>
    </>}
    {loading&&!cart&&<p role="status" className="text-sm text-slate-500 py-10 text-center">Préparation du panier…</p>}
  </section>
}
