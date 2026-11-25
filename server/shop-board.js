import {readBoardRows} from './team-board.js'
import {skuReferences,skuSourceRows} from './scalency-sku.js'
import {buildSkuActivity} from '../src/lib/skuActivity.js'
import {inSalesPeriod,salesStart} from '../src/lib/shopPeriod.js'
import {ASSET_BUCKET,ownedAsset} from './resources.js'

const check=result=>{if(result.error)throw result.error;return result.data}
const identity=(...parts)=>JSON.stringify(parts.map(v=>String(v??'').toLowerCase()))
const safePhoto=url=>typeof url==='string'&&/^https:\/\//i.test(url)?url:null
function all(db,table,columns,configure,keys){
  return readBoardRows(()=>{
    let q=configure(db.from(table).select(columns,{count:'exact'}))
    for(const name of keys)q=q.order(name)
    return q
  })
}

export function shopBoard({accounts,publicationAccounts=[],inventory,jobs,orders,references,drafts,postedRefs=[],listingCovers=[]}){
  // Publication receipts can outlive the account in the current Scalency directory.
  const logins=new Map([...publicationAccounts,...accounts].filter(r=>r.id&&r.login?.trim()).map(r=>[String(r.id),r.login.trim()]))
  const login=id=>logins.get(String(id))||id
  const refs=new Map(postedRefs.map(r=>[identity(r.type,login(r.account),r.id),r.sku]))
  const posted=(type,account,id)=>id&&(refs.get(identity(type,login(account),id))||refs.get(identity(type,'',id)))
  const saved=new Map(listingCovers.map(c=>[identity(c.account,c.id),c]))
  const feeds={comptes:Array.from(logins,([id,login])=>({id,login})),annonces:[],supprimees:[],publications:[],republications:[],commandes:[]}
  for(const record of inventory){
    const raw=record.payload
    const cached=saved.get(identity(raw.account_id,raw.id))
    const removed=cached?.deletedAt && !(Date.parse(raw.updated_at)>Date.parse(cached.deletedAt))
    const sale=Object.hasOwn(raw,'sale')?raw.sale:cached?.sale
    const r={...raw,status:removed?'deleted':raw.status,photo_url:raw.photo_url||cached?.photo,sku:raw.sku||cached?.sku,replaced_by:raw.replaced_by||cached?.replaced,sale,
      sold:raw.sold===true||['vendue','terminee','en_cours'].includes(sale?.state)}
    const [item]=skuSourceRows('items',[r])
    item.sku=item.sku||posted('listing',item.account,item.id)
    Object.assign(item,{inventory:true,accountId:record.account||r.account_id||r.account,photo:safePhoto(item.photo)||safePhoto(record.photo),seen:record.seen_at,
      size:record.listed_size||record.size,location:record.emplacement||r.location})
    feeds.annonces.push(item)
  }
  const visibility=new Map()
  for(const job of jobs){
    if(job.status!=='done')continue
    if(['hide','unhide'].includes(job.type)&&job.item_id){
      const k=identity(job.account_id,job.item_id),stamp=Date.parse(job.done_at||job.updated_at)
      if(Number.isFinite(stamp)&&(!visibility.has(k)||visibility.get(k).stamp<stamp))visibility.set(k,{hidden:job.type==='hide',stamp})
    }
    if(!job.new_item_id||!['relist','publish'].includes(job.type))continue
    const [receipt]=skuSourceRows('jobs',[job])
    receipt.sku=posted('listing',receipt.account,receipt.id)||receipt.sku||posted('job',receipt.account,job.id)
    feeds[job.type==='publish'?'publications':'republications'].push(receipt)
  }
  for(const ad of feeds.annonces)if(ad.status==='inactive'&&visibility.get(identity(ad.account,ad.id))?.hidden)ad.hidden=true
  const recent=new Map()
  for(const r of orders){
    if(!inSalesPeriod(r.order_date))continue
    const k=identity(login(r.account),r.vinted_transaction_id||r.id),prior=recent.get(k)
    if(!prior||Date.parse(r.status_updated_at||r.order_date)>Date.parse(prior.status_updated_at||prior.order_date))recent.set(k,r)
  }
  feeds.commandes=skuSourceRows('orders',[...recent.values()])
  for(const order of feeds.commandes)for(const line of order.lines){
    line.sku=posted('listing',order.account,line.listing)||posted('line',order.account,line.id)||line.sku
  }
  const manual=references.manual.map(ref=>({...ref,account:login(ref.account)}))
  const report=buildSkuActivity(feeds,{...references,manual,listingSku:(account,id)=>posted('listing',account,id)},'',true)
  const listings=new Map(),soldLines=new Map()
  for(const g of report.rows){
    for(const ad of g.listings){ad.photo=safePhoto(ad.photo);listings.set(identity(ad.account,ad.id),{...ad,sku:g.sku})}
    for(const sale of g.sales){
      sale.photo=safePhoto(sale.photo)
      if(sale.lineId)soldLines.set(identity(sale.account,sale.id,sale.lineId),g.sku)
    }
  }
  const exactLines=new Map(references.lines.map(r=>[identity(login(r.account),r.order,r.id),r]))
  const manualLines=new Map(manual.filter(r=>r.kind==='sale').map(r=>[identity(r.account,r.id,r.line),r.sku]))
  const sales=[...recent.values()].map(r=>{
    const account=login(r.account)
    const lines=(r.items||[]).map(i=>{
      const k=identity(account,r.id,i.id),ref=exactLines.get(k)
      const ad=listings.get(identity(account,i.vinted_id||ref?.listing))
      return {id:i.id,title:i.title||r.title,sku:posted('listing',account,i.vinted_id||ref?.listing)||posted('line',account,i.id)||manualLines.get(k)||soldLines.get(k)||i.sku||ref?.sku||i.product_sku||ad?.sku,
        photo:safePhoto(i.thumbnail)||ad?.photo,size:ad?.size,quantity:i.quantity??1,location:i.location||ad?.location}
    })
    return {id:r.id,accountId:r.account,account,title:r.title,date:r.order_date,estimated:!!r.order_date_estimated,status:r.normalized_status,state:r.state,
      label:r.status_fr,deadline:r.deadline,hasLabel:r.has_label===true,printed:r.printed_at,packed:r.packed_at,
      amount:r.subtotal,currency:r.currency,carrier:r.carrier,lines}
  })
  return {groups:report.rows,emptyOrders:report.emptyOrders,sales,drafts:drafts.map(d=>({...d,accountId:d.account,account:login(d.account)}))}
}

export async function readShopBoard(db,user,admin){
  const [accts,inventory,jobRows,orderRows,references,drafts,sync,posted,media,publicationAccounts]=await Promise.all([
    all(db,'scalency_records','remote_id,login:payload->>login',q=>q.eq('kind','accounts'),['remote_id']),
    all(db,'scalency_catalog_inventory','remote_id,account,payload,photo,seen_at,listed_size,size,emplacement',q=>q,['account','remote_id']),
    all(db,'scalency_records','payload',q=>q.eq('kind','jobs').eq('payload->>status','done').in('payload->>type',['publish','relist','hide','unhide']),['account','remote_id']),
    all(db,'scalency_records','payload',q=>q.eq('kind','orders').gte('sort_at',salesStart),['account','remote_id']),
    skuReferences(db,user),
    admin?all(db,'listing_drafts','id,fields,photo:photos->0->>path,updated_at',q=>q.eq('state','draft').eq('owner_id',user.id).not('fields->>account_id','is',null).is('vinted_id',null),['id']):[],
    db.from('scalency_settings').select('id,value').like('id','dressing-read-v1:%'),
    all(db,'scalency_settings','id,value',q=>q.like('id','dressing-ref:%'),['id']),
    all(db,'scalency_settings','id,value',q=>q.like('id','dressing-cover:%'),['id']),
    all(db,'publication_accounts','id,login',q=>q.not('login','is',null),['id'])
  ])
  const photos=[...new Set(drafts.map(r=>r.photo).filter(p=>p&&ownedAsset(p,user.id)))]
  const covers=new Map()
  for(let offset=0;offset<photos.length;offset+=100){
    const signed=await db.storage.from(ASSET_BUCKET).createSignedUrls(photos.slice(offset,offset+100),3600)
    for(const r of signed.data||[])if(r.signedUrl)covers.set(r.path,r.signedUrl)
  }
  const dataset=shopBoard({publicationAccounts,accounts:accts.map(r=>({id:r.remote_id,login:r.login})),inventory,jobs:jobRows.map(r=>r.payload),
    orders:orderRows.map(r=>r.payload),references,listingCovers:media.map(r=>r.value),postedRefs:posted.map(r=>r.value),drafts:drafts.map(d=>({id:d.id,account:d.fields.account_id,sku:d.fields.sku,title:d.fields.title,
      size:d.fields.size_text,price:d.fields.price,photo:covers.get(d.photo),status:'brouillon',seen:d.updated_at,isDraft:true}))})
  const stamps=check(sync).map(r=>r.value?.at).filter(Boolean).sort()
  return {...dataset,checkedAt:stamps.length===5?stamps[0]:null}
}
