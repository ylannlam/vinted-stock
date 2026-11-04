import ArticlePhotos from './ArticlePhotos'
import {productOf,salePhotos,stageOf,blocked,deadline,money,nextStage,ORDER_LABELS,STAGES} from '../lib/fulfillment'
import {nextSaleAction} from '../lib/saleDetails'
import {saleDateOf,saleDateLabel} from '../lib/salesOrder'
import {saleCoefficient,formatCoefficient} from '../lib/coefficient'
import {primaryClass,buttonClass,fieldClass} from './WorkspaceUI'

export default function SaleCard({line,catalog,busy,selecting,selected,onSelect,onDetails,onLabel,onAction,skuEditing,onSkuChange,onSkuPaste,onSkuSave,onSkuClose,error}) {
  const product=productOf(line,catalog),due=deadline(line),stage=stageOf(line),action=nextSaleAction(line,catalog)
  const isBlocked=blocked(line),isEditing=skuEditing?.id===line.id
  const title=line.source.title||'Article sans titre'
  const photos=salePhotos(line,catalog),coef=formatCoefficient(saleCoefficient(line))
  const soldAt=saleDateOf(line)
  const status=isBlocked?ORDER_LABELS[line.order.status]||'À vérifier':STAGES.find(s=>s.id===stage)?.label
  return <article className={`sale-card ${selected?'is-selected':''}`}>
    <div className="relative"><ArticlePhotos photos={photos.slice(0,1)} fallbacks={photos.slice(1)} title={title} onOpen={onDetails}/><span className={`sale-stage ${isBlocked?'sale-stage-warning':''}`}>{status}</span>{selecting&&<label className="sale-select"><input type="checkbox" aria-label={`Sélectionner ${title}`} disabled={busy||isBlocked||!nextStage(line)} checked={selected} onChange={e=>onSelect(e.target.checked)}/></label>}</div>
    <div className="sale-card-body">
      <div className="sale-card-meta"><span>{line.order.account_login||'Compte inconnu'}</span><strong className="sale-price">{money(line.source.selling_price,line.order.currency)}</strong></div>
      <button className="article-title-button" onClick={onDetails}><h2 className="article-title">{title}</h2></button>
      {soldAt&&<time className="sale-date" dateTime={soldAt}>Vendu le {saleDateLabel(soldAt)}</time>}
      <div className="sale-variant"><span>{line.supplier_size?'Taille '+line.supplier_size:'Taille à préciser'}</span>{line.supplier_color&&<span>{line.supplier_color}</span>}{line.actual_cost!=null?<><span className="sale-cost">Payé : {money(line.actual_cost,line.order.currency)}</span>{coef&&<span className="sale-cost" title="Prix de vente net ÷ prix payé">{coef}</span>}</>:product?.price!=null?<span className="sale-cost">Prix Shein indicatif : {money(product.price,product.currency)}</span>:null}</div>
      {due&&<p className={`sale-deadline ${due.urgent?'is-urgent':''}`}>Envoi Vinted : {due.text.toLowerCase()}</p>}
      {isEditing?<form className="sale-sku-form" aria-label={`SKU de ${title}`} onSubmit={e=>{e.preventDefault();onSkuSave()}} onKeyDown={e=>{if(e.key==='Escape'&&!busy)onSkuClose()}}>
        <label className="block text-xs font-medium">SKU Shein<input autoFocus required disabled={busy} autoCapitalize="none" autoCorrect="off" spellCheck={false} maxLength={200} placeholder="Colle le SKU ici" className={fieldClass+' mt-2'} value={skuEditing.sku} onPaste={onSkuPaste} onChange={e=>onSkuChange(e.target.value)}/></label>
        <p className="text-xs text-slate-500">{busy?'Enregistrement…':'Colle le SKU pour l’enregistrer automatiquement.'}</p>{error&&<p role="alert" className="text-xs text-red-700">{error}</p>}
        <div className="flex gap-2"><button disabled={busy||!skuEditing.sku.trim()} className={primaryClass}>Enregistrer</button><button type="button" disabled={busy} onClick={onSkuClose} className={buttonClass}>Annuler</button></div>
      </form>:<div className="sale-card-footer">
        {action?<button disabled={busy} onClick={()=>onAction(action)} className={primaryClass+' w-full'}>{action.label}</button>:<button disabled={busy} onClick={onDetails} className={buttonClass+' w-full'}>Voir la vente</button>}
        {action?.kind!=='details'&&action&&<button disabled={busy} onClick={onDetails} className="article-details-link">Voir les détails <span aria-hidden="true">↗</span></button>}
        {onLabel&&!isBlocked&&<button type="button" disabled={busy} onClick={onLabel} className="article-details-link">Bordereau 100 × 150 <span aria-hidden="true">↗</span></button>}
      </div>}
    </div>
  </article>
}
