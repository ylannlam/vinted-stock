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
    const months=['janv','fevr','mars','avr','mai','juin','juil','aout','sept','oct','nov','dec']
    const m=norm(value).match(/(\d{1,2})\s+([a-z]+)\.?\s+(20\d{2})/)
    const month=m?months.findIndex(x=>m[2].startsWith(x)):-1
    return month<0?null:`${m[3]}-${String(month+1).padStart(2,'0')}-${m[1].padStart(2,'0')}`
  }
  const price=value=>{const m=value.replace(/\s/g,'').match(/(\d+(?:[,.]\d{2})?)€/);return m?Number(m[1].replace(',','.')):null}
  const safeProduct=value=>{try{const u=new URL(value,url);return u.protocol==='https:'&&['fr.shein.com','www.shein.com'].includes(u.hostname)&&/-p-\d+\.html$/.test(u.pathname)?u.origin+u.pathname:null}catch{return null}}
  const observed_at=new Date().toISOString()
  if(url.pathname==='/user/orders/list') {
    const rows=[...document.querySelectorAll('li.list-item')].filter(n=>n.querySelector('[class*="order-number__"]'))
    if(!rows.length)return {error:document.querySelector('input[type="password"]')?'login_required':'page_unavailable'}
    const orders=rows.map(n=>({ref:text(n.querySelector('[class*="order-number__"]')),order_date:date(text(n.querySelector('.time'))),status_text:text(n.querySelector('.status-text')),total:price(text(n.querySelector('.default-price')))}))
    const next=document.querySelector('nav[aria-label="Pagination Navigation"] [aria-label="Next page"]')
    if(action==='next') {if(!next||next.disabled||next.getAttribute('aria-disabled')==='true')return {error:'no_next_page'};next.click();return {clicked:true}}
    return {kind:'list',orders,has_next:!!next&&!next.disabled&&next.getAttribute('aria-disabled')!=='true',observed_at}
  }
  const ref=url.pathname.match(/^\/user\/orders\/detail\/([A-Z0-9]{8,40})$/)?.[1]
  if(!ref)return {error:'page_unavailable'}
  const shownRef=text(document.querySelector('.order-info-billno .order-info-title'))
  if(shownRef!==ref)return {error:'page_unavailable'}
  if(action==='tracking') {
    const root=document.querySelector('main')||document.querySelector('[role="main"]')
    const target=[...(root||document).querySelectorAll('button,a[role="button"]')].find(n=>visible(n)&&text(n)==='Suivre')
    if(!target)return {error:'tracking_unavailable'}
    target.click();return {clicked:true}
  }
  const items=[]
  for(const table of document.querySelectorAll('table.new-order-table')) {
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
      if(statusCell&&cells.length>=6)inheritedStatus=text(statusCell)
      const img=row.querySelector('.img-box img'),src=img?.currentSrc||img?.src||img?.getAttribute('src')||''
      const photo=/^https:\/\/[^/]*ltwebstatic\.com\//.test(src)?src:null
      if(!/^[a-z0-9_-]{1,200}$/i.test(sku)||!Number.isInteger(quantity)||quantity<1||quantity>100||!product_url)return {error:'order_unreadable'}
      items.push({sku,quantity,product_url,title:text(row.querySelector('a.ga-order-goods')),color:parts.length===2?parts[0]:'',size:parts.length===2?parts[1]:'',variant_text:sizeText,unit_price:price(text(cells[3])),status_text:inheritedStatus,photo,eta:text(table.querySelector('.delivery-time-item__message'))})
    }
  }
  if(!items.length||items.length>200)return {error:'order_unreadable'}
  const order_date=date(text(document.querySelector('.order-info li:last-child .order-info-title')))
  return {kind:'detail',ref,order_date,items,observed_at}
}
