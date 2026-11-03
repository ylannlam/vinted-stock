import {previewPhotos} from './previewPhotos'
const at=new Date().toISOString()
const orders=[{ref:'GDEMO000001',order_date:at.slice(0,10),observed_at:at,updated_at:at,payment:{paid_total:41.09,shipping:3.90,currency:'EUR',source:'order_summary'},shipment_observations:[{tracking_number:'GFRDEMO123456',carrier:'GOFO',status_text:'En transit',eta:'6–12 novembre',skus:['DEMO-101-M'],observed_at:at}],items:[
  {id:'demo-order-item-1',sku:'DEMO-101-M',title:'Robe à épaules dénudées',size:'S',color:'Bleu ciel',quantity:1,unit_price:20.05,status:'shipped',present:true,eta:'6–12 novembre',photo:previewPhotos[1][0],product_url:'https://fr.shein.com/Demo-p-123456.html',links:[{line_id:'demo-1',origin:'auto'}]},
  {id:'demo-order-item-2',sku:'DEMO-102-M',title:'Combinaison côtelée',size:'M',color:'Noir',quantity:2,unit_price:8.57,status:'processing',present:true,eta:'10–17 novembre',photo:previewPhotos[2][0],product_url:'https://fr.shein.com/Demo-p-123457.html',links:[]}
]}]
export function sheinOrdersPreview(lines,body) {
  if(body){const item=orders.flatMap(o=>o.items).find(i=>i.id===body.item_id),line=lines.find(l=>l.id===body.line_id)
    if(!item||!line)throw Error('Choisis une vente.')
    if(body.operation==='unlink')item.links=item.links.filter(l=>l.line_id!==line.id)
    if(body.operation==='link')item.links.push({line_id:line.id,origin:'manual'})
    if(body.operation==='confirm_received')line.stage='received'
    return {saved:true}
  }
  return structuredClone({orders,count:orders.length,tracking:{starts_at:'2026-10-30T23:00:00Z'},runs:[{id:'run-demo',mode:'full',state:'completed',read_count:1,discovered:1,errors:[],started_at:at}],sync:{last_completed_at:at},lines:lines.map(l=>({id:l.id,title:l.source.title,sku:l.source.sku,size:l.supplier_size,color:l.supplier_color,stage:l.stage,account:l.order.account_login,updated_at:l.updated_at,item_id:orders.flatMap(o=>o.items).find(i=>i.links.some(a=>a.line_id===l.id))?.id}))})
}
let ordersState={enabled:true,phase:'done',message:'1 commande lue · 1 vente associée.',done:1,total:1,lastCompletedAt:Date.now(),hasTab:true}
export function sheinBridgePreview(action) {
  if(action==='orders_pause')ordersState={...ordersState,enabled:false,message:'Lecture des commandes en pause.'}
  if(action==='orders_start'||action==='orders_resume')ordersState={...ordersState,enabled:true,message:'1 commande lue · 1 vente associée.',lastCompletedAt:Date.now()}
  return structuredClone(ordersState)
}
