// Bibliothèque : catégories, grille tarifaire et regroupement des articles postés sur Dotb.
// Partagé entre le navigateur et l'API (aucune dépendance au DOM).

export const CATEGORIES=[
  ['robe','Robe'],['jupe','Jupe'],['top','Top'],['chemise','Chemise'],['pull','Pull'],['veste','Veste'],
  ['pantalon','Pantalon'],['jean','Jean'],['short','Short'],['combinaison','Combinaison'],['ensemble','Ensemble'],
  ['body','Body'],['maillot','Maillot'],['autre','Autre'],
]
export const categoryLabel=key=>CATEGORIES.find(([k])=>k===key)?.[1]||'Autre'
// Mots-clés des titres Shein / Vinted. Le mot le plus tôt dans le titre l'emporte :
// « Robe chemise » → robe, « Ensemble top et jupe » → ensemble.
const KEYWORDS=[
  ['ensemble',/\b(ensembles?|co-?ord|2 pi[eè]ces|deux pi[eè]ces|tailleur)\b/],
  ['combinaison',/\b(combinaisons?|combi-?shorts?|combishorts?|salopettes?|jumpsuits?|rompers?)\b/],
  ['robe',/\b(robes?|dress(es)?)\b/],
  ['jupe',/\b(jupes?|skirts?)\b/],
  ['body',/\b(bodys?|bodies|bodysuits?)\b/],
  ['maillot',/\b(maillots?|bikinis?|monokinis?|swimsuits?)\b/],
  ['jean',/\b(jeans?|denim)\b/],
  ['short',/\b(shorts?|bermudas?)\b/],
  ['pantalon',/\b(pantalons?|pants|trousers|leggings?|joggers?|jogging)\b/],
  ['veste',/\b(vestes?|manteaux?|manteau|blazers?|blousons?|doudounes?|trench|parkas?|jackets?|coats?)\b/],
  ['pull',/\b(pulls?|pull-over|sweats?|sweat-shirts?|cardigans?|gilets?|sweaters?|hoodies?)\b/],
  ['chemise',/\b(chemises?|chemisiers?|blouses?|shirts?)\b/],
  ['top',/\b(tops?|t-shirts?|tee-shirts?|tees?|d[ée]bardeurs?|crop|bustiers?|corsets?|camisoles?|brassi[eè]res?)\b/],
]
export function guessCategory(title='') {
  const text=String(title).toLowerCase()
  let best=null
  for(const [key,re] of KEYWORDS){const m=re.exec(text);if(m&&(!best||m.index<best.index))best={key,index:m.index}}
  return best?.key||'autre'
}
export const productCategory=p=>p?.category||guessCategory(p?.title)

// Grille : « jusqu'à X € Shein → Y € de vente », puis « au-delà : × coefficient » (facultatif).
export function validatePricing(input) {
  if(!input||typeof input!=='object'||!Array.isArray(input.tiers)||input.tiers.length>20)throw Error('Grille tarifaire invalide (20 paliers au maximum).')
  const number=(v,label,min,max)=>{const n=Number(String(v??'').replace(',','.'));if(!Number.isFinite(n)||n<=min||n>max)throw Error(`${label} invalide.`);return Math.round(n*100)/100}
  const tiers=input.tiers.map(t=>({max:number(t?.max,'Prix Shein du palier',0,10000),price:number(t?.price,'Prix de vente du palier',0,100000)})).sort((a,b)=>a.max-b.max)
  if(new Set(tiers.map(t=>t.max)).size!==tiers.length)throw Error('Deux paliers ont le même prix Shein.')
  const above=input.above===null||input.above===''||input.above===undefined?null:number(input.above,'Coefficient au-delà du dernier palier',0,100)
  return {tiers,above}
}
// Prix de vente conseillé (euros entiers) ; null si la grille ne couvre pas ce prix.
export function gridPrice(sheinPrice,pricing) {
  const price=Number(sheinPrice)
  if(!Number.isFinite(price)||price<=0||!pricing)return null
  const tier=(pricing.tiers||[]).find(t=>price<=t.max)
  if(tier)return tier.price
  return pricing.above?Math.round(price*pricing.above):null
}
export function salePriceOf(product,pricing) {
  if(product?.sale_price!=null)return {price:Number(product.sale_price),manual:true}
  const price=gridPrice(product?.price,pricing)
  return price==null?null:{price,manual:false}
}

// Articles Dotb présents, regroupés par SKU, sans ceux déjà vendus (ils sont dans « Vendus »).
export function groupPosted(posted=[],{products=[],links=[],sales=[]}={}) {
  const sold=new Set(sales.map(s=>String(s.sku).toLowerCase()))
  const groups=new Map()
  for(const item of posted) {
    const key=String(item.sku||'').toLowerCase()
    if(!key||sold.has(key))continue
    if(!groups.has(key))groups.set(key,{sku:item.sku,items:[]})
    groups.get(key).items.push(item)
  }
  return [...groups.values()].map(g=>{
    const link=links.find(l=>String(l.sku).toLowerCase()===g.sku.toLowerCase())
    const product=products.find(p=>p.id===link?.product_id)||products.find(p=>String(p.supplier_sku||'').toLowerCase()===g.sku.toLowerCase())||null
    const prices=[...new Set(g.items.map(i=>i.price).filter(v=>v!=null).map(Number))].sort((a,b)=>a-b)
    const latest=[...g.items].sort((a,b)=>String(b.synced_at).localeCompare(String(a.synced_at)))[0]
    return {...g,product,prices,title:product?.title||latest.title||g.sku,photo_url:latest.photo_url||product?.photo_url||null,
      accounts:[...new Set(g.items.map(i=>i.account_login).filter(Boolean))],supplier_url:product?.supplier_url||g.items.find(i=>i.supplier_url)?.supplier_url||null}
  })
}
const STATUS={pending:'En attente',draft:'Brouillon',scheduled:'Programmé',published:'En ligne',active:'En ligne',online:'En ligne',sold:'Vendu',reserved:'Réservé',hidden:'Masqué',error:'Erreur',failed:'Erreur'}
export const postedStatus=s=>STATUS[s]||s||'Inconnu'

// Guide des tailles Shein lu par le PC : lignes « FR · Taille · Tour de poitrine · … » → « 36 · S · 88 · … ».
// Le nom est coupé à 100 caractères : la dernière colonne d'un en-tête plus court que ses valeurs est ignorée.
const SIZE_COLUMNS=/^(fr|eu|uk|us|it|de|es|taille|size|tailles)$/i
const clean=v=>String(v).trim().replace(/(\d+)\.0\b/g,'$1')
export function sizeChart(product) {
  const rows=[],details=Array.isArray(product?.details)?product.details:[]
  const unit=details.find(d=>/unit[ée] des mesures/i.test(d?.name||''))?.value?.trim().toLowerCase()||'cm'
  for(const d of details) {
    const head=String(d?.name||'').split(' · ').map(x=>x.trim()),values=String(d?.value||'').split(' · ').map(x=>x.trim())
    if(head.length<3||values.length<3||!head.some(h=>/^(taille|size)$/i.test(h)))continue
    const usable=head.length<values.length?head.slice(0,-1):head
    const labels={},measures=[]
    usable.forEach((h,i)=>{if(values[i]===undefined||values[i]==='')return;if(SIZE_COLUMNS.test(h))labels[h.toLowerCase()]=values[i];else measures.push({name:h,value:`${clean(values[i])} ${unit}`})})
    rows.push({labels,measures})
  }
  return rows
}
const sizeTokens=text=>String(text||'').toUpperCase().replace(/TAILLE/g,' ').match(/[A-Z0-9]+(?:\/[A-Z0-9]+)?/g)||[]
export function measuresForSize(product,size) {
  const wanted=sizeTokens(size)
  if(!wanted.length)return []
  const matches=sizeChart(product).filter(r=>Object.values(r.labels).some(v=>sizeTokens(v).some(t=>wanted.includes(t))))
  // Plusieurs guides (ex. haut et bas d'un ensemble) : leurs mesures s'additionnent, sans doublon.
  const seen=new Set()
  return matches.flatMap(r=>r.measures).filter(m=>!seen.has(m.name.toLowerCase())&&seen.add(m.name.toLowerCase()))
}
// Caractéristiques utiles à la rédaction (le guide des tailles et le marketing Shein sont retirés).
const NOT_FOR_LISTING=/^(festivals|unit[ée] des mesures|instructions d'entretien|origine|type)$/i
export function listingFacts(product,size) {
  if(!product)return null
  const details=(Array.isArray(product.details)?product.details:[]).filter(d=>d?.name&&d?.value&&!d.name.includes(' · ')&&!NOT_FOR_LISTING.test(d.name.trim()))
    .map(d=>({name:String(d.name).slice(0,100),value:String(d.value).slice(0,300)}))
  return {title:String(product.title||'').slice(0,300),details,measures:measuresForSize(product,size),size:String(size||'').trim()}
}
export function measuresBlock(facts) {
  if(!facts?.measures?.length)return ''
  return [`Mesures${facts.size?` (taille ${facts.size})`:''} :`,...facts.measures.map(m=>`– ${m.name} : ${m.value}`)].join('\n')
}
// Le bloc des mesures se place avant la ligne « Mots-clés » si elle existe.
export function withMeasures(description,facts) {
  const block=measuresBlock(facts),text=String(description||'').trim()
  if(!block)return text
  const lines=text.split('\n'),at=lines.findIndex(l=>/^mots-cl[ée]s\s*:/i.test(l.trim()))
  if(at<0)return `${text}\n\n${block}`
  return [...lines.slice(0,at),block,'',...lines.slice(at)].join('\n').replace(/\n{3,}/g,'\n\n')
}

// Meilleures ventes : ventes regroupées par SKU sur la période (jours, ou null pour tout), les plus vendus d'abord.
export function bestSellers({items=[],products=[],links=[],sales=[]}={},{days=30,now=Date.now()}={}) {
  const since=days?now-days*86400000:-Infinity,groups=new Map()
  // Depuis le début : le total par SKU calculé par la base (toutes devises), complété par la dernière vente connue.
  if(!days)for(const s of sales){
    const sku=String(s.sku||'').trim();if(!sku)continue
    const key=sku.toLowerCase(),g=groups.get(key)||{sku,count:0,revenue:0,priced:0,last:0,photo:null,title:'',total:true}
    g.count+=Number(s.quantity)||0;g.revenue+=Number(s.revenue)||0;g.priced+=Number(s.known_prices)||0;g.last=Math.max(g.last,Date.parse(s.last_sale)||0)
    groups.set(key,g)
  }
  for(const item of items) {
    const sku=String(item.sku||'').trim(),at=Date.parse(item.sold_at)
    if(!sku||!(at>=since))continue
    const key=sku.toLowerCase(),g=groups.get(key)||{sku,count:0,revenue:0,priced:0,last:0,photo:null,title:''}
    if(!g.total){g.count++;if(item.price!=null&&Number.isFinite(Number(item.price))){g.revenue+=Number(item.price);g.priced++}}
    if(at>=g.last||!g.photo){g.last=Math.max(g.last,at);g.photo=item.photo_url||g.photo;g.title=item.title||g.title}
    groups.set(key,g)
  }
  const bySku=new Map(links.map(l=>[String(l.sku).toLowerCase(),l.product_id]))
  return [...groups.entries()].map(([key,g])=>{
    const product=products.find(p=>p.id===bySku.get(key))||products.find(p=>String(p.supplier_sku||'').toLowerCase()===key)||null
    return {...g,product,photo:product?.photo_url||g.photo,title:product?.title||g.title||g.sku}
  }).sort((a,b)=>b.count-a.count||b.last-a.last)
}
