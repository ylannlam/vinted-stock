import { validateObservation, validateSupplierAssociation } from '../../server/catalog'
import { collectionReferences } from './collector'
const product={id:'11111111-1111-4111-8111-111111111111',supplier_id:'123456',supplier_url:'https://fr.shein.com/Demo-p-123456.html',title:'Robe midi à fleurs · exemple',supplier_sku:'sz-DEMO',price:18.08,previous_price:19.90,size:'M',color:'Nude',availability:'available',observed_at:new Date().toISOString(),linked_skus:1}
const products=[product],items=[{id:'demo-item',sku:'sz-DEMO',title:'Robe midi · taille M',supplier_url:product.supplier_url}],links=[{sku:'sz-DEMO',product_id:product.id,updated_at:new Date().toISOString()}]
const observations=[{id:crypto.randomUUID(),product_id:product.id,price:18.08,currency:'EUR',size:'M',color:'Nude',availability:'available',observed_at:new Date().toISOString()},{id:crypto.randomUUID(),product_id:product.id,price:19.90,currency:'EUR',size:'M',color:'Nude',availability:'available',observed_at:new Date(Date.now()-86400000).toISOString()}]
Object.assign(product,{collection_status:'completed',price_scope:'product',size:'',last_checked_at:new Date().toISOString(),next_check_at:new Date(Date.now()+21600000).toISOString(),sizes:[{size:'S',availability:'available'},{size:'M',availability:'available'},{size:'L',availability:'unavailable'}],description:'Exemple de description récupérée sur la fiche fournisseur.',details:[{name:'Taille · Tour de poitrine',value:'M · 92 cm'}]})
const sales=[{sku:'sz-DEMO',currency:'EUR',quantity:8,known_prices:8,revenue:320,last_sale:new Date().toISOString()}]
const tracking={starts_at:'2026-10-29T23:00:00Z',time_zone:'Europe/Paris'}
items[0].tracking_status='included'
items.push({id:'22222222-2222-4222-8222-222222222222',sku:'sz-DEMO-RECENT',title:'Article à classer · exemple',tracking_status:'unclassified'})
const devices=[],jobs=[]
let browserState={version:'0.4.0',connected:false,enabled:false,phase:'idle',message:'Navigateur prêt à être connecté.'}
export async function collectorBridgePreview(action='status') {
  if(action==='connect')browserState={...browserState,connected:true,device_id:devices.at(-1)?.id}
  if(action==='start'||action==='resume')browserState={...browserState,enabled:true,phase:'idle',message:'En attente de tes liens ou SKU.'}
  if(action==='pause')browserState={...browserState,enabled:false,message:'Import en pause.'}
  return structuredClone(browserState)
}
export async function collectorPreview(method='GET',body) {
  if(method==='GET')return structuredClone({devices:devices.filter(d=>!d.revoked_at),jobs,pending:jobs.filter(j=>j.status==='queued').length})
  if(body.action==='create_device'){const id=crypto.randomUUID();devices.push({id,name:body.name,enabled:true,expires_at:new Date(Date.now()+90*86400000).toISOString()});return {id,token:'CODE-DEMONSTRATION-SANS-ACCES'}}
  if(body.action==='pause_device'){devices.find(d=>d.id===body.id).enabled=body.enabled;return {saved:true}}
  if(body.action==='revoke_device'){devices.find(d=>d.id===body.id).revoked_at=new Date().toISOString();return {saved:true}}
  if(body.action==='queue_due')return {queued:0}
  const refs=body.action==='retry'?[jobs.find(j=>j.id===body.id)]:collectionReferences(body.references)
  let queued=0
  for(const ref of refs)if(!jobs.some(j=>j.reference_key===ref.reference_key&&j.status==='queued')){jobs.unshift({...ref,id:crypto.randomUUID(),status:'queued',created_at:new Date().toISOString()});queued++}
  return {queued}
}
export async function catalogPreview(method='GET',body,query='') {
  if(method==='GET' && query.includes('product_id'))return {observations:structuredClone(observations),count:observations.length}
  if(method==='GET'){
    const active=items.filter(i=>i.tracking_status==='included'),activeLinks=links.filter(l=>active.some(i=>i.sku===l.sku)),activeProducts=products.filter(p=>activeLinks.some(l=>l.product_id===p.id)||!links.some(l=>l.product_id===p.id)),activeSales=sales.filter(s=>active.some(i=>i.sku===s.sku))
    return structuredClone({products:activeProducts,items:active,links:activeLinks,sales:activeSales,review_items:items,review_count:items.length,tracking,product_count:activeProducts.length,item_count:active.length,link_count:activeLinks.length,sales_count:activeSales.length,connected:true,last_sync:new Date().toISOString()})
  }
  if(body.action==='classify'){items.filter(i=>body.ids.includes(i.id)).forEach(i=>i.tracking_status=body.status);return {saved:true,classified:body.ids.length}}
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
