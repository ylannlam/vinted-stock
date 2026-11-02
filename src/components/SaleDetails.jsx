import {useRef} from 'react'
import ResourceDialog from './ResourceDialog'
import {ShipmentSummary} from './SupplierShipments'
import {ErrorNotice,fieldClass,buttonClass,primaryClass} from './WorkspaceUI'
import {STAGES,stageOf,money,deadline,ORDER_LABELS,nextStage,blocked,photoOf,safeUrl} from '../lib/fulfillment'
import {retrievalState,variantAvailability,saleMargin,draftSupplierUrl} from '../lib/saleDetails'

export function SheinStatus({sku,product}) {
  const state=retrievalState(sku,product)
  return <p className={`text-xs mt-2 ${state.tone==='amber'?'text-amber-800':state.tone==='blue'?'text-blue-700':'text-teal-700'}`}>{state.label}</p>
}

export default function SaleDetails({value,onChange,product,busy,error,notice,onClose,onSave,onRefresh,isAdmin,onRetry,onAdvance,onParcel,onShipments,onPreparePhoto,onLabel}) {
  const initial=useRef(JSON.stringify(value))
  const dirty=JSON.stringify(value)!==initial.current
  const state=retrievalState(value.sku,product),availability=variantAvailability(value.supplier_size,value.supplier_color,product)
  const margin=saleMargin(value),currency=value.order?.currency,due=deadline(value)
  const catalog=product?[product]:[],photo=photoOf({...value,sku_override:value.sku},catalog),supplierUrl=draftSupplierUrl(value,catalog)
  const change=(key,val)=>onChange({...value,[key]:val,...(['actual_cost','fees_amount','refund_amount'].includes(key)?{finance_confirmed:false}:{}),...(key==='sku'?{supplier_url:undefined,variant:''}:{})})
  const close=()=>{if(!dirty||window.confirm('Fermer sans enregistrer tes modifications ?'))onClose()}
  const field=(key,label,{amount=false,max=200,placeholder}={})=><label className="block text-sm text-slate-600" key={key}>{label}<input disabled={busy} className={fieldClass+' mt-1'} value={key==='supplier_url'?supplierUrl:value[key]??''} maxLength={max} inputMode={amount?'decimal':undefined} placeholder={placeholder} onChange={e=>change(key,amount?e.target.value.replace(',','.'):e.target.value)}/></label>
  return <ResourceDialog title="Fiche de vente" busy={busy} onClose={close}>
    <form className="space-y-6" onSubmit={e=>{e.preventDefault();onSave()}}>
      <header className="flex gap-4 items-start">{photo&&<img className="w-16 h-24 rounded-xl object-cover" src={photo} referrerPolicy="no-referrer" alt=""/>}<div className="min-w-0 flex-1"><h3 className="font-semibold text-lg">{value.source?.title||'Article sans titre'}</h3><p className="text-sm text-slate-500 mt-1">{value.order?.account_login||'Compte inconnu'} · {ORDER_LABELS[value.order?.status]||'Statut à vérifier'}</p><p className="font-semibold mt-2">Vendu {money(value.source?.selling_price,currency)}</p>{due&&<p className={`text-xs mt-1 ${due.urgent?'text-amber-800':'text-slate-500'}`}>Envoi : {due.text}</p>}</div></header>
      {onLabel&&!blocked(value)&&<button type="button" className={buttonClass} onClick={onLabel}>Bordereau 100 × 150 mm</button>}
      <ol aria-label="Étapes de préparation" className="flex flex-wrap gap-2">{STAGES.map((s,i)=><li key={s.id} aria-current={stageOf(value)===s.id?'step':undefined} className={`text-xs rounded-full px-3 py-2 ${stageOf(value)===s.id?'bg-teal-700 text-white':'bg-slate-100 text-slate-500'}`}>{i+1}. {s.label}</li>)}</ol>
      <section className="rounded-xl border p-4 space-y-4"><h3 className="font-semibold">Article à acheter sur Shein</h3>
        <div className="grid sm:grid-cols-2 gap-3">{field('sku','SKU Shein',{placeholder:'Référence de l’article vendu'})}{field('supplier_url','Lien Shein',{max:2000,placeholder:'https://fr.shein.com/…'})}{field('supplier_size','Taille à acheter',{max:80,placeholder:'Ex. M'})}{field('supplier_color','Couleur à acheter',{max:80,placeholder:'Ex. Beige'})}</div>
        <p className="text-xs text-teal-800">{value.supplier_size_manual?'Taille corrigée manuellement.':value.source?.size_origin==='dotb'?`Taille reprise de l’article Dotb : ${value.source.size_label}.`:value.source?.size?`Taille reprise du titre de la vente : ${value.source.size}. À vérifier si le titre est inexact.`:'La taille vendue n’est pas disponible : renseigne-la ci-dessus.'}</p>
        <p className="text-xs text-slate-500">La photo et le lien Shein s’ajoutent automatiquement après récupération du SKU. Taille et couleur sont propres à cette vente.</p>
        {product?.variant&&<p className="text-xs text-slate-500">Ancienne indication partagée : {product.variant}</p>}
        <div className="bg-slate-50 rounded-xl p-3"><div className="flex flex-wrap justify-between items-center gap-2"><div><p className="text-sm font-semibold">{product?.price!=null?`${money(product.price,product.currency)} · dernier prix relevé`:'Prix Shein non relevé'}</p>{product?.observed_at&&<p className="text-xs text-slate-500 mt-1">{product.color||'Couleur non relevée'} · {new Date(product.observed_at).toLocaleString('fr-FR')} · hors coupons</p>}<SheinStatus sku={value.sku} product={product}/></div><div className="flex flex-wrap gap-2">{safeUrl(supplierUrl)&&<a href={safeUrl(supplierUrl)} target="_blank" rel="noreferrer" className={buttonClass}>Ouvrir Shein ↗</a>}{isAdmin&&state.retry&&<button type="button" className={buttonClass} disabled={busy||dirty} onClick={onRetry}>Actualiser la fiche Shein</button>}</div></div>
          <p className={`text-xs mt-3 ${availability.tone==='red'?'text-red-700':availability.tone==='teal'?'text-teal-700':'text-amber-800'}`}>{availability.label}</p>
          <p className="text-xs mt-1 text-slate-500">Le prix peut varier selon la taille, les promotions et le panier. La récupération nécessite le navigateur connecté.</p>
          {dirty&&<p className="text-xs mt-2 text-slate-500">Enregistre tes modifications avant de relancer la récupération.</p>}
        </div>
      </section>
      <section className="space-y-3"><h3 className="font-semibold">Commande & réception</h3><div className="grid sm:grid-cols-2 gap-3">{field('supplier_order_ref','Numéro de commande Shein')}{value.supplier_tracking&&<p className="text-sm text-slate-500">Ancien suivi saisi : {value.supplier_tracking}</p>}{field('location','Emplacement chez toi',{max:100})}</div>{field('notes','Notes pour cette vente',{max:1000})}<div className="flex flex-wrap gap-2"><button type="button" className={buttonClass} disabled={busy||dirty} onClick={onParcel}>Relier un colis Shein</button><button type="button" className={buttonClass} disabled={busy||dirty} onClick={onShipments}>Voir les colis Shein</button></div>{dirty&&<p className="text-xs text-slate-500">Enregistre la vente avant de relier un colis.</p>}{value.shipments?.map(p=><div key={p.id} className="rounded-xl border p-3"><ShipmentSummary parcel={p}/></div>)}</section>
      <details className="rounded-xl bg-slate-50 p-4 space-y-3"><summary className="font-semibold cursor-pointer">Coûts réels & marge {currency?`(${currency})`:''}</summary><p className="text-xs text-slate-500">Indique le coût de cet article après remise. Répartis les frais de la commande entre les articles concernés.</p><div className="grid sm:grid-cols-3 gap-3">{field('actual_cost','Coût réellement payé',{amount:true,placeholder:'À renseigner'})}{field('fees_amount','Frais affectés',{amount:true})}{field('refund_amount','Remboursé au client',{amount:true})}</div>
        <div className="flex flex-wrap justify-between gap-2 text-sm"><span>Marge calculée avec tes montants</span><strong>{currency&&margin!=null?money(margin,currency):'À compléter'}</strong></div>
        <label className="flex gap-2 items-start text-sm"><input type="checkbox" disabled={busy||margin==null||!currency} checked={value.finance_confirmed} onChange={e=>change('finance_confirmed',e.target.checked)}/>J’ai vérifié le coût payé, les frais et les remboursements.</label>
      </details>
      {onPreparePhoto&&<button type="button" className={buttonClass} disabled={busy} onClick={()=>{if(!dirty||window.confirm('Quitter sans enregistrer tes modifications ?'))onPreparePhoto()}}>Préparer les photos</button>}
      <ErrorNotice error={error}/>{notice&&<p role="status" className="text-sm text-teal-800">{notice}</p>}
      <footer className="flex flex-wrap gap-3 justify-between border-t pt-4"><button type="button" className={buttonClass} disabled={busy} onClick={()=>{if(!dirty||window.confirm('Recharger la vente et abandonner tes modifications ?'))onRefresh()}}>Recharger la vente</button><div className="flex flex-wrap gap-2">{!blocked(value)&&nextStage(value)&&<button type="button" className={buttonClass} disabled={busy||dirty} title={dirty?'Enregistre tes modifications avant de changer d’étape':undefined} onClick={onAdvance}>{STAGES.find(s=>s.id===stageOf(value))?.action} →</button>}<button disabled={busy} className={primaryClass}>{busy?'Enregistrement…':'Enregistrer la vente'}</button></div></footer>
    </form>
  </ResourceDialog>
}
