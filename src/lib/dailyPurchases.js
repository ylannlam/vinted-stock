import {salePhotos} from './fulfillment.js'
import {sheinProduct} from './catalog.js'

export const PURCHASE_TIME_ZONE='Europe/Paris'
export const purchaseDay=(value=Date.now())=>new Intl.DateTimeFormat('en-CA',{timeZone:PURCHASE_TIME_ZONE,year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date(value))
export const shiftPurchaseDay=(day,offset)=>new Date(Date.parse(day+'T12:00:00Z')+offset*86400000).toISOString().slice(0,10)
const norm=value=>String(value||'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().replace(/\s+/g,'')
export const purchaseSize=value=>norm(String(value||'').replace(/^\s*\d+\s*\(([A-Za-z0-9]+)\)\s*$/,'$1'))
const paidStates=new Set(['processing','shipped','delivered'])
const boughtStages=new Set(['ordered','in_transit','received','prepared','shipped'])

// A cart is a projection of current sales, never another copy of their quantities.
// Unknown variants and unallocated paid purchases stay out of the buy list.
export function buildDailyPurchases(context,now=Date.now()) {
  const day=context.day||purchaseDay(now),catalog=context.catalog||[],groups=new Map()
  const counts={sold:0,ready:0,attention:0,ordered:0,excluded:0,missing_sku:0}
  for(const line of context.lines||[]) {
    if(!line.sale_date||purchaseDay(line.sale_date)>day||!context.include_earlier&&purchaseDay(line.sale_date)!==day)continue
    const blocked=line.is_blocked===true||['cancelled','returning','suspended'].includes(line.order_status||line.order?.status)||line.source_active===false
    if(blocked){counts.excluded++;continue}
    counts.sold++
    if(boughtStages.has(line.effective_stage||line.stage)||line.shein_item_id||line.supplier_order_ref?.trim()){counts.ordered++;continue}
    const sku=(line.resolved_sku??line.sku_override??line.source?.sku??'').trim()
    const product=catalog.find(p=>norm(p.sku)===norm(sku)),size=line.supplier_size?.trim()||'',color=line.supplier_color?.trim()||product?.color?.trim()||''
    const url=sheinProduct(product?.supplier_url)?.supplier_url||null
    const sizeInfo=product?.sizes?.find(s=>purchaseSize(s.size)===purchaseSize(size))
    const possiblePurchases=(context.unallocated||[]).filter(i=>paidStates.has(i.status)&&i.remaining>0&&norm(i.sku)===norm(sku)
      &&(!size||!i.size||purchaseSize(i.size)===purchaseSize(size))&&(!color||!i.color||norm(i.color)===norm(color))
      &&(!i.order_date||i.order_date>=purchaseDay(line.sale_date)))
    let state='ready',message='Taille disponible lors du dernier relevé.'
    if(!sku){state='missing_sku';message='Ajoute le SKU pour retrouver cet article sur Shein.';counts.missing_sku++}
    else if(possiblePurchases.length){state='purchase_review';message='Un achat payé avec ce SKU reste à associer. Vérifie-le avant de racheter.'}
    else if(!url||!product?.observed_at){state=['blocked','failed'].includes(product?.retrieval_status)?'lookup_failed':'searching';message=product?.retrieval_message||'L’extension recherche la fiche Shein.'}
    else if(now-Date.parse(product.observed_at)>6*3600000){state='stale';message='Le relevé a plus de 6 heures. Actualise le prix et les tailles avant de commander.'}
    else if(!size||!color){state='variant_missing';message='Précise la taille et la couleur dans la vente.'}
    else if(!product.color||norm(color)!==norm(product.color)){state='variant_review';message='La couleur de la vente doit être vérifiée sur la fiche Shein.'}
    else if(!sizeInfo||sizeInfo.availability!=='available'){state=sizeInfo?.availability==='unavailable'?'unavailable':'variant_review';message=state==='unavailable'?'Cette taille était indisponible au dernier relevé.':'La disponibilité de cette taille reste à vérifier sur Shein.'}
    const key=JSON.stringify([sku?norm(sku):line.id,purchaseSize(size),norm(color),state])
    const group=groups.get(key)||{key,sku,size,color,state,message,url,quantity:0,lines:[],photos:[],order_refs:[],
      title:line.source?.title||sku||'Article vendu',price:product?.currency==='EUR'&&product.price!=null&&Number.isFinite(Number(product.price))?Number(product.price):null,
      observed_at:product?.observed_at||null,retrieval_status:product?.retrieval_status||null,
      price_change_percent:product?.previous_price>0&&product?.price!=null?(Number(product.price)/Number(product.previous_price)-1)*100:null,
      earliest_sale:line.sale_date,deadline_at:null,urgent:false}
    group.quantity++
    if(line.sale_date<group.earliest_sale)group.earliest_sale=line.sale_date
    if(line.deadline_at&&(!group.deadline_at||line.deadline_at<group.deadline_at))group.deadline_at=line.deadline_at
    group.urgent=!!group.deadline_at&&Date.parse(group.deadline_at)-now<48*3600000
    group.lines.push({id:line.id,title:line.source?.title||sku,account:line.account_login||line.order?.account_login||'Compte Vinted',updated_at:line.updated_at})
    group.photos=[...new Set([...group.photos,...salePhotos({...line,sku_override:sku},product?[product]:[])])]
    group.order_refs=[...new Set([...group.order_refs,...possiblePurchases.map(i=>i.order_ref)])]
    groups.set(key,group)
    counts[state==='ready'?'ready':'attention']++
  }
  const result=[...groups.values()].sort((a,b)=>Number(b.urgent)-Number(a.urgent)||(a.deadline_at||'9999').localeCompare(b.deadline_at||'9999')||a.earliest_sale.localeCompare(b.earliest_sale)||a.title.localeCompare(b.title,'fr')||a.size.localeCompare(b.size,'fr'))
  const ready=result.filter(g=>g.state==='ready')
  return {...context,lines:undefined,catalog:undefined,unallocated:undefined,day,groups:result,counts,
    estimated_total:Math.round(ready.reduce((sum,g)=>sum+(g.price||0)*g.quantity,0)*100)/100,
    missing_prices:ready.reduce((sum,g)=>sum+(g.price==null?g.quantity:0),0)}
}

export function dailyPurchaseText(cart) {
  return ['Panier Shein du '+new Date(cart.day+'T12:00:00').toLocaleDateString('fr-FR'),
    ...cart.groups.filter(g=>g.state==='ready').map(g=>`${g.quantity} × ${g.title}\nSKU : ${g.sku} · Taille : ${g.size} · Couleur : ${g.color}\n${g.url}`)].join('\n\n')
}
