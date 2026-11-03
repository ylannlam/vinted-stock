import {buildDailyPurchases,purchaseDay} from './dailyPurchases'
import {previewPhotos} from './previewPhotos'

export function dailyCartDemo() {
  const at=new Date().toISOString()
  const catalog=[{sku:'DEMO-PANIER-01',supplier_url:'https://fr.shein.com/Demo-p-123456.html',price:12.5,currency:'EUR',color:'Noir',sizes:[{size:'M',availability:'available'},{size:'S',availability:'available'}],observed_at:at,photo_url:previewPhotos[0][1]}]
  const lines=[['M','Léa démo'],['M','Emma démo'],['S','Léa démo']].map(([size,account],i)=>({id:'demo-cart-'+i,stage:'to_order',updated_at:at,sale_date:at,supplier_size:size,source:{sku:'DEMO-PANIER-01',title:'Body noir à manches longues',thumbnail_url:previewPhotos[0][0]},order:{account_login:account,status:'label_sent',currency:'EUR'}}))
  return {catalog,lines}
}
export function dailyCartPreview(lines,catalog,day) {
  return buildDailyPurchases({day,lines,catalog,unallocated:[],orders_synced_at:new Date().toISOString(),earlier_pending:{count:lines.filter(l=>purchaseDay(l.sale_date)<day&&l.stage==='to_order').length,oldest_day:lines.filter(l=>l.stage==='to_order').map(l=>purchaseDay(l.sale_date)).sort()[0]}})
}
