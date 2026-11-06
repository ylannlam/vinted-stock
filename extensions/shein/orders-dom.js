// Isolated-world DOM only. No page scripts, cookies, addresses or payment data.
// Keep self-contained: chrome.scripting serializes this function.
export function readSheinOrders(action='read') {
  const text=n=>(n?.textContent||'').replace(/\s+/g,' ').trim()
  const norm=s=>s.normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase()
  const visible=n=>n&&!n.closest('[hidden],[aria-hidden="true"]')&&(!n.getClientRects||n.getClientRects().length>0)
  const url=new URL(location.href)
  if(url.protocol!=='https:'||!['fr.shein.com','www.shein.com'].includes(url.hostname))return {error:'page_unavailable'}
  if(/captcha|challenge|robot/.test(url.pathname)||[...document.querySelectorAll('iframe')].some(n=>/captcha|challenge/.test(n.src||'')))return {error:'human_check'}
  if(/auth|login|signin/.test(url.pathname))return {error:'login_required'}
  const date=value=>{
    const iso=value.match(/\b(20\d{2})[-/](\d{2})[-/](\d{2})\b/)
    if(iso)return `${iso[1]}-${iso[2]}-${iso[3]}`
    const numeric=value.match(/\b(\d{2})[/.](\d{2})[/.](20\d{2})\b/)
    if(numeric)return `${numeric[3]}-${numeric[2]}-${numeric[1]}`
    const months=['janv','fevr','mars','avr','mai','juin','juil','aout','sept','oct','nov','dec']
    const m=norm(value).match(/(\d{1,2})\s+([a-z]+)\.?\s+(20\d{2})/)
    const month=m?months.findIndex(x=>m[2].startsWith(x)):-1
    return month<0?null:`${m[3]}-${String(month+1).padStart(2,'0')}-${m[1].padStart(2,'0')}`
  }
  const price=value=>{const m=value.replace(/\s/g,'').match(/(\d+(?:[,.]\d{2})?)€/);return m?Number(m[1].replace(',','.')):null}
  const safeProduct=value=>{try{const u=new URL(value,url);return u.protocol==='https:'&&['fr.shein.com','www.shein.com'].includes(u.hostname)&&/-p-\d+\.html$/.test(u.pathname)?u.origin+u.pathname:null}catch{return null}}
  const observed_at=new Date().toISOString()
  // Données que la page Shein embarque elle-même (var gbRawData / var gbOrdersTrackSsrData) : bien plus fiables que l'affichage.
  const embedded=name=>{
    const marker=`var ${name} = `
    for(const script of Array.from(document.scripts||document.querySelectorAll('script')||[])){
      const t=script.textContent||'',at=t.indexOf(marker)
      if(at<0)continue
      const start=t.indexOf('{',at+marker.length)
      if(start<0)return null
      let depth=0,inString=false,escaped=false
      for(let k=start;k<t.length;k++){
        const c=t[k]
        if(inString){if(escaped)escaped=false;else if(c==='\\')escaped=true;else if(c==='"')inString=false;continue}
        if(c==='"')inString=true
        else if(c==='{')depth++
        else if(c==='}'&&--depth===0){try{return JSON.parse(t.slice(start,k+1))}catch{return null}}
      }
      return null
    }
    return null
  }
  const parisDate=seconds=>{const n=Number(seconds);if(!Number.isFinite(n)||n<=0)return null;return new Intl.DateTimeFormat('en-CA',{timeZone:'Europe/Paris',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date(n*1000))}
  const shortDay=seconds=>{const n=Number(seconds);if(!Number.isFinite(n)||n<=0)return '';return new Intl.DateTimeFormat('fr-FR',{timeZone:'Europe/Paris',day:'2-digit',month:'short'}).format(new Date(n*1000))}
  const etaRange=value=>{const [a,b]=String(value||'').split('-').map(Number);if(!a||!b)return '';const x=shortDay(a),y=shortDay(b),[d1,...m1]=x.split(' '),[d2,...m2]=y.split(' ');return m1.join(' ')===m2.join(' ')?`${d1}-${d2} ${m2.join(' ')}`:`${x} - ${y}`}
  const money=value=>{const n=Number(value?.amount);return Number.isFinite(n)&&n>=0&&n<=100000?Math.round(n*100)/100:null}
  const httpsImage=value=>{try{const u=new URL(String(value||'').replace(/^http:/,'https:'));return u.protocol==='https:'&&/(^|\.)ltwebstatic\.com$/.test(u.hostname)?u.href:null}catch{return null}}
  // Texte seul : DOMParser n'exécute rien et ne charge aucune image.
  const plain=value=>text(new DOMParser().parseFromString(String(value||''),'text/html').body).slice(0,300)
  // Codes d'article Shein observés sur les pages commande et suivi.
  const PROCESSING=new Set(['1','11','13','191','23','45','49','52']),SHIPPED=new Set(['16'])
  if(url.pathname==='/user/orders/list') {
    const candidates=[...document.querySelectorAll('li.list-item')]
    const rows=candidates.filter(n=>n.querySelector('[class*="order-number__"]'))
    if(!rows.length){
      if(document.querySelector('input[type="password"]'))return {error:'login_required'}
      const empty=[...document.querySelectorAll('[class*="empty"]')].some(n=>visible(n)&&/aucune commande|pas encore de commande|no orders/i.test(text(n)))
      return empty?{kind:'list',orders:[],empty:true,has_next:false,observed_at}:{error:'page_unavailable'}
    }
    const orders=rows.map(n=>({ref:text(n.querySelector('[class*="order-number__"]')),order_date:date(text(n.querySelector('.time'))),status_text:text(n.querySelector('.status-text')),total:price(text(n.querySelector('.default-price')))}))
    const next=document.querySelector('nav[aria-label="Pagination Navigation"] [aria-label="Next page"]')
    if(action==='next') {if(!next||next.disabled||next.getAttribute('aria-disabled')==='true')return {error:'no_next_page'};next.click();return {clicked:true}}
    return {kind:'list',orders,incomplete:candidates.length!==rows.length,has_next:!!next&&!next.disabled&&next.getAttribute('aria-disabled')!=='true',observed_at}
  }
  if(url.pathname==='/orders/track'||url.pathname==='/user/orders/track') {
    const billno=url.searchParams.get('billno')||''
    if(!/^G[A-Z0-9]{7,39}$/.test(billno))return {error:'page_unavailable'}
    const data=embedded('gbOrdersTrackSsrData')
    if(!data)return {error:'page_unavailable'}
    if(data.billno&&data.billno!==billno)return {error:'reference_mismatch'}
    const sources=[...Object.values(data.packageMap||{}),data.trackInfo].filter(p=>p&&typeof p==='object'&&p.track_num)
    const packages=[]
    for(const p of sources){
      const tracking=String(p.track_num||'').replace(/\s/g,'').toUpperCase()
      if(!/^[A-Z0-9-]{6,40}$/.test(tracking)||!/\d/.test(tracking)||packages.some(x=>x.tracking_number===tracking))continue
      const list=(Array.isArray(p.logistics_tracks_list)?p.logistics_tracks_list:[]).filter(e=>Number(e?.timestamp)>0)
      const events=list.map(e=>({at:new Date(Number(e.timestamp)*1000).toISOString(),place:String(e.place||'').trim().slice(0,80),text:plain(e.details),code:String(e.mall_status_code??'')})).filter(e=>e.text).sort((a,b)=>b.at.localeCompare(a.at)).slice(0,40)
      const nodes=list.find(e=>Array.isArray(e.transit_nodes)&&e.transit_nodes.length)?.transit_nodes||[]
      const lit=nodes.filter(n=>n.lit_node),last=lit.at(-1)
      const delivered=nodes.length>0&&nodes.at(-1).lit_node===true||events.some(e=>/^(livr[eé]|sign[eé]|d[eé]livr[eé])\b|a [eé]t[eé] livr[eé]|colis livr[eé]/i.test(e.text))
      let track_url=null
      try{const u=new URL(String(p.track_url||'').replace('[shippingNo]',encodeURIComponent(tracking)));if(u.protocol==='https:'&&!u.username&&!u.password)track_url=u.href.slice(0,300)}catch{}
      packages.push({tracking_number:tracking,package_no:String(p.package_no||'').slice(0,40),carrier:String(p.carrier_name||'').trim().slice(0,60),track_url,
        status_text:delivered?'Livré':events[0]?.code==='4'?'En cours de livraison':String(last?.node_name||(events.length?'En transit':'')).slice(0,80),steps:nodes.slice(0,8).map(n=>({name:String(n.node_name||'').slice(0,60),done:n.lit_node===true})),delivered,events})
    }
    return {kind:'track',ref:billno,packages,observed_at}
  }
  const ref=url.pathname.match(/^\/user\/orders\/detail\/([A-Z0-9]{8,40})$/)?.[1]
  const raw=ref?embedded('gbRawData'):null,info=raw?.orderInfo
  if(ref&&info&&info.billno===ref&&Array.isArray(info.orderGoodsList)&&info.orderGoodsList.length){
    const links=new Map([...document.querySelectorAll('a[href*="-p-"]')].map(a=>{const href=safeProduct(a.getAttribute('href'));return [href?.match(/-p-(\d+)\.html$/)?.[1],href]}).filter(([id,href])=>id&&href))
    const domStatus=new Map()
    for(const row of document.querySelectorAll('table.new-order-table tbody > tr')){
      const cells=[...row.children].filter(n=>n.tagName==='TD'),skuCell=cells.find(n=>/^SKU/i.test(n.getAttribute('aria-label')||''))
      if(skuCell&&cells[4])domStatus.set(text(skuCell).replace(/^SKU\s*:?\s*/i,'').toLowerCase(),text(cells[4]))
    }
    const packages=new Map((info.order_package_info_list||[]).map(p=>[p.packageNo,p]))
    const items=[],parcels=new Map()
    for(const g of info.orderGoodsList){
      const product=g.product||{},sku=String(product.goods_sn||'').trim(),quantity=Number(g.quantity),goodsId=String(g.goods_id||product.goods_id||'')
      const slug=String(product.goods_url_name||product.goods_name||'article').normalize('NFD').replace(/[\u0300-\u036f]/g,'').replace(/[^A-Za-z0-9]+/g,'-').replace(/^-|-$/g,'').slice(0,120)||'article'
      const product_url=links.get(goodsId)||(/^\d{1,20}$/.test(goodsId)?`https://${url.hostname}/${slug}-p-${goodsId}.html`:null)
      if(!/^[a-z0-9_-]{1,200}$/i.test(sku)||!Number.isInteger(quantity)||quantity<1||quantity>100||!product_url)return {error:'order_unreadable'}
      const variant=String(g.goods_attr||g.sku_attrs_contact_str||'').trim(),parts=variant.split(/\s*\/\s*/)
      const code=String(g.status??''),shipping=String(g.shipping_no||g.goods_pkg_rel_list?.find(r=>r.shipping_no)?.shipping_no||'').replace(/\s/g,'').toUpperCase()
      const fallback=domStatus.get(sku.toLowerCase())||''
      const status_text=SHIPPED.has(code)?'Expédiés':PROCESSING.has(code)?'En cours de traitement':code==='0'?'En attente de paiement':fallback||(g.refund_record_status_list?.length?'Remboursé':`Statut Shein ${code||'inconnu'}`)
      const pack=packages.get(g.reference_number),eta=etaRange(pack?.transport_info?.sub_transport_time)
      const unit=money(g.avgPrice),total=money(g.totalPrice)
      // Le prix moyen par unité est fiable s'il correspond au total de la ligne : chaque exemplaire porte alors son prix.
      const exact=unit!=null&&(total==null||Math.abs(unit*quantity-total)<0.011)
      const row={sku,product_url,title:String(product.goods_name||'').trim().slice(0,500),color:parts.length===2?parts[0]:'',size:parts.length===2?parts[1]:'',variant_text:variant,status_text,photo:httpsImage(product.goods_img),eta,status_code:code}
      if(exact)for(let k=0;k<quantity;k++)items.push({...row,quantity:1,unit_price:unit})
      else items.push({...row,quantity,unit_price:quantity===1?unit:null})
      if(shipping&&/^[A-Z0-9-]{6,40}$/.test(shipping)&&/\d/.test(shipping)){
        const parcel=parcels.get(shipping)||{tracking_number:shipping,package_no:String(g.reference_number||'').slice(0,40),carrier:text(document.querySelector('.order-detail-track-card__name')),skus:[],status_text:'',eta,delivered:false,events:[]}
        if(!parcel.skus.includes(sku))parcel.skus.push(sku)
        parcels.set(shipping,parcel)
      }
    }
    if(!items.length||items.length>200)return {error:'order_unreadable'}
    const total=money(info.totalPrice),shipping=money(info.shippingPrice)
    const currency=String(info.currency_code||info.orderCurrency?.code||'').toUpperCase()
    const paid=String(info.isPaid??'1')!=='0'&&info.paymentTime
    const payment=total!=null&&currency==='EUR'&&paid?{paid_total:total,shipping,currency:'EUR',source:'order_summary'}:null
    return {kind:'detail',source:'json',ref,order_date:parisDate(info.addTime)||date(text(document.querySelector('.order-info li:last-child .order-info-title'))),items,parcels:[...parcels.values()],payment,sections:[],section:null,observed_at}
  }
  if(!ref)return {error:'page_unavailable'}
  const shownRef=text(document.querySelector('.order-info-billno .order-info-title'))
  if(shownRef!==ref)return {error:'page_unavailable'}
  const sectionTabs=[...document.querySelectorAll('[role="tablist"] [role="tab"]')].filter(n=>visible(n)&&/^(en cours de traitement|colis\s*\d+)$/i.test(text(n)))
  const sections=sectionTabs.map(n=>text(n))
  const selected=sectionTabs.filter(n=>n.getAttribute('aria-selected')==='true'||/(?:^|[-_\s])active(?:$|[-_\s])/.test(n.className||''))
  const section=selected.length===1?text(selected[0]):null
  if(action&&typeof action==='object'&&typeof action.section==='string'){
    const matches=sectionTabs.filter(n=>text(n)===action.section)
    if(matches.length!==1)return {error:'order_unreadable'}
    matches[0].click();return {clicked:true}
  }
  if(action==='tracking') {
    const root=document.querySelector('main')||document.querySelector('[role="main"]')
    const target=[...(root||document).querySelectorAll('button,a[role="button"]')].find(n=>visible(n)&&text(n)==='Suivre')
    if(!target)return {error:'tracking_unavailable'}
    target.click();return {clicked:true}
  }
  const items=[]
  for(const table of document.querySelectorAll('table.new-order-table')) {
    if(!visible(table))continue
    // Shein uses rowspan for status: subsequent identical rows are real quantities.
    let inheritedStatus=''
    for(const row of table.querySelectorAll('tbody > tr')) {
      const cells=[...row.children].filter(n=>n.tagName==='TD')
      const skuCell=cells.find(n=>/^SKU/i.test(n.getAttribute('aria-label')||''))
      if(!skuCell)continue
      const sku=text(skuCell).replace(/^SKU\s*:?\s*/i,'')
      const quantity=Number(text(cells.find(n=>/^Quantité/i.test(n.getAttribute('aria-label')||''))))
      const product_url=safeProduct(row.querySelector('a.ga-order-goods')?.getAttribute('href'))
      const sizeText=text(row.querySelector('.size-info')),parts=sizeText.split(/\s*\/\s*/)
      const statusCell=cells[4]
      if(statusCell&&cells.length>=6){
        const dedicated=statusCell.querySelector('.status-text,[class*="goods-status"],[class*="order-status"]')
        const clone=statusCell.cloneNode(true);clone.querySelectorAll('button,a,[role="button"]').forEach(n=>{if(/^(suivre|deja recu|confirmer|voir|contacter|retourner|acheter)/.test(norm(text(n))))n.remove()})
        inheritedStatus=text(dedicated)||text(clone)
      }
      const img=row.querySelector('.img-box img'),src=img?.currentSrc||img?.src||img?.getAttribute('src')||''
      const photo=/^https:\/\/[^/]*ltwebstatic\.com\//.test(src)?src:null
      if(!/^[a-z0-9_-]{1,200}$/i.test(sku)||!Number.isInteger(quantity)||quantity<1||quantity>100||!product_url)return {error:'order_unreadable'}
      items.push({sku,quantity,product_url,title:text(row.querySelector('a.ga-order-goods')),color:parts.length===2?parts[0]:'',size:parts.length===2?parts[1]:'',variant_text:sizeText,unit_price:price(text(cells[3])),status_text:inheritedStatus,photo,eta:text(table.querySelector('.delivery-time-item__message'))})
    }
  }
  if(!items.length||items.length>200)return {error:'order_unreadable'}
  const order_date=date(text(document.querySelector('.order-info li:last-child .order-info-title')))
  // Only labelled shipment facts from a bounded parcel block. Never retain its full text.
  const parcels=[]
  for(const block of document.querySelectorAll('[class*="package"],[class*="parcel"],[class*="logistics"],[class*="tracking"]')) {
    if(!visible(block))continue
    const value=text(block)
    const tracking=value.match(/(?:Num[eé]ro de suivi|N[°º] de suivi|Tracking (?:number|no\.?))\s*[:：]?\s*([A-Z0-9][A-Z0-9 -]{5,39})(?=\s(?:Transporteur|Livraison|Suivre|Carrier)|$)/i)?.[1]?.trim().replace(/\s/g,'')
    if(!tracking||!/[0-9]/.test(tracking)||parcels.some(p=>p.tracking_number===tracking))continue
    const carrier=value.match(/(?:Transporteur|Carrier)\s*[:：]\s*([^:：]{2,50}?)(?=\s(?:Num[eé]ro|N[°º]|Tracking|Livraison|Suivre)|$)/i)?.[1]?.trim()||''
    const skus=[...block.querySelectorAll('[aria-label^="SKU"]')].map(n=>text(n).replace(/^SKU\s*:?\s*/i,''))
    parcels.push({tracking_number:tracking,carrier,skus:[...new Set(skus)],status_text:text(block.querySelector('.status-text')),eta:text(block.querySelector('.delivery-time-item__message'))})
  }
  // Read only an exact labelled summary row, never recommendation prices or payment details.
  const summaryAmount=label=>{
    const values=[...document.querySelectorAll('li')].filter(n=>visible(n)&&label.test(text(n))).map(n=>price(text(n)))
    return values.length===1?values[0]:null
  }
  const total=summaryAmount(/^Total\s*:?[\s\d,.€]+$/i)
  const shipping=summaryAmount(/^Frais de livraison\s*:[\s\d,.€]+$/i)
  const payment=total==null?null:{paid_total:total,shipping,currency:'EUR',source:'order_summary'}
  return {kind:'detail',ref,order_date,items,parcels,payment,sections,section,observed_at}
}
