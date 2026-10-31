// This function is self-contained so the PC can run it against the rendered product DOM.
// It reads the displayed SKU/price, not recommendations, internal APIs, cookies or account data.
export function readSheinPage() {
  const text=document.body?.innerText||''
  const blocked=/vérifier que vous êtes humain|je suis humain|verify (that )?you are human|security verification/i.test(text)
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
  const colors=document.querySelector('[role="radiogroup"][aria-label="Color options"]')
  const color=colors?.querySelector('[aria-checked="true"]')?.getAttribute('aria-label')||''
  const sizeGroup=document.querySelector('[role="radiogroup"][aria-label="Taille"]')||document.querySelector('[role="radiogroup"][aria-label="Size"]')
  const sizes=[...(sizeGroup?.querySelectorAll('[role="radio"]')||[])].map(e=>({size:e.getAttribute('aria-label')||e.innerText.trim(),availability:e.getAttribute('aria-disabled')==='true'?'unavailable':e.getAttribute('aria-disabled')==='false'?'available':'unknown'}))
  const photos=new Map()
  for(const img of document.querySelectorAll('img')) {
    if(!img.alt?.startsWith(title)||!img.alt.includes(` - ${color} - `))continue
    const src=img.currentSrc||img.src
    if(!/^https:\/\//.test(src))continue
    const key=src.replace(/_thumbnail_[^/.]+(?=\.)/,'')
    if(!photos.has(key)||/_900x|_1200x/.test(src))photos.set(key,src)
  }
  const descriptionButton=[...document.querySelectorAll('button')].find(e=>e.innerText.trim().startsWith('Description')&&e.getAttribute('aria-expanded')==='true')
  const description=descriptionButton?.parentElement?.innerText?.trim().slice(0,20000)||''
  const details=[]
  for(const table of document.querySelectorAll('table')) {
    if(!table.getClientRects().length)continue
    const rows=[...table.querySelectorAll('tr')].map(row=>[...row.querySelectorAll('th,td')].map(c=>c.innerText.trim()))
    if(!rows.length||rows.length>50)continue
    const name=rows[0].join(' · ').slice(0,100)
    for(const row of rows.slice(1))details.push({name,value:row.join(' · ').slice(0,1000)})
  }
  return {supplier_url:`https://${url.hostname}${url.pathname}`,supplier_sku:sku,title:title.slice(0,500),price,price_text:priceText,
    currency:'EUR',color,photos:[...photos.values()].slice(0,15),sizes,description,details:details.slice(0,50),observed_at:new Date().toISOString()}
}

export function readSheinSearch() {
  if(/vérifier que vous êtes humain|je suis humain|verify (that )?you are human|security verification/i.test(document.body?.innerText||''))return {error:'human_check',urls:[]}
  const urls=[]
  for(const link of document.querySelectorAll('a[href]')) {
    try {const u=new URL(link.href);if(u.protocol==='https:'&&['fr.shein.com','www.shein.com'].includes(u.hostname)&&/-p-\d{1,20}\.html$/i.test(u.pathname))urls.push(`${u.origin}${u.pathname}`)}catch{}
  }
  return {urls:[...new Set(urls)].slice(0,5)}
}
