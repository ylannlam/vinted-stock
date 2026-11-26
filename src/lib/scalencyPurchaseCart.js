import {purchaseDay,purchaseSize} from './dailyPurchases.js'
import {sheinProduct,sheinSearchUrl} from './catalog.js'
import {saleBucket} from './shopView.js'

export function scalencyPurchaseCart(sales,day){
  const groups=new Map(),incomplete=[]
  let units=0,orders=0
  for(const sale of sales){
    if(!sale.date||!Number.isFinite(Date.parse(sale.date))||purchaseDay(sale.date)!==day)continue
    if(sale.packed||sale.status==='packed'||saleBucket(sale)!=='dispatch')continue
    const lines=sale.lines.filter(line=>(line.state||sale.state)==='to_order')
    if(!lines.length){
      if(!sale.lines.length&&sale.state==='to_order')incomplete.push(sale)
      continue
    }
    orders++
    for(const [index,line] of lines.entries()){
      const sku=String(line.sku||'').trim(),size=String(line.size||'').trim(),color=String(line.color||'').trim()
      const product=sheinProduct(line.supplierUrl)||sheinProduct(sku)
      const search=sheinSearchUrl(sku)
      const title=line.title||sale.title||'Article vendu'
      const reference=search?sku:''
      const key=JSON.stringify([reference.toLowerCase(),product?.supplier_id||'',purchaseSize(size),color.toLowerCase()||title.toLowerCase(),
        (!size||(!reference&&!product))?[sale.accountId,sale.id,line.id,index]:null])
      const quantity=Number(line.quantity??1)
      if(!Number.isSafeInteger(quantity)||quantity<=0){
        if(!incomplete.includes(sale))incomplete.push(sale)
        continue
      }
      const group=groups.get(key)||{key,title,sku:reference,size,color,product:product?.supplier_url,search,photo:line.photo,quantity:0,sales:[]}
      group.quantity+=quantity
      if(!group.sales.includes(sale))group.sales.push(sale)
      groups.set(key,group)
      units+=quantity
    }
  }
  return {groups:[...groups.values()],units,orders,incomplete}
}
