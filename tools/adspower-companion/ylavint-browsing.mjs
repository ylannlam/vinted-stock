// These snapshots read only elements rendered by the Vinted page.
export function renderedListing(){
 const shown=e=>!!e&&!!e.getClientRects().length&&getComputedStyle(e).visibility!=='hidden'&&getComputedStyle(e).display!=='none'
 const all=s=>[...document.querySelectorAll(s)].filter(shown),txt=e=>e?.innerText?.trim()||''
 const titles=all('[data-testid="item-page-summary-plugin"] h1'),prices=all('[data-testid="item-price"]'),buttons=all('button[data-testid="favourite-button"]')
 const sellers=all('[data-testid="profile-username"]').map(e=>e.closest('a[href]')?.getAttribute('href')).filter(Boolean)
 const button=buttons.length===1?buttons[0]:null
 return {url:location.href,title:titles.length===1?txt(titles[0]):'',price_text:prices.length===1?txt(prices[0]):'',seller:sellers.length===1?sellers[0]:null,
   available:all('button,a').some(e=>/^Acheter(?: maintenant)?$/i.test(txt(e))),favourite:button?.getAttribute('aria-pressed')??null,favourite_ready:!!button&&!button.disabled}
}

export function visibleDraft(){
 const shown=e=>!!e.getClientRects().length&&getComputedStyle(e).visibility!=='hidden'&&getComputedStyle(e).display!=='none'
 return /\/items\/(?:new|\d+\/edit)(?:\/|$)/.test(location.pathname)||[...document.querySelectorAll('textarea,[contenteditable="true"]')].some(e=>shown(e)&&String(e.value??e.innerText??'').trim().length>0)
}

const normalize=v=>String(v||'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase()
export function favouriteMatches(detail,pace,member,id){
 let url,seller
 try{url=new URL(detail.url);seller=new URL(detail.seller,url)}catch{return false}
 if(!detail.seller||url.origin!=='https://www.vinted.fr'||url.pathname.match(/^\/items\/(\d+)(?:-|\/|$)/)?.[1]!==id||seller.origin!==url.origin)return false
 const sellerId=seller.pathname.match(/^\/member\/(\d+)(?:-|\/|$)/)?.[1]
 if(!sellerId||sellerId===String(member)||!detail.available||!detail.favourite_ready||detail.favourite!=='false'||!Number.isFinite(detail.price))return false
 if(detail.price<pace.browse_like_price_min||detail.price>pace.browse_like_price_max)return false
 const title=normalize(detail.title),keywords=normalize(pace.browse_like_keywords).split(',').map(v=>v.trim()).filter(Boolean)
 // Whole words prevent "robe" from matching unrelated words; allow its French plural.
 return keywords.length>0&&keywords.some(word=>new RegExp('(?:^|[^a-z0-9])'+word.replace(/[.*+?^${}()|[\]\\]/g,'\\$&')+(word==='robe'?'s?':'')+'(?:$|[^a-z0-9])').test(title))
}
