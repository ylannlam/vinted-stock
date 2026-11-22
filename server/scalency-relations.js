import {remoteId,ScalencyError} from './scalency-api.js'

const checked=r=>{if(r.error)throw r.error;return r.data}
const inventory='scalency_catalog_inventory'
const entries='scalency_order_products'
const physical='scalency_physical_catalog'
const products='scalency_product_library'
const records='scalency_records'
const asText=x=>String(x??'')
const stockName=i=>[i.category,i.size,i.emplacement].filter(Boolean).join(' · ')||'Pièce du stock'
const distinct=rows=>[...new Map(rows.map(row=>[row.route+'?'+new URLSearchParams(row.params),row])).values()]
const link=(route,params,label,group)=>({route,params,label,group})
const adLink=a=>link('dressing',{id:a.remote_id,account:a.account},a.payload?.title||a.remote_id,'Annonces')
const stockLink=i=>link('stock',{piece:i.id},stockName(i),'Pièces physiques')
const saleLink=e=>link('ventes',{id:e.order_id,account:e.login},e.order_title||e.order_id,'Ventes')
const productLink=p=>link('catalogue',{product:p.id},p.title||'Fiche fournisseur','Catalogue')
const draftLink=d=>link('annonces',{draft:d.id},d.fields?.title||d.fields?.sku||'Fiche annonce','Fiches du site')
const accountLink=a=>link('comptes',{id:a.remote_id},a.payload.login,'Compte Vinted')
async function accountOf(db,id,login){
  const q=db.from(records).select('remote_id,payload').eq('kind','accounts')
  return checked(await (login?q.eq('payload->>login',login):q.eq('remote_id',id)).limit(1).maybeSingle())
}
async function listed(db,id,account){
  if(!id||!account)return null
  return checked(await db.from(inventory).select('*').eq('remote_id',id).eq('account',account).maybeSingle())
}
async function stockOf(db,id){
  return id?checked(await db.from(physical).select('*').eq('id',id).maybeSingle()):null
}
export async function catalogProduct(db,id){
  const row=checked(await db.from(products).select('*').eq('id',remoteId(id)).maybeSingle())
  if(!row)throw new ScalencyError('Fiche fournisseur introuvable.',404)
  return row
}
export async function draftSource(db,stockId,productId,sku){
  const stock=stockId?await stockOf(db,remoteId(stockId)):null
  if(stockId&&!stock)throw new ScalencyError('Pièce du stock introuvable.',404)
  if(stock&&stock.status!=='en_stock')throw new ScalencyError('Cette pièce ne figure plus dans le stock disponible.',409)
  if(stock){
    const sold=checked(await db.from('scalency_inventory').select('remote_id').eq('item_id',stock.id).eq('linked_sale',true).limit(1))
    if(sold.length)throw new ScalencyError('Une annonce associée à cette pièce est déjà vendue.',409)
  }
  let id=productId?remoteId(productId):stock?.product_id
  if(stock?.product_id&&id!==stock.product_id)throw new ScalencyError('La fiche et la pièce correspondent à deux références différentes.',409)
  if(!id&&sku){const key=checked(await db.from('scalency_product_keys').select('product_id').eq('sku',String(sku).trim().toLowerCase()).maybeSingle());id=key?.product_id}
  const product=id?await catalogProduct(db,id):null
  if(stock?.supplier_id&&product&&stock.supplier_id!==product.supplier_id)throw new ScalencyError('Les références fournisseur ne correspondent pas.',409)
  if(sku&&product){
    const key=checked(await db.from('scalency_product_keys').select('product_id').eq('sku',String(sku).trim().toLowerCase()).maybeSingle())
    if(key&&key.product_id!==product.id)throw new ScalencyError('Le SKU appartient à une autre fiche fournisseur.',409)
  }
  return {stock,product}
}
export async function connectedRecords(db,user,role,q){
  const kind=q.entity,id=kind==='archive'?String(q.id||'').slice(0,180):remoteId(q.id)
  const account=q.account?(['orders','archive'].includes(kind)?String(q.account).slice(0,180):remoteId(q.account)):null,admin=role==='admin'
  const links=[],suggestions=[]
  function add(...rows){links.push(...rows.filter(Boolean))}
  async function addProduct(productId){
    if(productId){const p=await catalogProduct(db,productId);add(productLink(p))}
  }
  async function addListings(rows){
    for(const r of rows)if(r.listing&&r.account_id){const a=await listed(db,r.listing,r.account_id);if(a)add(adLink(a))}
  }
  if(kind==='accounts'&&admin){
    const a=await accountOf(db,id)
    if(a)for(const [route,code,label] of [['dressing',id,'Annonces du compte'],['ventes',a.payload.login,'Ventes du compte'],['messages',id,'Conversations du compte'],['publication',id,'Actions du compte']])add(link(route,{account:code,login:a.payload.login},label,'Ce compte'))
  }else if(kind==='items'){
    const a=await listed(db,id,account)
    if(!a)return {links,suggestions}
    const [acct,orders,stock,drafts,jobs,threads]=await Promise.all([
      admin?accountOf(db,account):null,
      db.from(entries).select('order_id,login,order_title').eq('listing',id).eq('account_id',account).order('order_date',{ascending:false}),
      stockOf(db,a.item_id),
      admin?db.from('listing_drafts').select('id,state,fields').eq('owner_id',user.id).eq('vinted_id',id).eq('fields->>account_id',account):null,
      admin?db.from(records).select('remote_id,payload').eq('kind','jobs').eq('account',account).or('payload->>item_id.eq.'+id+',payload->>new_item_id.eq.'+id).order('sort_at',{ascending:false}).limit(30):null,
      admin?db.from('scalency_thread_items').select('thread').eq('account',account).eq('listing',id).limit(30):null])
    if(acct)add(accountLink(acct))
    if(stock)add(stockLink(stock))
    await addProduct(a.product_id)
    add(...checked(orders).map(saleLink))
    if(drafts)add(...checked(drafts).map(draftLink))
    if(jobs)add(...checked(jobs).map(j=>link('publication',{id:j.remote_id,account},j.payload.type_label+' · '+(j.payload.status_label||j.payload.status),'Publication')))
    if(threads)add(...checked(threads).map(t=>link('messages',{id:t.thread,account},'Conversation '+t.thread,'Messagerie')))
    if(a.item_id){
      const others=checked(await db.from(inventory).select('remote_id,account,payload').eq('item_id',a.item_id))
      add(...others.filter(o=>o.remote_id!==id||o.account!==account).map(adLink))
    }else if(a.supplier_id&&a.payload.status==='active'&&a.payload.sold===false){
      const candidates=checked(await db.from(physical).select('id,category,size,emplacement,photo_url').eq('status','en_stock').eq('supplier_id',a.supplier_id).order('emplacement'))
      suggestions.push(...candidates.filter(i=>!a.listed_size||asText(i.size).trim().toLowerCase()===a.listed_size.trim().toLowerCase()))
    }
  }else if(kind==='orders'){
    let order=db.from(records).select('account,payload').eq('kind','orders').eq('remote_id',id)
    if(account)order=order.eq('account',account)
    const r=checked(await order.maybeSingle())
    if(!r)return {links,suggestions}
    const lines=checked(await db.from(entries).select('*').eq('order_id',id).eq('login',r.account))
    if(admin){const a=await accountOf(db,null,r.account);if(a)add(accountLink(a))}
    await addListings(lines)
    for(const pid of new Set(lines.map(l=>l.product_id).filter(Boolean)))await addProduct(pid)
    for(const line of lines){
      if(line.archive_line)add(link('ventes',{filter:'archive',id:line.archive_line},'Vente historique · '+(line.sku||line.archive_line),'Historique'))
      if(line.listing&&line.account_id){const a=await listed(db,line.listing,line.account_id);if(a?.item_id){const stock=await stockOf(db,a.item_id);if(stock)add(stockLink(stock))}}
    }
  }else if(kind==='archive'){
    const rows=checked(await db.from(entries).select('order_id,login,order_title').eq('archive_line',id))
    add(...rows.map(saleLink))
  }else if(kind==='jobs'&&admin){
    const r=checked(await db.from(records).select('payload').eq('kind','jobs').eq('account',account).eq('remote_id',id).maybeSingle())
    if(r){const a=await accountOf(db,account);if(a)add(accountLink(a));await addListings([...new Set([r.payload.item_id,r.payload.new_item_id].filter(Boolean))].map(listing=>({account_id:account,listing})))}
    const drafts=checked(await db.from('listing_drafts').select('id,state,fields').eq('owner_id',user.id).eq('fields->>account_id',account).eq('payload->>scalency_job_id',id))
    add(...drafts.map(draftLink))
  }else if(kind==='draft'&&admin){
    const d=checked(await db.from('listing_drafts').select('fields,vinted_id,stock_item_id,catalog_product_id,job:payload->>scalency_job_id').eq('id',id).eq('owner_id',user.id).maybeSingle())
    if(d){
      if(d.fields.account_id){const a=await accountOf(db,d.fields.account_id);if(a)add(accountLink(a))}
      await addListings([{listing:d.vinted_id,account_id:d.fields.account_id}])
      if(d.job)add(link('publication',{id:d.job,account:d.fields.account_id},'Suivre la publication','Publication'))
      if(d.stock_item_id){const s=await stockOf(db,d.stock_item_id);if(s)add(stockLink(s))}
      await addProduct(d.catalog_product_id)
    }
  }else if(kind==='conversations'&&admin){
    const a=await accountOf(db,account);if(a)add(accountLink(a))
    const assoc=checked(await db.from('scalency_thread_items').select('listing').eq('account',account).eq('thread',id).maybeSingle())
    if(assoc)await addListings([{listing:assoc.listing,account_id:account}])
  }else if(kind==='stock'||kind==='product'){
    const isStock=kind==='stock',stock=isStock?await stockOf(db,id):null
    if(isStock&&!stock)return {links,suggestions}
    const productId=isStock?stock.product_id:id
    const rows=checked(await db.from(inventory).select('remote_id,account,payload,linked_sale').eq(isStock?'item_id':'product_id',id))
    add(...rows.map(adLink))
    if(isStock){
      await addProduct(productId)
      for(const a of rows){
        const sales=checked(await db.from(entries).select('order_id,login,order_title').eq('listing',a.remote_id).eq('account_id',a.account))
        add(...sales.map(saleLink))
      }
    }
    else{
      const units=checked(await db.from(physical).select('id,category,size,emplacement').eq('product_id',id).eq('status','en_stock').order('emplacement'))
      add(...units.map(stockLink))
      const sales=checked(await db.from(entries).select('order_id,login,order_title').eq('product_id',id).order('order_date',{ascending:false}).limit(30))
      add(...sales.map(saleLink))
    }
    if(admin){
      let drafts=db.from('listing_drafts').select('id,state,fields').eq('owner_id',user.id).eq('state','draft')
      if(isStock)drafts=drafts.eq('stock_item_id',id)
      else drafts=drafts.eq('catalog_product_id',id)
      add(...checked(await drafts).map(draftLink))
      if(!isStock||(stock.status==='en_stock'&&!rows.some(r=>r.linked_sale)))add(link('annonces',isStock?{piece:id}:{product:id},'Préparer une annonce','Publication'))
    }
  }
  return {links:distinct(links),suggestions}
}
