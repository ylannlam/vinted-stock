import {saleStage} from './skuActivity.js'

export const statusLabels={
  all:'Toutes',live:'En ligne',sold:'Vendues',hidden:'Masquées',draft:'Brouillons',offline:'Hors ligne',unknown:'À vérifier'
}
const listingStates={'en ligne':'live',vendue:'sold',masquée:'hidden',brouillon:'draft',supprimée:'offline',inactive:'offline',remplacée:'offline',historique:'unknown'}
const strip=value=>String(value??'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().trim()
const timestamp=value=>Number.isFinite(Date.parse(value))?Date.parse(value):0
const labelDate=new Intl.DateTimeFormat('fr-FR',{day:'numeric',month:'short',year:'numeric',timeZone:'Europe/Paris'})
export const calendar=value=>timestamp(value)?labelDate.format(new Date(value)):'—'
export function price(amount,currency='EUR'){
  if(amount==null||amount===''||!Number.isFinite(Number(amount)))return '—'
  try{return new Intl.NumberFormat('fr-FR',{style:'currency',currency:currency||'EUR'}).format(Number(amount))}
  catch{return [amount,currency].filter(Boolean).join(' ')}
}
export const recordKey=r=>JSON.stringify([r.isDraft?'draft':'item',r.account,r.id])
export function textMatch(row,search){
  const haystack=strip([row.sku,row.title,row.account,row.id,...(row.lines||[]).flatMap(i=>[i.title,i.sku,i.location])].join(' '))
  return strip(search).split(/\s+/).every(word=>haystack.includes(word))
}

export function listingRows(board){
  const rows=[]
  for(const group of board.groups)for(const r of group.listings){
    const calculated=r.age!=null&&Number.isFinite(+r.age)&&+r.age>=0&&timestamp(r.seen)?new Date(timestamp(r.seen)-Number(r.age)*86400000).toISOString():null
    rows.push({...r,sku:group.sku,state:listingStates[r.status]||'unknown',date:r.published||calculated,approx:r.estimated||(!r.published&&!!calculated)})
  }
  for(const r of board.drafts)rows.push({...r,state:'draft',date:r.seen,approx:false})
  return rows
}
export function sortListings(rows,sort){
  const value=r=>sort==='likes'?Number(r.favourites??-1):sort==='views'?Number(r.views??-1):sort==='price'?Number(r.price??-1):timestamp(r.date)
  return [...rows].sort((a,b)=>value(b)-value(a)||timestamp(b.date)-timestamp(a.date)||String(a.id).localeCompare(String(b.id)))
}
export function performanceRows(groups,account){
  const rows=[]
  for(const g of groups){
    const listings=g.listings.filter(r=>!account||r.account===account),sales=g.sales.filter(r=>!account||r.account===account)
    if(!listings.length&&!sales.length)continue
    const completed=sales.filter(s=>s.stage==='completed').reduce((n,s)=>n+s.qty,0)
    const pending=sales.filter(s=>s.stage==='pending').reduce((n,s)=>n+s.qty,0)
    const lastSale=sales.reduce((latest,sale)=>timestamp(sale.date)>timestamp(latest)?sale.date:latest,null)
    const lead=listings.find(r=>r.photo)||sales.find(r=>r.photo)
    const likes=listings.filter(r=>r.favourites!=null)
    rows.push({...g,photo:lead?.photo,title:lead?.title||listings[0]?.title||sales[0]?.title||g.title,listings,sales,
      published:listings.length,online:listings.filter(r=>r.status==='en ligne').length,favourites:likes.length?likes.reduce((n,r)=>n+Number(r.favourites),0):null,
      sold:completed+pending,completed,pending,lastSale})
  }
  return rows
}
export function saleBucket(row){
  if(!saleStage({status:row.status,state:row.state}))return ['cancelled','refunded','returned','returning','expired','suspended'].some(s=>[row.status,row.state].includes(s))?'closed':'other'
  if(row.status==='completed')return 'complete'
  if(['shipped','delivered','ready_for_pickup'].includes(row.status)||row.state==='shipped')return 'transit'
  return 'dispatch'
}
export const printableLabel=row=>saleBucket(row)==='dispatch'&&row.hasLabel
export const salesLabels={dispatch:'À expédier',transit:'En livraison',complete:'Terminées',closed:'Annulées et incidents',other:'Autres',all:'Toutes'}
export function sortSales(rows,sort){
  const missing=Number.MAX_SAFE_INTEGER
  return [...rows].sort((a,b)=>sort==='due'?((timestamp(a.deadline)||missing)-(timestamp(b.deadline)||missing)||timestamp(b.date)-timestamp(a.date)):
    sort==='amount'?(Number(b.amount??-1)-Number(a.amount??-1)||timestamp(b.date)-timestamp(a.date)):timestamp(b.date)-timestamp(a.date))
}
