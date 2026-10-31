import { validateObservation, validateSupplierAssociation } from '../../server/catalog'
const product={id:'11111111-1111-4111-8111-111111111111',supplier_id:'123456',supplier_url:'https://fr.shein.com/Demo-p-123456.html',title:'Robe midi à fleurs · exemple',supplier_sku:'sz-DEMO',price:18.08,previous_price:19.90,size:'M',color:'Nude',availability:'available',observed_at:new Date().toISOString(),linked_skus:1}
const products=[product],items=[{id:'demo-item',sku:'sz-DEMO',title:'Robe midi · taille M',supplier_url:product.supplier_url}],links=[{sku:'sz-DEMO',product_id:product.id,updated_at:new Date().toISOString()}]
const observations=[{id:crypto.randomUUID(),product_id:product.id,price:18.08,currency:'EUR',size:'M',color:'Nude',availability:'available',observed_at:new Date().toISOString()},{id:crypto.randomUUID(),product_id:product.id,price:19.90,currency:'EUR',size:'M',color:'Nude',availability:'available',observed_at:new Date(Date.now()-86400000).toISOString()}]
export async function catalogPreview(method='GET',body,query='') {
  if(method==='GET' && query.includes('product_id'))return {observations:structuredClone(observations),count:observations.length}
  if(method==='GET')return structuredClone({products,items,links,product_count:products.length,item_count:items.length,link_count:links.length,connected:true,last_sync:new Date().toISOString()})
  if(body.action==='sync')return {has_more:false,processed:1}
  if(body.action==='supplier'){
    const valid=validateSupplierAssociation(body)
    let target=products.find(p=>p.supplier_id===valid.supplier_id)
    if(!target){target={...valid,id:crypto.randomUUID(),title:items.find(i=>i.sku===valid.sku)?.title||valid.sku};products.push(target)}
    const old=links.find(l=>l.sku===valid.sku)
    if(old)Object.assign(old,{product_id:target.id,updated_at:new Date().toISOString()})
    else links.push({sku:valid.sku,product_id:target.id,updated_at:new Date().toISOString()})
    return {saved:true,product_id:target.id}
  }
  if(body.action==='observe'){
    const valid=validateObservation(body);let target=products.find(p=>p.supplier_id===valid.product.supplier_id)
    if(!target){target={...valid.product,id:crypto.randomUUID()};products.push(target)}
    if(!observations.some(o=>o.id===valid.observation.id)){observations.unshift({...valid.observation,product_id:target.id});Object.assign(target,{...valid.observation,id:target.id,previous_price:target.price})}
    return {saved:true,product_id:target.id}
  }
  if(body.action==='link'){const old=links.find(l=>l.sku===body.sku);if(old)Object.assign(old,body);else links.push(body);return {saved:true}}
}
