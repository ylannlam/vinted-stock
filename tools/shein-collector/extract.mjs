// This function is self-contained so the PC can run it against the rendered product DOM.
// It reads the displayed SKU/price, not recommendations, internal APIs, cookies or account data.
export function readSheinPage() {
  const text=document.body?.innerText||''
  const blocked=/\/(?:risk\/challenge|captcha|challenge)(?:\/|$)/i.test(location.pathname||'')
    || /vérifi(?:er|cation).{0,40}(?:humain|sécurité)|je (?:ne )?suis (?:pas )?(?:un robot|humain)|verify (that )?you are human|security verification|not a robot|captcha|accès refusé|access denied/i.test(text+' '+(document.title||'')+' '+location.pathname)
    || [...document.querySelectorAll('iframe')].some(e=>e.getClientRects().length&&/captcha|challenge|verification/i.test([e.title,e.src].join(' ')))
  if(blocked)return {error:'human_check'}
  const url=new URL(location.href),id=url.pathname.match(/-p-(\d{1,20})\.html$/i)?.[1]
  if(url.protocol!=='https:'||!['fr.shein.com','www.shein.com'].includes(url.hostname)||!id)return {error:'page_unavailable'}
  const title=document.querySelector('h1')?.innerText?.trim()||''
  const copy=[...document.querySelectorAll('button')].map(e=>e.getAttribute('aria-label')||'').find(s=>/^Copy SKU /i.test(s))
  const sku=copy?.replace(/^Copy SKU /i,'').trim()||text.match(/\bSKU:\s*([A-Za-z0-9_-]+)/)?.[1]||''
  const priceNode=document.getElementById('productMainPriceId')
  const priceText=(priceNode?.getAttribute('aria-label')||priceNode?.innerText||'').trim()
  const price=priceText.replace(/\s|\u00a0|\u202f/g,'').replace(/€|EUR/gi,'').replace(',','.')
  if(!title||!sku)return {error:'page_unavailable'}
  if(!/€|EUR/i.test(priceText)||!/^\d{1,5}(\.\d{1,2})?$/.test(price)||Number(price)<=0)return {error:'price_unreadable'}
  const descriptionButton=[...document.querySelectorAll('button')].find(e=>e.innerText.trim().startsWith('Description')&&e.getAttribute('aria-expanded')==='true')
  const descriptionRegion=descriptionButton?.parentElement?.querySelector('[role="group"][aria-label="Description"]')
  const description=descriptionRegion?.innerText?.trim().slice(0,20000)||''
  const details=[]
  for(const item of descriptionRegion?.querySelectorAll('[role="listitem"]')||[]) {
    const nameNode=item.querySelector('.product-intro__attr-list-textname'),valueNode=item.querySelector('.product-intro__attr-list-textval')
    // Shein uses display:contents on the row; visibility belongs to its cells.
    if(!nameNode?.getClientRects().length||!valueNode?.getClientRects().length)continue
    const name=nameNode.innerText?.trim().replace(/:\s*$/,'')
    const value=valueNode.innerText?.trim()
    if(name&&value&&name!=='SKU')details.push({name:name.slice(0,100),value:value.slice(0,1000)})
  }
  const colors=document.querySelector('[role="radiogroup"][aria-label="Color options"]')
    || [...document.querySelectorAll('[role="radiogroup"]')].find(e=>/^(?:couleurs?|colou?rs?(?: options)?)$/i.test(e.getAttribute('aria-label')||''))
  const selectedColor=colors?.querySelector('[aria-checked="true"]')
  let color=(selectedColor?.getAttribute('aria-label')||selectedColor?.innerText||'').trim()
  if(!color) {
    // Single-color products may have no swatches. Read an explicit, visible color heading;
    // do not guess from recommendations, descriptions, images or hidden product data.
    const headings=[...document.querySelectorAll('h2,h3,[role="heading"]')].filter(e=>e.getClientRects().length)
    const values=headings.map(e=>{
      const label=e.getAttribute('aria-label')?.trim()||''
      return label.match(/^(?:couleur|colou?r)\s*[:：]?\s+(.{1,100})$/i)?.[1]
        || e.innerText?.trim().match(/^(?:couleur|colou?r)\s*[:：]\s*([^\n]{1,100})$/i)?.[1]||''
    }).map(s=>s.trim()).filter(Boolean)
    const unique=[...new Set(values)]
    if(unique.length===1)color=unique[0]
  }
  if(!color) {
    const values=[...new Set(details.filter(d=>/^(?:couleur|colou?r)$/i.test(d.name)).map(d=>d.value))]
    if(values.length===1)color=values[0]
  }
  const sizeGroup=document.querySelector('[role="radiogroup"][aria-label="Taille"]')||document.querySelector('[role="radiogroup"][aria-label="Size"]')
  const selectedSize=sizeGroup?.querySelector?.('[aria-checked="true"]')
  const sizes=[...(sizeGroup?.querySelectorAll('[role="radio"]')||[])].map(e=>({size:e.getAttribute('aria-label')||e.innerText.trim(),availability:e.getAttribute('aria-disabled')==='true'?'unavailable':e.getAttribute('aria-disabled')==='false'?'available':'unknown'}))
  const photos=new Map()
  for(const img of document.querySelectorAll('img')) {
    if(!img.alt?.startsWith(title)||!img.alt.includes(` - ${color} - `))continue
    const src=img.currentSrc||img.src
    if(!/^https:\/\//.test(src))continue
    const key=src.replace(/_thumbnail_[^/.]+(?=\.)/,'')
    if(!photos.has(key)||/_900x|_1200x/.test(src))photos.set(key,src)
  }
  const measures=[...document.querySelectorAll('[role="group"]')].find(e=>e.getClientRects().length&&/^(?:tailles?\s*(?:&|et)\s*mesures?|size\s*(?:&|and)\s*fit)$/i.test(e.getAttribute('aria-label')||''))
  const unit=measures?.querySelector('.bsc-size-unit-switch .unit-active')?.innerText?.trim()
  if(unit)details.push({name:'Unité des mesures',value:unit.slice(0,20)})
  for(const table of measures?.querySelectorAll('table')||[]) {
    if(!table.getClientRects().length)continue
    const rows=[...table.querySelectorAll('tr')].map(row=>[...row.querySelectorAll('th,td')].map(c=>c.innerText.trim()))
    if(!rows.length||rows.length>50)continue
    if(!table.querySelector('th,thead')&&rows.every(row=>row.length===2)) {
      for(const row of rows)details.push({name:row[0].slice(0,100),value:row[1].slice(0,1000)})
    } else {
      const name=rows[0].join(' · ').slice(0,100)
      for(const row of rows.slice(1))details.push({name,value:row.join(' · ').slice(0,1000)})
    }
  }
  return {supplier_url:`https://${url.hostname}${url.pathname}`,supplier_sku:sku,title:title.slice(0,500),price,price_text:priceText,
    currency:'EUR',color,selected_size:selectedSize?.getAttribute('aria-label')||selectedSize?.innerText||'',photos:[...photos.values()].slice(0,15),sizes,description,details:details.slice(0,50),observed_at:new Date().toISOString()}
}

export function readSheinSearch() {
  if(/\/(?:risk\/challenge|captcha|challenge)(?:\/|$)/i.test(typeof location==='undefined'?'':location.pathname||'')
    || /vérifi(?:er|cation).{0,40}(?:humain|sécurité)|je (?:ne )?suis (?:pas )?(?:un robot|humain)|verify (that )?you are human|security verification|not a robot|captcha|accès refusé|access denied/i.test((document.body?.innerText||'')+' '+(document.title||''))
    || [...document.querySelectorAll('iframe')].some(e=>e.getClientRects?.().length&&/captcha|challenge|verification/i.test([e.title,e.src].join(' '))))return {error:'human_check',urls:[]}
  const urls=[]
  for(const link of document.querySelectorAll('a[href]')) {
    try {const u=new URL(link.href);if(u.protocol==='https:'&&['fr.shein.com','www.shein.com'].includes(u.hostname)&&/-p-\d{1,20}\.html$/i.test(u.pathname))urls.push(`${u.origin}${u.pathname}`)}catch{}
  }
  return {urls:[...new Set(urls)].slice(0,5)}
}
