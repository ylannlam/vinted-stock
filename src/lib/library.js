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

// Mesures et caractéristiques Shein utiles à une annonce (jamais inventées).
const MEASURE=/(longueur|tour|buste|poitrine|taille|hanches?|épaules?|epaules?|manches?|cuisses?|entrejambe|largeur|aisselle|cm\b)/i
export function sheinFacts(product) {
  if(!product)return {measures:[],details:[]}
  const details=(Array.isArray(product.details)?product.details:[]).filter(d=>d?.name&&d?.value).map(d=>({name:String(d.name).slice(0,100),value:String(d.value).slice(0,300)}))
  return {measures:details.filter(d=>MEASURE.test(d.name)||/\d\s*cm/i.test(d.value)),details:details.filter(d=>!(MEASURE.test(d.name)||/\d\s*cm/i.test(d.value)))}
}
