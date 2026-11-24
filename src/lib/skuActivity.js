import {inSalesPeriod} from './shopPeriod.js'
const clean=value=>String(value??'').trim()
const key=value=>clean(value).toLowerCase()
const identity=(...parts)=>JSON.stringify(parts.map(clean))
export const skuFeeds=['comptes','annonces','supprimees','publications','republications','commandes']

export function saleStage(order){
  if(['cancelled','returning','returned','refunded','expired','suspended'].includes(order.state)||
     ['cancelled','returning','returned','refunded','expired','suspended'].includes(order.status))return null
  if(order.status==='completed')return 'completed'
  if(['payment_received','label_sent','packed','shipped','ready_for_pickup','delivered'].includes(order.status)||
     ['ready','to_order','to_pack','to_ship','shipped','preparing','to_prepare','waiting'].includes(order.state))return 'pending'
  return null
}

export function buildSkuActivity(feeds,references={},accountFilter='',periodOnly=false){
  const accounts=new Map(feeds.comptes.map(r=>[clean(r.id),clean(r.login)||clean(r.id)]))
  const login=id=>accounts.get(clean(id))||clean(id)
  const ads=new Map(),connections=[],sales=[],emptyOrders=[]
  const manual=new Map((references.manual||[]).map(r=>[identity(r.kind,key(r.account),r.id,r.line),r.sku]))
  function listing(account,id,title){
    if(!account||!id)return null
    const owner=login(account),k=identity(key(owner),id)
    if(!ads.has(k))ads.set(k,{id:clean(id),account:owner,title:'',status:'historique',skus:new Map()})
    const row=ads.get(k)
    if(!row.title&&title)row.title=title
    return row
  }
  function evidence(row,sku){if(row&&clean(sku))row.skus.set(key(sku),clean(sku))}
  for(const r of [...feeds.annonces,...feeds.supprimees]){
    const a=listing(r.account,r.id,r.title)
    if(!a)continue
    a.status=r.sold?'vendue':r.hidden||r.status==='hidden'?'masquée':r.status==='active'?'en ligne':r.status==='deleted'?'supprimée':'inactive'
    a.dressingSold=r.sold===true
    Object.assign(a,{inventory:r.inventory,accountId:r.accountId,photo:r.photo,price:r.price,currency:r.currency,views:r.views,favourites:r.favourites,
      published:r.published,estimated:false,age:r.age,seen:r.seen,size:r.size,location:r.location})
    if(r.sku)a.postedSku=clean(r.sku)
    evidence(a,r.sku)
    if(r.replaced)connections.push([a,listing(r.account,r.replaced)])
    if(r.saleState){a.saleState=r.saleState;a.soldAt=r.soldAt;a.transaction=r.transaction}
  }
  for(const r of [...feeds.publications,...feeds.republications,...(references.drafts||[])]){
    const a=listing(r.account,r.id,r.title)
    evidence(a,r.sku)
    if(a&&r.sku&&!a.postedSku)a.postedSku=clean(r.sku)
    if(a&&r.published&&(!a.published||a.estimated&&!r.estimated)){
      a.published=r.published;a.estimated=!!r.estimated
    }
    if(a&&r.previous)connections.push([listing(r.account,r.previous),a])
  }
  for(const r of references.ads||[])evidence(ads.get(identity(key(login(r.account)),r.id)),r.sku)
  const refLines=new Map((references.lines||[]).map(r=>[identity(key(login(r.account)),r.order,r.id),r]))
  const orders=new Map(),matched=new Set(),transactions=new Map()
  for(const a of ads.values())if(a.transaction){
    const k=identity(key(a.account),a.transaction)
    if(!transactions.has(k))transactions.set(k,[])
    transactions.get(k).push(a)
  }
  for(const r of feeds.commandes){
    if(periodOnly&&!inSalesPeriod(r.date))continue
    const k=identity(key(login(r.account)),r.transaction||r.id),older=orders.get(k)
    if(!older||String(r.updated||r.date||'')>String(older.updated||older.date||''))orders.set(k,r)
  }
  for(const [orderKey,r] of orders){
    const stage=saleStage(r),account=login(r.account),seen=new Set(),linked=transactions.get(orderKey)||[]
    let lines=r.lines||[]
    if(!lines.length&&linked.length)lines=linked.map(a=>({listing:a.id,title:a.title,quantity:1}))
    if(!lines.length&&stage)emptyOrders.push({account,id:r.id,title:r.title,date:r.date,stage})
    for(const line of lines){
      if(line.id&&seen.has(clean(line.id)))continue
      if(line.id)seen.add(clean(line.id))
      const ref=refLines.get(identity(key(account),r.id,line.id))
      const ad=listing(account,line.listing||ref?.listing||(lines.length===1&&linked.length===1?linked[0].id:null),line.title||r.title)
      const sku=clean(manual.get(identity('sale',key(account),r.id,line.id)))||clean(line.sku)||clean(ref?.sku)||clean(line.productSku)
      evidence(ad,sku)
      if(ad&&!ad.photo)ad.photo=line.photo
      if(ad){
        matched.add(ad)
        if(!ad.orderInfo||String(r.date||'')>String(ad.orderInfo.date||'')){
          ad.orderInfo={date:r.date,status:r.status,state:r.state,stage}
        }
      }
      if(!stage)continue
      if(ad&&['en ligne','historique','inactive','masquée'].includes(ad.status))ad.status='vendue'
      const qty=Number(line.quantity??1)
      if(!Number.isSafeInteger(qty)||qty<=0)continue
      sales.push({sku,ad,id:r.id,lineId:clean(line.id),listingId:ad?.id,photo:line.photo||ad?.photo,account,title:line.title||r.title,date:r.date,stage,qty})
    }
  }
  for(const a of ads.values()){
    if(!a.saleState||matched.has(a)||a.transaction&&orders.has(identity(key(a.account),a.transaction))||periodOnly&&!inSalesPeriod(a.soldAt))continue
    if(['terminee','en_cours'].includes(a.saleState))
      sales.push({ad:a,id:'',listingId:a.id,photo:a.photo,account:a.account,title:a.title,date:a.soldAt,stage:a.saleState==='terminee'?'completed':'pending',qty:1})
  }
  for(const a of ads.values()){
    const override=manual.get(identity('listing',key(a.account),a.id,''))
    if(override){a.skus=new Map([[key(override),override]]);a.postedSku=override}
  }
  // Reposts can form chains. Transfer a reference only when the whole chain agrees.
  const neighbours=new Map()
  for(const [a,b] of connections)if(a&&b){
    if(a!==b&&a.status==='en ligne')a.status='remplacée'
    if(!neighbours.has(a))neighbours.set(a,[])
    if(!neighbours.has(b))neighbours.set(b,[])
    neighbours.get(a).push(b);neighbours.get(b).push(a)
  }
  const visited=new Set()
  for(const start of neighbours.keys()){
    if(visited.has(start))continue
    const stack=[start],component=[],skus=new Map()
    while(stack.length){
      const a=stack.pop()
      if(visited.has(a))continue
      visited.add(a);component.push(a)
      for(const [k,v] of a.skus)skus.set(k,v)
      for(const next of neighbours.get(a))if(!visited.has(next))stack.push(next)
    }
    if(skus.size===1)for(const a of component)if(!a.skus.size)a.skus=skus
  }
  const groups=new Map(),names=new Set()
  const allowed=account=>{names.add(account);return !accountFilter||key(account)===key(accountFilter)}
  function group(sku){
    const k=key(sku)
    if(!groups.has(k))groups.set(k,{key:k,sku:clean(sku),title:'',published:0,online:0,completed:0,pending:0,lastSale:'',listings:[],sales:[]})
    return groups.get(k)
  }
  const adSku=a=>a?.postedSku||(a?.skus.size===1?[...a.skus.values()][0]:'')
  for(const a of ads.values())if(allowed(a.account)){
    const g=group(adSku(a))
    if(!g.title&&a.title)g.title=a.title
    g.published++
    if(a.status==='en ligne')g.online++
    g.listings.push({id:a.id,title:a.title,account:a.account,status:a.status,dressingSold:a.dressingSold,orderInfo:a.orderInfo,inventory:a.inventory,accountId:a.accountId,photo:a.photo,price:a.price,currency:a.currency,
      size:a.size,location:a.location,views:a.views,favourites:a.favourites,published:a.published,estimated:a.estimated,age:a.age,seen:a.seen})
  }
  for(const {ad,sku,...s} of sales)if(allowed(s.account)){
    const g=group(sku||adSku(ad))
    g[s.stage]+=s.qty;g.sales.push(s)
    if(!g.title&&s.title)g.title=s.title
    if(s.stage==='completed'&&s.date>g.lastSale)g.lastSale=s.date
  }
  return {rows:[...groups.values()],accounts:[...new Set([...names,...emptyOrders.map(x=>x.account)].filter(Boolean))].sort(),
    emptyOrders:emptyOrders.filter(x=>!accountFilter||key(x.account)===key(accountFilter))}
}
