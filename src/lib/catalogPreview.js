import { validateObservation, validateSupplierAssociation } from '../../server/catalog'
import { collectionReferences,latestCollections } from './collector'
import {previewPhotos} from './previewPhotos'
import {sheinBridgePreview} from './sheinOrdersPreview'
const product={id:'11111111-1111-4111-8111-111111111111',supplier_id:'123456',supplier_url:'https://fr.shein.com/Demo-p-123456.html',title:'Robe midi à fleurs · exemple',supplier_sku:'sz-DEMO',price:18.08,previous_price:19.90,size:'M',color:'Nude',availability:'available',observed_at:new Date().toISOString(),linked_skus:1}
const products=[product],items=[{id:'demo-item',sku:'sz-DEMO',title:'Robe midi · taille M',supplier_url:product.supplier_url}],links=[{sku:'sz-DEMO',product_id:product.id,updated_at:new Date().toISOString()}]
const observations=[{id:crypto.randomUUID(),product_id:product.id,price:18.08,currency:'EUR',size:'M',color:'Nude',availability:'available',observed_at:new Date().toISOString()},{id:crypto.randomUUID(),product_id:product.id,price:19.90,currency:'EUR',size:'M',color:'Nude',availability:'available',observed_at:new Date(Date.now()-86400000).toISOString()}]
Object.assign(product,{collection_status:'completed',price_scope:'product',size:'',last_checked_at:new Date().toISOString(),next_check_at:new Date(Date.now()+21600000).toISOString(),sizes:[{size:'S',availability:'available'},{size:'M',availability:'available'},{size:'L',availability:'unavailable'}],description:'Exemple de description récupérée sur la fiche fournisseur.',details:[{name:'Taille · Tour de poitrine',value:'M · 92 cm'}]})
const sales=[{sku:'sz-DEMO',currency:'EUR',quantity:8,known_prices:8,revenue:320,last_sale:new Date().toISOString()}]
Object.assign(product,{title:'Robe à épaules dénudées · exemple',photo_url:previewPhotos[1][0],photos:previewPhotos[1]})
for (const [i,title,color] of [[0,'Body à manches longues · exemple','Noir'],[2,'Combinaison côtelée · exemple','Noir']]) {
  const p={...product,id:`11111111-1111-4111-8111-11111111111${i+2}`,supplier_sku:`sz-DEMO-${i+2}`,supplier_id:String(123457+i),title,color,photo_url:previewPhotos[i][0],photos:previewPhotos[i],price:12.5+i,previous_price:null}
  products.push(p)
  links.push({sku:p.supplier_sku,product_id:p.id,updated_at:new Date().toISOString()})
}
const tracking={starts_at:'2026-10-30T23:00:00Z',time_zone:'Europe/Paris'}
// Bibliothèque : les 3 produits ci-dessus sont vendus ; un produit ajouté par SKU et deux annonces Dotb postées.
products.forEach(p=>{p.sold=true})
products.push({...product,id:'11111111-1111-4111-8111-111111111115',supplier_id:'123499',supplier_sku:'sz-AJOUT-1',title:'Jupe longue vintage à motifs · exemple',color:'Marron',photo_url:previewPhotos[2][0],photos:previewPhotos[2],price:9.68,previous_price:9.14,sold:false,added_at:new Date().toISOString(),category:null,sale_price:null})
const posted=[
  {id:'22222222-2222-4222-8222-222222222221',sku:'sz-POSTE-1',title:'Top navettage manches larges taille XS',account_login:'lea.dressing',status:'published',price:'31',currency:'EUR',photo_url:previewPhotos[0][0],synced_at:new Date().toISOString()},
  {id:'22222222-2222-4222-8222-222222222222',sku:'sz-POSTE-1',title:'Top navettage gris',account_login:'mia.closet',status:'pending',price:'29',currency:'EUR',photo_url:previewPhotos[0][1]||previewPhotos[0][0],synced_at:new Date().toISOString()},
  {id:'22222222-2222-4222-8222-222222222223',sku:'sz-AJOUT-1',title:'Jupe longue vintage taille S',account_login:'lea.dressing',status:'published',price:'39',currency:'EUR',photo_url:previewPhotos[2][0],synced_at:new Date().toISOString()},
]
links.push({sku:'sz-AJOUT-1',product_id:'11111111-1111-4111-8111-111111111115',updated_at:new Date().toISOString()})
let pricing={tiers:[{max:6,price:31},{max:10,price:39},{max:14,price:49},{max:18,price:64}],above:4.4},lastDotbSync=new Date(Date.now()-3600000).toISOString()
const devices=[],jobs=Array.from({length:4},(_,i)=>({id:crypto.randomUUID(),reference_key:`sku:sz-DEMO-${i+1}`,input:`sz-DEMO-${i+1}`,expected_sku:`sz-DEMO-${i+1}`,status:['completed','completed','running','queued'][i],message:null,created_at:new Date(Date.now()-(i+1)*60000).toISOString()}))
const connectionDemo=new URLSearchParams(location.search).get('connect-demo')
let browserState={version:'0.7.1',connected:!connectionDemo,enabled:!connectionDemo,phase:connectionDemo?'idle':'extract',job:connectionDemo?null:jobs[2],completed:2,lastContactAt:Date.now(),message:'Récupération des photos et du lien Shein…'}
export async function collectorBridgePreview(action='status') {
  if(action==='connect')browserState={...browserState,connected:true,device_id:devices.at(-1)?.id}
  if(action==='start'||action==='resume')browserState={...browserState,enabled:true,phase:'idle',message:'En attente de tes liens ou SKU.'}
  if(action==='pause')browserState={...browserState,enabled:false,message:'Import en pause.'}
  return structuredClone({...browserState,version:'0.7.1',orders:sheinBridgePreview(action),lastContactAt:Date.now()})
}
export async function collectorPreview(method='GET',body) {
  if(body?.action==='create_device'&&connectionDemo==='full')throw Error('Cinq PC sont déjà associés. Déconnecte un ancien PC pour en ajouter un autre.')
  if(method==='GET'){
    const recent=latestCollections(jobs),count=status=>recent.filter(j=>status.includes(j.status)).length
    return structuredClone({devices:devices.filter(d=>!d.revoked_at),jobs,pending:count(['queued','running']),progress:{total:recent.length,completed:count(['completed']),queued:count(['queued']),running:count(['running']),review:count(['blocked','failed'])}})
  }
  if(body.action==='create_device'){const id=crypto.randomUUID();devices.push({id,name:body.name,enabled:true,expires_at:new Date(Date.now()+90*86400000).toISOString()});return {id,token:'CODE-DEMONSTRATION-SANS-ACCES'}}
  if(body.action==='pause_device'){devices.find(d=>d.id===body.id).enabled=body.enabled;return {saved:true}}
  if(body.action==='revoke_device'){devices.find(d=>d.id===body.id).revoked_at=new Date().toISOString();return {saved:true}}
  if(body.action==='queue_due')return {queued:0}
  const refs=body.action==='retry'?jobs.filter(j=>(body.ids||[body.id]).includes(j.id)&&['blocked','failed'].includes(j.status)):collectionReferences(body.references)
  let queued=0
  for(const ref of refs)if(!jobs.some(j=>j.reference_key===ref.reference_key&&j.status==='queued')){jobs.unshift({...ref,id:crypto.randomUUID(),status:'queued',created_at:new Date().toISOString()});queued++}
  return {queued}
}
export async function catalogPreview(method='GET',body,query='') {
  if(method==='GET' && query.includes('product_id'))return {observations:structuredClone(observations),count:observations.length}
  if(method==='GET'){
    return structuredClone({products,items,links,sales,tracking,product_count:products.length,item_count:items.length,link_count:links.length,sales_count:sales.length,connected:true,last_sync:new Date().toISOString(),
      library_ready:true,posted,posted_count:posted.length,pricing,dotb_sync:{last_completed_at:lastDotbSync,running:false,resumable:false}})
  }
  if(body.action==='library-add'){const refs=collectionReferences(body.references);return {queued:refs.length,references:refs.length}}
  if(body.action==='library-sync'){lastDotbSync=new Date().toISOString();return {done:true,pages:1,items:posted.length}}
  if(body.action==='pricing'){pricing=body.pricing;return {saved:true,pricing}}
  if(body.action==='product-meta'){const p=products.find(p=>p.id===body.product_id);const sale=body.sale_price===''||body.sale_price==null?null:Number(String(body.sale_price).replace(',','.'));Object.assign(p,{category:body.category||null,sale_price:sale});return {saved:true,product_id:p.id,category:p.category,sale_price:p.sale_price}}
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
